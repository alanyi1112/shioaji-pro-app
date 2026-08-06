from __future__ import annotations

from pathlib import Path
import unittest

from multichart_gateway.active_universe import (
    DEFAULT_TAIWAN_SYMBOLS,
    ActiveUniverse,
    canonical_taiwan_symbol,
)
from multichart_gateway.runtime_config import GatewayStartupError


REPOSITORY_ROOT = Path(__file__).parents[2]


def _setup_taiwan_symbols() -> tuple[str, ...]:
    rows: list[tuple[int, str]] = []
    text = (REPOSITORY_ROOT / "public" / "data" / "stock_setup.md").read_text(
        encoding="utf-8"
    )
    for line in text.splitlines():
        if not line.startswith("|") or "---" in line or "頁籤 |" in line:
            continue
        cells = [cell.strip() for cell in line.split("|")[1:-1]]
        if len(cells) < 7 or cells[0] != "台股" or not cells[2]:
            continue
        if cells[6].lower() in {"no", "false", "0"}:
            continue
        rows.append((int(cells[2]), cells[3].upper()))
    return tuple(symbol for _, symbol in sorted(rows))


class ActiveUniverseTests(unittest.TestCase):
    def test_defaults_match_current_enabled_ordered_taiwan_setup(self) -> None:
        self.assertEqual(len(DEFAULT_TAIWAN_SYMBOLS), 24)
        # The gateway release can be verified as a standalone directory on the
        # host, where the website's public setup file intentionally is absent.
        if (REPOSITORY_ROOT / "public" / "data" / "stock_setup.md").exists():
            self.assertEqual(DEFAULT_TAIWAN_SYMBOLS, _setup_taiwan_symbols())

    def test_union_is_canonical_deduplicated_and_bounded(self) -> None:
        universe = ActiveUniverse(limit=25)
        snapshot = universe.replace_user_symbols(
            ["2330.tw", "8069.two", "6488.TWO", "AAPL", "invalid.TW", " 6488.two "]
        )

        self.assertEqual(snapshot.default_candidate_count, 24)
        self.assertEqual(snapshot.user_candidate_count, 3)
        self.assertEqual(snapshot.candidate_count, 26)
        self.assertEqual(snapshot.active_symbols[:24], DEFAULT_TAIWAN_SYMBOLS)
        self.assertEqual(snapshot.active_symbols[-1], "6488.TWO")
        self.assertEqual(snapshot.overflow_symbols, ("8069.TWO",))
        self.assertEqual(snapshot.capacity_remaining, 0)
        self.assertTrue(snapshot.contains("6488.TWO"))
        self.assertTrue(snapshot.is_overflow("8069.TWO"))

    def test_pilot_can_lower_limit_without_changing_default_priority(self) -> None:
        universe = ActiveUniverse(limit=2)
        snapshot = universe.replace_user_symbols(["8069.TWO"])

        self.assertEqual(snapshot.active_symbols, DEFAULT_TAIWAN_SYMBOLS[:2])
        self.assertEqual(snapshot.overflow_count, 23)
        self.assertEqual(
            snapshot.safe_counts(),
            {
                "activeUniverseCount": 2,
                "activeUniverseOverflowCount": 23,
                "activeUniverseCapacityRemaining": 0,
            },
        )

    def test_replacement_removes_old_user_candidates_and_filters_non_taiwan(self) -> None:
        universe = ActiveUniverse(limit=32)
        first = universe.replace_user_symbols(["8069.TWO"])
        second = universe.replace_user_symbols(["6488.TWO", "MSFT"])

        self.assertIn("8069.TWO", first.active_symbols)
        self.assertNotIn("8069.TWO", second.active_symbols)
        self.assertIn("6488.TWO", second.active_symbols)
        self.assertIsNone(canonical_taiwan_symbol("^TWII"))
        self.assertIsNone(canonical_taiwan_symbol("AAPL"))
        self.assertIsNone(canonical_taiwan_symbol(object()))

    def test_incremental_add_is_canonical_idempotent_and_keeps_candidates(self) -> None:
        universe = ActiveUniverse(limit=25)

        first = universe.add_user_symbol("8069.two")
        repeated = universe.add_user_symbol(" 8069.TWO ")
        overflow = universe.add_user_symbol("6488.TWO")

        self.assertEqual(first.user_candidate_count, 1)
        self.assertEqual(repeated.user_candidate_count, 1)
        self.assertEqual(overflow.user_candidate_count, 2)
        self.assertIn("8069.TWO", overflow.overflow_symbols)
        with self.assertRaisesRegex(
            GatewayStartupError,
            "^unsupported_canonical_symbol$",
        ):
            universe.add_user_symbol("AAPL")


if __name__ == "__main__":
    unittest.main()
