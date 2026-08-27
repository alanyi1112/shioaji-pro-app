const AUTHORIZED_FETCH_BY_CONTROLLER = new WeakMap();
const AUTHORIZED_FETCH_BY_OBSERVER = new WeakMap();

export const SMART_ORDER_SHIOAJI_TRADE_OBSERVER_TEST_ONLY = Object.freeze({
    authorize({ fetchImpl, runtimeController }) {
        if (
            typeof fetchImpl !== 'function' ||
            !runtimeController ||
            typeof runtimeController !== 'object'
        ) {
            throw new TypeError('test observer authority input is invalid');
        }
        AUTHORIZED_FETCH_BY_CONTROLLER.set(runtimeController, fetchImpl);
    },
    authorizeLocalSidecar({ startTradeObserver, tradeObserverFetch }) {
        if (
            typeof startTradeObserver !== 'function' ||
            typeof tradeObserverFetch !== 'function'
        ) {
            throw new TypeError('test sidecar observer authority input is invalid');
        }
        AUTHORIZED_FETCH_BY_OBSERVER.set(
            startTradeObserver,
            tradeObserverFetch,
        );
    },
});

export function assertSmartOrderLocalSidecarTradeObserverRuntimeAuthority({
    productionObserver,
    startTradeObserver,
    tradeObserverFetch,
}) {
    if (
        (startTradeObserver === productionObserver &&
            tradeObserverFetch === globalThis.fetch) ||
        AUTHORIZED_FETCH_BY_OBSERVER.get(startTradeObserver) ===
            tradeObserverFetch
    ) {
        return;
    }
    throw new Error(
        'test smart-order sidecar requires module-issued observer/fetch authority',
    );
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
        if (
            !runtimeController ||
            AUTHORIZED_FETCH_BY_CONTROLLER.get(runtimeController) !== fetchImpl
        ) {
            throw new Error(
                'test trade observer requires module-issued Runtime/fetch authority',
            );
        }
    }
}
