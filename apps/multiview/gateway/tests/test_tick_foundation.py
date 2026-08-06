from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest

from multichart_gateway.model import normalize_shioaji_tick
from multichart_gateway.runtime_config import GatewayStartupError
from multichart_gateway.tick_buffer import BoundedLatestTickBuffer


def tick_payload(
    *,
    timestamp: str = "2026-07-31T09:00:00+08:00",
    open_price: float = 100,
    high: float = 103,
    low: float = 99,
    close: float = 102,
    average: float = 101,
    volume: int = 2,
    total_volume: int = 20,
) -> dict[str, object]:
    return {
        "datetime": timestamp,
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "avg_price": average,
        "volume": volume,
        "total_volume": total_volume,
        "simtrade": False,
    }


class TickNormalizationTests(unittest.TestCase):
    def test_normalizes_taipei_source_time_and_canonical_fields(self) -> None:
        tick = normalize_shioaji_tick("2330.TW", tick_payload(), 1)
        self.assertEqual(tick.canonical_symbol, "2330.TW")
        self.assertEqual(tick.exchange, "TWSE")
        self.assertEqual(tick.session_date, date(2026, 7, 31))
        self.assertEqual(tick.source_time.utcoffset().total_seconds(), 8 * 3600)
        self.assertEqual(tick.close, Decimal("102"))
        self.assertEqual(tick.tick_volume, 2)
        self.assertEqual(tick.total_volume, 20)
        self.assertEqual(tick.sequence, 1)

        alphanumeric = normalize_shioaji_tick("00981a.tw", tick_payload(), 2)
        self.assertEqual(alphanumeric.canonical_symbol, "00981A.TW")

    def test_rejects_unsupported_symbol_invalid_source_time_and_invalid_ohlc(self) -> None:
        with self.assertRaisesRegex(GatewayStartupError, "^unsupported_canonical_symbol$"):
            normalize_shioaji_tick("AAPL", tick_payload(), 1)
        with self.assertRaisesRegex(GatewayStartupError, "^tick_source_time_invalid$"):
            normalize_shioaji_tick("2330.TW", tick_payload(timestamp="not-a-time"), 1)
        with self.assertRaisesRegex(GatewayStartupError, "^tick_ohlc_invalid$"):
            normalize_shioaji_tick(
                "2330.TW",
                tick_payload(high=98, low=99),
                1,
            )


class TickBufferTests(unittest.TestCase):
    def test_callback_path_coalesces_same_symbol_without_losing_extremes_or_volume(self) -> None:
        buffer = BoundedLatestTickBuffer(max_symbols=2)
        first = normalize_shioaji_tick("2330.TW", tick_payload(), 1)
        second = normalize_shioaji_tick(
            "2330.TW",
            tick_payload(
                timestamp="2026-07-31T09:00:01+08:00",
                high=104,
                low=98,
                close=103,
                average=101.5,
                volume=3,
                total_volume=23,
            ),
            2,
        )
        self.assertTrue(buffer.offer_from_callback(first))
        self.assertTrue(buffer.offer_from_callback(second))
        drained = buffer.drain()
        self.assertEqual(len(drained), 1)
        self.assertEqual(drained[0].high, Decimal("104"))
        self.assertEqual(drained[0].low, Decimal("98"))
        self.assertEqual(drained[0].close, Decimal("103"))
        self.assertEqual(drained[0].tick_volume, 5)
        self.assertEqual(drained[0].total_volume, 23)
        self.assertEqual(buffer.stats().coalesced, 1)

    def test_capacity_is_bounded_by_symbol_and_overflow_is_counted(self) -> None:
        buffer = BoundedLatestTickBuffer(max_symbols=2)
        self.assertTrue(buffer.offer_from_callback(normalize_shioaji_tick("2330.TW", tick_payload(), 1)))
        self.assertTrue(buffer.offer_from_callback(normalize_shioaji_tick("00919.TW", tick_payload(), 2)))
        self.assertFalse(buffer.offer_from_callback(normalize_shioaji_tick("00878.TW", tick_payload(), 3)))
        stats = buffer.stats()
        self.assertEqual(stats.pending_symbols, 2)
        self.assertEqual(stats.overflow_dropped, 1)

    def test_older_tick_does_not_replace_newer_latest_state(self) -> None:
        buffer = BoundedLatestTickBuffer(max_symbols=1)
        newer = normalize_shioaji_tick(
            "2330.TW",
            tick_payload(timestamp="2026-07-31T09:00:02+08:00", close=103),
            2,
        )
        older = normalize_shioaji_tick("2330.TW", tick_payload(close=100), 1)
        buffer.offer_from_callback(newer)
        buffer.offer_from_callback(older)
        self.assertEqual(buffer.drain()[0].close, Decimal("103"))


if __name__ == "__main__":
    unittest.main()
