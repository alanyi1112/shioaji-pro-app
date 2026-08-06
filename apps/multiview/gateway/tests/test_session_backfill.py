from __future__ import annotations

from datetime import date, datetime
from threading import Event, Lock, Thread
import unittest

from multichart_gateway.application import build_application
from multichart_gateway.model import (
    NormalizedKbar,
    NormalizedTick,
    TAIPEI,
    normalize_shioaji_kbar,
    normalize_shioaji_tick,
)
from multichart_gateway.runtime_config import GatewayStartupError
from multichart_gateway.session_backfill import SessionBackfillCoordinator
from multichart_gateway.session_buffer import BoundedSessionRingBuffer


SESSION_DATE = date(2026, 7, 31)


def timestamp_ns(hour: int, minute: int, second: int = 0) -> int:
    value = datetime(2026, 7, 31, hour, minute, second, tzinfo=TAIPEI)
    return int(value.timestamp() * 1_000_000_000)


def kbar(symbol: str, minute: int) -> NormalizedKbar:
    return normalize_shioaji_kbar(
        symbol,
        SESSION_DATE,
        timestamp_ns=timestamp_ns(9, minute),
        open_price=100,
        high_price=102,
        low_price=99,
        close_price=101,
        volume=10,
        amount=1_010_000,
    )


def tick(symbol: str, minute: int, second: int, sequence: int) -> NormalizedTick:
    return normalize_shioaji_tick(
        symbol,
        {
            "datetime": datetime(
                2026,
                7,
                31,
                9,
                minute,
                second,
                tzinfo=TAIPEI,
            ),
            "open": 100,
            "high": 103,
            "low": 99,
            "close": 102,
            "avg_price": 101,
            "volume": 2,
            "total_volume": 20 + sequence,
            "simtrade": False,
        },
        sequence,
    )


class BackfillProvider:
    capabilities = (
        "market_login",
        "tick_subscribe",
        "tick_unsubscribe",
        "daily_kbars",
        "safe_health",
    )

    def __init__(self, points: tuple[NormalizedKbar, ...] = ()) -> None:
        self.points = points
        self.calls: list[tuple[str, object]] = []
        self.events: list[str] = []
        self.pending_ticks: list[NormalizedTick] = []
        self.fetch_entered = Event()
        self.allow_fetch = Event()
        self.allow_fetch.set()
        self.fail_fetch = False
        self.connected = False
        self._lock = Lock()

    def login_data_only(self, _runtime_secrets: object) -> None:
        self.connected = True

    def subscribe_ticks(self, canonical_symbol: str) -> None:
        if not self.connected:
            raise GatewayStartupError("provider_not_connected")
        self.events.append(f"subscribe:{canonical_symbol}")

    def unsubscribe_ticks(self, canonical_symbol: str) -> None:
        self.events.append(f"unsubscribe:{canonical_symbol}")

    def fetch_daily_kbars(
        self,
        canonical_symbol: str,
        session_date: date,
    ) -> tuple[NormalizedKbar, ...]:
        with self._lock:
            self.calls.append((canonical_symbol, session_date))
        self.events.append(f"backfill:{canonical_symbol}")
        self.fetch_entered.set()
        self.allow_fetch.wait(timeout=2)
        if self.fail_fetch:
            raise GatewayStartupError("provider_kbars_failed")
        return self.points

    def drain_ticks(self, limit: int | None = None) -> list[NormalizedTick]:
        count = len(self.pending_ticks) if limit is None else limit
        drained = self.pending_ticks[:count]
        del self.pending_ticks[:count]
        return drained

    def close(self) -> None:
        self.connected = False


