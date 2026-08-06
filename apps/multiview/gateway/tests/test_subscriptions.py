from __future__ import annotations

from threading import Event, Lock, Thread
import unittest

from multichart_gateway.active_universe import ActiveUniverse
from multichart_gateway.runtime_config import GatewayStartupError
from multichart_gateway.subscriptions import SubscriptionManager


class CountingProvider:
    capabilities = ("tick_subscribe", "tick_unsubscribe")

    def __init__(self) -> None:
        self.subscribe_calls: list[str] = []
        self.unsubscribe_calls: list[str] = []
        self.subscribe_entered = Event()
        self.allow_subscribe = Event()
        self.allow_subscribe.set()
        self.fail_subscribe = False
        self._lock = Lock()

    def login_data_only(self, _runtime_secrets: object) -> None:
        return None

    def subscribe_ticks(self, canonical_symbol: str) -> None:
        with self._lock:
            self.subscribe_calls.append(canonical_symbol)
        self.subscribe_entered.set()
        self.allow_subscribe.wait(timeout=2)
        if self.fail_subscribe:
            raise GatewayStartupError("provider_subscribe_failed")

    def unsubscribe_ticks(self, canonical_symbol: str) -> None:
        with self._lock:
            self.unsubscribe_calls.append(canonical_symbol)

    def close(self) -> None:
        return None


class FakeTimer:
    def __init__(self, delay: float, callback: object) -> None:
        self.delay = delay
        self.callback = callback
        self.started = False
        self.cancelled = False

    def start(self) -> None:
        self.started = True

    def cancel(self) -> None:
        self.cancelled = True

    def fire(self) -> None:
        if not self.cancelled:
            assert callable(self.callback)
            self.callback()


class FakeTimerFactory:
    def __init__(self) -> None:
        self.timers: list[FakeTimer] = []

    def __call__(self, delay: float, callback: object) -> FakeTimer:
        timer = FakeTimer(delay, callback)
        self.timers.append(timer)
        return timer


def manager_fixture(
    *,
    provider: CountingProvider | None = None,
    limit: int = 32,
    cooldown: float = 30,
    timer_factory: FakeTimerFactory | None = None,
) -> tuple[SubscriptionManager, CountingProvider, ActiveUniverse, FakeTimerFactory]:
    selected_provider = provider or CountingProvider()
    universe = ActiveUniverse(limit=limit)
    timers = timer_factory or FakeTimerFactory()
    manager = SubscriptionManager(
        selected_provider,
        universe,
        unsubscribe_cooldown_seconds=cooldown,
        timer_factory=timers,
    )
    return manager, selected_provider, universe, timers


class SubscriptionManagerTests(unittest.TestCase):
    def test_reference_count_is_idempotent_and_uses_one_upstream_subscription(self) -> None:
        manager, provider, _, _ = manager_fixture()

        first = manager.acquire("2330.tw", "panel-a")
        repeated = manager.acquire("2330.TW", "panel-a")
        second = manager.acquire("2330.TW", "member-b-panel-c")

        self.assertTrue(first.subscribed)
        self.assertEqual(repeated.reference_count, 1)
        self.assertEqual(second.reference_count, 2)
        self.assertEqual(provider.subscribe_calls, ["2330.TW"])
        self.assertEqual(manager.safe_counts()["subscriptionReferenceCount"], 2)

    def test_concurrent_acquire_is_single_flight_per_symbol(self) -> None:
        provider = CountingProvider()
        provider.allow_subscribe.clear()
        manager, _, _, _ = manager_fixture(provider=provider)
        snapshots: list[object] = []
        errors: list[Exception] = []

        def acquire(reference: str) -> None:
            try:
                snapshots.append(manager.acquire("2330.TW", reference))
            except Exception as error:
                errors.append(error)

        first = Thread(target=acquire, args=("panel-a",))
        second = Thread(target=acquire, args=("panel-b",))
        first.start()
        self.assertTrue(provider.subscribe_entered.wait(timeout=2))
        second.start()
        provider.allow_subscribe.set()
        first.join(timeout=2)
        second.join(timeout=2)

        self.assertEqual(errors, [])
        self.assertEqual(len(snapshots), 2)
        self.assertEqual(provider.subscribe_calls, ["2330.TW"])
        self.assertEqual(manager.snapshot("2330.TW").reference_count, 2)

    def test_last_release_cools_down_and_reacquire_cancels_unsubscribe(self) -> None:
        manager, provider, _, timers = manager_fixture(cooldown=30)
        manager.acquire("2330.TW", "panel-a")
        manager.acquire("2330.TW", "panel-b")

        self.assertEqual(manager.release("2330.TW", "panel-a").reference_count, 1)
        cooling = manager.release("2330.TW", "panel-b")
        self.assertTrue(cooling.cooldown_pending)
        self.assertEqual(len(timers.timers), 1)
        self.assertEqual(timers.timers[0].delay, 30)

        resumed = manager.acquire("2330.TW", "panel-c")
        self.assertTrue(timers.timers[0].cancelled)
        self.assertTrue(resumed.subscribed)
        self.assertEqual(provider.subscribe_calls, ["2330.TW"])

        manager.release("2330.TW", "panel-c")
        timers.timers[1].fire()
        self.assertEqual(provider.unsubscribe_calls, ["2330.TW"])
        self.assertFalse(manager.snapshot("2330.TW").subscribed)

    def test_capacity_and_non_taiwan_symbols_fail_before_provider_call(self) -> None:
        manager, provider, universe, _ = manager_fixture(limit=24)
        universe.replace_user_symbols(["8069.TWO"])

        with self.assertRaisesRegex(GatewayStartupError, "^active_universe_capacity$"):
            manager.acquire("8069.TWO", "panel-a")
        with self.assertRaisesRegex(GatewayStartupError, "^unsupported_canonical_symbol$"):
            manager.acquire("AAPL", "panel-a")
        self.assertEqual(provider.subscribe_calls, [])

    def test_failed_subscribe_releases_reference_and_allows_later_retry(self) -> None:
        provider = CountingProvider()
        provider.fail_subscribe = True
        manager, _, _, _ = manager_fixture(provider=provider)

        with self.assertRaisesRegex(GatewayStartupError, "^provider_subscribe_failed$"):
            manager.acquire("2330.TW", "panel-a")
        self.assertEqual(manager.snapshot("2330.TW").reference_count, 0)

        provider.fail_subscribe = False
        retried = manager.acquire("2330.TW", "panel-a")
        self.assertTrue(retried.subscribed)
        self.assertEqual(provider.subscribe_calls, ["2330.TW", "2330.TW"])


if __name__ == "__main__":
    unittest.main()
