from __future__ import annotations

from datetime import date, datetime
import json
import unittest

from multichart_gateway.model import TAIPEI, normalize_shioaji_kbar, normalize_shioaji_tick
from multichart_gateway.runtime_config import GatewayStartupError, RuntimeConfig, RuntimeSecrets
from multichart_gateway.uplink import RealtimeMicrobatchUplink
from multichart_gateway.session_buffer import SessionSnapshot


class _Connection:
    def __init__(self) -> None:
        self.messages: list[str] = []
        self.inbound: list[str] = []
        self.closed = False
        self.fail = False

    def send(self, message: str) -> None:
        if self.fail:
            raise OSError("fixture-sensitive")
        self.messages.append(message)

    def close(self) -> None:
        self.closed = True

    def recv(self, timeout: float | None = None) -> str:
        del timeout
        if not self.inbound:
            raise TimeoutError
        return self.inbound.pop(0)


def _secrets() -> RuntimeSecrets:
    return RuntimeSecrets(
        api_key="fixture-api-key",
        secret_key="fixture-secret-key",
        ingest_secret="fixture-ingest-secret",
        access_client_id="fixture-access-client-id",
        access_client_secret="fixture-access-client-secret",
    )


def _tick(sequence: int, close: float):
    return normalize_shioaji_tick(
        "2330.TW",
        {
            "datetime": f"2026-07-31T10:00:0{sequence}+08:00",
            "open": 100,
            "high": 105,
            "low": 99,
            "close": close,
            "avg_price": 101,
            "volume": 1,
            "total_volume": 20 + sequence,
            "simtrade": False,
        },
        sequence,
        "provider-connection",
    )


class UplinkConfigurationTests(unittest.TestCase):
    def test_production_requires_exact_wss_ingest_path_without_query(self) -> None:
        base = {
            "GATEWAY_MODE": "production",
            "CREDENTIALS_DIRECTORY": "/run/credentials/multichart-gateway.service",
        }
        with self.assertRaisesRegex(GatewayStartupError, "^realtime_ingest_url_invalid$"):
            RuntimeConfig.from_environment(base)
        with self.assertRaisesRegex(GatewayStartupError, "^realtime_ingest_url_invalid$"):
            RuntimeConfig.from_environment({**base, "REALTIME_INGEST_URL": "https://example.test/api/realtime/ingest"})
        config = RuntimeConfig.from_environment({
            **base,
            "REALTIME_INGEST_URL": "wss://example.test/api/realtime/ingest",
        })
        self.assertEqual(config.realtime_ingest_url, "wss://example.test/api/realtime/ingest")