class SessionBackfillTests(unittest.TestCase):
    def test_opening_session_buffer_skips_history_query(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=8)
        buffer.append(tick("2330.TW", 0, 30, 1))
        provider = BackfillProvider((kbar("2330.TW", 0),))
        coordinator = SessionBackfillCoordinator(buffer)

        result = coordinator.ensure_session(
            provider,
            "2330.TW",
            datetime(2026, 7, 31, 10, 0, tzinfo=TAIPEI),
        )

        self.assertEqual(result.status, "buffer")
        self.assertEqual(provider.calls, [])

    def test_backfill_runs_once_and_stops_before_first_live_tick_minute(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=8)
        buffer.append(tick("2330.TW", 2, 30, 1))
        provider = BackfillProvider(tuple(kbar("2330.TW", minute) for minute in range(3)))
        coordinator = SessionBackfillCoordinator(buffer)
        now = datetime(2026, 7, 31, 10, 0, tzinfo=TAIPEI)

        first = coordinator.ensure_session(provider, "2330.TW", now)
        repeated = coordinator.ensure_session(provider, "2330.TW", now)
        buffer.append(tick("2330.TW", 3, 0, 2))

        snapshot = buffer.snapshot("2330.TW")
        self.assertEqual(first.status, "backfilled")
        self.assertEqual(first.point_count, 2)
        self.assertEqual(repeated.status, "buffer")
        self.assertEqual(provider.calls, [("2330.TW", SESSION_DATE)])
        self.assertEqual(
            [point.source_time.strftime("%H:%M:%S") for point in snapshot.points],
            ["09:00:00", "09:01:00", "09:02:30", "09:03:00"],
        )

    def test_concurrent_requests_share_one_kbars_attempt(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=8)
        provider = BackfillProvider((kbar("2330.TW", 0),))
        provider.allow_fetch.clear()
        coordinator = SessionBackfillCoordinator(buffer)
        now = datetime(2026, 7, 31, 10, 0, tzinfo=TAIPEI)
        results: list[object] = []

        def ensure() -> None:
            results.append(coordinator.ensure_session(provider, "2330.TW", now))

        first = Thread(target=ensure)
        second = Thread(target=ensure)
        first.start()
        self.assertTrue(provider.fetch_entered.wait(timeout=2))
        second.start()
        provider.allow_fetch.set()
        first.join(timeout=2)
        second.join(timeout=2)

        self.assertEqual(len(results), 2)
        self.assertEqual(provider.calls, [("2330.TW", SESSION_DATE)])
        self.assertTrue(all(result.status == "backfilled" for result in results))

    def test_failed_attempt_is_not_repeated_same_day(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=8)
        provider = BackfillProvider()
        provider.fail_fetch = True
        coordinator = SessionBackfillCoordinator(buffer)
        now = datetime(2026, 7, 31, 10, 0, tzinfo=TAIPEI)

        first = coordinator.ensure_session(provider, "2330.TW", now)
        second = coordinator.ensure_session(provider, "2330.TW", now)

        self.assertEqual(first.status, "failed")
        self.assertEqual(first.reason_code, "provider_kbars_failed")
        self.assertEqual(second, first)
        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(coordinator.safe_counts()["sessionBackfillFailureCount"], 1)

    def test_outside_regular_session_does_not_consume_attempt(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=8)
        provider = BackfillProvider((kbar("2330.TW", 0),))
        coordinator = SessionBackfillCoordinator(buffer)

        closed = coordinator.ensure_session(
            provider,
            "2330.TW",
            datetime(2026, 7, 31, 8, 59, tzinfo=TAIPEI),
        )
        opened = coordinator.ensure_session(
            provider,
            "2330.TW",
            datetime(2026, 7, 31, 9, 1, tzinfo=TAIPEI),
        )

        self.assertEqual(closed.status, "not-needed")
        self.assertEqual(opened.status, "backfilled")
        self.assertEqual(len(provider.calls), 1)

    def test_watchlist_control_subscribes_before_backfill_and_exposes_safe_status(self) -> None:
        provider = BackfillProvider((kbar("8069.TWO", 0),))
        application = build_application(
            {},
            provider,
            now_provider=lambda: datetime(2026, 7, 31, 10, 0, tzinfo=TAIPEI),
        )
        application.start()
        try:
            result = application.handle_control_event(
                {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
            )
            repeated = application.handle_control_event(
                {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
            )
        finally:
            application.stop()

        self.assertEqual(result.status, "started")
        self.assertEqual(result.backfill_status, "backfilled")
        self.assertEqual(result.backfill_point_count, 1)
        self.assertEqual(repeated.status, "already-subscribed")
        self.assertEqual(repeated.backfill_status, "buffer")
        self.assertEqual(
            provider.events[:2],
            ["subscribe:8069.TWO", "backfill:8069.TWO"],
        )
        self.assertEqual(len(provider.calls), 1)
        payload = result.safe_payload()
        self.assertEqual(payload["backfillStatus"], "backfilled")
        self.assertNotIn("headers", payload)

    def test_backfill_failure_keeps_live_subscription_and_is_not_retried(self) -> None:
        provider = BackfillProvider()
        provider.fail_fetch = True
        application = build_application(
            {},
            provider,
            now_provider=lambda: datetime(2026, 7, 31, 10, 0, tzinfo=TAIPEI),
        )
        application.start()
        try:
            result = application.handle_control_event(
                {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
            )
            repeated = application.handle_control_event(
                {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
            )
        finally:
            application.stop()

        self.assertTrue(result.realtime_available)
        self.assertEqual(result.reason_code, "none")
        self.assertEqual(result.backfill_status, "failed")
        self.assertEqual(result.backfill_reason_code, "provider_kbars_failed")
        self.assertEqual(repeated.backfill_status, "failed")
        self.assertEqual(len(provider.calls), 1)

    def test_uplink_demand_snapshot_replaces_symbols_and_releases_removed_reference(self) -> None:
        provider = BackfillProvider((kbar("8069.TWO", 0),))
        application = build_application(
            {}, provider,
            now_provider=lambda: datetime(2026, 7, 31, 10, 0, tzinfo=TAIPEI),
        )
        application.start()
        try:
            added = application.replace_uplink_demand_symbols(["8069.TWO"])
            repeated = application.replace_uplink_demand_symbols(["8069.TWO"])
            removed = application.replace_uplink_demand_symbols([])

            self.assertEqual([result.status for result in added], ["started"])
            self.assertEqual(repeated, ())
            self.assertEqual(removed, ())
            self.assertTrue(application.subscriptions.snapshot("8069.TWO").cooldown_pending)
            self.assertEqual(application.safe_health()["uplinkDemandSymbolCount"], 0)
            self.assertEqual(application.safe_health()["uplinkAcquiredSymbolCount"], 0)
            self.assertEqual(provider.events.count("subscribe:8069.TWO"), 1)
            self.assertEqual(len(provider.calls), 1)
        finally:
            application.stop()

    def test_uplink_demand_release_keeps_default_universe_reference(self) -> None:
        provider = BackfillProvider()
        application = build_application(
            {}, provider,
            now_provider=lambda: datetime(2026, 7, 31, 10, 0, tzinfo=TAIPEI),
        )
        application.start()
        try:
            application.acquire_symbol("2330.TW", "default-universe")
            application.replace_uplink_demand_symbols(["2330.TW"])
            self.assertEqual(application.subscriptions.snapshot("2330.TW").reference_count, 2)

            application.replace_uplink_demand_symbols([])
            snapshot = application.subscriptions.snapshot("2330.TW")
            self.assertTrue(snapshot.subscribed)
            self.assertEqual(snapshot.reference_count, 1)
            self.assertFalse(snapshot.cooldown_pending)
        finally:
            application.stop()


if __name__ == "__main__":
    unittest.main()
