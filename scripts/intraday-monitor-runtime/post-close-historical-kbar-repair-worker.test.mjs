import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { HISTORICAL_KBAR_REPAIR_CANDIDATE_SCHEMA, computeHistoricalKbarPayloadHash,
    createHistoricalKbarInterruptionRecord, expectedTaiwanRegularSessionMinutes } from './historical-kbar-repair.mjs';
import { HistoricalKbarRepairRepository,
    resolveHistoricalKbarRepairDatabasePath } from './historical-kbar-repair-repository.mjs';
import { createPostCloseHistoricalKbarRepairWorker,
    issuePostCloseHistoricalKbarRepairAuthority } from './post-close-historical-kbar-repair-worker.mjs';

const roots = [];
const tradeDate = '2026-09-09';

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'post-close-repair-worker-'));
    roots.push(root);
    return new HistoricalKbarRepairRepository(resolveHistoricalKbarRepairDatabasePath(root));
}

function candidate(symbol, exchange, requestOrdinal, volumeAdjustment = 0) {
    const rows = expectedTaiwanRegularSessionMinutes().map((minute, index) => ({
        datetime: `${tradeDate}T${minute}:00+08:00`, open: 100, high: 102, low: 99, close: 101,
        volume: index === 10 ? 10 + volumeAdjustment : 10, amount: 1_000,
    }));
    const value = { schemaVersion: HISTORICAL_KBAR_REPAIR_CANDIDATE_SCHEMA, symbol, exchange,
        securityType: 'STK', tradeDate, timeZone: 'Asia/Taipei', source: 'mock-history',
        sourceVersion: 'mock-history/1', fetchedAt: `2026-09-09T13:3${4 + requestOrdinal}:00+08:00`,
        sourceUnit: 'common_lot', canonicalUnit: 'common_lot', volumeSemantics: 'minute_delta',
        closeEncoding: 'normal_13_30',
        arrays: { datetime: rows.map((row) => row.datetime), Open: rows.map((row) => row.open),
            High: rows.map((row) => row.high), Low: rows.map((row) => row.low),
            Close: rows.map((row) => row.close), Volume: rows.map((row) => row.volume),
            Amount: rows.map((row) => row.amount) }, knownZeroMinutes: [], previousClose: 99 };
    return { ...value, payloadHash: computeHistoricalKbarPayloadHash(value) };
}

function interruption(symbol, exchange = 'TSE') {
    return createHistoricalKbarInterruptionRecord({ symbol, exchange, tradeDate,
        interruptionStart: '2026-09-09T10:00:00+08:00', interruptionEnd: '2026-09-09T10:05:00+08:00',
        streamGeneration: 'generation_000001', sequenceStart: 60, sequenceEnd: 65,
        cohortHash: `sha256:${'a'.repeat(64)}`, sourceVersion: 'mock-live/1',
        payloadHash: `sha256:${'b'.repeat(64)}`, reason: 'sse_disconnected',
        liveMinutes: [{ minuteKey: '09:01', volumeCommonLot: 10 }] });
}

function authority(nowEpochMs) {
    return issuePostCloseHistoricalKbarRepairAuthority({ tradeDate, observedAtEpochMs: nowEpochMs,
        timeZone: 'Asia/Taipei', simulation: true, sessionFinalized: true }, nowEpochMs);
}

function persistInterruptions(store, values) {
    for (const value of values) store.putInterruption(value, store.currentRevision());
}

function providers({ unstableSymbol = null, throwingSymbol = null } = {}) {
    return {
        resolveInstrumentAuthority: vi.fn(async ({ symbol, exchange }) => ({ officialTradingDay: true,
            identityVerified: true, instrumentStatus: 'normal', symbol, exchange, securityType: 'STK',
            tradeDate, timeZone: 'Asia/Taipei' })),
        fetchFinalVolumeAuthority: vi.fn(async ({ symbol, exchange }) => ({ status: 'verified',
            sessionScope: 'regular_session', unit: 'common_lot', volumeCommonLot: 2_700,
            symbol, exchange, tradeDate, source: 'mock-official-close', sourceVersion: 'mock-close/1' })),
        fetchHistoricalKbars: vi.fn(async ({ symbol, exchange, requestOrdinal }) => {
            if (symbol === throwingSymbol) throw new Error('mock_provider_unavailable');
            return candidate(symbol, exchange, requestOrdinal,
                symbol === unstableSymbol && requestOrdinal === 2 ? 1 : 0);
        }),
    };
}

