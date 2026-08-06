export const RUNTIME_MODE_ENDPOINT = '/__realtimestock/runtime-mode';

export type RuntimeMode =
    | 'simulation'
    | 'production-readonly'
    | 'unknown';

export const TRADING_WRITE_PATHS = new Set([
    '/api/v1/order/place_order',
    '/api/v1/order/cancel_order',
    '/api/v1/order/update_price',
    '/api/v1/order/update_qty',
    '/api/v1/order/place_comboorder',
    '/api/v1/order/cancel_comboorder',
]);

export function normalizeRuntimeMode(value: unknown): RuntimeMode {
    return value === 'simulation' || value === 'production-readonly'
        ? value
        : 'unknown';
}

export function isTradingWriteRequest(
    pathname: string,
    method = 'POST',
): boolean {
    return method.toUpperCase() !== 'GET' && TRADING_WRITE_PATHS.has(pathname);
}
