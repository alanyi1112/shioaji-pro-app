"""Loopback-only health endpoint with an allowlisted response."""

from __future__ import annotations

from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Lock, Thread
from typing import Callable

from .runtime_config import GatewayStartupError


LOOPBACK_HOST = "127.0.0.1"


@dataclass
class ServiceHealthState:
    mode: str
    active_universe_limit: int
    _state: str = "starting"
    _reason_code: str = "none"
    _reconnect_attempts: int = 0
    _lock: Lock = field(default_factory=Lock, repr=False)

    def transition(
        self,
        state: str,
        *,
        reason_code: str = "none",
        reconnect_attempts: int | None = None,
    ) -> None:
        with self._lock:
            self._state = state
            self._reason_code = reason_code
            if reconnect_attempts is not None:
                self._reconnect_attempts = reconnect_attempts

    def accept_provider_event(self, state: str) -> None:
        if state == "live":
            self.transition("live")
        elif state == "reconnecting":
            self.transition("degraded", reason_code="provider_reconnecting")
        elif state in {"disconnected", "connect_failed"}:
            self.transition("degraded", reason_code="provider_disconnected")
        elif state == "closed":
            self.transition("stopped")

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "runtime": "multichart-gateway",
                "transport": "loopback",
                "mode": self.mode,
                "state": self._state,
                "reasonCode": self._reason_code,
                "reconnectAttempts": self._reconnect_attempts,
                "activeUniverseLimit": self.active_universe_limit,
            }


def _handler_factory(snapshot: Callable[[], dict[str, object]]) -> type[BaseHTTPRequestHandler]:
    class HealthHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path != "/health":
                self.send_error(404)
                return
            body = json.dumps(
                snapshot(),
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *args: object) -> None:
            del args

    return HealthHandler


class LoopbackHealthServer:
    def __init__(self, state: ServiceHealthState, port: int) -> None:
        self._state = state
        self._port = port
        self._server: ThreadingHTTPServer | None = None
        self._thread: Thread | None = None

    @property
    def bound_port(self) -> int | None:
        if self._server is None:
            return None
        return int(self._server.server_address[1])

    def start(self) -> None:
        try:
            server = ThreadingHTTPServer(
                (LOOPBACK_HOST, self._port),
                _handler_factory(self._state.snapshot),
            )
        except OSError:
            raise GatewayStartupError("health_bind_failed") from None
        server.daemon_threads = True
        thread = Thread(target=server.serve_forever, name="gateway-health", daemon=True)
        thread.start()
        self._server = server
        self._thread = thread

    def stop(self) -> None:
        server = self._server
        thread = self._thread
        self._server = None
        self._thread = None
        if server is None:
            return
        server.shutdown()
        server.server_close()
        if thread is not None:
            thread.join(timeout=2)
