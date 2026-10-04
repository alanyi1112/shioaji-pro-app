import { describe, expect, it, vi } from 'vitest';
import {
    createIntradayNotificationAcknowledgements,
    hasValidIntradayNotificationLease,
    intradayNotificationText,
    isNewLiveNotificationEvent,
} from './intraday-monitor-notifications';
import type { IntradayMonitorTriggerView } from './intraday-monitor-api';

function trigger(overrides: Partial<IntradayMonitorTriggerView> = {}): IntradayMonitorTriggerView {
    return {
        eventId: 'server-event-1', eventHash: 'a'.repeat(64), kind: 'live', tradeDate: '2026-09-04',
        baselineTradeDate: '2026-09-03', canonicalSymbol: '2330.TW', exchange: 'TSE', minuteKey: '10:05',
        configRevision: 1, threshold: '1.5', currentCumulativeVolume: 180, previousCumulativeVolume: 100,
        unit: 'common_lot', sourceVersion: 'fixture/1', formulaVersion: 'relative-volume/1', completeness: 'complete',
        createdAt: '2026-09-04T10:06:00+08:00', notificationAuthority: true,
        ...overrides,
    };
}

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
    };
}

describe('盤中事件通知 acknowledgement', () => {
    it('以 server event id 跨 client 只允許一次通知 claim', async () => {
        const storage = memoryStorage();
        let queue = Promise.resolve();
        const runExclusive = (_name: string, task: () => boolean) => {
            const result = queue.then(task);
            queue = result.then(() => undefined);
            return result;
        };
        const firstTab = createIntradayNotificationAcknowledgements('2026-09-04', { storage, runExclusive });
        const secondTab = createIntradayNotificationAcknowledgements('2026-09-04', { storage, runExclusive });

        expect(await Promise.all([firstTab.claim('server-event-1'), secondTab.claim('server-event-1')]))
            .toEqual([true, false]);
        expect(await firstTab.claim('server-event-1')).toBe(false);
        const reloadedTab = createIntradayNotificationAcknowledgements('2026-09-04', { storage, runExclusive });
        expect(await reloadedTab.claim('server-event-1')).toBe(false);
        expect(await secondTab.claim('server-event-2')).toBe(true);
    });

    it('儲存不可用或 acknowledgement schema 損壞時 fail closed', async () => {
        const broken = { getItem: vi.fn(() => '{bad'), setItem: vi.fn() };
        const acknowledgements = createIntradayNotificationAcknowledgements('2026-09-04', {
            storage: broken,
            runExclusive: async (_name, task) => task(),
        });
        expect(await acknowledgements.claim('server-event-1')).toBe(false);
        expect(broken.setItem).not.toHaveBeenCalled();
    });

    it('只接受有 notification authority 的新 live event 與未過期 lease', () => {
        expect(isNewLiveNotificationEvent(trigger())).toBe(true);
        expect(isNewLiveNotificationEvent(trigger({ kind: 'historical' }))).toBe(false);
        expect(isNewLiveNotificationEvent(trigger({ notificationAuthority: false }))).toBe(false);
        expect(hasValidIntradayNotificationLease({ expiresAt: '2099-01-01T00:00:00Z' }, Date.parse('2026-09-04T00:00:00Z'))).toBe(true);
        expect(hasValidIntradayNotificationLease({ expiresAt: '2026-09-03T00:00:00Z' }, Date.parse('2026-09-04T00:00:00Z'))).toBe(false);
        expect(hasValidIntradayNotificationLease(null)).toBe(false);
    });

    it('以事件 evidence 產生不含帳戶或交易動作的通知文字', () => {
        expect(intradayNotificationText(trigger(), '台積電')).toEqual({
            title: '2330 台積電 盤中量比達標',
            body: '10:05 累積量比 1.80×，門檻 1.5×',
        });
    });
});
