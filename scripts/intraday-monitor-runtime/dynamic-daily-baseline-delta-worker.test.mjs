import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { baselineCalendar } from './direct-160-baseline.mjs';
import { createDynamicBaselineDeltaBudget } from './dynamic-baseline-delta-budget.mjs';
import { createDynamicDailyBaselineDeltaWorker }
    from './dynamic-daily-baseline-delta-worker.mjs';
import { createDynamicDailyBaselineApiPort }
    from './dynamic-daily-baseline-api-port.mjs';
import { resolveDynamicDailyBaselineCoverage }
    from './dynamic-daily-baseline-resolver.mjs';
import { createDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { symbolFixture } from './fixtures/direct-160-baseline.mjs';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';
import { DYNAMIC_DAILY_SESSION_PROOF_SCHEMA } from './dynamic-daily-session-proof.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))); });

function fixture() {
    const twse = { stat: 'ok', queryYear: 2026, fields: ['日期', '名稱', '說明'],
        data: [['2026-01-01', '中華民國開國紀念日', '依規定放假1日。']] };
    const tpex = { data: { html: '<table><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table><table><tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr></table>' } };
    const calendar = baselineCalendar(twse, tpex, '2026-09-11', '2026-09-14',
        Date.parse('2026-09-11T14:00:00+08:00'));
    const config = validateIntradayMonitorConfig({ schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision: 9, globalThreshold: '1.5', items: [{
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code: '1001',
                target_code: null }, enabled: true, thresholdOverride: null, source: 'manual' }] });
    expect(config.ok).toBe(true);
    const plan = createDynamicDailyCohortPlan({ config: config.value,
        authority: { schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: true, isTradingDate: true, tradeDate: '2026-09-14',
            previousTradeDate: '2026-09-11', sourceVersions: [calendar.sourceVersion],
            observedAt: '2026-09-11T13:35:00+08:00' },
        approval: { decision: 'go', approvedActiveLimit: 160, approvalHash: 'a'.repeat(64) },
        createdAt: '2026-09-11T13:36:00+08:00' });
    const coverage = resolveDynamicDailyBaselineCoverage({ plan });
    const usage = { bytes: 100_000_000, limit_bytes: 524_288_000,
        remaining_bytes: 424_288_000 };
    const sample = (tradeDate) => ({ tradeDate, consumedBytes: 22_000_000,
        providerLimitBytes: usage.limit_bytes,
        sourceSha256: 'a'.repeat(64), usageStartSha256: 'b'.repeat(64),
        usageEndSha256: 'c'.repeat(64), verificationSha256: 'd'.repeat(64),
        baselineSha256: 'e'.repeat(64) });
    const budget = createDynamicBaselineDeltaBudget({ usage,
        samples: [sample('2026-09-09'), sample('2026-09-10')],
        tradeDate: plan.tradeDate, addedSymbolCount: 1,
        observedAt: '2026-09-11T14:10:00+08:00',
        deadlineAt: '2026-09-14T08:35:00+08:00' });
    const entry = { canonicalSymbol: '1001.TW',
        contractIdentity: { code: '1001', exchange: 'TSE', security_type: 'STK',
            region: 'TW', target_code: null } };
    const source = symbolFixture(entry, 'a'.repeat(64), calendar);
    return { plan, coverage, calendar, budget, usage, source };
}

function providers(input, counters, { corrupt = false } = {}) {
    const response = (value) => ({ value, responseBytes: 2_000 });
    return createDynamicDailyBaselineDeltaWorker({
        readUsage: async () => { counters.usage = (counters.usage ?? 0) + 1; return input.usage; },
        fetchContract: async () => { counters.contract = (counters.contract ?? 0) + 1;
            return response(input.source.contract); },
        fetchKbars: async ({ ordinal }) => { counters.kbars = (counters.kbars ?? 0) + 1;
            const selected = structuredClone(ordinal === 1 ? input.source.first : input.source.second);
            if (corrupt && ordinal === 2) selected.data.Volume[0] = 3;
            return response(selected); },
        fetchTicks: async () => { counters.ticks = (counters.ticks ?? 0) + 1;
            return response(input.source.ticks); },
        now: () => '2026-09-11T14:10:00+08:00',
    });
}

