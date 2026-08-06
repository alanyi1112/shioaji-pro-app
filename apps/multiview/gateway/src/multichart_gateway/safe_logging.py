"""Allowlist-only structured gateway logging."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
import json
import re

from .runtime_config import GatewayStartupError


SAFE_LOG_FIELDS = {
    "phase",
    "reasonCode",
    "state",
    "count",
    "accepted",
    "coalesced",
    "dropped",
    "pendingSymbols",
    "subscriptionCount",
    "latencyMs",
    "sequence",
    "port",
}
SAFE_TOKEN = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


def safe_reason_code(error: BaseException) -> str:
    if isinstance(error, GatewayStartupError) and SAFE_TOKEN.fullmatch(error.reason_code):
        return error.reason_code
    return "internal_error"


class SafeLogger:
    def __init__(self, sink: Callable[[str], None] = print) -> None:
        self._sink = sink

    def emit(self, event: str, **fields: object) -> None:
        if not SAFE_TOKEN.fullmatch(event):
            raise GatewayStartupError("unsafe_log_event")
        unknown = set(fields) - SAFE_LOG_FIELDS
        if unknown:
            raise GatewayStartupError("unsafe_log_field")

        payload: dict[str, object] = {
            "event": event,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        for key, value in fields.items():
            if isinstance(value, str):
                if not SAFE_TOKEN.fullmatch(value):
                    raise GatewayStartupError("unsafe_log_value")
            elif value is not None and not isinstance(value, (bool, int, float)):
                raise GatewayStartupError("unsafe_log_value")
            payload[key] = value
        self._sink(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
