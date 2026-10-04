/** 隔離的 UI／decoder fixture；不是正式行情、官方日曆或 live 驗收。 */
import { buildCandlestickHistory } from './stock-screener-candlestick';
import { queryCandlestickSnapshot } from './stock-screener-candlestick-query';
import { DEFAULT_CRITERIA_V7 } from './stock-screener-v7';
import { migrateCriteriaV7ToV8 } from './stock-screener-v8';
import { migrateCriteriaV8ToV9 } from './stock-screener-v9';
import { technicalEvidenceHash } from './stock-screener-technical-patterns';
import { CANDLESTICK_CATALOG_VERSION } from './stock-screener-candlestick-catalog';
import type { CandlestickResponse } from './stock-screener-candlestick-api';
export async function candlestickUIFixture() {
    const dates = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-29', '2026-09-30'];
    const closes = [140, 130, 120, 110, 100, 80, 91];
    const bars = dates.map((sessionDate, i) => ({ sessionDate, open: String(i < 5 ? closes[i]! - 1 : i === 5 ? 100 : 80),
        high: String(i === 5 ? 101 : i === 6 ? 92 : closes[i]! + 1), low: String(i < 5 ? closes[i]! - 2 : 79), close: String(closes[i]), volumeShares: '1000000' }));
    const history = await buildCandlestickHistory(bars, dates, { mappingVersion: 'ui-fixture', calendarHash: 'a'.repeat(64), sourceHashes: ['b'.repeat(64)], completedThrough: dates.at(-1)! });
    const criteria = migrateCriteriaV8ToV9(migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7));
    for (const v of Object.values(criteria)) if (v && typeof v === 'object' && 'enabled' in v) v.enabled = false;
    criteria.candlestickReversal.enabled = true; criteria.candlestickReversal.patterns = ['piercing'];
    const rows = [{ symbol: '1111.TW', code: '1111', name: 'UI 隔離測試股', market: 'TWSE' as const, ordinary: true as const, history }];
    const snapshot = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', through: history.through, universeRevision: 'fixture', universeHash: 'a'.repeat(64), rowsHash: await technicalEvidenceHash(rows), rows };
    const query = { criteria, sort: 'code' as const, direction: 'asc' as const, resultState: 'pass' as const };
    const calculated = await queryCandlestickSnapshot(snapshot, { ...query, limit: 50 });
    const response: CandlestickResponse = { ...calculated, version: 9, state: 'ready', reason: 'none', canUseResults: true,
        snapshotId: snapshot.id, effectiveSessionDate: history.through, expectedSessionDate: history.through,
        formulaVersion: history.formulaVersion, capability: history.capability, catalogVersion: CANDLESTICK_CATALOG_VERSION,
        sourceMappingVersion: history.mappingVersion, calendarHash: history.calendarHash, sourceHashes: history.sourceHashes,
        rowsHash: snapshot.rowsHash, universeHash: snapshot.universeHash, sourceEvidence: { fixture: true } };
    return { query, response };
}
