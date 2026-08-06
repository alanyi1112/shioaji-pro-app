"""Narrow market-data providers with no order, account, position, or CA surface."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import date
import importlib
import itertools
from threading import Lock
from typing import Any, Protocol
from uuid import uuid4

from .model import (
    NormalizedKbar,
    NormalizedTick,
    normalize_shioaji_kbar,
    normalize_shioaji_tick,
)
from .runtime_config import GatewayStartupError, RuntimeSecrets
from .tick_buffer import BoundedLatestTickBuffer


SAFE_CAPABILITIES = (
    "market_login",
    "contract_lookup",
    "tick_subscribe",
    "tick_unsubscribe",
    "daily_kbars",
    "safe_health",
)

MAX_DAILY_KBAR_ROWS = 600


class MarketDataProvider(Protocol):
    @property
    def capabilities(self) -> tuple[str, ...]: ...

    def login_data_only(self, runtime_secrets: RuntimeSecrets | None) -> None: ...

    def subscribe_ticks(self, canonical_symbol: str) -> None: ...

    def unsubscribe_ticks(self, canonical_symbol: str) -> None: ...

    def fetch_daily_kbars(
        self,
        canonical_symbol: str,
        session_date: date,
    ) -> tuple[NormalizedKbar, ...]: ...

    def drain_ticks(self, limit: int | None = None) -> list[NormalizedTick]: ...

    def close(self) -> None: ...


class SimulationMarketDataProvider:
    def __init__(self) -> None:
        self.connected = False
        self.subscriptions: set[str] = set()

    @property
    def capabilities(self) -> tuple[str, ...]:
        return SAFE_CAPABILITIES

    def login_data_only(self, runtime_secrets: RuntimeSecrets | None) -> None:
        if runtime_secrets is not None:
            raise GatewayStartupError("simulation_received_runtime_secret")
        self.connected = True

    def subscribe_ticks(self, canonical_symbol: str) -> None:
        if not self.connected:
            raise GatewayStartupError("provider_not_connected")
        self.subscriptions.add(canonical_symbol)

    def unsubscribe_ticks(self, canonical_symbol: str) -> None:
        self.subscriptions.discard(canonical_symbol)

    def fetch_daily_kbars(
        self,
        canonical_symbol: str,
        session_date: date,
    ) -> tuple[NormalizedKbar, ...]:
        if not self.connected:
            raise GatewayStartupError("provider_not_connected")
        return ()

    def drain_ticks(self, limit: int | None = None) -> list[NormalizedTick]:
        if limit is not None and limit < 0:
            raise GatewayStartupError("tick_buffer_drain_limit_invalid")
        return []

    def close(self) -> None:
        self.subscriptions.clear()
        self.connected = False


class ShioajiMarketDataProvider:
    """Shioaji adapter that deliberately exposes only market-data operations."""

    def __init__(
        self,
        module_loader: Callable[[], Any] | None = None,
        tick_buffer: BoundedLatestTickBuffer | None = None,
        connection_event_sink: Callable[[str], None] | None = None,
    ) -> None:
        self._module_loader = module_loader or self._import_shioaji
        self._tick_buffer = tick_buffer or BoundedLatestTickBuffer()
        self._sequences = itertools.count(1)
        self._connection_id = uuid4().hex
        self._sequence_lock = Lock()
        self._invalid_callback_ticks = 0
        self._connection_event_sink = connection_event_sink
        self._connection_state = "starting"
        self._module: Any | None = None
        self._api: Any | None = None

    @staticmethod
    def _import_shioaji() -> Any:
        try:
            return importlib.import_module("shioaji")
        except ImportError:
            raise GatewayStartupError("provider_runtime_unavailable") from None

    @property
    def capabilities(self) -> tuple[str, ...]:
        return SAFE_CAPABILITIES

    @property
    def tick_buffer(self) -> BoundedLatestTickBuffer:
        return self._tick_buffer

    @property
    def invalid_callback_ticks(self) -> int:
        with self._sequence_lock:
            return self._invalid_callback_ticks

    @property
    def connection_state(self) -> str:
        with self._sequence_lock:
            return self._connection_state

    def _next_sequence(self) -> int:
        with self._sequence_lock:
            return next(self._sequences)

    def _set_connection_state(self, state: str) -> None:
        with self._sequence_lock:
            self._connection_state = state
        if self._connection_event_sink is not None:
            self._connection_event_sink(state)

    def _on_quote_event(
        self,
        _response_code: int,
        event_code: int,
        _info: str,
        _event: str,
    ) -> None:
        state_by_event = {
            0: "live",
            1: "disconnected",
            2: "connect_failed",
            12: "reconnecting",
            13: "live",
        }
        state = state_by_event.get(event_code)
        if state is not None:
            self._set_connection_state(state)

    @staticmethod
    def _canonical_symbol(exchange: Any, code: Any) -> str:
        raw_exchange = (
            getattr(exchange, "value", None)
            or getattr(exchange, "name", None)
            or str(exchange)
        )
        normalized_exchange = str(raw_exchange).upper()
        if "OTC" in normalized_exchange or "TPEX" in normalized_exchange:
            suffix = ".TWO"
        elif "TSE" in normalized_exchange or "TWSE" in normalized_exchange:
            suffix = ".TW"
        else:
            raise GatewayStartupError("unsupported_exchange")
        return f"{str(code).strip()}{suffix}"

    def _on_tick(self, exchange: Any, tick: Any) -> None:
        try:
            canonical_symbol = self._canonical_symbol(exchange, getattr(tick, "code", ""))
            payload = {
                "datetime": getattr(tick, "datetime", None),
                "open": getattr(tick, "open", None),
                "high": getattr(tick, "high", None),
                "low": getattr(tick, "low", None),
                "close": getattr(tick, "close", None),
                "avg_price": getattr(tick, "avg_price", None),
                "volume": getattr(tick, "volume", None),
                "total_volume": getattr(tick, "total_volume", None),
                "simtrade": getattr(tick, "simtrade", False),
            }
            normalized = normalize_shioaji_tick(
                canonical_symbol,
                payload,
                self._next_sequence(),
                self._connection_id,
            )
            self._tick_buffer.offer_from_callback(normalized)
        except GatewayStartupError:
            with self._sequence_lock:
                self._invalid_callback_ticks += 1

    def login_data_only(self, runtime_secrets: RuntimeSecrets | None) -> None:
        if runtime_secrets is None:
            raise GatewayStartupError("runtime_secret_missing")
        module = self._module_loader()
        api = module.Shioaji(simulation=False)
        try:
            api.login(
                api_key=runtime_secrets.api_key,
                secret_key=runtime_secrets.secret_key,
                subscribe_trade=False,
            )
        except Exception:
            raise GatewayStartupError("provider_login_failed") from None
        try:
            api.set_on_tick_stk_v1_callback(self._on_tick)
            api.quote.set_event_callback(self._on_quote_event)
        except Exception:
            try:
                api.logout()
            except Exception:
                pass
            raise GatewayStartupError("provider_callback_registration_failed") from None
        self._module = module
        self._api = api
        self._set_connection_state("live")

    def _contract_for(self, canonical_symbol: str) -> Any:
        if self._api is None:
            raise GatewayStartupError("provider_not_connected")
        code = canonical_symbol.split(".", 1)[0]
        if not code or not canonical_symbol.endswith((".TW", ".TWO")):
            raise GatewayStartupError("unsupported_canonical_symbol")
        try:
            return self._api.Contracts.Stocks[code]
        except Exception:
            raise GatewayStartupError("provider_contract_unavailable") from None

    def subscribe_ticks(self, canonical_symbol: str) -> None:
        if self._api is None or self._module is None:
            raise GatewayStartupError("provider_not_connected")
        contract = self._contract_for(canonical_symbol)
        try:
            self._api.subscribe(contract, quote_type=self._module.QuoteType.Tick)
        except Exception:
            raise GatewayStartupError("provider_subscribe_failed") from None

    def unsubscribe_ticks(self, canonical_symbol: str) -> None:
        if self._api is None or self._module is None:
            return
        contract = self._contract_for(canonical_symbol)
        try:
            self._api.unsubscribe(contract, quote_type=self._module.QuoteType.Tick)
        except Exception:
            raise GatewayStartupError("provider_unsubscribe_failed") from None

    @staticmethod
    def _kbar_column(payload: Any, *names: str) -> list[Any]:
        value: Any = None
        for name in names:
            if isinstance(payload, Mapping) and name in payload:
                value = payload[name]
                break
            value = getattr(payload, name, None)
            if value is not None:
                break
        if value is None or isinstance(value, (str, bytes)):
            raise GatewayStartupError("provider_kbars_schema_invalid")
        try:
            return list(value)
        except TypeError:
            raise GatewayStartupError("provider_kbars_schema_invalid") from None

    def fetch_daily_kbars(
        self,
        canonical_symbol: str,
        session_date: date,
    ) -> tuple[NormalizedKbar, ...]:
        if self._api is None:
            raise GatewayStartupError("provider_not_connected")
        if type(session_date) is not date:
            raise GatewayStartupError("kbar_session_date_invalid")
        contract = self._contract_for(canonical_symbol)
        date_text = session_date.isoformat()
        try:
            payload = self._api.kbars(
                contract=contract,
                start=date_text,
                end=date_text,
                timeout=5000,
            )
        except Exception:
            raise GatewayStartupError("provider_kbars_failed") from None

        columns = {
            "timestamp": self._kbar_column(payload, "ts", "datetime"),
            "open": self._kbar_column(payload, "Open", "open"),
            "high": self._kbar_column(payload, "High", "high"),
            "low": self._kbar_column(payload, "Low", "low"),
            "close": self._kbar_column(payload, "Close", "close"),
            "volume": self._kbar_column(payload, "Volume", "volume"),
            "amount": self._kbar_column(payload, "Amount", "amount"),
        }
        row_count = len(columns["timestamp"])
        if row_count > MAX_DAILY_KBAR_ROWS or any(
            len(column) != row_count for column in columns.values()
        ):
            raise GatewayStartupError("provider_kbars_schema_invalid")

        normalized: dict[object, NormalizedKbar] = {}
        for index in range(row_count):
            try:
                point = normalize_shioaji_kbar(
                    canonical_symbol,
                    session_date,
                    timestamp_ns=columns["timestamp"][index],
                    open_price=columns["open"][index],
                    high_price=columns["high"][index],
                    low_price=columns["low"][index],
                    close_price=columns["close"][index],
                    volume=columns["volume"][index],
                    amount=columns["amount"][index],
                )
            except GatewayStartupError as error:
                if str(error) == "kbar_session_date_mismatch":
                    continue
                raise
            normalized[point.source_time] = point
        return tuple(normalized[key] for key in sorted(normalized))

    def drain_ticks(self, limit: int | None = None) -> list[NormalizedTick]:
        return self._tick_buffer.drain(limit)

    def close(self) -> None:
        api = self._api
        self._api = None
        self._module = None
        self._set_connection_state("closed")
        if api is None:
            return
        try:
            api.logout()
        except Exception:
            raise GatewayStartupError("provider_logout_failed") from None
