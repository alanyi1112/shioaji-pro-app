import { INTRADAY_STOCK_SELECTION_LAYOUT_ID } from './workspace';

const DEFAULT_APP_ORIGIN = 'http://127.0.0.1:5173';

function localAppOrigin(value: string) {
    try {
        const origin = new URL(value);
        if (
            origin.protocol !== 'http:' ||
            !['127.0.0.1', 'localhost', '::1'].includes(origin.hostname) ||
            origin.port !== '5173' ||
            origin.username ||
            origin.password
        ) {
            throw new Error('invalid_origin');
        }
        return origin;
    } catch {
        return new URL(DEFAULT_APP_ORIGIN);
    }
}

export function resolveIntradayStockSelectionUrl(
    appOrigin = DEFAULT_APP_ORIGIN,
) {
    const url = new URL('/', localAppOrigin(appOrigin));
    url.searchParams.set('layout', INTRADAY_STOCK_SELECTION_LAYOUT_ID);
    return url.toString();
}

export function openIntradayStockSelectionWindow(
    targetWindow: Pick<Window, 'open'> = window,
    appOrigin = window.location.origin,
) {
    return targetWindow.open(
        resolveIntradayStockSelectionUrl(appOrigin),
        '_blank',
        'noopener',
    );
}
