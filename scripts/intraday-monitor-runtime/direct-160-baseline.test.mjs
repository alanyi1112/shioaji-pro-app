import { describe, expect, it } from 'vitest';
import { verifyDirect160HistoricalSymbol,
    validateDirect160BaselineSet } from './direct-160-baseline.mjs';
import { fixtureBaseline, symbolFixture } from './fixtures/direct-160-baseline.mjs';
import { hashDirect160 } from './direct-160-storage.mjs';


const manifest = { stage: 160, manifestHash: 'a'.repeat(64), cohort: Array.from({ length: 160 }, (_, i) => ({
    canonicalSymbol: `${1001+i}.TW`, contractIdentity: { code: String(1001+i), exchange: 'TSE', security_type: 'STK', region: 'TW' },
})) };

describe('160 檔可信 1 分 K 基準', () => {
    it('全部 43,200 分鐘來自 1 分 K 累加，不能把歷史資料算成 live 日', () => {
        const baseline = fixtureBaseline(manifest);
        expect(validateDirect160BaselineSet(baseline, manifest, '2026-09-14')).toBe(true);
        expect(baseline.manifests[0].cumulativeSeries.at(-1).cumulativeVolume).toBe(540);
        expect(baseline.liveCaptureAcceptance).toBe(false);
        expect(validateDirect160BaselineSet(baseline, manifest, '2026-09-15')).toBe(false);
        expect(validateDirect160BaselineSet(baseline, { ...manifest, manifestHash: 'b'.repeat(64) }, '2026-09-14')).toBe(false);
        const bad = structuredClone(baseline); bad.manifests[159] = bad.manifests[0];
        const { baselineHash, ...body } = bad; bad.baselineHash = hashDirect160(body, 'bundle');
        expect(validateDirect160BaselineSet(bad, manifest, '2026-09-14')).toBe(false);
    });
    it('拒絕雙抓漂移、同總量但分鐘錯置、缺分鐘及盤後成交', () => {
        const b = fixtureBaseline(manifest);
        const input = () => symbolFixture(manifest.cohort[0], manifest.manifestHash, b.calendar);
        const drift = input(); drift.second.data.Volume[0] = 3;
        expect(() => verifyDirect160HistoricalSymbol(drift)).toThrow(/unstable/);
        const shifted = input(); shifted.ticks.volume[0] = 1; shifted.ticks.volume[1] = 3;
        expect(() => verifyDirect160HistoricalSymbol(shifted)).toThrow(/minute_mismatch/);
        const missing = input(); Object.values(missing.first.data).forEach(a => a.splice(10,1));
        missing.second.data = structuredClone(missing.first.data);
        expect(() => verifyDirect160HistoricalSymbol(missing)).toThrow(/missing_minute/);
        const late = input(); late.ticks.datetime[269] = '2026-09-11T14:30:00';
        expect(() => verifyDirect160HistoricalSymbol(late)).toThrow(/outside_regular/);
    });
    it('只在逐筆該分鐘零量且整日總量相符時補足無成交分鐘', () => {
        const b = fixtureBaseline(manifest);
        const input = symbolFixture(manifest.cohort[0], manifest.manifestHash, b.calendar);
        for (const source of [input.first, input.second]) {
            for (const values of Object.values(source.data)) values.splice(10, 1);
        }
        input.ticks.volume[10] = 0;
        const verified = verifyDirect160HistoricalSymbol(input);
        expect(verified.cumulativeSeries).toHaveLength(270);
        expect(verified.cumulativeSeries[10].cumulativeVolume)
            .toBe(verified.cumulativeSeries[9].cumulativeVolume);
        const invalid = symbolFixture(manifest.cohort[0], manifest.manifestHash, b.calendar);
        for (const source of [invalid.first, invalid.second]) {
            for (const values of Object.values(source.data)) values.splice(10, 1);
        }
        expect(() => verifyDirect160HistoricalSymbol(invalid)).toThrow(/missing_minute/);
    });
});
