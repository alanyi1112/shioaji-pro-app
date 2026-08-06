"""Canonical Taiwan stock Tick model and strict Shioaji normalization."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import math
from typing import Any, Mapping
from zoneinfo import ZoneInfo

from .active_universe import canonical_taiwan_symbol
from .runtime_config import GatewayStartupError


TAIPEI = ZoneInfo("Asia/Taipei")


@dataclass(frozen=True)
class NormalizedTick:
    canonical_symbol: str
    exchange: str
    session_date: date
    source_time: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    average_price: Decimal
    tick_volume: int
    total_volume: int
    simtrade: bool
    sequence: int
    connection_id: str = "local"


@dataclass(frozen=True)
class NormalizedKbar:
    canonical_symbol: str
    exchange: str
    session_date: date
    source_time: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int
    amount: Decimal


def _decimal(payload: Mapping[str, Any], *keys: str) -> Decimal:
    value: Any = None
    for key in keys:
        if key in payload:
            value = payload[key]
            break
    if value is None or isinstance(value, bool):
        raise GatewayStartupError("tick_price_missing")
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise GatewayStartupError("tick_price_invalid") from None
    if not number.is_finite() or number <= 0:
        raise GatewayStartupError("tick_price_invalid")
    return number


def _volume(payload: Mapping[str, Any], key: str) -> int:
    value = payload.get(key)
    if value is None or isinstance(value, bool):
        raise GatewayStartupError("tick_volume_missing")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise GatewayStartupError("tick_volume_invalid") from None
    if not math.isfinite(number) or number < 0 or not number.is_integer():
        raise GatewayStartupError("tick_volume_invalid")
    return int(number)


def _nonnegative_decimal(value: Any, reason_code: str) -> Decimal:
    if value is None or isinstance(value, bool):
        raise GatewayStartupError(reason_code)
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise GatewayStartupError(reason_code) from None
    if not number.is_finite() or number < 0:
        raise GatewayStartupError(reason_code)
    return number


def _source_time(value: Any) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, (tuple, list)) and 6 <= len(value) <= 7:
        try:
            components = [int(component) for component in value]
            parsed = datetime(*components, tzinfo=TAIPEI)
        except (TypeError, ValueError):
            raise GatewayStartupError("tick_source_time_invalid") from None
    elif isinstance(value, str):
        candidate = value.strip()
        if candidate.endswith("Z"):
            candidate = candidate[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            raise GatewayStartupError("tick_source_time_invalid") from None
    else:
        raise GatewayStartupError("tick_source_time_missing")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TAIPEI)
    return parsed.astimezone(TAIPEI)


def _simtrade(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value in (0, 1):
        return bool(value)
    raise GatewayStartupError("tick_simtrade_invalid")


def normalize_shioaji_tick(
    canonical_symbol: str,
    payload: Mapping[str, Any],
    sequence: int,
    connection_id: str = "local",
) -> NormalizedTick:
    normalized_symbol = canonical_taiwan_symbol(canonical_symbol)
    if normalized_symbol is None:
        raise GatewayStartupError("unsupported_canonical_symbol")
    if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence <= 0:
        raise GatewayStartupError("tick_sequence_invalid")
    if (
        not isinstance(connection_id, str)
        or not 1 <= len(connection_id) <= 64
        or not all(character.isalnum() or character in "-_" for character in connection_id)
    ):
        raise GatewayStartupError("tick_connection_id_invalid")

    source_time = _source_time(payload.get("datetime"))
    open_price = _decimal(payload, "open")
    high_price = _decimal(payload, "high")
    low_price = _decimal(payload, "low")
    close_price = _decimal(payload, "close")
    average_price = _decimal(payload, "avg_price", "average_price")
    if high_price < low_price or not low_price <= open_price <= high_price:
        raise GatewayStartupError("tick_ohlc_invalid")
    if not low_price <= close_price <= high_price or not low_price <= average_price <= high_price:
        raise GatewayStartupError("tick_ohlc_invalid")

    tick_volume = _volume(payload, "volume")
    total_volume = _volume(payload, "total_volume")
    if tick_volume > total_volume:
        raise GatewayStartupError("tick_volume_invalid")

    return NormalizedTick(
        canonical_symbol=normalized_symbol,
        exchange="TWSE" if normalized_symbol.endswith(".TW") else "TPEx",
        session_date=source_time.date(),
        source_time=source_time,
        open=open_price,
        high=high_price,
        low=low_price,
        close=close_price,
        average_price=average_price,
        tick_volume=tick_volume,
        total_volume=total_volume,
        simtrade=_simtrade(payload.get("simtrade", False)),
        sequence=sequence,
        connection_id=connection_id,
    )


def normalize_shioaji_kbar(
    canonical_symbol: str,
    session_date: date,
    *,
    timestamp_ns: object,
    open_price: object,
    high_price: object,
    low_price: object,
    close_price: object,
    volume: object,
    amount: object,
) -> NormalizedKbar:
    normalized_symbol = canonical_taiwan_symbol(canonical_symbol)
    if normalized_symbol is None:
        raise GatewayStartupError("unsupported_canonical_symbol")
    if type(session_date) is not date:
        raise GatewayStartupError("kbar_session_date_invalid")
    if isinstance(timestamp_ns, bool):
        raise GatewayStartupError("kbar_source_time_invalid")
    try:
        raw_timestamp_ns = int(timestamp_ns)
    except (TypeError, ValueError, OverflowError):
        raise GatewayStartupError("kbar_source_time_invalid") from None
    if raw_timestamp_ns <= 0:
        raise GatewayStartupError("kbar_source_time_invalid")
    try:
        source_time = datetime.fromtimestamp(
            raw_timestamp_ns / 1_000_000_000,
            tz=timezone.utc,
        ).astimezone(TAIPEI)
    except (OverflowError, OSError, ValueError):
        raise GatewayStartupError("kbar_source_time_invalid") from None
    if source_time.date() != session_date:
        raise GatewayStartupError("kbar_session_date_mismatch")

    prices = {
        "open": open_price,
        "high": high_price,
        "low": low_price,
        "close": close_price,
    }
    normalized_prices = {
        key: _nonnegative_decimal(value, "kbar_price_invalid")
        for key, value in prices.items()
    }
    if any(value <= 0 for value in normalized_prices.values()):
        raise GatewayStartupError("kbar_price_invalid")
    if (
        normalized_prices["high"] < normalized_prices["low"]
        or not normalized_prices["low"]
        <= normalized_prices["open"]
        <= normalized_prices["high"]
        or not normalized_prices["low"]
        <= normalized_prices["close"]
        <= normalized_prices["high"]
    ):
        raise GatewayStartupError("kbar_ohlc_invalid")

    normalized_volume = _nonnegative_decimal(volume, "kbar_volume_invalid")
    if normalized_volume != normalized_volume.to_integral_value():
        raise GatewayStartupError("kbar_volume_invalid")
    normalized_amount = _nonnegative_decimal(amount, "kbar_amount_invalid")
    return NormalizedKbar(
        canonical_symbol=normalized_symbol,
        exchange="TWSE" if normalized_symbol.endswith(".TW") else "TPEx",
        session_date=session_date,
        source_time=source_time,
        open=normalized_prices["open"],
        high=normalized_prices["high"],
        low=normalized_prices["low"],
        close=normalized_prices["close"],
        volume=int(normalized_volume),
        amount=normalized_amount,
    )


def merge_coalesced_ticks(previous: NormalizedTick, incoming: NormalizedTick) -> NormalizedTick:
    if previous.canonical_symbol != incoming.canonical_symbol:
        raise GatewayStartupError("tick_symbol_mismatch")
    if previous.session_date != incoming.session_date:
        return incoming
    if incoming.sequence <= previous.sequence or incoming.source_time < previous.source_time:
        return previous

    return NormalizedTick(
        canonical_symbol=previous.canonical_symbol,
        exchange=previous.exchange,
        session_date=previous.session_date,
        source_time=incoming.source_time,
        open=previous.open,
        high=max(previous.high, incoming.high),
        low=min(previous.low, incoming.low),
        close=incoming.close,
        average_price=incoming.average_price,
        tick_volume=previous.tick_volume + incoming.tick_volume,
        total_volume=max(previous.total_volume, incoming.total_volume),
        simtrade=incoming.simtrade,
        sequence=incoming.sequence,
    )
