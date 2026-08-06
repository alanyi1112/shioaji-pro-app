"""Short critical-section Tick callback buffer with latest-value coalescing."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock

from .model import NormalizedTick, merge_coalesced_ticks
from .runtime_config import GatewayStartupError


@dataclass(frozen=True)
class TickBufferStats:
    pending_symbols: int
    accepted: int
    coalesced: int
    overflow_dropped: int


class BoundedLatestTickBuffer:
    """Bounds memory by symbol count and never performs I/O from the callback path."""

    def __init__(self, max_symbols: int = 32) -> None:
        if not 1 <= max_symbols <= 32:
            raise GatewayStartupError("tick_buffer_capacity_invalid")
        self._max_symbols = max_symbols
        self._pending: OrderedDict[str, NormalizedTick] = OrderedDict()
        self._accepted = 0
        self._coalesced = 0
        self._overflow_dropped = 0
        self._lock = Lock()

    def offer_from_callback(self, tick: NormalizedTick) -> bool:
        with self._lock:
            existing = self._pending.get(tick.canonical_symbol)
            if existing is not None:
                self._pending[tick.canonical_symbol] = merge_coalesced_ticks(existing, tick)
                self._pending.move_to_end(tick.canonical_symbol)
                self._accepted += 1
                self._coalesced += 1
                return True
            if len(self._pending) >= self._max_symbols:
                self._overflow_dropped += 1
                return False
            self._pending[tick.canonical_symbol] = tick
            self._accepted += 1
            return True

    def drain(self, limit: int | None = None) -> list[NormalizedTick]:
        with self._lock:
            if limit is None:
                limit = len(self._pending)
            if limit < 0:
                raise GatewayStartupError("tick_buffer_drain_limit_invalid")
            drained: list[NormalizedTick] = []
            for _ in range(min(limit, len(self._pending))):
                _, tick = self._pending.popitem(last=False)
                drained.append(tick)
            return drained

    def stats(self) -> TickBufferStats:
        with self._lock:
            return TickBufferStats(
                pending_symbols=len(self._pending),
                accepted=self._accepted,
                coalesced=self._coalesced,
                overflow_dropped=self._overflow_dropped,
            )
