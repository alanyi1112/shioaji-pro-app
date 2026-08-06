"""One-second bounded outbound WebSocket microbatches for Cloudflare ingest."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from decimal import Decimal
import json
import time
from typing import Any, Protocol
from uuid import uuid4

from .model import NormalizedKbar, NormalizedTick, TAIPEI
from .active_universe import canonical_taiwan_symbol
from .runtime_config import GatewayStartupError, RuntimeSecrets
from .session_buffer import SessionSnapshot


MAX_MICROBATCH_BYTES = 64 * 1024
MAX_MICROBATCH_UPDATES = 32
MAX_BOOTSTRAP_POINTS = 128
MICROBATCH_INTERVAL_SECONDS = 1.0


class WebSocketConnection(Protocol):
    def send(self, message: str) -> None: ...
    def recv(self, timeout: float | None = None) -> str | bytes: ...
    def close(self) -> None: ...


ConnectFactory = Callable[[str, dict[str, str]], WebSocketConnection]


def _default_connect(url: str, headers: dict[str, str]) -> WebSocketConnection:
    try:
        from websockets.sync.client import connect
    except ImportError:
        raise GatewayStartupError("uplink_runtime_unavailable") from None
    try:
        return connect(
            url,
            additional_headers=headers,
            compression=None,
            open_timeout=10,
            ping_interval=20,
            ping_timeout=20,
            close_timeout=5,
            max_size=MAX_MICROBATCH_BYTES,
            max_queue=4,
        )
    except Exception:
        raise GatewayStartupError("uplink_connect_failed") from None


def _number(value: Decimal) -> float:
    return float(value)


class RealtimeMicrobatchUplink:
    def __init__(
        self,
        url: str,
        secrets: RuntimeSecrets,
        *,
        connect_factory: ConnectFactory = _default_connect,
        monotonic: Callable[[], float] = time.monotonic,
        now_provider: Callable[[], datetime] = lambda: datetime.now(TAIPEI),
        connection_id: str | None = None,
    ) -> None:
        if not secrets.ingest_secret or not secrets.access_client_id or not secrets.access_client_secret:
            raise GatewayStartupError("uplink_runtime_secret_missing")
        self._url = url
        self._ingest_secret = secrets.ingest_secret
        self._access_client_id = secrets.access_client_id
        self._access_client_secret = secrets.access_client_secret
        self._connect_factory = connect_factory
        self._monotonic = monotonic
        self._now_provider = now_provider
        self._connection_id = connection_id or uuid4().hex
        self._connection: WebSocketConnection | None = None
        self._pending: dict[str, tuple[NormalizedTick, str, str]] = {}
        self._sequence = 0
        self._last_flush = monotonic()
        self._sent = 0
        self._failed = 0
        self._coalesced = 0
        self._control_received = 0
        self._control_invalid = 0

    def offer(self, tick: NormalizedTick, continuity: str, reason_code: str) -> None:
        if len(self._pending) >= MAX_MICROBATCH_UPDATES and tick.canonical_symbol not in self._pending:
            raise GatewayStartupError("uplink_symbol_capacity")
        if tick.canonical_symbol in self._pending:
            self._coalesced += 1
        self._pending[tick.canonical_symbol] = (tick, continuity, reason_code)

    def connect(self) -> None:
        """Establish the outbound control/data channel before the first Tick."""
        self._ensure_connected(self._now_provider().astimezone(TAIPEI))

    def flush_due(self, *, force: bool = False) -> bool:
        now_mono = self._monotonic()
        if not force and now_mono - self._last_flush < MICROBATCH_INTERVAL_SECONDS:
            return False
        self._last_flush = now_mono
        if not self._pending:
            return False
        now = self._now_provider().astimezone(TAIPEI)
        updates = [
            self._payload(tick, continuity, reason_code, now)
            for tick, continuity, reason_code in self._pending.values()
        ]
        self._send_payload("market-batch-v1", "updates", updates, now)
        self._pending.clear()
        return True

    def send_session_snapshot(self, snapshot: SessionSnapshot) -> int:
        points = [point for point in snapshot.points if isinstance(point, NormalizedKbar)]
        if not points:
            return 0
        sent = 0
        cumulative_volume = 0
        now = self._now_provider().astimezone(TAIPEI)
        for start in range(0, len(points), MAX_BOOTSTRAP_POINTS):
            chunk = points[start : start + MAX_BOOTSTRAP_POINTS]
            payload = []
            for index, point in enumerate(chunk):
                cumulative_volume += point.volume
                payload.append(self._bootstrap_payload(point, index + start + 1, cumulative_volume, snapshot, now))
            self._send_payload("session-bootstrap-v1", "points", payload, now)
            sent += len(chunk)
        return sent

    def close(self) -> None:
        self._drop_connection()
        self._pending.clear()

    def poll_subscription_demand(self, limit: int = 4) -> tuple[str, ...] | None:
        if not 1 <= limit <= 8:
            raise GatewayStartupError("uplink_control_limit_invalid")
        connection = self._connection
        if connection is None or not hasattr(connection, "recv"):
            return None
        latest: tuple[str, ...] | None = None
        for _ in range(limit):
            try:
                raw = connection.recv(timeout=0)
            except TimeoutError:
                break
            except Exception:
                self._drop_connection()
                raise GatewayStartupError("uplink_receive_failed") from None
            if not isinstance(raw, str) or len(raw.encode("utf-8")) > 4096:
                self._control_invalid += 1
                continue
            try:
                payload = json.loads(raw)
            except (TypeError, ValueError):
                self._control_invalid += 1
                continue
            if not isinstance(payload, dict):
                self._control_invalid += 1
                continue
            if payload.get("type") in {"ready", "ack", "error"}:
                continue
            if set(payload) != {"type", "symbols"} or payload.get("type") != "subscription-demand-v1" or not isinstance(payload.get("symbols"), list):
                self._control_invalid += 1
                continue
            symbols = payload["symbols"]
            if len(symbols) > 32:
                self._control_invalid += 1
                continue
            normalized = [canonical_taiwan_symbol(symbol) for symbol in symbols]
            if any(symbol is None for symbol in normalized):
                self._control_invalid += 1
                continue
            self._control_received += 1
            latest = tuple(dict.fromkeys(symbol for symbol in normalized if symbol is not None))
        return latest

    def safe_counts(self) -> dict[str, int | str]:
        return {
            "uplinkState": "live" if self._connection is not None else "disconnected",
            "uplinkPendingSymbolCount": len(self._pending),
            "uplinkSentBatchCount": self._sent,
            "uplinkFailureCount": self._failed,
            "uplinkCoalescedCount": self._coalesced,
            "uplinkControlReceivedCount": self._control_received,
            "uplinkControlInvalidCount": self._control_invalid,
        }

    def _ensure_connected(self, now: datetime) -> WebSocketConnection:
        if self._connection is None:
            headers = {
                "x-realtime-ingest-secret": self._ingest_secret,
                "x-realtime-timestamp": str(int(now.timestamp() * 1000)),
                "x-realtime-connection-id": self._connection_id,
                "CF-Access-Client-Id": self._access_client_id,
                "CF-Access-Client-Secret": self._access_client_secret,
            }
            self._connection = self._connect_factory(self._url, headers)
        return self._connection

    def _drop_connection(self) -> None:
        connection = self._connection
        self._connection = None
        if connection is None:
            return
        try:
            connection.close()
        except Exception:
            pass

    def _send_payload(
        self,
        message_type: str,
        collection_key: str,
        values: list[dict[str, Any]],
        now: datetime,
    ) -> None:
        self._sequence += 1
        message = json.dumps(
            {
                "type": message_type,
                "connectionId": self._connection_id,
                "sequence": self._sequence,
                "sentAt": now.isoformat(timespec="milliseconds"),
                collection_key: values,
            },
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        if len(message.encode("utf-8")) > MAX_MICROBATCH_BYTES:
            self._failed += 1
            raise GatewayStartupError("uplink_payload_too_large")
        try:
            self._ensure_connected(now).send(message)
        except GatewayStartupError:
            self._failed += 1
            self._drop_connection()
            raise
        except Exception:
            self._failed += 1
            self._drop_connection()
            raise GatewayStartupError("uplink_send_failed") from None
        self._sent += 1

    def _payload(
        self,
        tick: NormalizedTick,
        continuity: str,
        reason_code: str,
        received_time: datetime,
    ) -> dict[str, Any]:
        return {
            "canonicalSymbol": tick.canonical_symbol,
            "exchange": tick.exchange,
            "sessionDate": tick.session_date.isoformat(),
            "sourceTime": tick.source_time.isoformat(timespec="milliseconds"),
            "receivedTime": received_time.isoformat(timespec="milliseconds"),
            "open": _number(tick.open),
            "high": _number(tick.high),
            "low": _number(tick.low),
            "close": _number(tick.close),
            "averagePrice": _number(tick.average_price),
            "tickVolume": tick.tick_volume,
            "totalVolume": tick.total_volume,
            "simtrade": tick.simtrade,
            "sequence": tick.sequence,
            "connectionId": self._connection_id,
            "provider": "shioaji",
            "continuity": continuity if continuity in {"complete", "partial"} else "partial",
            "reasonCode": reason_code if reason_code else "none",
        }

    def _bootstrap_payload(
        self,
        point: NormalizedKbar,
        sequence: int,
        total_volume: int,
        snapshot: SessionSnapshot,
        received_time: datetime,
    ) -> dict[str, Any]:
        return {
            "canonicalSymbol": point.canonical_symbol,
            "exchange": point.exchange,
            "sessionDate": point.session_date.isoformat(),
            "sourceTime": point.source_time.isoformat(timespec="milliseconds"),
            "receivedTime": received_time.isoformat(timespec="milliseconds"),
            "open": _number(point.open),
            "high": _number(point.high),
            "low": _number(point.low),
            "close": _number(point.close),
            "averagePrice": _number(point.close),
            "volume": point.volume,
            "totalVolume": total_volume,
            "sequence": sequence,
            "connectionId": self._connection_id,
            "provider": "shioaji",
            "continuity": snapshot.continuity if snapshot.continuity in {"complete", "partial"} else "partial",
            "reasonCode": snapshot.reason_code if snapshot.reason_code else "none",
        }
