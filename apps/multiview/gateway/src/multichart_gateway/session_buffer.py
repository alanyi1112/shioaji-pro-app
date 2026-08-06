"""Bounded in-memory session points, isolated from canonical candle history."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import date, datetime, time
from threading import RLock

from .active_universe import canonical_taiwan_symbol
from .model import NormalizedKbar, NormalizedTick, TAIPEI
from .runtime_config import GatewayStartupError


@dataclass(frozen=True)
class SessionAppendResult:
    status: str
    accepted: bool
    evicted: bool


@dataclass(frozen=True)
class SessionBackfillMergeResult:
    status: str
    accepted_points: int
    skipped_points: int
    truncated: bool


SessionPoint = NormalizedTick | NormalizedKbar


@dataclass(frozen=True)
class SessionSnapshot:
    canonical_symbol: str
    session_date: date | None
    points: tuple[SessionPoint, ...]
    truncated: bool
    continuity: str = "complete"
    reason_code: str = "none"


@dataclass(frozen=True)
class SessionBufferStats:
    buffered_symbols: int
    buffered_points: int
    accepted: int
    duplicates: int
    evicted: int
    stale_session_dropped: int
    symbol_overflow_dropped: int
    backfill_points: int
    reconnect_gaps: int
    closed_market_dropped: int
    partial_sessions: int


@dataclass
class _SymbolSession:
    session_date: date
    points: deque[SessionPoint] = field(default_factory=deque)
    last_source_time: datetime | None = None
    last_sequence: int = 0
    connection_id: str | None = None
    retired_connection_ids: deque[str] = field(default_factory=lambda: deque(maxlen=4))
    truncated: bool = False
    continuity: str = "complete"
    reason_code: str = "none"


class BoundedSessionRingBuffer:
    """Keeps only the current trading session for a bounded symbol universe."""

    def __init__(self, *, max_symbols: int, max_points_per_symbol: int) -> None:
        if not 1 <= max_symbols <= 32:
            raise GatewayStartupError("session_buffer_symbol_capacity_invalid")
        if not 1 <= max_points_per_symbol <= 20_000:
            raise GatewayStartupError("session_buffer_point_capacity_invalid")
        self._max_symbols = max_symbols
        self._max_points_per_symbol = max_points_per_symbol
        self._sessions: dict[str, _SymbolSession] = {}
        self._accepted = 0
        self._duplicates = 0
        self._evicted = 0
        self._stale_session_dropped = 0
        self._symbol_overflow_dropped = 0
        self._backfill_points = 0
        self._reconnect_gaps = 0
        self._closed_market_dropped = 0
        self._lock = RLock()

    def append(self, tick: NormalizedTick) -> SessionAppendResult:
        if not isinstance(tick, NormalizedTick):
            raise GatewayStartupError("invalid_session_tick")
        canonical_symbol = canonical_taiwan_symbol(tick.canonical_symbol)
        if canonical_symbol != tick.canonical_symbol:
            raise GatewayStartupError("unsupported_canonical_symbol")
        if tick.source_time.astimezone(TAIPEI).date() != tick.session_date:
            raise GatewayStartupError("tick_session_date_mismatch")
        local_time = tick.source_time.astimezone(TAIPEI)
        if (
            local_time.weekday() >= 5
            or local_time.timetz().replace(tzinfo=None) < time(9, 0)
            or local_time.timetz().replace(tzinfo=None) > time(13, 30)
        ):
            with self._lock:
                self._closed_market_dropped += 1
            return SessionAppendResult("market-closed", False, False)

        with self._lock:
            session = self._sessions.get(canonical_symbol)
            if session is None:
                if len(self._sessions) >= self._max_symbols:
                    self._symbol_overflow_dropped += 1
                    return SessionAppendResult("symbol-capacity", False, False)
                session = _SymbolSession(tick.session_date)
                self._sessions[canonical_symbol] = session
            elif tick.session_date < session.session_date:
                self._stale_session_dropped += 1
                return SessionAppendResult("stale-session", False, False)
            elif tick.session_date > session.session_date:
                session = _SymbolSession(tick.session_date)
                self._sessions[canonical_symbol] = session

            if tick.connection_id in session.retired_connection_ids:
                self._duplicates += 1
                return SessionAppendResult("retired-connection", False, False)
            if (
                session.last_source_time is not None
                and (
                    tick.source_time < session.last_source_time
                    or (
                        session.connection_id != tick.connection_id
                        and tick.source_time == session.last_source_time
                    )
                )
            ):
                self._duplicates += 1
                return SessionAppendResult("duplicate", False, False)
            if session.connection_id == tick.connection_id and tick.sequence <= session.last_sequence:
                self._duplicates += 1
                return SessionAppendResult("duplicate", False, False)
            reconnect_gap = False
            if session.connection_id is not None and session.connection_id != tick.connection_id:
                session.retired_connection_ids.append(session.connection_id)
                if (
                    session.last_source_time is not None
                    and (tick.source_time - session.last_source_time).total_seconds() > 5
                ):
                    reconnect_gap = True
                    session.continuity = "partial"
                    session.reason_code = "reconnect_gap"
                    self._reconnect_gaps += 1

            evicted = False
            if len(session.points) >= self._max_points_per_symbol:
                session.points.popleft()
                session.truncated = True
                self._evicted += 1
                evicted = True
            session.points.append(tick)
            session.last_source_time = tick.source_time
            session.last_sequence = tick.sequence
            session.connection_id = tick.connection_id
            self._accepted += 1
            return SessionAppendResult(
                "accepted-reconnect-gap" if reconnect_gap else "accepted",
                True,
                evicted,
            )

    def prepend_kbars(
        self,
        symbol: object,
        session_date: date,
        points: tuple[NormalizedKbar, ...],
    ) -> SessionBackfillMergeResult:
        canonical_symbol = canonical_taiwan_symbol(symbol)
        if canonical_symbol is None:
            raise GatewayStartupError("unsupported_canonical_symbol")
        if type(session_date) is not date:
            raise GatewayStartupError("kbar_session_date_invalid")
        if not isinstance(points, tuple) or len(points) > 600:
            raise GatewayStartupError("session_backfill_invalid")
        for point in points:
            if not isinstance(point, NormalizedKbar):
                raise GatewayStartupError("session_backfill_invalid")
            if (
                point.canonical_symbol != canonical_symbol
                or point.session_date != session_date
                or point.source_time.astimezone(TAIPEI).date() != session_date
            ):
                raise GatewayStartupError("session_backfill_mismatch")

        with self._lock:
            session = self._sessions.get(canonical_symbol)
            if session is None:
                if len(self._sessions) >= self._max_symbols:
                    self._symbol_overflow_dropped += 1
                    return SessionBackfillMergeResult(
                        "symbol-capacity",
                        0,
                        len(points),
                        False,
                    )
                session = _SymbolSession(session_date)
                self._sessions[canonical_symbol] = session
            elif session_date < session.session_date:
                self._stale_session_dropped += 1
                return SessionBackfillMergeResult(
                    "stale-session",
                    0,
                    len(points),
                    session.truncated,
                )
            elif session_date > session.session_date:
                session = _SymbolSession(session_date)
                self._sessions[canonical_symbol] = session

            live_ticks = [
                point for point in session.points if isinstance(point, NormalizedTick)
            ]
            live_cutoff: datetime | None = None
            if live_ticks:
                earliest_live = min(point.source_time for point in live_ticks)
                live_cutoff = earliest_live.replace(second=0, microsecond=0)

            existing_times = {point.source_time for point in session.points}
            accepted = [
                point
                for point in points
                if point.source_time not in existing_times
                and (live_cutoff is None or point.source_time < live_cutoff)
            ]
            skipped = len(points) - len(accepted)
            combined = sorted(
                (*accepted, *session.points),
                key=self._point_sort_key,
            )
            evicted = max(0, len(combined) - self._max_points_per_symbol)
            if evicted:
                combined = combined[evicted:]
                session.truncated = True
                session.continuity = "partial"
                session.reason_code = "session_buffer_truncated"
                self._evicted += evicted
            session.points = deque(combined)
            self._backfill_points += len(accepted)
            return SessionBackfillMergeResult(
                "merged" if accepted else "no-new-points",
                len(accepted),
                skipped,
                session.truncated,
            )

    def has_opening_coverage(
        self,
        symbol: object,
        session_date: date,
        *,
        opening_deadline: time = time(9, 1),
    ) -> bool:
        if type(session_date) is not date or type(opening_deadline) is not time:
            raise GatewayStartupError("session_coverage_boundary_invalid")
        snapshot = self.snapshot(symbol)
        if (
            snapshot.session_date != session_date
            or not snapshot.points
            or snapshot.truncated
        ):
            return False
        first_source_time = min(point.source_time for point in snapshot.points)
        boundary = datetime.combine(session_date, opening_deadline, tzinfo=TAIPEI)
        return first_source_time <= boundary

    def snapshot(self, symbol: object) -> SessionSnapshot:
        canonical_symbol = canonical_taiwan_symbol(symbol)
        if canonical_symbol is None:
            raise GatewayStartupError("unsupported_canonical_symbol")
        with self._lock:
            session = self._sessions.get(canonical_symbol)
            if session is None:
                return SessionSnapshot(canonical_symbol, None, (), False, "unavailable", "no_session")
            points = tuple(sorted(session.points, key=self._point_sort_key))
            return SessionSnapshot(
                canonical_symbol,
                session.session_date,
                points,
                session.truncated,
                session.continuity,
                session.reason_code,
            )

    def clear_before(self, cutoff: date) -> int:
        if type(cutoff) is not date:
            raise GatewayStartupError("invalid_session_cutoff")
        with self._lock:
            expired = [
                symbol
                for symbol, session in self._sessions.items()
                if session.session_date < cutoff
            ]
            for symbol in expired:
                self._sessions.pop(symbol, None)
            return len(expired)

    def clear(self) -> None:
        with self._lock:
            self._sessions.clear()

    def stats(self) -> SessionBufferStats:
        with self._lock:
            return SessionBufferStats(
                buffered_symbols=len(self._sessions),
                buffered_points=sum(
                    len(session.points) for session in self._sessions.values()
                ),
                accepted=self._accepted,
                duplicates=self._duplicates,
                evicted=self._evicted,
                stale_session_dropped=self._stale_session_dropped,
                symbol_overflow_dropped=self._symbol_overflow_dropped,
                backfill_points=self._backfill_points,
                reconnect_gaps=self._reconnect_gaps,
                closed_market_dropped=self._closed_market_dropped,
                partial_sessions=sum(
                    session.continuity == "partial"
                    for session in self._sessions.values()
                ),
            )

    def safe_counts(self) -> dict[str, int]:
        stats = self.stats()
        return {
            "sessionBufferSymbolCount": stats.buffered_symbols,
            "sessionBufferPointCount": stats.buffered_points,
            "sessionBufferAcceptedCount": stats.accepted,
            "sessionBufferDuplicateCount": stats.duplicates,
            "sessionBufferEvictedCount": stats.evicted,
            "sessionBufferStaleDropCount": stats.stale_session_dropped,
            "sessionBufferOverflowDropCount": stats.symbol_overflow_dropped,
            "sessionBufferBackfillPointCount": stats.backfill_points,
            "sessionBufferReconnectGapCount": stats.reconnect_gaps,
            "sessionBufferClosedMarketDropCount": stats.closed_market_dropped,
            "sessionBufferPartialCount": stats.partial_sessions,
        }

    @staticmethod
    def _point_sort_key(point: SessionPoint) -> tuple[datetime, int, int]:
        if isinstance(point, NormalizedTick):
            return (point.source_time, 1, point.sequence)
        return (point.source_time, 0, 0)
