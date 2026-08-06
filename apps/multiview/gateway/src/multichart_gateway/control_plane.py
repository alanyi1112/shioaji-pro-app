"""Allowlisted gateway control events for immediate watchlist subscription."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from .active_universe import ActiveUniverse, canonical_taiwan_symbol
from .runtime_config import GatewayStartupError
from .safe_logging import safe_reason_code
from .subscriptions import SubscriptionManager


WATCHLIST_SYMBOL_ADDED = "watchlist-symbol-added"
WATCHLIST_SUBSCRIPTION_REFERENCE = "watchlist-control"
CONTROL_EVENT_FIELDS = frozenset({"type", "symbol"})


@dataclass(frozen=True)
class ControlPlaneResult:
    status: str
    canonical_symbol: str | None
    realtime_available: bool
    reason_code: str
    backfill_status: str = "not-requested"
    backfill_point_count: int = 0
    backfill_reason_code: str = "none"

    def safe_payload(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "status": self.status,
            "realtimeAvailable": self.realtime_available,
            "reasonCode": self.reason_code,
        }
        if self.canonical_symbol is not None:
            payload["canonicalSymbol"] = self.canonical_symbol
        if self.backfill_status != "not-requested":
            payload["backfillStatus"] = self.backfill_status
            payload["backfillPointCount"] = self.backfill_point_count
            payload["backfillReasonCode"] = self.backfill_reason_code
        return payload


class GatewayControlPlane:
    """Routes safe control events without accepting user identity or secrets."""

    def __init__(
        self,
        active_universe: ActiveUniverse,
        subscriptions: SubscriptionManager,
    ) -> None:
        self._active_universe = active_universe
        self._subscriptions = subscriptions

    def handle(self, event: object) -> ControlPlaneResult:
        if not isinstance(event, Mapping):
            return self._failed(None, "invalid_control_event")
        if set(event) != CONTROL_EVENT_FIELDS:
            return self._failed(None, "invalid_control_event")
        if event.get("type") != WATCHLIST_SYMBOL_ADDED:
            return self._failed(None, "unsupported_control_event")

        canonical_symbol = canonical_taiwan_symbol(event.get("symbol"))
        if canonical_symbol is None:
            return self._failed(None, "unsupported_canonical_symbol")

        try:
            universe = self._active_universe.add_user_symbol(canonical_symbol)
            if universe.is_overflow(canonical_symbol):
                return ControlPlaneResult(
                    status="capacity",
                    canonical_symbol=canonical_symbol,
                    realtime_available=False,
                    reason_code="active_universe_capacity",
                )
            acquired = self._subscriptions.acquire_with_result(
                canonical_symbol,
                WATCHLIST_SUBSCRIPTION_REFERENCE,
            )
        except GatewayStartupError as error:
            reason_code = safe_reason_code(error)
            if reason_code == "active_universe_capacity":
                return ControlPlaneResult(
                    status="capacity",
                    canonical_symbol=canonical_symbol,
                    realtime_available=False,
                    reason_code=reason_code,
                )
            return self._failed(canonical_symbol, reason_code)
        except Exception as error:
            return self._failed(canonical_symbol, safe_reason_code(error))

        return ControlPlaneResult(
            status=(
                "started" if acquired.started_upstream else "already-subscribed"
            ),
            canonical_symbol=canonical_symbol,
            realtime_available=True,
            reason_code="none",
        )

    @staticmethod
    def _failed(
        canonical_symbol: str | None,
        reason_code: str,
    ) -> ControlPlaneResult:
        return ControlPlaneResult(
            status="failed",
            canonical_symbol=canonical_symbol,
            realtime_available=False,
            reason_code=reason_code,
        )
