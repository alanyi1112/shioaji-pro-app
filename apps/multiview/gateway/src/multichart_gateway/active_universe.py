"""Deterministic, bounded Taiwan equity universe shared by subscription control."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
import re
from threading import RLock

from .runtime_config import (
    DEFAULT_ACTIVE_UNIVERSE_LIMIT,
    MAX_ACTIVE_UNIVERSE_LIMIT,
    GatewayStartupError,
)


# Keep this order aligned with the enabled, ordered Taiwan rows in
# public/data/stock_setup.md. Defaults retain priority when a pilot lowers the
# configured capacity; user symbols are then admitted in canonical sort order.
DEFAULT_TAIWAN_SYMBOLS = (
    "00919.TW",
    "00878.TW",
    "00929.TW",
    "00981A.TW",
    "00982A.TW",
    "009816.TW",
    "009819.TW",
    "3231.TW",
    "2330.TW",
    "0050.TW",
    "0056.TW",
    "006208.TW",
    "2317.TW",
    "2308.TW",
    "2382.TW",
    "2412.TW",
    "2454.TW",
    "2603.TW",
    "2615.TW",
    "2881.TW",
    "2882.TW",
    "6505.TW",
    "2891.TW",
    "3711.TW",
)

TAIWAN_STOCK_SYMBOL = re.compile(r"^[0-9][0-9A-Z]{3,5}\.(?:TW|TWO)$")


def canonical_taiwan_symbol(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    symbol = value.strip().upper()
    return symbol if TAIWAN_STOCK_SYMBOL.fullmatch(symbol) else None


def _unique_symbols(values: Iterable[object]) -> tuple[str, ...]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        symbol = canonical_taiwan_symbol(value)
        if symbol is None or symbol in seen:
            continue
        seen.add(symbol)
        result.append(symbol)
    return tuple(result)


@dataclass(frozen=True)
class ActiveUniverseSnapshot:
    limit: int
    default_candidate_count: int
    user_candidate_count: int
    candidate_count: int
    active_symbols: tuple[str, ...]
    overflow_symbols: tuple[str, ...]

    @property
    def active_count(self) -> int:
        return len(self.active_symbols)

    @property
    def overflow_count(self) -> int:
        return len(self.overflow_symbols)

    @property
    def capacity_remaining(self) -> int:
        return max(0, self.limit - self.active_count)

    def contains(self, canonical_symbol: str) -> bool:
        return canonical_symbol in self.active_symbols

    def is_overflow(self, canonical_symbol: str) -> bool:
        return canonical_symbol in self.overflow_symbols

    def safe_counts(self) -> dict[str, int]:
        return {
            "activeUniverseCount": self.active_count,
            "activeUniverseOverflowCount": self.overflow_count,
            "activeUniverseCapacityRemaining": self.capacity_remaining,
        }


class ActiveUniverse:
    """Thread-safe union of ordered defaults and all-user watchlist symbols."""

    def __init__(
        self,
        *,
        default_symbols: Iterable[object] = DEFAULT_TAIWAN_SYMBOLS,
        limit: int = DEFAULT_ACTIVE_UNIVERSE_LIMIT,
    ) -> None:
        if not 1 <= limit <= MAX_ACTIVE_UNIVERSE_LIMIT:
            raise GatewayStartupError("active_universe_limit_out_of_range")
        self._limit = limit
        self._default_symbols = _unique_symbols(default_symbols)
        self._user_symbols: tuple[str, ...] = ()
        self._lock = RLock()

    def replace_user_symbols(self, symbols: Iterable[object]) -> ActiveUniverseSnapshot:
        # Sorting prevents user, panel, or query order from changing which symbol
        # receives the final capacity slot.
        normalized = _unique_symbols(symbols)
        with self._lock:
            self._user_symbols = tuple(sorted(normalized))
            return self._snapshot_locked()

    def add_user_symbol(self, symbol: object) -> ActiveUniverseSnapshot:
        canonical_symbol = canonical_taiwan_symbol(symbol)
        if canonical_symbol is None:
            raise GatewayStartupError("unsupported_canonical_symbol")
        with self._lock:
            if canonical_symbol not in self._user_symbols:
                self._user_symbols = tuple(
                    sorted((*self._user_symbols, canonical_symbol))
                )
            return self._snapshot_locked()

    def snapshot(self) -> ActiveUniverseSnapshot:
        with self._lock:
            return self._snapshot_locked()

    def _snapshot_locked(self) -> ActiveUniverseSnapshot:
        defaults = self._default_symbols
        default_set = set(defaults)
        user_only = tuple(symbol for symbol in self._user_symbols if symbol not in default_set)
        candidates = defaults + user_only
        return ActiveUniverseSnapshot(
            limit=self._limit,
            default_candidate_count=len(defaults),
            user_candidate_count=len(self._user_symbols),
            candidate_count=len(candidates),
            active_symbols=candidates[: self._limit],
            overflow_symbols=candidates[self._limit :],
        )
