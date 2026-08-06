from __future__ import annotations

from threading import Event, Lock, Thread
import unittest

from multichart_gateway.active_universe import ActiveUniverse
from multichart_gateway.control_plane import GatewayControlPlane
from multichart_gateway.runtime_config import GatewayStartupError
from multichart_gateway.subscriptions import SubscriptionManager


class ControlPlaneProvider:
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


def control_fixture(
    *,
    limit: int = 32,
    provider: ControlPlaneProvider | None = None,
) -> tuple[GatewayControlPlane, ControlPlaneProvider, ActiveUniverse]:
    selected_provider = provider or ControlPlaneProvider()
    universe = ActiveUniverse(limit=limit)
    subscriptions = SubscriptionManager(
        selected_provider,
        universe,
        unsubscribe_cooldown_seconds=30,
    )
    return GatewayControlPlane(universe, subscriptions), selected_provider, universe


class GatewayControlPlaneTests(unittest.TestCase):
    def test_new_watchlist_symbol_is_added_and_subscribed_immediately(self) -> None:
        control, provider, universe = control_fixture()

        result = control.handle(
            {"type": "watchlist-symbol-added", "symbol": "8069.two"}
        )

        self.assertEqual(result.status, "started")
        self.assertTrue(result.realtime_available)
        self.assertEqual(result.canonical_symbol, "8069.TWO")
        self.assertIn("8069.TWO", universe.snapshot().active_symbols)
        self.assertEqual(provider.subscribe_calls, ["8069.TWO"])

    def test_duplicate_events_share_subscription_and_report_existing_state(self) -> None:
        control, provider, _ = control_fixture()

        first = control.handle(
            {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
        )
        repeated = control.handle(
            {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
        )

        self.assertEqual(first.status, "started")
        self.assertEqual(repeated.status, "already-subscribed")
        self.assertEqual(provider.subscribe_calls, ["8069.TWO"])

    def test_concurrent_duplicate_events_are_single_flight(self) -> None:
        provider = ControlPlaneProvider()
        provider.allow_subscribe.clear()
        control, _, _ = control_fixture(provider=provider)
        statuses: list[str] = []

        def add_symbol() -> None:
            statuses.append(
                control.handle(
                    {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
                ).status
            )

        first = Thread(target=add_symbol)
        second = Thread(target=add_symbol)
        first.start()
        self.assertTrue(provider.subscribe_entered.wait(timeout=2))
        second.start()
        provider.allow_subscribe.set()
        first.join(timeout=2)
        second.join(timeout=2)

        self.assertCountEqual(statuses, ["started", "already-subscribed"])
        self.assertEqual(provider.subscribe_calls, ["8069.TWO"])

    def test_capacity_keeps_watchlist_candidate_without_provider_call(self) -> None:
        control, provider, universe = control_fixture(limit=24)

        result = control.handle(
            {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
        )

        self.assertEqual(result.status, "capacity")
        self.assertFalse(result.realtime_available)
        self.assertEqual(result.reason_code, "active_universe_capacity")
        self.assertIn("8069.TWO", universe.snapshot().overflow_symbols)
        self.assertEqual(provider.subscribe_calls, [])

    def test_invalid_or_non_taiwan_events_fail_with_allowlisted_payload(self) -> None:
        control, provider, _ = control_fixture()

        extra = control.handle(
            {
                "type": "watchlist-symbol-added",
                "symbol": "8069.TWO",
                "user": "must-not-enter-gateway",
            }
        )
        unsupported = control.handle(
            {"type": "watchlist-symbol-added", "symbol": "AAPL"}
        )

        self.assertEqual(
            extra.safe_payload(),
            {
                "status": "failed",
                "realtimeAvailable": False,
                "reasonCode": "invalid_control_event",
            },
        )
        self.assertEqual(unsupported.status, "failed")
        self.assertEqual(unsupported.reason_code, "unsupported_canonical_symbol")
        self.assertNotIn("user", unsupported.safe_payload())
        self.assertEqual(provider.subscribe_calls, [])

    def test_provider_failure_returns_safe_status_and_allows_retry(self) -> None:
        provider = ControlPlaneProvider()
        provider.fail_subscribe = True
        control, _, _ = control_fixture(provider=provider)

        failed = control.handle(
            {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
        )
        provider.fail_subscribe = False
        retried = control.handle(
            {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
        )

        self.assertEqual(failed.status, "failed")
        self.assertEqual(failed.reason_code, "provider_subscribe_failed")
        self.assertEqual(retried.status, "started")
        self.assertEqual(provider.subscribe_calls, ["8069.TWO", "8069.TWO"])


if __name__ == "__main__":
    unittest.main()
