"""Single-flight, once-per-session Kbars recovery for newly activated symbols."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time
from threading import Condition, RLock

from .active_universe import canonical_taiwan_symbol
from .providers import MarketDataProvider
from .runtime_config import GatewayStartupError
from .safe_logging import safe_reason_code
from .session_buffer import BoundedSessionRingBuffer
from .model import TAIPEI


REGULAR_SESSION_OPEN = time(9, 0)
REGULAR_SESSION_CLOSE = time(13, 30)


@dataclass(frozen=True)
class SessionBackfillResult:
    status: str
    point_count: int
    reason_code: str


@dataclass
class _Attempt:
    in_flight: bool = True
    result: SessionBackfillResult | None = None


class SessionBackfillCoordinator:
    """Shares one bounded Kbars attempt for each canonical symbol and Taipei date."""

    def __init__(self, session_buffer: BoundedSessionRingBuffer) -> None:
        self._session_buffer = session_buffer
        self._attempts: dict[tuple[str, date], _Attempt] = {}
        self._started = 0
        self._completed = 0
        self._failed = 0
        self._condition = Condition(RLock())

    def ensure_session(
        self,
        provider: MarketDataProvider,
        symbol: object,
        now: datetime,
    ) -> SessionBackfillResult:
        canonical_symbol = canonical_taiwan_symbol(symbol)
        if canonical_symbol is None:
            raise GatewayStartupError("unsupported_canonical_symbol")
        if not isinstance(now, datetime) or now.tzinfo is None:
            raise GatewayStartupError("session_backfill_time_invalid")
        taipei_now = now.astimezone(TAIPEI)
        session_date = taipei_now.date()

        if self._session_buffer.has_opening_coverage(
            canonical_symbol,
            session_date,
        ):
            return SessionBackfillResult("buffer", 0, "none")
        if not self._is_regular_session(taipei_now):
            return SessionBackfillResult("not-needed", 0, "market_not_open")

        key = (canonical_symbol, session_date)
        with self._condition:
            for previous_key in tuple(self._attempts):
                if previous_key[1] < session_date:
                    self._attempts.pop(previous_key, None)
            attempt = self._attempts.get(key)
            if attempt is not None:
                while attempt.in_flight:
                    self._condition.wait()
                assert attempt.result is not None
                return attempt.result
            attempt = _Attempt()
            self._attempts[key] = attempt
            self._started += 1

        try:
            points = provider.fetch_daily_kbars(canonical_symbol, session_date)
            merged = self._session_buffer.prepend_kbars(
                canonical_symbol,
                session_date,
                points,
            )
            if merged.accepted_points == 0:
                result = SessionBackfillResult("empty", 0, "none")
            elif merged.truncated:
                result = SessionBackfillResult(
                    "partial",
                    merged.accepted_points,
                    "session_buffer_truncated",
                )
            else:
                result = SessionBackfillResult(
                    "backfilled",
                    merged.accepted_points,
                    "none",
                )
        except Exception as error:
            result = SessionBackfillResult("failed", 0, safe_reason_code(error))

        with self._condition:
            attempt.in_flight = False
            attempt.result = result
            self._completed += 1
            if result.status == "failed":
                self._failed += 1
            self._condition.notify_all()
        return result

    def safe_counts(self) -> dict[str, int]:
        with self._condition:
            return {
                "sessionBackfillAttemptCount": self._started,
                "sessionBackfillCompletedCount": self._completed,
                "sessionBackfillFailureCount": self._failed,
                "sessionBackfillInFlightCount": sum(
                    attempt.in_flight for attempt in self._attempts.values()
                ),
            }

    @staticmethod
    def _is_regular_session(now: datetime) -> bool:
        local_time = now.timetz().replace(tzinfo=None)
        return (
            now.weekday() < 5
            and REGULAR_SESSION_OPEN <= local_time <= REGULAR_SESSION_CLOSE
        )
