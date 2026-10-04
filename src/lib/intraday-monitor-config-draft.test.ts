import { describe, expect, it, vi } from 'vitest';
import type { ContractBase } from './types/contract';
import {
    canonicalIntradayThreshold,
    moveIntradayMonitorDraftItem,
    parseIntradayMonitorTokens,
    removeIntradayMonitorDraftItem,
    resolveIntradayMonitorImport,
    updateIntradayMonitorDraftItem,
} from './intraday-monitor-config-draft';
import type { IntradayMonitorConfigItemView } from './intraday-monitor-api';

function item(code: string): IntradayMonitorConfigItemView {
    return {
        contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code, target_code: null },
        enabled: true,
        thresholdOverride: null,
        source: 'manual',
    };
}

function contract(code: string, patch: Partial<ContractBase> = {}): ContractBase {
    return {
        security_type: 'STK', region: 'TW', exchange: 'TSE', code, target_code: null, ...patch,
    };
}

describe('盤中監控設定草稿', () => {
    it('正規化代碼並在匯入時分類接受、重複與無效項目', async () => {
        expect(parseIntradayMonitorTokens('2330.tw, TPEX:6488； 2454\n2603')).toEqual(['2330', '6488', '2454', '2603']);
        const resolver = vi.fn(async (code: string) => {
            if (code === '9999') return contract(code, { security_type: 'FUT' });
            if (code === '8888') throw new Error('not found');
            return contract(code, code === '6488' ? { exchange: 'OTC' } : {});
        });
        const report = await resolveIntradayMonitorImport(
            [item('2330')],
            ['2330', '6488', '6488', '9999', '8888', 'BAD'].map((code) => ({ code, source: 'manual' as const })),
            resolver,
        );
        expect(report.accepted.map((entry) => entry.contract.code)).toEqual(['6488']);
        expect(report.accepted[0]?.source).toBe('manual');
        expect(report.duplicates).toEqual(['2330', '6488']);
        expect(report.invalid).toEqual(['9999', '8888', 'BAD']);
        expect(report.overLimit).toEqual([]);
    });

    it('超過 200 檔時只加入剩餘容量並保留輸入順序', async () => {
        const current = Array.from({ length: 199 }, (_, index) => item(String(1000 + index)));
        const report = await resolveIntradayMonitorImport(
            current,
            [{ code: '3000', source: 'watchlist' }, { code: '3001', source: 'watchlist' }],
            async (code) => contract(code),
        );
        expect(report.accepted.map((entry) => entry.contract.code)).toEqual(['3000']);
        expect(report.overLimit).toEqual(['3001']);
    });

    it('啟停、覆寫門檻、刪除與上下移動都維持穩定排序', () => {
        const original = [item('2330'), item('2454'), item('2603')];
        const moved = moveIntradayMonitorDraftItem(original, 'TSE:2603', -1);
        expect(moved.map((entry) => entry.contract.code)).toEqual(['2330', '2603', '2454']);
        const updated = updateIntradayMonitorDraftItem(moved, 'TSE:2603', { enabled: false, thresholdOverride: '3' });
        expect(updated[1]).toMatchObject({ enabled: false, thresholdOverride: '3' });
        expect(removeIntradayMonitorDraftItem(updated, 'TSE:2330').map((entry) => entry.contract.code)).toEqual(['2603', '2454']);
        expect(canonicalIntradayThreshold('2.00')).toBe('2');
        expect(canonicalIntradayThreshold('0.9')).toBeNull();
        expect(canonicalIntradayThreshold('100.01')).toBeNull();
    });
});
