"""Long-running gateway process with bounded startup reconnects."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
import math
import signal
from threading import Event

from .active_universe import ActiveUniverse
from .application import GatewayApplication
from .health import LoopbackHealthServer, ServiceHealthState
from .model import TAIPEI
from .providers import ShioajiMarketDataProvider, SimulationMarketDataProvider
from .provider_budget import BudgetedMarketDataProvider, ProviderBudgetPolicy
from .runtime_config import GatewayMode, GatewayStartupError, RuntimeConfig
from .safe_logging import SafeLogger, safe_reason_code
from .session_backfill import SessionBackfillCoordinator
from .session_buffer import BoundedSessionRingBuffer
from .subscriptions import SubscriptionManager
from .uplink import RealtimeMicrobatchUplink


@dataclass(frozen=True)
class ReconnectPolicy:
    delays_seconds: tuple[float, ...] = (1, 2, 5, 10, 30, 60)

    def __post_init__(self) -> None:
        if not 1 <= len(self.delays_seconds) <= 8:
            raise GatewayStartupError("reconnect_policy_invalid")
        if any(
            not math.isfinite(delay) or delay < 0 or delay > 300
            for delay in self.delays_seconds
        ):
            raise GatewayStartupError("reconnect_policy_invalid")

    def delay_after_failure(self, failure_count: int) -> float | None:
        if failure_count < 1 or failure_count > len(self.delays_seconds):
            return None
        return self.delays_seconds[failure_count - 1]


class GatewayService:
    def __init__(
        self,
        application_factory: Callable[[], GatewayApplication],
        health_state: ServiceHealthState,
        health_server: LoopbackHealthServer,
        *,
        reconnect_policy: ReconnectPolicy | None = None,
        stop_event: Event | None = None,
        logger: SafeLogger | None = None,
    ) -> None:
        self._application_factory = application_factory
        self._health_state = health_state
        self._health_server = health_server
        self._reconnect_policy = reconnect_policy or ReconnectPolicy()
        self._stop_event = stop_event or Event()
        self._logger = logger or SafeLogger()

    def request_stop(self) -> None:
        self._stop_event.set()

    def run(self) -> int:
        self._health_server.start()
        failure_count = 0
        application: GatewayApplication | None = None
        try:
            while not self._stop_event.is_set():
                application = self._application_factory()
                try:
                    application.start()
                    self._health_state.transition(
                        "live",
                        reconnect_attempts=failure_count,
                    )
                    self._logger.emit(
                        "gateway_state",
                        phase="provider",
                        state="live",
                        count=failure_count,
                        reasonCode="none",
                    )
                    while not self._stop_event.wait(0.25):
                        getattr(application, "process_uplink_control_events", lambda: 0)()
                        application.process_pending_ticks()
                    getattr(application, "process_uplink_control_events", lambda: 0)()
                    application.process_pending_ticks()
                    if application.uplink is not None:
                        application.uplink.flush_due(force=True)
                    return 0
                except Exception as error:
                    failure_count += 1
                    reason_code = safe_reason_code(error)
                    delay = self._reconnect_policy.delay_after_failure(failure_count)
                    if delay is None:
                        self._health_state.transition(
                            "unavailable",
                            reason_code=reason_code,
                            reconnect_attempts=failure_count,
                        )
                        self._logger.emit(
                            "gateway_state",
                            phase="provider",
                            state="unavailable",
                            count=failure_count,
                            reasonCode=reason_code,
                        )
                        return 1
                    self._health_state.transition(
                        "degraded",
                        reason_code=reason_code,
                        reconnect_attempts=failure_count,
                    )
                    self._logger.emit(
                        "gateway_state",
                        phase="provider",
                        state="degraded",
                        count=failure_count,
                        reasonCode=reason_code,
                    )
                    if self._stop_event.wait(delay):
                        return 0
                finally:
                    if application.started:
                        try:
                            application.stop()
                        except Exception:
                            self._health_state.transition(
                                "degraded",
                                reason_code="provider_stop_failed",
                                reconnect_attempts=failure_count,
                            )
                    application = None
            return 0
        finally:
            self._health_state.transition("stopped")
            self._health_server.stop()


def build_service(config: RuntimeConfig | None = None) -> GatewayService:
    resolved_config = config or RuntimeConfig.from_environment()
    active_universe = ActiveUniverse(
        limit=resolved_config.active_universe_limit,
    )
    health_state = ServiceHealthState(
        mode=resolved_config.mode.value,
        active_universe_limit=resolved_config.active_universe_limit,
    )
    session_buffer = BoundedSessionRingBuffer(
        max_symbols=resolved_config.active_universe_limit,
        max_points_per_symbol=resolved_config.session_buffer_points_per_symbol,
    )
    session_backfill = SessionBackfillCoordinator(session_buffer)

    def application_factory() -> GatewayApplication:
        raw_provider = (
            SimulationMarketDataProvider()
            if resolved_config.mode is GatewayMode.SIMULATION
            else ShioajiMarketDataProvider(
                connection_event_sink=health_state.accept_provider_event,
            )
        )
        provider = BudgetedMarketDataProvider(
            raw_provider,
            ProviderBudgetPolicy(
                login_attempt_limit=resolved_config.provider_login_attempt_limit,
                subscription_attempt_limit=resolved_config.provider_subscription_attempt_limit,
                kbars_daily_limit=resolved_config.provider_kbars_daily_limit,
                failure_threshold=resolved_config.provider_failure_threshold,
                cooldown_seconds=resolved_config.provider_cooldown_seconds,
            ),
        )
        uplink_factory = None
        if resolved_config.mode is GatewayMode.PRODUCTION:
            assert resolved_config.realtime_ingest_url is not None
            uplink_factory = lambda secrets: RealtimeMicrobatchUplink(
                resolved_config.realtime_ingest_url or "",
                secrets,
            )
        return GatewayApplication(
            config=resolved_config,
            provider=provider,
            active_universe=active_universe,
            subscriptions=SubscriptionManager(
                provider,
                active_universe,
                unsubscribe_cooldown_seconds=(
                    resolved_config.unsubscribe_cooldown_seconds
                ),
            ),
            session_buffer=session_buffer,
            session_backfill=session_backfill,
            now_provider=lambda: datetime.now(TAIPEI),
            uplink_factory=uplink_factory,
        )

    return GatewayService(
        application_factory,
        health_state,
        LoopbackHealthServer(health_state, resolved_config.health_port),
    )


def main() -> int:
    try:
        service = build_service()
    except GatewayStartupError as error:
        SafeLogger().emit(
            "gateway_state",
            phase="startup",
            state="unavailable",
            reasonCode=safe_reason_code(error),
        )
        return 1

    def stop(_signum: int, _frame: object) -> None:
        service.request_stop()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        return service.run()
    except GatewayStartupError as error:
        SafeLogger().emit(
            "gateway_state",
            phase="service",
            state="unavailable",
            reasonCode=safe_reason_code(error),
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
