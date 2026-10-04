import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    emitIntradayMonitorConfigInvalidation,
    onIntradayMonitorConfigInvalidation,
} from './intraday-monitor-invalidation';

describe('盤中監控設定 invalidation', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('同頁只接受固定 schema 的 revision event', () => {
        vi.stubGlobal('BroadcastChannel', undefined);
        const listener = vi.fn();
        const stop = onIntradayMonitorConfigInvalidation(listener);
        emitIntradayMonitorConfigInvalidation(8, 'client_identity_1234567890');
        window.dispatchEvent(new CustomEvent('sj-intraday-monitor-config-invalidation-v1', {
            detail: { version: 2, type: 'intraday-monitor-config-invalidated', revision: 9, sourceClientId: 'bad', emittedAt: Date.now() },
        }));
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ revision: 8 }));
        stop();
    });
});
