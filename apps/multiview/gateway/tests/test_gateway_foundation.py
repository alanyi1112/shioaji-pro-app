from __future__ import annotations

import json
import os
from datetime import date, datetime
from pathlib import Path
import tempfile
import types
import unittest

from multichart_gateway.application import build_application
from multichart_gateway.model import TAIPEI, normalize_shioaji_tick
from multichart_gateway.providers import (
    SAFE_CAPABILITIES,
    ShioajiMarketDataProvider,
    SimulationMarketDataProvider,
)
from multichart_gateway.runtime_config import (
    GatewayMode,
    GatewayStartupError,
    PINNED_SHIOAJI_VERSION,
    RuntimeConfig,
    RuntimeSecrets,
    load_runtime_secrets,
)


class RuntimeConfigTests(unittest.TestCase):
    def test_default_mode_is_simulation_and_does_not_read_runtime_secrets(self) -> None:
        application = build_application({})
        application.start()
        self.assertTrue(application.started)
        self.assertEqual(application.safe_health()["mode"], "simulation")
        self.assertEqual(application.safe_health()["shioajiVersion"], "1.7.1")
        self.assertEqual(application.safe_health()["activeUniverseCount"], 24)
        self.assertEqual(application.safe_health()["activeUniverseCapacityRemaining"], 8)
        self.assertNotIn("api", repr(application.safe_health()).lower())

    def test_production_without_systemd_runtime_directory_fails_closed(self) -> None:
        with self.assertRaisesRegex(GatewayStartupError, "^runtime_secret_directory_missing$"):
            build_application({"GATEWAY_MODE": "production"})

    def test_production_start_subscribes_bounded_default_universe_before_waiting_for_control(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for filename in (
                "shioaji_api_key", "shioaji_secret_key", "cloudflare_ingest_secret",
                "cloudflare_access_client_id", "cloudflare_access_client_secret",
            ):
                path = root / filename
                path.write_text(f"fixture-{filename}", encoding="utf-8")
                path.chmod(0o600)
            class ProductionFixtureProvider(SimulationMarketDataProvider):
                def login_data_only(self, runtime_secrets: RuntimeSecrets | None) -> None:
                    if runtime_secrets is None:
                        raise GatewayStartupError("fixture_runtime_secret_missing")
                    self.connected = True

            provider = ProductionFixtureProvider()
            application = build_application({
                "GATEWAY_MODE": "production",
                "CREDENTIALS_DIRECTORY": directory,
                "REALTIME_INGEST_URL": "wss://example.test/api/realtime/ingest",
            }, provider=provider)
            class NoopUplink:
                connected = False

                def connect(self) -> None:
                    self.connected = True

                def close(self) -> None:
                    self.connected = False

                def safe_counts(self) -> dict[str, int | str]:
                    return {"uplinkState": "live" if self.connected else "disconnected"}

            uplink = NoopUplink()
            application.uplink_factory = lambda _secrets: uplink
            application.start()
            try:
                self.assertEqual(application.safe_health()["subscriptionCount"], 24)
                self.assertEqual(len(provider.subscriptions), 24)
                self.assertTrue(uplink.connected)
            finally:
                application.stop()

    def test_active_universe_cannot_exceed_internal_limit(self) -> None:
        with self.assertRaisesRegex(GatewayStartupError, "^active_universe_limit_out_of_range$"):
            RuntimeConfig.from_environment({"ACTIVE_UNIVERSE_LIMIT": "33"})

    def test_unsubscribe_cooldown_is_bounded_for_pilot_tuning(self) -> None:
        self.assertEqual(
            RuntimeConfig.from_environment({}).unsubscribe_cooldown_seconds,
            30,
        )
        self.assertEqual(
            RuntimeConfig.from_environment(
                {"UNSUBSCRIBE_COOLDOWN_SECONDS": "0"}
            ).unsubscribe_cooldown_seconds,
            0,
        )
        with self.assertRaisesRegex(
            GatewayStartupError,
            "^unsubscribe_cooldown_out_of_range$",
        ):
            RuntimeConfig.from_environment({"UNSUBSCRIBE_COOLDOWN_SECONDS": "301"})

    def test_session_buffer_point_capacity_is_bounded(self) -> None:
        self.assertEqual(
            RuntimeConfig.from_environment({}).session_buffer_points_per_symbol,
            18_000,
        )
        self.assertEqual(
            RuntimeConfig.from_environment(
                {"SESSION_BUFFER_POINTS_PER_SYMBOL": "1"}
            ).session_buffer_points_per_symbol,
            1,
        )
        with self.assertRaisesRegex(
            GatewayStartupError,
            "^session_buffer_point_capacity_out_of_range$",
        ):
            RuntimeConfig.from_environment(
                {"SESSION_BUFFER_POINTS_PER_SYMBOL": "20001"}
            )

    def test_application_universe_uses_pilot_limit_and_health_exposes_counts_only(self) -> None:
        application = build_application({"ACTIVE_UNIVERSE_LIMIT": "25"})
        snapshot = application.replace_user_symbols(["8069.TWO", "6488.TWO"])
        health = application.safe_health()

        self.assertEqual(snapshot.active_count, 25)
        self.assertEqual(snapshot.overflow_count, 1)
        self.assertEqual(health["activeUniverseLimit"], 25)
        self.assertEqual(health["activeUniverseCount"], 25)
        self.assertEqual(health["activeUniverseOverflowCount"], 1)
        serialized = json.dumps(health)
        self.assertNotIn("6488.TWO", serialized)
        self.assertNotIn("8069.TWO", serialized)

    def test_application_routes_watchlist_control_event_after_start(self) -> None:
        application = build_application({})
        application.start()
        try:
            result = application.handle_control_event(
                {"type": "watchlist-symbol-added", "symbol": "8069.TWO"}
            )
            self.assertEqual(result.status, "started")
            self.assertEqual(application.safe_health()["subscriptionCount"], 1)
            self.assertEqual(application.safe_health()["sessionBufferPointCount"], 0)
        finally:
            application.stop()

    def test_application_routes_normalized_tick_to_session_buffer(self) -> None:
        application = build_application({"SESSION_BUFFER_POINTS_PER_SYMBOL": "2"})
        normalized = normalize_shioaji_tick(
            "00981a.tw",
            {
                "datetime": "2026-07-31T09:00:00+08:00",
                "open": 12.5,
                "high": 12.6,
                "low": 12.4,
                "close": 12.55,
                "avg_price": 12.5,
                "volume": 1,
                "total_volume": 1,
                "simtrade": False,
            },
            1,
        )

        result = application.append_session_tick(normalized)
        snapshot = application.session_snapshot("00981A.TW")
        health = application.safe_health()

        self.assertTrue(result.accepted)
        self.assertEqual(snapshot.points, (normalized,))
        self.assertEqual(health["sessionBufferPointCount"], 1)
        self.assertNotIn("00981A.TW", json.dumps(health))

    def test_runtime_secret_files_must_be_private_regular_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for filename in (
                "shioaji_api_key",
                "shioaji_secret_key",
                "cloudflare_ingest_secret",
                "cloudflare_access_client_id",
                "cloudflare_access_client_secret",
            ):
                path = root / filename
                path.write_text(f"fixture-{filename}", encoding="utf-8")
                path.chmod(0o600)
            config = RuntimeConfig(
                mode=GatewayMode.PRODUCTION,
                credential_directory=root,
            )
            runtime_secrets = load_runtime_secrets(config)
            self.assertIsNotNone(runtime_secrets)
            self.assertEqual(repr(runtime_secrets), "RuntimeSecrets([REDACTED_SECRET])")

            (root / "shioaji_api_key").chmod(0o644)
            with self.assertRaisesRegex(GatewayStartupError, "^runtime_secret_permissions_too_open$"):
                load_runtime_secrets(config)

    def test_runtime_secret_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.write_text("fixture-value", encoding="utf-8")
            target.chmod(0o600)
            os.symlink(target, root / "shioaji_api_key")
            for filename in (
                "shioaji_secret_key",
                "cloudflare_ingest_secret",
                "cloudflare_access_client_id",
                "cloudflare_access_client_secret",
            ):
                path = root / filename
                path.write_text("fixture-value", encoding="utf-8")
                path.chmod(0o600)
            config = RuntimeConfig(
                mode=GatewayMode.PRODUCTION,
                credential_directory=root,
            )
            with self.assertRaisesRegex(GatewayStartupError, "^runtime_secret_invalid_type$"):
                load_runtime_secrets(config)


class ProviderContractTests(unittest.TestCase):
    def test_simulation_adapter_has_only_market_data_capabilities(self) -> None:
        provider = SimulationMarketDataProvider()
        provider.login_data_only(None)
        provider.subscribe_ticks("2330.TW")
        self.assertEqual(provider.subscriptions, {"2330.TW"})
        self.assertEqual(provider.capabilities, SAFE_CAPABILITIES)
        for forbidden in (
            "place_order",
            "update_order",
            "cancel_order",
            "account_balance",
            "positions",
            "activate_ca",
        ):
            self.assertFalse(hasattr(provider, forbidden))

    def test_shioaji_login_disables_trade_subscription_and_never_loads_ca(self) -> None:
        calls: dict[str, object] = {}

        class FakeQuote:
            def set_event_callback(self, callback: object) -> None:
                calls["event_callback"] = callback

        class FakeApi:
            def __init__(self, simulation: bool) -> None:
                calls["simulation"] = simulation
                self.Contracts = types.SimpleNamespace(Stocks={"2330": "stock-contract"})
                self.quote = FakeQuote()

            def login(self, **kwargs: object) -> None:
                calls["login"] = kwargs

            def set_on_tick_stk_v1_callback(self, callback: object) -> None:
                calls["callback"] = callback

            def subscribe(self, contract: object, *, quote_type: object) -> None:
                calls["subscribe"] = (contract, quote_type)

            def unsubscribe(self, contract: object, *, quote_type: object) -> None:
                calls["unsubscribe"] = (contract, quote_type)

            def kbars(self, **kwargs: object) -> object:
                calls["kbars"] = kwargs
                timestamp = datetime(
                    2026,
                    7,
                    31,
                    9,
                    1,
                    tzinfo=TAIPEI,
                )
                return types.SimpleNamespace(
                    ts=[int(timestamp.timestamp() * 1_000_000_000)],
                    Open=[100],
                    High=[103],
                    Low=[99],
                    Close=[102],
                    Volume=[20],
                    Amount=[2_040_000],
                )

            def logout(self) -> None:
                calls["logout"] = True

            def activate_ca(self, **kwargs: object) -> None:
                raise AssertionError("data-only adapter must not activate CA")

        fake_module = types.SimpleNamespace(
            Shioaji=FakeApi,
            QuoteType=types.SimpleNamespace(Tick="tick"),
        )
        connection_states: list[str] = []
        provider = ShioajiMarketDataProvider(
            module_loader=lambda: fake_module,
            connection_event_sink=connection_states.append,
        )
        runtime_secrets = RuntimeSecrets(
            api_key="fixture-api-key",
            secret_key="fixture-secret-key",
            ingest_secret="fixture-ingest-secret",
        )
        provider.login_data_only(runtime_secrets)
        callback = calls["callback"]
        assert callable(callback)
        event_callback = calls["event_callback"]
        assert callable(event_callback)
        event_callback(0, 12, "fixture-info-that-must-not-be-forwarded", "fixture-event")
        event_callback(0, 13, "fixture-info-that-must-not-be-forwarded", "fixture-event")
        callback(
            types.SimpleNamespace(value="TSE"),
            types.SimpleNamespace(
                code="2330",
                datetime=(2026, 7, 31, 9, 0, 0, 123456),
                open=100,
                high=103,
                low=99,
                close=102,
                avg_price=101,
                volume=2,
                total_volume=20,
                simtrade=False,
            ),
        )
        provider.subscribe_ticks("2330.TW")
        kbars = provider.fetch_daily_kbars("2330.TW", date(2026, 7, 31))
        provider.unsubscribe_ticks("2330.TW")
        provider.close()

        self.assertEqual(calls["simulation"], False)
        self.assertEqual(
            calls["login"],
            {
                "api_key": "fixture-api-key",
                "secret_key": "fixture-secret-key",
                "subscribe_trade": False,
            },
        )
        self.assertEqual(calls["subscribe"], ("stock-contract", "tick"))
        self.assertEqual(
            calls["kbars"],
            {
                "contract": "stock-contract",
                "start": "2026-07-31",
                "end": "2026-07-31",
                "timeout": 5000,
            },
        )
        self.assertEqual(len(kbars), 1)
        self.assertEqual(kbars[0].canonical_symbol, "2330.TW")
        self.assertEqual(kbars[0].source_time.strftime("%H:%M"), "09:01")
        self.assertEqual(calls["unsubscribe"], ("stock-contract", "tick"))
        self.assertEqual(calls["logout"], True)
        self.assertEqual(connection_states, ["live", "reconnecting", "live", "closed"])
        drained = provider.tick_buffer.drain()
        self.assertEqual(len(drained), 1)
        self.assertEqual(drained[0].canonical_symbol, "2330.TW")
        self.assertEqual(drained[0].source_time.microsecond, 123456)
        for forbidden in (
            "place_order",
            "update_order",
            "cancel_order",
            "account_balance",
            "positions",
            "activate_ca",
        ):
            self.assertFalse(hasattr(provider, forbidden))

    def test_shioaji_adapter_rejects_missing_runtime_secret(self) -> None:
        provider = ShioajiMarketDataProvider(module_loader=lambda: object())
        with self.assertRaisesRegex(GatewayStartupError, "^runtime_secret_missing$"):
            provider.login_data_only(None)

    def test_callback_registration_failure_logs_out_partial_session(self) -> None:
        calls: dict[str, object] = {}

        class FakeApi:
            def __init__(self, simulation: bool) -> None:
                calls["simulation"] = simulation
                self.quote = types.SimpleNamespace(
                    set_event_callback=lambda _callback: None,
                )

            def login(self, **kwargs: object) -> None:
                calls["login"] = kwargs

            def set_on_tick_stk_v1_callback(self, _callback: object) -> None:
                raise RuntimeError("fixture-sensitive")

            def logout(self) -> None:
                calls["logout"] = True

        provider = ShioajiMarketDataProvider(
            module_loader=lambda: types.SimpleNamespace(Shioaji=FakeApi),
        )
        with self.assertRaisesRegex(
            GatewayStartupError,
            "^provider_callback_registration_failed$",
        ):
            provider.login_data_only(
                RuntimeSecrets(
                    api_key="fixture-api-key",
                    secret_key="fixture-secret-key",
                    ingest_secret="fixture-ingest-secret",
                )
            )
        self.assertTrue(calls["logout"])

    def test_shioaji_version_is_pinned(self) -> None:
        self.assertEqual(PINNED_SHIOAJI_VERSION, "1.7.1")


if __name__ == "__main__":
    unittest.main()
