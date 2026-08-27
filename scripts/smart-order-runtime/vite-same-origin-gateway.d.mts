import type { Plugin } from 'vite';

export const SMART_ORDER_VITE_GATEWAY_SCHEMA_VERSION: string;
export const SMART_ORDER_VITE_GATEWAY_PREFIX: string;
export const SMART_ORDER_BROWSER_CSRF_HEADER: string;
export const SMART_ORDER_BROWSER_CSRF_ROUTE: string;

export interface SmartOrderGatewayOptions {
    appSupportRoot?: string;
    now?: () => number;
    csrfTokenTtlMs?: number;
    csrfSessionTtlMs?: number;
}

export function authorizeSmartOrderBrowserGatewayRequest(
    request: unknown,
): Readonly<Record<string, unknown>>;

export function readSmartOrderGatewayAuthority(options: {
    appSupportRoot?: string;
    nowEpochMs?: number;
}): Promise<Readonly<Record<string, unknown>>>;

export function createSmartOrderSameOriginGatewayMiddleware(
    options?: SmartOrderGatewayOptions,
): (
    request: unknown,
    response: unknown,
    next: () => void,
) => Promise<void>;

export function smartOrderSameOriginGateway(
    options?: SmartOrderGatewayOptions,
): Plugin;