describe('收盤後歷史 KBar repair worker', () => {
    it('13:34:30 前不核發 provider request authority', async () => {
        const now = Date.parse('2026-09-09T13:34:29+08:00');
        const source = providers();
        const store = repository();
        const worker = createPostCloseHistoricalKbarRepairWorker({ ...source, repository: store,
            nowEpochMs: () => now });
        const result = await worker.run({ authority: authority(now), interruptions: [interruption('2330.TW')] });
        expect(result).toMatchObject({ allowed: false, reason: 'post_close_authority_required',
            baselineUsableCount: 0, liveCaptureAcceptanceCount: 0 });
        expect(source.fetchHistoricalKbars).not.toHaveBeenCalled();
        expect(store.currentRevision()).toBe(0);
        store.close();
    });

    it('逐商品隔離成功與重抓衝突，部分成功不得冒充整批成功', async () => {
        const now = Date.parse('2026-09-09T13:36:30+08:00');
        const source = providers({ unstableSymbol: '2454.TW' });
        const store = repository();
        const interruptions = [interruption('2330.TW'), interruption('2454.TW')];
        persistInterruptions(store, interruptions);
        const worker = createPostCloseHistoricalKbarRepairWorker({ ...source, repository: store,
            nowEpochMs: () => now });
        const result = await worker.run({ authority: authority(now),
            interruptions });

        expect(result).toMatchObject({ allowed: true, allSucceeded: false, baselineUsableCount: 1,
            liveCaptureAcceptanceCount: 0, notificationDispatchCount: 0, retroactiveTriggerCount: 0,
            brokerWriteAttemptCount: 0, productionTransitionCount: 0, serviceLifecycleMutationCount: 0 });
        expect(result.results[0]).toMatchObject({ symbol: '2330.TW', ok: true,
            baselineUsable: true, liveCaptureAcceptance: false });
        expect(result.results[1]).toMatchObject({ symbol: '2454.TW', ok: false,
            baselineUsable: false, liveCaptureAcceptance: false });
        expect(result.results[1].reasonCodes).toContain('refetch_payload_unstable');
        expect(source.fetchHistoricalKbars).toHaveBeenCalledTimes(4);
        expect(store.currentRevision()).toBe(3);
        expect(store.listForTradeDate(tradeDate)).toHaveLength(1);
        store.close();
    });

    it('單檔 provider 失敗後仍繼續處理下一檔', async () => {
        const now = Date.parse('2026-09-09T13:36:30+08:00');
        const source = providers({ throwingSymbol: '2330.TW' });
        const store = repository();
        const interruptions = [interruption('2330.TW'), interruption('2454.TW')];
        persistInterruptions(store, interruptions);
        const worker = createPostCloseHistoricalKbarRepairWorker({ ...source, repository: store,
            nowEpochMs: () => now });
        const result = await worker.run({ authority: authority(now),
            interruptions });
        expect(result.results).toMatchObject([
            { symbol: '2330.TW', ok: false, reasonCodes: ['mock_provider_unavailable'] },
            { symbol: '2454.TW', ok: true, baselineUsable: true, liveCaptureAcceptance: false },
        ]);
        expect(store.currentRevision()).toBe(3);
        store.close();
    });

    it('尚未持久化的 interruption 不得觸發任何歷史 provider', async () => {
        const now = Date.parse('2026-09-09T13:36:30+08:00');
        const source = providers();
        const store = repository();
        const worker = createPostCloseHistoricalKbarRepairWorker({ ...source, repository: store,
            nowEpochMs: () => now });
        const result = await worker.run({ authority: authority(now), interruptions: [interruption('2330.TW')] });
        expect(result.results[0]).toMatchObject({ ok: false,
            reasonCodes: ['interruption_evidence_not_persisted'], baselineUsable: false });
        expect(source.resolveInstrumentAuthority).not.toHaveBeenCalled();
        expect(source.fetchFinalVolumeAuthority).not.toHaveBeenCalled();
        expect(source.fetchHistoricalKbars).not.toHaveBeenCalled();
        store.close();
    });
});
