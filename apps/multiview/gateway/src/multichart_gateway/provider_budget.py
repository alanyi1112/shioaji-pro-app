"""Bounded provider operations with cooldown and circuit-breaker protection."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from threading import Condition, RLock
import time

from .model import NormalizedKbar, NormalizedTick, TAIPEI
from .providers import MarketDataProvider
from .runtime_config import GatewayStartupError, RuntimeSecrets


@dataclass(frozen=True)
class ProviderBudgetPolicy:
    login_attempt_limit: int
    subscription_attempt_limit: int
    kbars_daily_limit: int
    failure_threshold: int
    cooldown_seconds: float


@dataclass
class _OperationState:
    in_flight: bool = False
    failure_count: int = 0
    circuit_open_until: float = 0


class BudgetedMarketDataProvider:
    """Applies process-wide provider budgets without exposing provider details."""

    def __init__(
        self,
        provider: MarketDataProvider,
        policy: ProviderBudgetPolicy,
        *,
        monotonic: Callable[[], float] = time.monotonic,
        now_provider: Callable[[], datetime] = lambda: datetime.now(TAIPEI),
    ) -> None:
        self._provider = provider
        self._policy = policy
        self._monotonic = monotonic
        self._now_provider = now_provider
        self._condition = Condition(RLock())
        self._operations: dict[tuple[str, str], _OperationState] = {}
        self._login_attempts = 0
        self._subscription_attempts = 0
        self._kbar_day: date | None = None
        self._kbar_attempts = 0
        self._rejected = 0

    @property
    def capabilities(self) -> tuple[str, ...]:
        return self._provider.capabilities

    def login_data_only(self, runtime_secrets: RuntimeSecrets | None) -> None:
        with self._condition:
            if self._login_attempts >= self._policy.login_attempt_limit:
                self._rejected += 1
                raise GatewayStartupError("provider_login_budget_exhausted")
            self._login_attempts += 1
        self._guarded("login", "provider", lambda: self._provider.login_data_only(runtime_secrets))

    def subscribe_ticks(self, canonical_symbol: str) -> None:
        with self._condition:
            if self._subscription_attempts >= self._policy.subscription_attempt_limit:
                self._rejected += 1
                raise GatewayStartupError("provider_subscription_budget_exhausted")
            self._subscription_attempts += 1
        self._guarded(
            "subscribe",
            canonical_symbol,
            lambda: self._provider.subscribe_ticks(canonical_symbol),
        )

    def unsubscribe_ticks(self, canonical_symbol: str) -> None:
        self._guarded(
            "unsubscribe",
            canonical_symbol,
            lambda: self._provider.unsubscribe_ticks(canonical_symbol),
        )

    def fetch_daily_kbars(
        self,
        canonical_symbol: str,
        session_date: date,
    ) -> tuple[NormalizedKbar, ...]:
        with self._condition:
            today = self._now_provider().astimezone(TAIPEI).date()
            if self._kbar_day != today:
                self._kbar_day = today
                self._kbar_attempts = 0
            if self._kbar_attempts >= self._policy.kbars_daily_limit:
                self._rejected += 1
                raise GatewayStartupError("provider_kbars_budget_exhausted")
            self._kbar_attempts += 1
        result: tuple[NormalizedKbar, ...] | None = None

        def fetch() -> None:
            nonlocal result
            result = self._provider.fetch_daily_kbars(canonical_symbol, session_date)

        self._guarded("kbars", f"{canonical_symbol}:{session_date.isoformat()}", fetch)
        assert result is not None
        return result

    def drain_ticks(self, limit: int | None = None) -> list[NormalizedTick]:
        return self._provider.drain_ticks(limit)

    def close(self) -> None:
        self._provider.close()

    def safe_counts(self) -> dict[str, int]:
        with self._condition:
            now = self._monotonic()
            return {
                "providerLoginAttemptCount": self._login_attempts,
                "providerSubscriptionAttemptCount": self._subscription_attempts,
                "providerKbarsAttemptCount": self._kbar_attempts,
                "providerBudgetRejectedCount": self._rejected,
                "providerCircuitOpenCount": sum(
                    state.circuit_open_until > now for state in self._operations.values()
                ),
                "providerOperationInFlightCount": sum(
                    state.in_flight for state in self._operations.values()
                ),
            }

    def _guarded(self, operation: str, key: str, callback: Callable[[], None]) -> None:
        state_key = (operation, key)
        with self._condition:
            state = self._operations.setdefault(state_key, _OperationState())
            while state.in_flight:
                self._condition.wait()
            now = self._monotonic()
            if state.circuit_open_until > now:
                self._rejected += 1
                raise GatewayStartupError(f"provider_{operation}_circuit_open")
            state.in_flight = True
        try:
            callback()
        except Exception:
            with self._condition:
                state.in_flight = False
                state.failure_count += 1
                if state.failure_count >= self._policy.failure_threshold:
                    state.circuit_open_until = self._monotonic() + self._policy.cooldown_seconds
                self._condition.notify_all()
            raise
        with self._condition:
            state.in_flight = False
            state.failure_count = 0
            state.circuit_open_until = 0
            self._condition.notify_all()
