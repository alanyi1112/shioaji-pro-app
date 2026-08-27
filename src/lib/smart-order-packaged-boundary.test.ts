import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./smart-order-browser-gateway-mode', () => ({
    SMART_ORDER_BROWSER_GATEWAY_AVAILABLE: false,
}));

import {
    fetchSmartOrderReadiness,
    SmartOrderLocalApiError,
} from './smart-order-client';
import { subscribeSmartOrderRuntimeEvents } from './smart-order-event-client';
import { fetchSmartOrderHistory } from './smart-order-history-client';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('packaged and static smart-order browser boundary', () => {
    it('rejects every browser control-plane transport before fetch or EventSource', async () => {
        const fetchMock = vi.fn();
        const eventSourceFactory = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        for (const operation of [
            () => fetchSmartOrderReadiness(),
            () => fetchSmartOrderHistory(),
        ]) {
            await expect(operation()).rejects.toMatchObject({
                status: 503,
                code: 'smart_order_local_gateway_unavailable',
            });
        }
        expect(() =>
            subscribeSmartOrderRuntimeEvents(
                {
                    onRuntimeEvent: vi.fn(),
                    onGap: vi.fn(),
                },
                eventSourceFactory,
            ),
        ).toThrowError(SmartOrderLocalApiError);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(eventSourceFactory).not.toHaveBeenCalled();
    });
});
