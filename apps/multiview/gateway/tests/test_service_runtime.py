from __future__ import annotations

import json
from pathlib import Path
from threading import Event
import types
import unittest
from unittest.mock import patch
from urllib.request import urlopen

from multichart_gateway.health import LOOPBACK_HOST, LoopbackHealthServer, ServiceHealthState
from multichart_gateway.host_preflight import verify_time_sync
from multichart_gateway.runtime_config import GatewayStartupError, RuntimeConfig
from multichart_gateway.safe_logging import SafeLogger
from multichart_gateway.service import GatewayService, ReconnectPolicy


ROOT = Path(__file__).parents[1]


class RuntimeConfigurationTests(unittest.TestCase):
    def test_health_port_is_bounded_and_loopback_is_fixed(self) -> None:
        self.assertEqual(RuntimeConfig.from_environment({}).health_port, 8788)
        self.assertEqual(
            RuntimeConfig.from_environment({"GATEWAY_HEALTH_PORT": "18788"}).health_port,
            18788,
        )
        with self.assertRaisesRegex(GatewayStartupError, "^health_port_out_of_range$"):
            RuntimeConfig.from_environment({"GATEWAY_HEALTH_PORT": "80"})
        self.assertEqual(LOOPBACK_HOST, "127.0.0.1")


class HealthServerTests(unittest.TestCase):
    def test_health_is_loopback_only_and_allowlisted(self) -> None:
        state = ServiceHealthState(mode="simulation", active_universe_limit=2)
        state.transition("degraded", reason_code="provider_reconnecting", reconnect_attempts=1)
        server = LoopbackHealthServer(state, 0)
        server.start()
        try:
            assert server.bound_port is not None
            with urlopen(f"http://127.0.0.1:{server.bound_port}/health", timeout=2) as response:
                payload = json.loads(response.read())
            self.assertEqual(payload["transport"], "loopback")
            self.assertEqual(payload["state"], "degraded")
            self.assertEqual(payload["reasonCode"], "provider_reconnecting")
            self.assertNotIn("headers", payload)
            self.assertNotIn("environment", payload)
            self.assertNotIn("account", json.dumps(payload).lower())
        finally:
            server.stop()


class ServiceReconnectTests(unittest.TestCase):
    def test_reconnect_policy_rejects_unbounded_or_invalid_delays(self) -> None:
        with self.assertRaisesRegex(GatewayStartupError, "^reconnect_policy_invalid$"):
            ReconnectPolicy(())
        with self.assertRaisesRegex(GatewayStartupError, "^reconnect_policy_invalid$"):
            ReconnectPolicy((1, 301))

    def test_startup_reconnect_is_bounded_and_logs_only_safe_reason(self) -> None:
        class FailingApplication:
            started = False

            def start(self) -> None:
                raise GatewayStartupError("provider_login_failed")

            def stop(self) -> None:
                self.started = False

        state = ServiceHealthState(mode="simulation", active_universe_limit=2)
        server = LoopbackHealthServer(state, 0)
        lines: list[str] = []
        service = GatewayService(
            FailingApplication,
            state,
            server,
            reconnect_policy=ReconnectPolicy((0, 0)),
            stop_event=Event(),
            logger=SafeLogger(lines.append),
        )
        self.assertEqual(service.run(), 1)
        self.assertEqual(len(lines), 3)
        self.assertEqual(json.loads(lines[-1])["state"], "unavailable")
        self.assertTrue(all("provider_login_failed" in line for line in lines))

    def test_live_service_drains_callback_ticks_outside_callback_path(self) -> None:
        stop_event = Event()

        class LiveApplication:
            started = False
            processed = 0

            def start(self) -> None:
                self.started = True

            def process_pending_ticks(self) -> int:
                self.processed += 1
                stop_event.set()
                return 1

            def stop(self) -> None:
                self.started = False

        application = LiveApplication()
        state = ServiceHealthState(mode="simulation", active_universe_limit=2)
        server = LoopbackHealthServer(state, 0)
        service = GatewayService(
            lambda: application,
            state,
            server,
            stop_event=stop_event,
            logger=SafeLogger(lambda _line: None),
        )

        self.assertEqual(service.run(), 0)
        self.assertEqual(application.processed, 2)
        self.assertFalse(application.started)


class HostAndSystemdContractTests(unittest.TestCase):
    def test_time_sync_preflight_does_not_expose_command_errors(self) -> None:
        completed = types.SimpleNamespace(returncode=0, stdout="yes\n", stderr="fixture-sensitive")
        with patch("multichart_gateway.host_preflight.subprocess.run", return_value=completed):
            self.assertTrue(verify_time_sync())

        with patch("multichart_gateway.host_preflight.subprocess.run", side_effect=OSError("fixture-sensitive")):
            self.assertFalse(verify_time_sync())

    def test_systemd_unit_has_supervisor_secret_and_host_hardening(self) -> None:
        unit = (ROOT / "deploy" / "multichart-gateway.service").read_text(encoding="utf-8")
        self.assertIn("User=multichart-gateway", unit)
        self.assertIn("Restart=on-failure", unit)
        self.assertIn("RestartSec=300", unit)
        self.assertIn("StartLimitBurst=3", unit)
        self.assertIn("systemd-inhibit --what=sleep", unit)
        self.assertIn("/opt/multichart-gateway/current/.venv/bin/python", unit)
        self.assertIn("multichart_gateway.host_preflight", unit)
        self.assertIn("WorkingDirectory=/var/lib/multichart-gateway", unit)
        self.assertIn("StateDirectoryMode=0700", unit)
        self.assertIn("LimitCORE=0", unit)
        self.assertIn("Environment=UNSUBSCRIBE_COOLDOWN_SECONDS=30", unit)
        self.assertIn("Environment=SESSION_BUFFER_POINTS_PER_SYMBOL=18000", unit)
        self.assertIn("Environment=PROVIDER_KBARS_DAILY_LIMIT=32", unit)
        self.assertIn("Environment=PROVIDER_FAILURE_THRESHOLD=3", unit)
        self.assertEqual(unit.count("LoadCredentialEncrypted="), 5)
        self.assertNotIn("EnvironmentFile=", unit)
        self.assertNotIn("0.0.0.0", unit)
        self.assertNotIn("[REDACTED_SECRET]", unit)

    def test_installer_is_exact_release_scoped_and_does_not_start_service(self) -> None:
        installer = (ROOT / "tools" / "install_system_service.sh").read_text(encoding="utf-8")
        self.assertIn("release_directory=${release_root}/${release_id}", installer)
        self.assertIn("ln -sfn", installer)
        self.assertIn("chmod -R a+rX,go-w", installer)
        self.assertIn("systemctl daemon-reload", installer)
        self.assertNotIn("enable --now", installer)
        self.assertNotIn("systemctl start", installer)


if __name__ == "__main__":
    unittest.main()
