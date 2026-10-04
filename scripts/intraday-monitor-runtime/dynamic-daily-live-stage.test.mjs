import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { baselineCalendar, verifyDirect160HistoricalSymbol }
    from './direct-160-baseline.mjs';
import { dynamicDailySymbolBaselineCohortHash, resolveDynamicDailyBaselineCoverage }
    from './dynamic-daily-baseline-resolver.mjs';
import { createDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { writeDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { activateDynamicDailyPlan, readDynamicDailyActivePlan }
    from './dynamic-daily-active-plan.mjs';
import { createDynamicDailyLiveStage } from './dynamic-daily-live-stage.mjs';
import { createDynamicDailyBaselineGateReceipt, createDynamicDailyFinalGateReceipt,
    writeDynamicDailyGateReceipt }
    from './dynamic-daily-premarket-gate.mjs';
import { symbolFixture } from './fixtures/direct-160-baseline.mjs';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))); });

function setup(codes = ['1001'], missingCodes = []) {
    const twse = { stat: 'ok', queryYear: 2026, fields: ['日期', '名稱', '說明'],
        data: [['2026-01-01', '中華民國開國紀念日', '依規定放假1日。']] };
    const tpex = { data: { html: '<table><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table><table><tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr></table>' } };
    const calendar = baselineCalendar(twse, tpex, '2026-09-11', '2026-09-14',
        Date.parse('2026-09-11T14:00:00+08:00'));
    const config = validateIntradayMonitorConfig({ schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision: 9, globalThreshold: '1.5', items: codes.map((code) => ({
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code,
                target_code: null },
            enabled: true, thresholdOverride: null, source: 'manual',
        })) });
    expect(config.ok).toBe(true);
    const plan = createDynamicDailyCohortPlan({ config: config.value,
        authority: { schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: true, isTradingDate: true, tradeDate: '2026-09-14',
            previousTradeDate: '2026-09-11', sourceVersions: [calendar.sourceVersion],
            observedAt: '2026-09-11T13:35:00+08:00' },
        approval: { decision: 'go', approvedActiveLimit: 160,
            approvalHash: 'a'.repeat(64) },
        createdAt: '2026-09-11T13:36:00+08:00' });
    const manifests = codes.filter((code) => !missingCodes.includes(code)).map((code) => {
        const entry = { canonicalSymbol: `${code}.TW`, contractIdentity: {
            security_type: 'STK', region: 'TW', exchange: 'TSE', code,
            target_code: null } };
        const cohortHash = dynamicDailySymbolBaselineCohortHash({ tradeDate: plan.tradeDate,
            previousTradeDate: plan.previousTradeDate, canonicalSymbol: entry.canonicalSymbol,
            exchange: 'TSE' }).slice(7);
        return verifyDirect160HistoricalSymbol(symbolFixture(entry, cohortHash, calendar));
    });
    const coverage = resolveDynamicDailyBaselineCoverage({ plan,
        standaloneManifests: manifests });
    const baselineGate = createDynamicDailyBaselineGateReceipt({ plan, coverage,
        sources: manifests.map((manifest) => ({ manifest, sourceHash: manifest.manifestId,
            sealedAt: '2026-09-11T14:03:00+08:00' })),
        checkedAt: '2026-09-14T08:35:00+08:00',
        officialCalendarCurrent: true, previousSessionFinalized: true });
    expect(baselineGate.outcome).toBe(missingCodes.length ? 'partial_ready' : 'ready');
    const finalGate = createDynamicDailyFinalGateReceipt({ plan, baselineGate,
        checkedAt: '2026-09-14T08:45:00+08:00', savedConfigRevision: 9,
        officialCalendarCurrent: true, simulation: true, businessSessionCurrent: true,
        connectionGeneration: 'simulation:1234567890abcdef' });
    expect(finalGate.outcome).toBe(missingCodes.length ? 'partial_ready' : 'ready');
    return { plan, coverage, manifests, baselineGate, finalGate };
}

