"""Data-only Shioaji gateway foundation."""

from .active_universe import ActiveUniverse, ActiveUniverseSnapshot
from .application import GatewayApplication, build_application
from .control_plane import ControlPlaneResult, GatewayControlPlane
from .runtime_config import GatewayMode, GatewayStartupError, RuntimeConfig
from .session_backfill import SessionBackfillCoordinator, SessionBackfillResult
from .provider_budget import BudgetedMarketDataProvider, ProviderBudgetPolicy
from .uplink import RealtimeMicrobatchUplink
from .session_buffer import (
    BoundedSessionRingBuffer,
    SessionAppendResult,
    SessionBackfillMergeResult,
    SessionBufferStats,
    SessionPoint,
    SessionSnapshot,
)
from .subscriptions import (
    SubscriptionAcquireResult,
    SubscriptionManager,
    SubscriptionSnapshot,
)

__all__ = [
    "ActiveUniverse",
    "ActiveUniverseSnapshot",
    "GatewayApplication",
    "GatewayControlPlane",
    "GatewayMode",
    "GatewayStartupError",
    "ControlPlaneResult",
    "RuntimeConfig",
    "SessionBackfillCoordinator",
    "SessionBackfillResult",
    "BudgetedMarketDataProvider",
    "ProviderBudgetPolicy",
    "RealtimeMicrobatchUplink",
    "BoundedSessionRingBuffer",
    "SessionAppendResult",
    "SessionBackfillMergeResult",
    "SessionBufferStats",
    "SessionPoint",
    "SessionSnapshot",
    "SubscriptionAcquireResult",
    "SubscriptionManager",
    "SubscriptionSnapshot",
    "build_application",
]
