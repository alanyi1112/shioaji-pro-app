"""Gateway application composition with production fail-closed startup."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Mapping

from .active_universe import ActiveUniverse, ActiveUniverseSnapshot, canonical_taiwan_symbol
from .control_plane import (
    WATCHLIST_SUBSCRIPTION_REFERENCE,
    ControlPlaneResult,
    GatewayControlPlane,
)
from .model import NormalizedTick, TAIPEI
from .providers import (
    MarketDataProvider,
    ShioajiMarketDataProvider,
    SimulationMarketDataProvider,
)
from .provider_budget import BudgetedMarketDataProvider, ProviderBudgetPolicy
from .runtime_config import (
    GatewayMode,
    GatewayStartupError,
    RuntimeConfig,
    RuntimeSecrets,
    load_runtime_secrets,
)
from .session_buffer import (
    BoundedSessionRingBuffer,
    SessionAppendResult,
    SessionSnapshot,
)
from .session_backfill import SessionBackfillCoordinator
from .subscriptions import SubscriptionManager, SubscriptionSnapshot
from .uplink import RealtimeMicrobatchUplink


@dataclass
class GatewayApplication:
    config: RuntimeConfig
    provider: MarketDataProvider
    active_universe: ActiveUniverse
    subscriptions: SubscriptionManager
    session_buffer: BoundedSessionRingBuffer
    session_backfill: SessionBackfillCoordinator
    now_provider: Callable[[], datetime]
    uplink: RealtimeMicrobatchUplink | None = field(default=None, repr=False)
    uplink_factory: Callable[[RuntimeSecrets], RealtimeMicrobatchUplink] | None = field(
        default=None,
        repr=False,
    )
    started: bool = False
    _uplink_demand_symbols: set[str] = field(default_factory=set, repr=False)
    _uplink_acquired_symbols: set[str] = field(default_factory=set, repr=False)

    def start(self) -> None:
        runtime_secrets = load_runtime_secrets(self.config)
        if self.uplink_factory is not None:
            if runtime_secrets is None:
                raise GatewayStartupError("uplink_runtime_secret_missing")
            self.uplink = self.uplink_factory(runtime_secrets)
        try:
            self.provider.login_data_only(runtime_secrets)
            if self.config.mode is GatewayMode.PRODUCTION:
                for symbol in self.active_universe.snapshot().active_symbols:
                    self.subscriptions.acquire(symbol, "default-universe")
                if self.uplink is not None:
                    self.uplink.connect()
            self.started = True
        except Exception:
            if self.uplink is not None:
                self.uplink.close()
                self.uplink = None
            self.provider.close()
            raise

    def stop(self) -> None:
        self.subscriptions.close()
        if self.uplink is not None:
            self.uplink.close()
            self.uplink = None
        self.provider.close()
        self.started = False

    def replace_user_symbols(self, symbols: Iterable[object]) -> ActiveUniverseSnapshot:
        return self.active_universe.replace_user_symbols(symbols)

    def acquire_symbol(self, symbol: object, reference: object) -> SubscriptionSnapshot:
        return self.subscriptions.acquire(symbol, reference)

    def release_symbol(self, symbol: object, reference: object) -> SubscriptionSnapshot:
        return self.subscriptions.release(symbol, reference)

    def handle_control_event(self, event: object) -> ControlPlaneResult:
        result = GatewayControlPlane(
            self.active_universe,
            self.subscriptions,
        ).handle(event)
        if not result.realtime_available or result.canonical_symbol is None:
            return result
        self.process_pending_ticks()
        backfill = self.session_backfill.ensure_session(
            self.provider,
            result.canonical_symbol,
            self.now_provider(),
        )
        if self.uplink is not None and backfill.point_count:
            self.uplink.send_session_snapshot(
                self.session_buffer.snapshot(result.canonical_symbol)
            )
        self.process_pending_ticks()
        return replace(
            result,
            backfill_status=backfill.status,
            backfill_point_count=backfill.point_count,
            backfill_reason_code=backfill.reason_code,
        )

    def append_session_tick(self, tick: NormalizedTick) -> SessionAppendResult:
        return self.session_buffer.append(tick)

    def session_snapshot(self, symbol: object) -> SessionSnapshot:
        return self.session_buffer.snapshot(symbol)

    def process_pending_ticks(self, limit: int = 32) -> int:
        if not 1 <= limit <= 32:
            raise GatewayStartupError("pending_tick_limit_out_of_range")
        accepted = 0
        for tick in self.provider.drain_ticks(limit):
            append_result = self.session_buffer.append(tick)
            if append_result.accepted:
                accepted += 1
                if self.uplink is not None:
                    snapshot = self.session_buffer.snapshot(tick.canonical_symbol)
                    self.uplink.offer(tick, snapshot.continuity, snapshot.reason_code)
        if self.uplink is not None:
            self.uplink.flush_due()
        return accepted

    def process_uplink_control_events(self) -> int:
        if self.uplink is None:
            return 0
        symbols = self.uplink.poll_subscription_demand()
        if symbols is None:
            return 0
        self.replace_uplink_demand_symbols(symbols)
        return 1

    def replace_uplink_demand_symbols(
        self,
        symbols: Iterable[object],
    ) -> tuple[ControlPlaneResult, ...]:
        desired = {
            canonical
            for symbol in symbols
            if (canonical := canonical_taiwan_symbol(symbol)) is not None
        }
        universe = self.active_universe.replace_user_symbols(desired)
        target = desired.intersection(universe.active_symbols)

        for symbol in sorted(self._uplink_acquired_symbols - target):
            self.subscriptions.release(symbol, WATCHLIST_SUBSCRIPTION_REFERENCE)
            self._uplink_acquired_symbols.discard(symbol)

        results: list[ControlPlaneResult] = []
        for symbol in sorted(target - self._uplink_acquired_symbols):
            result = self.handle_control_event(
                {"type": "watchlist-symbol-added", "symbol": symbol}
            )
            results.append(result)
            if result.realtime_available:
                self._uplink_acquired_symbols.add(symbol)
        self._uplink_demand_symbols = desired
        return tuple(results)

    def safe_health(self) -> dict[str, object]:
        universe = self.active_universe.snapshot()
        provider_budget = (
            self.provider.safe_counts()
            if isinstance(self.provider, BudgetedMarketDataProvider)
            else {}
        )
        uplink = self.uplink.safe_counts() if self.uplink is not None else {
            "uplinkState": "disabled",
            "uplinkPendingSymbolCount": 0,
            "uplinkSentBatchCount": 0,
            "uplinkFailureCount": 0,
            "uplinkCoalescedCount": 0,
        }
        return {
            "mode": self.config.mode.value,
            "started": self.started,
            "activeUniverseLimit": self.config.active_universe_limit,
            **universe.safe_counts(),
            **self.subscriptions.safe_counts(),
            **self.session_buffer.safe_counts(),
            **self.session_backfill.safe_counts(),
            **provider_budget,
            **uplink,
            "uplinkDemandSymbolCount": len(self._uplink_demand_symbols),
            "uplinkAcquiredSymbolCount": len(self._uplink_acquired_symbols),
            "healthTransport": "loopback",
            "shioajiVersion": self.config.shioaji_version,
            "capabilities": list(self.provider.capabilities),
        }


def build_application(
    environment: Mapping[str, str] | None = None,
    provider: MarketDataProvider | None = None,
    now_provider: Callable[[], datetime] | None = None,
) -> GatewayApplication:
    config = RuntimeConfig.from_environment(environment)
    selected_provider = provider
    if selected_provider is None:
        selected_provider = (
            SimulationMarketDataProvider()
            if config.mode is GatewayMode.SIMULATION
            else ShioajiMarketDataProvider()
        )
    budgeted_provider = BudgetedMarketDataProvider(
        selected_provider,
        ProviderBudgetPolicy(
            login_attempt_limit=config.provider_login_attempt_limit,
            subscription_attempt_limit=config.provider_subscription_attempt_limit,
            kbars_daily_limit=config.provider_kbars_daily_limit,
            failure_threshold=config.provider_failure_threshold,
            cooldown_seconds=config.provider_cooldown_seconds,
        ),
        now_provider=now_provider or (lambda: datetime.now(TAIPEI)),
    )
    active_universe = ActiveUniverse(limit=config.active_universe_limit)
    session_buffer = BoundedSessionRingBuffer(
        max_symbols=config.active_universe_limit,
        max_points_per_symbol=config.session_buffer_points_per_symbol,
    )
    uplink_factory = None
    if config.mode is GatewayMode.PRODUCTION:
        assert config.realtime_ingest_url is not None
        uplink_factory = lambda secrets: RealtimeMicrobatchUplink(
            config.realtime_ingest_url or "",
            secrets,
            now_provider=now_provider or (lambda: datetime.now(TAIPEI)),
        )
    return GatewayApplication(
        config=config,
        provider=budgeted_provider,
        active_universe=active_universe,
        subscriptions=SubscriptionManager(
            budgeted_provider,
            active_universe,
            unsubscribe_cooldown_seconds=config.unsubscribe_cooldown_seconds,
        ),
        session_buffer=session_buffer,
        session_backfill=SessionBackfillCoordinator(session_buffer),
        now_provider=now_provider or (lambda: datetime.now(TAIPEI)),
        uplink_factory=uplink_factory,
    )
