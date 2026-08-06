from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path
import unittest

from multichart_gateway.model import NormalizedTick, normalize_shioaji_tick
from multichart_gateway.runtime_config import GatewayStartupError
from multichart_gateway.session_buffer import BoundedSessionRingBuffer


def tick(
    symbol: str,
    timestamp: str,
    sequence: int,
    *,
    close: int = 100,
) -> NormalizedTick:
    return normalize_shioaji_tick(
        symbol,
        {
            "datetime": timestamp,
            "open": 100,
            "high": max(101, close),
            "low": min(99, close),
            "close": close,
            "avg_price": 100,
            "volume": 1,
            "total_volume": sequence,
            "simtrade": False,
        },
        sequence,
    )


class SessionRingBufferTests(unittest.TestCase):
    def test_same_source_time_and_sequence_is_deduplicated(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=2, max_points_per_symbol=4)
        first = tick("2330.TW", "2026-07-31T09:00:00+08:00", 1)

        self.assertTrue(buffer.append(first).accepted)
        duplicate = buffer.append(first)

        self.assertEqual(duplicate.status, "duplicate")
        self.assertFalse(duplicate.accepted)
        self.assertEqual(len(buffer.snapshot("2330.TW").points), 1)
        self.assertEqual(buffer.stats().duplicates, 1)

    def test_same_source_time_with_distinct_sequence_remains_distinct(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=4)
        buffer.append(tick("2330.TW", "2026-07-31T09:00:00+08:00", 1))
        buffer.append(
            tick("2330.TW", "2026-07-31T09:00:00+08:00", 2, close=101)
        )

        snapshot = buffer.snapshot("2330.TW")
        self.assertEqual([point.sequence for point in snapshot.points], [1, 2])
        self.assertEqual(snapshot.points[-1].close, Decimal("101"))

    def test_replay_cannot_return_after_ring_eviction(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=2)
        original = tick("2330.TW", "2026-07-31T09:00:00+08:00", 1)
        buffer.append(original)
        buffer.append(tick("2330.TW", "2026-07-31T09:00:01+08:00", 2))
        buffer.append(tick("2330.TW", "2026-07-31T09:00:02+08:00", 3))

        replay = buffer.append(original)

        self.assertEqual(replay.status, "duplicate")
        self.assertEqual(
            [point.sequence for point in buffer.snapshot("2330.TW").points],
            [2, 3],
        )

    def test_older_source_time_is_rejected_even_with_newer_sequence(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=2)
        buffer.append(tick("2330.TW", "2026-07-31T09:00:02+08:00", 2))

        older = buffer.append(
            tick("2330.TW", "2026-07-31T09:00:01+08:00", 3)
        )

        self.assertEqual(older.status, "duplicate")
        self.assertEqual(
            [point.sequence for point in buffer.snapshot("2330.TW").points],
            [2],
        )

    def test_ring_evicts_oldest_and_marks_session_truncated(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=2)
        for second in range(3):
            result = buffer.append(
                tick(
                    "2330.TW",
                    f"2026-07-31T09:00:0{second}+08:00",
                    second + 1,
                    close=100 + second,
                )
            )

        snapshot = buffer.snapshot("2330.TW")
        self.assertTrue(result.evicted)
        self.assertTrue(snapshot.truncated)
        self.assertEqual([point.sequence for point in snapshot.points], [2, 3])
        self.assertEqual(buffer.stats().evicted, 1)

    def test_new_session_replaces_old_and_late_old_session_is_rejected(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=4)
        buffer.append(tick("2330.TW", "2026-07-31T13:29:59+08:00", 1))
        buffer.append(tick("2330.TW", "2026-08-03T09:00:00+08:00", 2))
        stale = buffer.append(tick("2330.TW", "2026-07-31T13:30:00+08:00", 3))

        snapshot = buffer.snapshot("2330.TW")
        self.assertEqual(snapshot.session_date, date(2026, 8, 3))
        self.assertEqual([point.sequence for point in snapshot.points], [2])
        self.assertEqual(stale.status, "stale-session")
        self.assertEqual(buffer.stats().stale_session_dropped, 1)

    def test_symbol_capacity_and_cleanup_are_bounded(self) -> None:
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=2)
        buffer.append(tick("2330.TW", "2026-07-31T09:00:00+08:00", 1))
        overflow = buffer.append(
            tick("00919.TW", "2026-07-31T09:00:00+08:00", 2)
        )

        self.assertEqual(overflow.status, "symbol-capacity")
        self.assertEqual(buffer.clear_before(date(2026, 8, 1)), 1)
        self.assertEqual(buffer.stats().buffered_symbols, 0)

    def test_restart_is_empty_and_module_has_no_canonical_storage_dependency(self) -> None:
        first = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=2)
        first.append(tick("2330.TW", "2026-07-31T09:00:00+08:00", 1))

        restarted = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=2)
        self.assertEqual(restarted.snapshot("2330.TW").points, ())

        source = (
            Path(__file__).parents[1]
            / "src"
            / "multichart_gateway"
            / "session_buffer.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("worker/", source)
        self.assertNotIn("D1Database", source)

    def test_invalid_capacity_and_session_date_mismatch_fail_closed(self) -> None:
        with self.assertRaisesRegex(
            GatewayStartupError,
            "^session_buffer_point_capacity_invalid$",
        ):
            BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=20_001)

        malformed = normalize_shioaji_tick(
            "2330.TW",
            {
                "datetime": "2026-07-31T09:00:00+08:00",
                "open": 100,
                "high": 101,
                "low": 99,
                "close": 100,
                "avg_price": 100,
                "volume": 1,
                "total_volume": 1,
                "simtrade": False,
            },
            1,
        )
        object.__setattr__(malformed, "session_date", date(2026, 8, 1))
        buffer = BoundedSessionRingBuffer(max_symbols=1, max_points_per_symbol=2)
        with self.assertRaisesRegex(
            GatewayStartupError,
            "^tick_session_date_mismatch$",
        ):
            buffer.append(malformed)


if __name__ == "__main__":
    unittest.main()
