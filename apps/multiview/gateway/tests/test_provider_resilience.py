from __future__ import annotations

from datetime import date, datetime
import unittest

from multichart_gateway.model import TAIPEI, normalize_shioaji_tick
from multichart_gateway.provider_budget import (
    BudgetedMarketDataProvider,
    ProviderBudgetPolicy,
)
from multichart_gateway.runtime_config import GatewayStartupError
from multichart_gateway.session_buffer import BoundedSessionRingBuffer


class _Provider:
    capabilities = ("market_login", "tick_subscribe", "daily_kbars")

    def __init__(self) -> None:
        self.connected = False
        self.subscribe_failures = 0

    def login_data_only(self, _runtime_secrets: object) -> None:
        self.connected = True

    def subscribe_ticks(self, _canonical_symbol: str) -> None:
        if self.subscribe_failures:
            self.subscribe_failures -= 1
            raise GatewayStartupError("provider_subscribe_failed")

    def unsubscribe_ticks(self, _canonical_symbol: str) -> None:
        return None

    def fetch_daily_kbars(
        self,
        _canonical_symbol: str,
        _session_date: date,
    ) -> tuple[object, ...]:
        return ()

    def drain_ticks(self, limit: int | None = None) -> list[object]:
        del limit
        return []

    def close(self) -> None:
        self.connected = False


def _policy(**overrides: object) -> ProviderBudgetPolicy:
    values = {
        "login_attempt_limit": 2,
        "subscription_attempt_limit": 6,
        "kbars_daily_limit": 2,
        "failure_threshold": 2,
        "cooldown_seconds": 10,
    }
    values.update(overrides)
    return ProviderBudgetPolicy(**values)  # type: ignore[arg-type]


def _tick(
    source_time: str,
    sequence: int,
    connection_id: str,
    total_volume: int,
):
    return normalize_shioaji_tick(
        "2330.TW",
        {
            "datetime": source_time,
            "open": 100,
            "high": 103,
            "low": 99,
            "close": 102,
            "avg_price": 101,
            "volume": 1,
            "total_volume": total_volume,
            "simtrade": False,
        },
        sequence,
        connection_id,
    )


class ProviderBudgetTests(unittest.TestCase):
    def test_operation_circuit_opens_then_recovers_after_cooldown(self) -> None:
        clock = [100.0]
        raw = _Provider()
        raw.subscribe_failures = 2
        provider = BudgetedMarketDataProvider(
            raw,
            _policy(),
            monotonic=lambda: clock[0],
        )

        for _ in range(2):
            with self.assertRaisesRegex(
                GatewayStartupError,
                "^provider_subscribe_failed$",
            ):
                provider.subscribe_ticks("2330.TW")
        with self.assertRaisesRegex(
            GatewayStartupError,
            "^provider_subscribe_circuit_open$",
        ):
            provider.subscribe_ticks("2330.TW")
        self.assertEqual(provider.safe_counts()["providerCircuitOpenCount"], 1)

        clock[0] += 10
        provider.subscribe_ticks("2330.TW")
        self.assertEqual(provider.safe_counts()["providerCircuitOpenCount"], 0)

    def test_login_and_daily_kbars_budgets_fail_closed(self) -> None:
        raw = _Provider()
        provider = BudgetedMarketDataProvider(raw, _policy())
        provider.login_data_only(None)
        provider.login_data_only(None)
        with self.assertRaisesRegex(
            GatewayStartupError,
            "^provider_login_budget_exhausted$",
        ):
            provider.login_data_only(None)

        provider.fetch_daily_kbars("2330.TW", date(2026, 7, 31))
        provider.fetch_daily_kbars("2317.TW", date(2026, 7, 31))
        with self.assertRaisesRegex(
            GatewayStartupError,
            "^provider_kbars_budget_exhausted$",
        ):
            provider.fetch_daily_kbars("2454.TW", date(2026, 7, 31))


class SessionContinuityTests(unittest.TestCase):
    def test_reconnect_sequence_reset_is_accepted_and_gap_is_partial(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=8)
        first = buffer.append(
            _tick("2026-07-31T09:00:00+08:00", 20, "connection-a", 20)
        )
        resumed = buffer.append(
            _tick("2026-07-31T09:00:10+08:00", 1, "connection-b", 21)
        )
        replay = buffer.append(
            _tick("2026-07-31T09:00:11+08:00", 21, "connection-a", 22)
        )

        snapshot = buffer.snapshot("2330.TW")
        self.assertTrue(first.accepted)
        self.assertEqual(resumed.status, "accepted-reconnect-gap")
        self.assertEqual(replay.status, "retired-connection")
        self.assertEqual(snapshot.continuity, "partial")
        self.assertEqual(snapshot.reason_code, "reconnect_gap")
        self.assertEqual(buffer.safe_counts()["sessionBufferReconnectGapCount"], 1)

    def test_reconnect_replay_and_closed_market_ticks_do_not_mutate_session(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=8)
        buffer.append(_tick("2026-07-31T09:00:00+08:00", 2, "connection-a", 2))
        replay = buffer.append(
            _tick("2026-07-31T09:00:00+08:00", 1, "connection-b", 2)
        )
        closed = buffer.append(
            _tick("2026-07-31T14:00:00+08:00", 3, "connection-a", 3)
        )

        self.assertEqual(replay.status, "duplicate")
        self.assertEqual(closed.status, "market-closed")
        self.assertEqual(len(buffer.snapshot("2330.TW").points), 1)
        self.assertEqual(
            buffer.safe_counts()["sessionBufferClosedMarketDropCount"],
            1,
        )

    def test_new_trading_day_resets_connection_sequence_and_continuity(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=8)
        buffer.append(_tick("2026-07-31T13:30:00+08:00", 20, "connection-a", 20))
        next_day = buffer.append(
            _tick("2026-08-03T09:00:00+08:00", 1, "connection-b", 1)
        )

        snapshot = buffer.snapshot("2330.TW")
        self.assertTrue(next_day.accepted)
        self.assertEqual(snapshot.session_date, date(2026, 8, 3))
        self.assertEqual(snapshot.continuity, "complete")
        self.assertEqual(len(snapshot.points), 1)


if __name__ == "__main__":
    unittest.main()
