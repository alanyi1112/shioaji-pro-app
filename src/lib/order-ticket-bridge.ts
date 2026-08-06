export type OrderTicketBridge = {
    code: string;
    securityType: 'STK' | 'WRT';
    exchange: 'TSE' | 'OTC' | 'OES';
};

const ALLOWED_KEYS = new Set([
    'popout',
    'bridge',
    'code',
    'security_type',
    'exchange',
]);

export function parseOrderTicketBridge(
    params: URLSearchParams,
): OrderTicketBridge | null {
    if (
        params.get('popout') !== 'ticket' ||
        params.get('bridge') !== 'multiview'
    ) {
        return null;
    }
    for (const key of params.keys()) {
        if (!ALLOWED_KEYS.has(key) || params.getAll(key).length !== 1) {
            return null;
        }
    }
    const code = (params.get('code') || '').trim().toUpperCase();
    const securityType = params.get('security_type');
    const exchange = params.get('exchange');
    if (!/^[A-Z0-9]{2,12}$/.test(code)) return null;
    if (securityType !== 'STK' && securityType !== 'WRT') return null;
    if (exchange !== 'TSE' && exchange !== 'OTC' && exchange !== 'OES') {
        return null;
    }
    return { code, securityType, exchange };
}
