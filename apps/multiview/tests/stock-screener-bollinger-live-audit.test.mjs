import test from 'node:test';
import assert from 'node:assert/strict';
import { independentStages, auditPublication } from '../../../scripts/stock-screener-bollinger-live-audit.mjs';
import { DEFAULT_BOLLINGER_SQUEEZE, buildBollingerFrozenFeatures, evaluateBollingerStages } from '../../../src/lib/stock-screener-v8.ts';

test('獨立稽核拒絕沒有真實發布 head 的資料庫', () => {
    assert.throws(() => auditPublication(':memory:'), /no such table/);
});
test('獨立直接窗口與產品 prefix 分類相符，不把缺資料推論為零', async () => {
    const c = { ...DEFAULT_BOLLINGER_SQUEEZE, enabled: true };
    for (const missing of [false, true]) {
        const sessions = Array.from({ length: 160 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
        const bars = sessions.map((sessionDate, i) => ({ sessionDate, open: String(30 + i * .03), high: String(31 + i * .03),
            low: String(29 + i * .03), close: String(30 + i * .03), volumeShares: '10000000', turnoverNtd: '400000000' }));
        if (missing) bars.splice(155, 1);
        const frozen = await buildBollingerFrozenFeatures(bars, sessions), actual = await evaluateBollingerStages(frozen, c);
        const independent = independentStages(frozen.points, c);
        assert.equal(independent.stage, actual.stage);
        if (missing) assert.equal(frozen.points[155].close, null);
    }
});
