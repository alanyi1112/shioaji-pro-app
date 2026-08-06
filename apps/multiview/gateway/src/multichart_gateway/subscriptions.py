"""Symbol-scoped subscription reference counting and single-flight control."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from threading import Condition, RLock, Timer
from typing import Protocol

from .active_universe import ActiveUniverse, canonical_taiwan_symbol
from .providers import MarketDataProvider
from .runtime_config import GatewayStartupError


MAX_REFERENCE_ID_LENGTH = 128


class CancellableTimer(Protocol):
    def start(self) -> None: ...

    def cancel(self) -> None: ...


TimerFactory = Callable[[float, Callable[[], None]], CancellableTimer]


def _daemon_timer(delay_seconds: float, callback: Callable[[], None]) -> Timer:
    timer = Timer(delay_seconds, callback)
    timer.daemon = True
    return timer


def _validated_reference_id(value: object) -> str:
    if not isinstance(value, str):
        raise GatewayStartupError("invalid_subscription_reference")
    reference_id = value.strip()
    if not reference_id or len(reference_id) > MAX_REFERENCE_ID_LENGTH:
        raise GatewayStartupError("invalid_subscription_reference")
    return reference_id


@dataclass(frozen=True)
class SubscriptionSnapshot:
    canonical_symbol: str
    reference_count: int
    subscribed: bool
    in_flight: bool
    cooldown_pending: bool


@dataclass(frozen=True)
class SubscriptionAcquireResult:
    snapshot: SubscriptionSnapshot
    started_upstream: bool


@dataclass
class _SymbolState:
    references: set[str] = field(default_factory=set)
    subscribed: bool = False
    subscribing: bool = False
    unsubscribing: bool = False
    cooldown_timer: CancellableTimer | None = None


class SubscriptionManager:
    """Shares one upstream subscription across all references for a symbol."""

    def __init__(
        self,
        provider: MarketDataProvider,
        active_universe: ActiveUniverse,
        *,
        unsubscribe_cooldown_seconds: float,
        timer_factory: TimerFactory = _daemon_timer,
    ) -> None:
        if not 0 <= unsubscribe_cooldown_seconds <= 300:
            raise GatewayStartupError("unsubscribe_cooldown_out_of_range")
        self._provider = provider
        self._active_universe = active_universe
        self._unsubscribe_cooldown_seconds = unsubscribe_cooldown_seconds
        self._timer_factory = timer_factory
        self._lock = RLock()
        self._condition = Condition(self._lock)
        self._states: dict[str, _SymbolState] = {}
        self._closed = False

    def acquire(self, symbol: object, reference: object) -> SubscriptionSnapshot:
        return self.acquire_with_result(symbol, reference).snapshot

    def acquire_with_result(
        self,
        symbol: object,
        reference: object,
    ) -> SubscriptionAcquireResult:
        canonical_symbol = canonical_taiwan_symbol(symbol)
        if canonical_symbol is None:
            raise GatewayStartupError("unsupported_canonical_symbol")
        reference_id = _validated_reference_id(reference)
        universe = self._active_universe.snapshot()
        if not universe.contains(canonical_symbol):
            reason = (
                "active_universe_capacity"
                if universe.is_overflow(canonical_symbol)
                else "symbol_not_in_active_universe"
            )
            raise GatewayStartupError(reason)

        with self._condition:
            if self._closed:
                raise GatewayStartupError("subscription_manager_closed")
            state = self._states.setdefault(canonical_symbol, _SymbolState())
            state.references.add(reference_id)
            if state.cooldown_timer is not None:
                state.cooldown_timer.cancel()
                state.cooldown_timer = None

            waited_for_subscribe = state.subscribing
            while state.subscribing or state.unsubscribing:
                self._condition.wait()
                if self._closed:
                    state.references.discard(reference_id)
                    raise GatewayStartupError("subscription_manager_closed")
            if state.subscribed:
                return SubscriptionAcquireResult(
                    self._snapshot(canonical_symbol, state),
                    started_upstream=False,
                )
            if waited_for_subscribe:
                state.references.discard(reference_id)
                self._prune_if_idle(canonical_symbol, state)
                raise GatewayStartupError("provider_subscribe_failed")
            state.subscribing = True

        try:
            self._provider.subscribe_ticks(canonical_symbol)
        except Exception:
            with self._condition:
                state.subscribing = False
                state.references.discard(reference_id)
                self._condition.notify_all()
                self._prune_if_idle(canonical_symbol, state)
            raise GatewayStartupError("provider_subscribe_failed") from None

        timer: CancellableTimer | None = None
        with self._condition:
            state.subscribing = False
            state.subscribed = True
            if not state.references:
                timer = self._schedule_unsubscribe_locked(canonical_symbol, state)
            self._condition.notify_all()
            snapshot = self._snapshot(canonical_symbol, state)
        if timer is not None:
            timer.start()
        return SubscriptionAcquireResult(snapshot, started_upstream=True)

    def release(self, symbol: object, reference: object) -> SubscriptionSnapshot:
        canonical_symbol = canonical_taiwan_symbol(symbol)
        if canonical_symbol is None:
            raise GatewayStartupError("unsupported_canonical_symbol")
        reference_id = _validated_reference_id(reference)
        timer: CancellableTimer | None = None
        with self._condition:
            state = self._states.get(canonical_symbol)
            if state is None:
                return SubscriptionSnapshot(canonical_symbol, 0, False, False, False)
            state.references.discard(reference_id)
            if (
                not state.references
                and state.subscribed
                and not state.subscribing
                and not state.unsubscribing
                and state.cooldown_timer is None
            ):
                timer = self._schedule_unsubscribe_locked(canonical_symbol, state)
            snapshot = self._snapshot(canonical_symbol, state)
        if timer is not None:
            timer.start()
        return snapshot

    def snapshot(self, symbol: object) -> SubscriptionSnapshot:
        canonical_symbol = canonical_taiwan_symbol(symbol)
        if canonical_symbol is None:
            raise GatewayStartupError("unsupported_canonical_symbol")
        with self._lock:
            state = self._states.get(canonical_symbol)
            if state is None:
                return SubscriptionSnapshot(canonical_symbol, 0, False, False, False)
            return self._snapshot(canonical_symbol, state)

    def safe_counts(self) -> dict[str, int]:
        with self._lock:
            return {
                "subscriptionCount": sum(state.subscribed for state in self._states.values()),
                "subscriptionReferenceCount": sum(
                    len(state.references) for state in self._states.values()
                ),
                "subscriptionInFlightCount": sum(
                    state.subscribing or state.unsubscribing
                    for state in self._states.values()
                ),
                "subscriptionCooldownCount": sum(
                    state.cooldown_timer is not None for state in self._states.values()
                ),
            }

    def close(self) -> None:
        with self._condition:
            self._closed = True
            for state in self._states.values():
                if state.cooldown_timer is not None:
                    state.cooldown_timer.cancel()
                    state.cooldown_timer = None
            self._states.clear()
            self._condition.notify_all()

    def _schedule_unsubscribe_locked(
        self,
        canonical_symbol: str,
        state: _SymbolState,
    ) -> CancellableTimer:
        timer: CancellableTimer

        def unsubscribe() -> None:
            self._unsubscribe_after_cooldown(canonical_symbol, timer)

        timer = self._timer_factory(self._unsubscribe_cooldown_seconds, unsubscribe)
        state.cooldown_timer = timer
        return timer

    def _unsubscribe_after_cooldown(
        self,
        canonical_symbol: str,
        timer: CancellableTimer,
    ) -> None:
        with self._condition:
            state = self._states.get(canonical_symbol)
            if (
                self._closed
                or state is None
                or state.cooldown_timer is not timer
                or state.references
                or not state.subscribed
            ):
                return
            state.cooldown_timer = None
            state.subscribed = False
            state.unsubscribing = True

        succeeded = False
        try:
            self._provider.unsubscribe_ticks(canonical_symbol)
            succeeded = True
        except Exception:
            # The provider adapter already maps failures to safe reason codes.
            # Task 3.6 owns any bounded retry policy; do not retry from a timer.
            succeeded = False

        with self._condition:
            state = self._states.get(canonical_symbol)
            if state is None:
                return
            state.unsubscribing = False
            if not succeeded:
                state.subscribed = True
            self._condition.notify_all()
            self._prune_if_idle(canonical_symbol, state)

    def _prune_if_idle(self, canonical_symbol: str, state: _SymbolState) -> None:
        if (
            not state.references
            and not state.subscribed
            and not state.subscribing
            and not state.unsubscribing
            and state.cooldown_timer is None
        ):
            self._states.pop(canonical_symbol, None)

    @staticmethod
    def _snapshot(canonical_symbol: str, state: _SymbolState) -> SubscriptionSnapshot:
        return SubscriptionSnapshot(
            canonical_symbol=canonical_symbol,
            reference_count=len(state.references),
            subscribed=state.subscribed,
            in_flight=state.subscribing or state.unsubscribing,
            cooldown_pending=state.cooldown_timer is not None,
        )
