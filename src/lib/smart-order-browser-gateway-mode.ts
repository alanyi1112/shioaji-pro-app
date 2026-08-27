// Production and packaged builds do not currently contain a reviewed
// smart-order same-origin gateway. Keep every browser control-plane caller
// fail-closed unless Vite's managed local serve configuration replaces this
// module with the explicit local-only variant.
export const SMART_ORDER_BROWSER_GATEWAY_AVAILABLE = false as const;
