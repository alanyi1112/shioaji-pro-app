"""Fail-closed runtime configuration without dotenv or secret CLI arguments."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
import os
from pathlib import Path
import stat
from typing import Mapping
from urllib.parse import urlparse


PINNED_SHIOAJI_VERSION = "1.7.1"
DEFAULT_ACTIVE_UNIVERSE_LIMIT = 32
MAX_ACTIVE_UNIVERSE_LIMIT = 32
DEFAULT_HEALTH_PORT = 8788
DEFAULT_UNSUBSCRIBE_COOLDOWN_SECONDS = 30
MAX_UNSUBSCRIBE_COOLDOWN_SECONDS = 300
DEFAULT_SESSION_BUFFER_POINTS_PER_SYMBOL = 18_000
MAX_SESSION_BUFFER_POINTS_PER_SYMBOL = 20_000
DEFAULT_PROVIDER_LOGIN_ATTEMPT_LIMIT = 6
MAX_PROVIDER_LOGIN_ATTEMPT_LIMIT = 8
DEFAULT_PROVIDER_SUBSCRIPTION_ATTEMPT_LIMIT = 64
MAX_PROVIDER_SUBSCRIPTION_ATTEMPT_LIMIT = 128
DEFAULT_PROVIDER_KBARS_DAILY_LIMIT = 32
MAX_PROVIDER_KBARS_DAILY_LIMIT = 32
DEFAULT_PROVIDER_FAILURE_THRESHOLD = 3
MAX_PROVIDER_FAILURE_THRESHOLD = 8
DEFAULT_PROVIDER_COOLDOWN_SECONDS = 60
MAX_PROVIDER_COOLDOWN_SECONDS = 300
MIN_HEALTH_PORT = 1024
MAX_HEALTH_PORT = 65535
MAX_SECRET_BYTES = 4096

RUNTIME_SECRET_FILES = {
    "api_key": "shioaji_api_key",
    "secret_key": "shioaji_secret_key",
    "ingest_secret": "cloudflare_ingest_secret",
    "access_client_id": "cloudflare_access_client_id",
    "access_client_secret": "cloudflare_access_client_secret",
}


class GatewayMode(StrEnum):
    SIMULATION = "simulation"
    PRODUCTION = "production"


class GatewayStartupError(RuntimeError):
    """Startup error whose string representation is always a safe reason code."""

    def __init__(self, reason_code: str) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code

    def __str__(self) -> str:
        return self.reason_code


@dataclass(frozen=True)
class RuntimeSecrets:
    api_key: str = field(repr=False)
    secret_key: str = field(repr=False)
    ingest_secret: str = field(repr=False)
    access_client_id: str | None = field(default=None, repr=False)
    access_client_secret: str | None = field(default=None, repr=False)

    def __repr__(self) -> str:
        return "RuntimeSecrets([REDACTED_SECRET])"


@dataclass(frozen=True)
class RuntimeConfig:
    mode: GatewayMode
    credential_directory: Path | None = None
    active_universe_limit: int = DEFAULT_ACTIVE_UNIVERSE_LIMIT
    health_port: int = DEFAULT_HEALTH_PORT
    unsubscribe_cooldown_seconds: int = DEFAULT_UNSUBSCRIBE_COOLDOWN_SECONDS
    session_buffer_points_per_symbol: int = DEFAULT_SESSION_BUFFER_POINTS_PER_SYMBOL
    provider_login_attempt_limit: int = DEFAULT_PROVIDER_LOGIN_ATTEMPT_LIMIT
    provider_subscription_attempt_limit: int = DEFAULT_PROVIDER_SUBSCRIPTION_ATTEMPT_LIMIT
    provider_kbars_daily_limit: int = DEFAULT_PROVIDER_KBARS_DAILY_LIMIT
    provider_failure_threshold: int = DEFAULT_PROVIDER_FAILURE_THRESHOLD
    provider_cooldown_seconds: int = DEFAULT_PROVIDER_COOLDOWN_SECONDS
    realtime_ingest_url: str | None = None
    shioaji_version: str = PINNED_SHIOAJI_VERSION

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> "RuntimeConfig":
        source = os.environ if environment is None else environment
        raw_mode = source.get("GATEWAY_MODE", GatewayMode.SIMULATION.value).strip().lower()
        try:
            mode = GatewayMode(raw_mode)
        except ValueError as error:
            raise GatewayStartupError("invalid_gateway_mode") from error

        raw_limit = source.get("ACTIVE_UNIVERSE_LIMIT", str(DEFAULT_ACTIVE_UNIVERSE_LIMIT))
        try:
            active_universe_limit = int(raw_limit)
        except ValueError as error:
            raise GatewayStartupError("invalid_active_universe_limit") from error
        if not 1 <= active_universe_limit <= MAX_ACTIVE_UNIVERSE_LIMIT:
            raise GatewayStartupError("active_universe_limit_out_of_range")

        raw_health_port = source.get("GATEWAY_HEALTH_PORT", str(DEFAULT_HEALTH_PORT))
        try:
            health_port = int(raw_health_port)
        except ValueError:
            raise GatewayStartupError("invalid_health_port") from None
        if not MIN_HEALTH_PORT <= health_port <= MAX_HEALTH_PORT:
            raise GatewayStartupError("health_port_out_of_range")

        raw_cooldown = source.get(
            "UNSUBSCRIBE_COOLDOWN_SECONDS",
            str(DEFAULT_UNSUBSCRIBE_COOLDOWN_SECONDS),
        )
        try:
            unsubscribe_cooldown_seconds = int(raw_cooldown)
        except ValueError:
            raise GatewayStartupError("invalid_unsubscribe_cooldown") from None
        if not 0 <= unsubscribe_cooldown_seconds <= MAX_UNSUBSCRIBE_COOLDOWN_SECONDS:
            raise GatewayStartupError("unsubscribe_cooldown_out_of_range")

        raw_session_points = source.get(
            "SESSION_BUFFER_POINTS_PER_SYMBOL",
            str(DEFAULT_SESSION_BUFFER_POINTS_PER_SYMBOL),
        )
        try:
            session_buffer_points_per_symbol = int(raw_session_points)
        except ValueError:
            raise GatewayStartupError("invalid_session_buffer_point_capacity") from None
        if not 1 <= session_buffer_points_per_symbol <= MAX_SESSION_BUFFER_POINTS_PER_SYMBOL:
            raise GatewayStartupError("session_buffer_point_capacity_out_of_range")

        provider_login_attempt_limit = _bounded_int(
            source,
            "PROVIDER_LOGIN_ATTEMPT_LIMIT",
            DEFAULT_PROVIDER_LOGIN_ATTEMPT_LIMIT,
            1,
            MAX_PROVIDER_LOGIN_ATTEMPT_LIMIT,
            "provider_login_attempt_limit_out_of_range",
        )
        provider_subscription_attempt_limit = _bounded_int(
            source,
            "PROVIDER_SUBSCRIPTION_ATTEMPT_LIMIT",
            DEFAULT_PROVIDER_SUBSCRIPTION_ATTEMPT_LIMIT,
            1,
            MAX_PROVIDER_SUBSCRIPTION_ATTEMPT_LIMIT,
            "provider_subscription_attempt_limit_out_of_range",
        )
        provider_kbars_daily_limit = _bounded_int(
            source,
            "PROVIDER_KBARS_DAILY_LIMIT",
            DEFAULT_PROVIDER_KBARS_DAILY_LIMIT,
            1,
            MAX_PROVIDER_KBARS_DAILY_LIMIT,
            "provider_kbars_daily_limit_out_of_range",
        )
        provider_failure_threshold = _bounded_int(
            source,
            "PROVIDER_FAILURE_THRESHOLD",
            DEFAULT_PROVIDER_FAILURE_THRESHOLD,
            1,
            MAX_PROVIDER_FAILURE_THRESHOLD,
            "provider_failure_threshold_out_of_range",
        )
        provider_cooldown_seconds = _bounded_int(
            source,
            "PROVIDER_COOLDOWN_SECONDS",
            DEFAULT_PROVIDER_COOLDOWN_SECONDS,
            1,
            MAX_PROVIDER_COOLDOWN_SECONDS,
            "provider_cooldown_seconds_out_of_range",
        )

        raw_directory = source.get("CREDENTIALS_DIRECTORY", "").strip()
        credential_directory = Path(raw_directory) if raw_directory else None
        if mode is GatewayMode.PRODUCTION and credential_directory is None:
            raise GatewayStartupError("runtime_secret_directory_missing")
        realtime_ingest_url = source.get("REALTIME_INGEST_URL", "").strip() or None
        if mode is GatewayMode.PRODUCTION:
            parsed = urlparse(realtime_ingest_url or "")
            if (
                parsed.scheme != "wss"
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.query
                or parsed.fragment
                or parsed.path != "/api/realtime/ingest"
            ):
                raise GatewayStartupError("realtime_ingest_url_invalid")

        return cls(
            mode=mode,
            credential_directory=credential_directory,
            active_universe_limit=active_universe_limit,
            health_port=health_port,
            unsubscribe_cooldown_seconds=unsubscribe_cooldown_seconds,
            session_buffer_points_per_symbol=session_buffer_points_per_symbol,
            provider_login_attempt_limit=provider_login_attempt_limit,
            provider_subscription_attempt_limit=provider_subscription_attempt_limit,
            provider_kbars_daily_limit=provider_kbars_daily_limit,
            provider_failure_threshold=provider_failure_threshold,
            provider_cooldown_seconds=provider_cooldown_seconds,
            realtime_ingest_url=realtime_ingest_url,
        )


def _bounded_int(
    source: Mapping[str, str],
    name: str,
    default: int,
    minimum: int,
    maximum: int,
    reason_code: str,
) -> int:
    try:
        value = int(source.get(name, str(default)))
    except ValueError:
        raise GatewayStartupError(reason_code) from None
    if not minimum <= value <= maximum:
        raise GatewayStartupError(reason_code)
    return value


def _read_runtime_secret(directory: Path, filename: str) -> str:
    path = directory / filename
    try:
        info = path.lstat()
    except OSError as error:
        raise GatewayStartupError("runtime_secret_missing") from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise GatewayStartupError("runtime_secret_invalid_type")
    if info.st_mode & 0o077:
        raise GatewayStartupError("runtime_secret_permissions_too_open")
    if not 0 < info.st_size <= MAX_SECRET_BYTES:
        raise GatewayStartupError("runtime_secret_invalid_size")

    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
        try:
            payload = os.read(descriptor, MAX_SECRET_BYTES + 1)
        finally:
            os.close(descriptor)
    except OSError as error:
        raise GatewayStartupError("runtime_secret_unreadable") from error

    if len(payload) > MAX_SECRET_BYTES:
        raise GatewayStartupError("runtime_secret_invalid_size")
    try:
        value = payload.decode("utf-8").strip()
    except UnicodeDecodeError as error:
        raise GatewayStartupError("runtime_secret_invalid_encoding") from error
    if not value or value == "[REDACTED_SECRET]":
        raise GatewayStartupError("runtime_secret_placeholder")
    return value


def load_runtime_secrets(config: RuntimeConfig) -> RuntimeSecrets | None:
    if config.mode is GatewayMode.SIMULATION:
        return None
    if config.credential_directory is None:
        raise GatewayStartupError("runtime_secret_directory_missing")

    try:
        directory_info = config.credential_directory.stat()
    except OSError as error:
        raise GatewayStartupError("runtime_secret_directory_unavailable") from error
    if not stat.S_ISDIR(directory_info.st_mode):
        raise GatewayStartupError("runtime_secret_directory_invalid")

    values = {
        field_name: _read_runtime_secret(config.credential_directory, filename)
        for field_name, filename in RUNTIME_SECRET_FILES.items()
    }
    return RuntimeSecrets(**values)