async function run(worker, root, input) {
    return worker.run({ root, plan: input.plan, coverage: input.coverage,
        calendar: input.calendar, budget: input.budget,
        sourceVersion: 'fixture-only/1', sessionProof: {
            schemaVersion: DYNAMIC_DAILY_SESSION_PROOF_SCHEMA,
            simulation: true, businessSessionCurrent: true,
            connectionGeneration: 'simulation:1234567890abcdef',
            snapshotTradeDate: input.plan.previousTradeDate,
            sourceVersion: 'fixture-only/1',
            observedAt: '2026-09-11T14:10:00+08:00' } });
}

describe('每日差異基準採集', () => {
    it('只對缺基準個股做有界唯讀查詢，逐檔封存 manifest 與收據', async () => {
        const input = fixture();
        const counters = {};
        const worker = providers(input, counters);
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-delta-'));
        roots.push(root);
        const result = await run(worker, root, input);
        expect(result).toMatchObject({ outcome: 'verified', verifiedCount: 1 });
        expect(counters).toMatchObject({ contract: 1, kbars: 2, ticks: 1 });
        expect(result.results[0].manifestId).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(JSON.parse(await readFile(result.receiptPath, 'utf8')))
            .toMatchObject({ outcome: 'verified', requestedCount: 1, verifiedCount: 1,
                notificationAuthority: false, retroactiveAuthority: false });
        await expect(run(worker, root, input)).rejects.toThrow('daily_delta_already_claimed');
        expect(counters).toMatchObject({ contract: 1, kbars: 2, ticks: 1 });
    });

    it('雙抓漂移會留下失敗收據，不把部分原始資料冒充基準', async () => {
        const input = fixture();
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-delta-'));
        roots.push(root);
        const result = await run(providers(input, {}, { corrupt: true }), root, input);
        expect(result).toMatchObject({ outcome: 'failed', verifiedCount: 0 });
        expect(JSON.parse(await readFile(result.receiptPath, 'utf8')))
            .toMatchObject({ outcome: 'failed', results: [expect.objectContaining({
                canonicalSymbol: '1001.TW', outcome: 'failed', manifestId: null })] });
    });

    it('預算、simulation 或缺基準集合不符時，claim 前拒絕而不查 provider', async () => {
        const input = fixture();
        const counters = {};
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-delta-'));
        roots.push(root);
        await expect(run(providers(input, counters), root, { ...input,
            budget: { ...input.budget, ready: false } })).rejects.toThrow();
        expect(counters).toEqual({});
    });

    it('本機唯讀 API port 的兩次原始 KBar 回應可交給逐檔驗證器，不偷換成假資料', async () => {
        const input = fixture();
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-delta-'));
        roots.push(root);
        let kbarCalls = 0;
        const fetchImpl = async (url) => {
            const pathname = new URL(url).pathname;
            if (pathname.includes('/contracts/')) return Response.json(input.source.contract);
            if (pathname.endsWith('/kbars')) {
                kbarCalls += 1;
                return Response.json(input.source.first.data);
            }
            if (pathname.endsWith('/ticks')) return Response.json(input.source.ticks);
            throw new Error('unexpected_endpoint');
        };
        const port = createDynamicDailyBaselineApiPort({ fetchImpl,
            now: () => '2026-09-11T14:10:00+08:00' });
        const worker = createDynamicDailyBaselineDeltaWorker({
            readUsage: async () => input.usage,
            fetchContract: port.fetchContract,
            fetchKbars: port.fetchKbars,
            fetchTicks: port.fetchTicks,
            now: () => '2026-09-11T14:10:00+08:00',
        });
        expect(await run(worker, root, input)).toMatchObject({ outcome: 'verified', verifiedCount: 1 });
        expect(kbarCalls).toBe(2);
    });
});
