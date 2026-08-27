export const SMART_ORDER_SHIOAJI_TRADE_OBSERVER_TEST_ONLY = undefined;

export function assertSmartOrderLocalSidecarTradeObserverRuntimeAuthority({
    productionObserver,
    startTradeObserver,
    tradeObserverFetch,
}) {
    if (
        startTradeObserver !== productionObserver ||
        tradeObserverFetch !== globalThis.fetch
    ) {
        throw new Error(
            'production smart-order sidecar does not accept an injected trade observer or fetch authority',
        );
    }
}

export async function assertSmartOrderShioajiTradeObserverRuntimeAuthority({
    fetchImpl,
    runtimeController,
}) {
    const { isIssuedPrimarySmartOrderRuntimeController } = await import(
        './runtime-controller.mjs'
    );
    if (
        fetchImpl !== globalThis.fetch ||
        !isIssuedPrimarySmartOrderRuntimeController(runtimeController)
    ) {
        throw new Error(
            'production trade observer requires the issued primary Runtime controller and native fetch authority',
        );
    }
}