describe('每日名單單一 bounded 盤中資料路徑', () => {
    it('active pointer 必須有已保存 Gate，且不可早於 Gate 或建立第二份', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-active-plan-'));
        roots.push(root);
        const input = setup();
        expect(await readDynamicDailyActivePlan(root, input.plan.tradeDate)).toBeNull();
        await writeDynamicDailyCohortPlan(root, input.plan);
        await expect(activateDynamicDailyPlan({ root, plan: input.plan,
            finalGate: input.finalGate,
            activatedAt: '2026-09-14T08:45:01+08:00' }))
            .rejects.toThrow('daily_final_gate_receipt_missing');
        await writeDynamicDailyGateReceipt(root, input.finalGate);
        await expect(activateDynamicDailyPlan({ root, plan: input.plan,
            finalGate: input.finalGate,
            activatedAt: '2026-09-14T08:45:01+08:00' }))
            .rejects.toThrow('daily_baseline_gate_receipt_missing');
        await writeDynamicDailyGateReceipt(root, input.baselineGate);
        await expect(activateDynamicDailyPlan({ root, plan: input.plan,
            finalGate: input.finalGate,
            activatedAt: '2026-09-14T08:44:59+08:00' }))
            .rejects.toThrow('daily_active_plan_input_invalid');
        const first = await activateDynamicDailyPlan({ root, plan: input.plan,
            finalGate: input.finalGate,
            activatedAt: '2026-09-14T08:45:01+08:00' });
        expect(first.alreadyActive).toBe(false);
        expect(await readDynamicDailyActivePlan(root, input.plan.tradeDate))
            .toMatchObject({ active: { activationHash: first.value.activationHash },
                plan: { planHash: input.plan.planHash },
                baselineGate: { receiptHash: input.baselineGate.receiptHash },
                finalGate: { receiptHash: input.finalGate.receiptHash } });
        const second = await activateDynamicDailyPlan({ root, plan: input.plan,
            finalGate: input.finalGate,
            activatedAt: '2026-09-14T08:46:00+08:00' });
        expect(second).toMatchObject({ alreadyActive: true,
            value: { activationHash: first.value.activationHash } });
        await expect(activateDynamicDailyPlan({ root, plan: input.plan,
            finalGate: input.finalGate,
            activatedAt: '2026-09-14T09:00:00+08:00' }))
            .rejects.toThrow('daily_active_plan_input_invalid');
    });

    it('盤前 Gate 後一次 batch；合法封分鐘比較，stop 後不能同 generation 重啟', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-live-stage-'));
        roots.push(root);
        await writeFile(path.join(root, 'runtime-mode'), 'simulation\n');
        await writeFile(path.join(root, 'runtime-api-generation'),
            'simulation:1234567890abcdef\n');
        const calls = [];
        let controller;
        let current = '2026-09-14T08:45:01+08:00';
        const fetchImpl = async (url, init = {}) => {
            const pathname = new URL(url).pathname;
            calls.push(pathname);
            if (pathname.endsWith('/info')) return Response.json({ simulation: true,
                version: 'fixture/1' });
            if (pathname.endsWith('/data/kbar')) return new Response(new ReadableStream({
                start(stream) { controller = stream; },
            }), { headers: { 'content-type': 'text/event-stream' } });
            if (pathname.endsWith('/subscribe/kbars') ||
                pathname.endsWith('/unsubscribe/kbars')) {
                expect(JSON.parse(init.body).stocks).toHaveLength(1);
                return Response.json({ success: true });
            }
            throw new Error('unexpected_network_request');
        };
        const input = setup();
        await writeDynamicDailyCohortPlan(root, input.plan);
        await writeDynamicDailyGateReceipt(root, input.baselineGate);
        await writeDynamicDailyGateReceipt(root, input.finalGate);
        await activateDynamicDailyPlan({ root, plan: input.plan,
            finalGate: input.finalGate,
            activatedAt: '2026-09-14T08:45:00+08:00' });
        const stage = createDynamicDailyLiveStage({ ...input,
            appSupportRoot: root, fetchImpl, now: () => current,
            nowEpochMs: () => Date.parse(current) });
        expect(stage.status()).toMatchObject({ phase: 'idle', evaluatedCount: 0,
            admission: { plannedCount: 1, subscriptionRequestedCount: 0,
                dataActiveCount: 0 } });
        expect(await stage.start()).toMatchObject({ cohortSize: 1,
            notificationAuthority: false });
        current = '2026-09-14T09:02:01+08:00';
        for (const [time, volume] of [['09:01:00', 4], ['09:02:00', 3]]) {
            controller.enqueue(new TextEncoder().encode(`event: kbar\ndata: ${JSON.stringify({
                code: '1001', date: '2026/09/14', time, volume,
            })}\n\n`));
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(stage.status()).toMatchObject({ phase: 'running', evaluatedCount: 1,
            admission: { plannedCount: 1, subscriptionRequestedCount: 1,
                dataActiveCount: 1 }, notificationDispatchCount: 0 });
        expect(stage.evaluations()[0]).toMatchObject({ minuteKey: '09:01',
            classification: 'matched', notificationAuthority: false });
        await stage.stop();
        expect(calls.filter((item) => item.endsWith('/data/kbar'))).toHaveLength(1);
        expect(calls.filter((item) => item.endsWith('/subscribe/kbars'))).toHaveLength(1);
        expect(calls.filter((item) => item.endsWith('/unsubscribe/kbars'))).toHaveLength(1);
        await expect(stage.start()).rejects.toThrow('daily_live_stage_already_used');
    });

    it('缺一檔基準只隔離該檔，同一批次觀測其餘商品且不補位', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-live-partial-'));
        roots.push(root);
        await writeFile(path.join(root, 'runtime-mode'), 'simulation\n');
        await writeFile(path.join(root, 'runtime-api-generation'),
            'simulation:1234567890abcdef\n');
        const input = setup(['1001', '1002'], ['1002']);
        expect(input.coverage).toMatchObject({ plannedCount: 2,
            baselineReadyCount: 1, exact160BaselineReady: false });
        await writeDynamicDailyCohortPlan(root, input.plan);
        await writeDynamicDailyGateReceipt(root, input.baselineGate);
        await writeDynamicDailyGateReceipt(root, input.finalGate);
        await activateDynamicDailyPlan({ root, plan: input.plan,
            finalGate: input.finalGate,
            activatedAt: '2026-09-14T08:45:00+08:00' });
        const calls = [];
        let controller;
        let current = '2026-09-14T08:45:01+08:00';
        const fetchImpl = async (url, init = {}) => {
            const pathname = new URL(url).pathname;
            calls.push(pathname);
            if (pathname.endsWith('/info')) return Response.json({ simulation: true,
                version: 'fixture/1' });
            if (pathname.endsWith('/data/kbar')) return new Response(new ReadableStream({
                start(stream) { controller = stream; },
            }), { headers: { 'content-type': 'text/event-stream' } });
            if (pathname.endsWith('/subscribe/kbars') ||
                pathname.endsWith('/unsubscribe/kbars')) {
                expect(JSON.parse(init.body).stocks).toHaveLength(2);
                return Response.json({ success: true });
            }
            throw new Error('unexpected_network_request');
        };
        const stage = createDynamicDailyLiveStage({ ...input, appSupportRoot: root,
            fetchImpl, now: () => current,
            nowEpochMs: () => Date.parse(current) });
        await stage.start();
        current = '2026-09-14T09:02:01+08:00';
        for (const code of ['1001', '1002']) {
            for (const [time, volume] of [['09:01:00', 4], ['09:02:00', 3]]) {
                controller.enqueue(new TextEncoder().encode(`event: kbar\ndata: ${JSON.stringify({
                    code, date: '2026/09/14', time, volume,
                })}\n\n`));
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(stage.status()).toMatchObject({ phase: 'running', evaluatedCount: 2,
            admission: { plannedCount: 2, baselineReadyCount: 1,
                exact160BaselineReady: false, subscriptionRequestedCount: 2,
                dataActiveCount: 1 } });
        expect(stage.status().admission.items[1]).toMatchObject({
            canonicalSymbol: '1002.TW', baselineState: 'waiting_baseline',
            comparisonEligible: false, notificationEligible: false });
        expect(stage.evaluations().map((item) => [item.canonicalSymbol,
            item.comparable])).toEqual([['1001.TW', true], ['1002.TW', false]]);
        await stage.stop();
        expect(calls.filter((item) => item.endsWith('/data/kbar'))).toHaveLength(1);
        expect(calls.filter((item) => item.endsWith('/subscribe/kbars'))).toHaveLength(1);
    });

    it('缺基準或偽造 Gate 在建立 SSE 前拒絕', async () => {
        const input = setup();
        expect(() => createDynamicDailyLiveStage({ ...input, manifests: [] }))
            .toThrow('daily_live_stage_gate_invalid');
        expect(() => createDynamicDailyLiveStage({ ...input,
            finalGate: { ...input.finalGate, outcome: 'failed' } }))
            .toThrow('daily_live_stage_gate_invalid');
    });

    it('08:45 後 generation 改變時在開 SSE 前拒絕', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-live-stage-'));
        roots.push(root);
        await writeFile(path.join(root, 'runtime-mode'), 'simulation\n');
        await writeFile(path.join(root, 'runtime-api-generation'),
            'simulation:changed_generation_0001\n');
        let requests = 0;
        const input = setup();
        await writeDynamicDailyCohortPlan(root, input.plan);
        await writeDynamicDailyGateReceipt(root, input.baselineGate);
        await writeDynamicDailyGateReceipt(root, input.finalGate);
        await activateDynamicDailyPlan({ root, plan: input.plan,
            finalGate: input.finalGate,
            activatedAt: '2026-09-14T08:45:00+08:00' });
        const stage = createDynamicDailyLiveStage({ ...input, appSupportRoot: root,
            fetchImpl: async () => { requests += 1; throw new Error('must_not_fetch'); },
            now: () => '2026-09-14T08:45:01+08:00' });
        await expect(stage.start()).rejects.toThrow('daily_live_stage_generation_mismatch');
        expect(requests).toBe(0);
    });

    it('即使 coverage 宣稱就緒，與 08:35 保存來源不一致也不得開 SSE', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-live-source-'));
        roots.push(root);
        const input = setup();
        await writeDynamicDailyCohortPlan(root, input.plan);
        await writeDynamicDailyGateReceipt(root, input.baselineGate);
        await writeDynamicDailyGateReceipt(root, input.finalGate);
        await activateDynamicDailyPlan({ root, plan: input.plan,
            finalGate: input.finalGate,
            activatedAt: '2026-09-14T08:45:00+08:00' });
        const coverage = { ...input.coverage, items: input.coverage.items.map((item) =>
            ({ ...item, sourceHash: 'b'.repeat(64) })) };
        let requests = 0;
        const stage = createDynamicDailyLiveStage({ ...input, coverage,
            appSupportRoot: root,
            fetchImpl: async () => { requests += 1; throw new Error('must_not_fetch'); },
            now: () => '2026-09-14T08:45:01+08:00' });
        await expect(stage.start()).rejects
            .toThrow('daily_live_stage_baseline_evidence_mismatch');
        expect(requests).toBe(0);
    });
});
