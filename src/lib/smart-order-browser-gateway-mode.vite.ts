// This module is selected only by the managed local Vite serve configuration.
// The gateway itself still verifies loopback socket, Host, Origin, Fetch
// Metadata, CSRF and the private sidecar capability for every request.
export const SMART_ORDER_BROWSER_GATEWAY_AVAILABLE = true as const;