class RealtimeMicrobatchTests(unittest.TestCase):
    def test_connect_establishes_control_channel_before_first_tick(self) -> None:
        connection = _Connection()
        calls = []
        uplink = RealtimeMicrobatchUplink(
            "wss://example.test/api/realtime/ingest", _secrets(),
            connect_factory=lambda url, headers: calls.append((url, headers)) or connection,
            now_provider=lambda: datetime(2026, 7, 31, 8, 59, 0, tzinfo=TAIPEI),
            connection_id="uplink-connection",
        )
        uplink.connect()
        uplink.connect()
        self.assertEqual(len(calls), 1)
        self.assertEqual(uplink.safe_counts()["uplinkState"], "live")
        self.assertEqual(connection.messages, [])

    def test_hub_subscription_demand_is_strict_bounded_and_safe(self) -> None:
        connection = _Connection()
        uplink = RealtimeMicrobatchUplink(
            "wss://example.test/api/realtime/ingest", _secrets(),
            connect_factory=lambda _url, _headers: connection,
            now_provider=lambda: datetime(2026, 7, 31, 10, 0, 1, tzinfo=TAIPEI),
            connection_id="uplink-connection",
        )
        uplink.offer(_tick(1, 101), "complete", "none")
        uplink.flush_due(force=True)
        connection.inbound.extend([
            json.dumps({"type": "ready", "role": "ingest"}),
            json.dumps({"type": "subscription-demand-v1", "symbols": ["8069.two", "2330.TW", "8069.TWO"]}),
            json.dumps({"type": "subscription-demand-v1", "symbols": ["AAPL"], "credential": "not-allowed"}),
        ])
        self.assertEqual(uplink.poll_subscription_demand(), ("8069.TWO", "2330.TW"))
        self.assertEqual(uplink.safe_counts()["uplinkControlReceivedCount"], 1)
        self.assertEqual(uplink.safe_counts()["uplinkControlInvalidCount"], 1)

        connection.inbound.extend([
            json.dumps({"type": "subscription-demand-v1", "symbols": ["2330.TW"]}),
            json.dumps({"type": "subscription-demand-v1", "symbols": []}),
        ])
        self.assertEqual(uplink.poll_subscription_demand(), ())
        self.assertIsNone(uplink.poll_subscription_demand())
        self.assertEqual(uplink.safe_counts()["uplinkControlReceivedCount"], 3)

    def test_session_kbars_are_chunked_as_bounded_bootstrap_with_cumulative_volume(self) -> None:
        now = datetime(2026, 7, 31, 10, 0, 1, tzinfo=TAIPEI)
        connection = _Connection()
        points = tuple(
            normalize_shioaji_kbar(
                "2330.TW", date(2026, 7, 31),
                timestamp_ns=int(datetime(2026, 7, 31, 9, minute, tzinfo=TAIPEI).timestamp() * 1_000_000_000),
                open_price=100, high_price=102, low_price=99, close_price=101,
                volume=10, amount=1_010_000,
            )
            for minute in range(3)
        )
        uplink = RealtimeMicrobatchUplink(
            "wss://example.test/api/realtime/ingest", _secrets(),
            connect_factory=lambda _url, _headers: connection,
            now_provider=lambda: now, connection_id="uplink-connection",
        )
        sent = uplink.send_session_snapshot(SessionSnapshot("2330.TW", date(2026, 7, 31), points, False))
        payload = json.loads(connection.messages[0])
        self.assertEqual(sent, 3)
        self.assertEqual(payload["type"], "session-bootstrap-v1")
        self.assertEqual([point["totalVolume"] for point in payload["points"]], [10, 20, 30])
        self.assertLess(len(connection.messages[0].encode("utf-8")), 64 * 1024)

    def test_one_second_batch_coalesces_symbol_and_uses_independent_uplink_identity(self) -> None:
        clock = [0.0]
        now = datetime(2026, 7, 31, 10, 0, 1, tzinfo=TAIPEI)
        connection = _Connection()
        handshakes: list[tuple[str, dict[str, str]]] = []

        def connect(url: str, headers: dict[str, str]) -> _Connection:
            handshakes.append((url, headers))
            return connection

        uplink = RealtimeMicrobatchUplink(
            "wss://example.test/api/realtime/ingest",
            _secrets(),
            connect_factory=connect,
            monotonic=lambda: clock[0],
            now_provider=lambda: now,
            connection_id="uplink-connection",
        )
        uplink.offer(_tick(1, 101), "complete", "none")
        uplink.offer(_tick(2, 102), "partial", "reconnect_gap")
        self.assertFalse(uplink.flush_due())
        clock[0] = 1.0
        self.assertTrue(uplink.flush_due())

        payload = json.loads(connection.messages[0])
        self.assertEqual(len(payload["updates"]), 1)
        self.assertEqual(payload["updates"][0]["close"], 102)
        self.assertEqual(payload["updates"][0]["connectionId"], "uplink-connection")
        self.assertEqual(payload["updates"][0]["continuity"], "partial")
        self.assertEqual(payload["connectionId"], "uplink-connection")
        self.assertEqual(payload["sequence"], 1)
        self.assertNotIn("fixture-ingest-secret", connection.messages[0])
        self.assertEqual(handshakes[0][1]["x-realtime-timestamp"], str(int(now.timestamp() * 1000)))
        self.assertEqual(uplink.safe_counts()["uplinkCoalescedCount"], 1)

    def test_missing_access_machine_credential_fails_closed(self) -> None:
        with self.assertRaisesRegex(GatewayStartupError, "^uplink_runtime_secret_missing$"):
            RealtimeMicrobatchUplink(
                "wss://example.test/api/realtime/ingest",
                RuntimeSecrets(
                    api_key="fixture-api-key",
                    secret_key="fixture-secret-key",
                    ingest_secret="fixture-ingest-secret",
                ),
            )

    def test_send_failure_closes_connection_and_keeps_bounded_pending_state(self) -> None:
        clock = [1.0]
        connection = _Connection()
        connection.fail = True
        uplink = RealtimeMicrobatchUplink(
            "wss://example.test/api/realtime/ingest",
            _secrets(),
            connect_factory=lambda _url, _headers: connection,
            monotonic=lambda: clock[0],
            now_provider=lambda: datetime(2026, 7, 31, 10, 0, 1, tzinfo=TAIPEI),
            connection_id="uplink-connection",
        )
        uplink.offer(_tick(1, 101), "complete", "none")
        with self.assertRaisesRegex(GatewayStartupError, "^uplink_send_failed$"):
            uplink.flush_due(force=True)
        self.assertTrue(connection.closed)
        self.assertEqual(uplink.safe_counts()["uplinkPendingSymbolCount"], 1)
        self.assertEqual(uplink.safe_counts()["uplinkFailureCount"], 1)


if __name__ == "__main__":
    unittest.main()
