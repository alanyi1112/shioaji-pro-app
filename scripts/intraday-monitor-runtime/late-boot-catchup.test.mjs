import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildLateBootLaunchAgentPlist,
    runLateBootPremarketCatchup } from './late-boot-catchup.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true, force: true }))));
const tradeDate = '2026-10-01';
const previousTradeDate = '2026-09-30';
const authority = { current: true, isTradingDate: true, tradeDate, previousTradeDate,
    source: 'fixture official dual calendar' };
const at = (time) => new Date(`${tradeDate}T${time}+08:00`);

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'late-boot-catchup-'));
    roots.push(root);
    const premarket = path.join(root, 'IntradayMonitor', 'premarket');
    const baseline = path.join(root, 'intraday-baselines',
        `${previousTradeDate}-for-${tradeDate}-verified`, 'baseline-set.json');
    await mkdir(path.dirname(baseline), { recursive: true });
    await mkdir(premarket, { recursive: true });
    await writeFile(path.join(premarket, 'config.json'), '{}');
    await writeFile(baseline, JSON.stringify({ baselineHash: `sha256:${'b'.repeat(64)}` }));
    return { root, premarket, baseline };
}

describe('晚開機本機入口', () => {
    it('獨立 RunAtLoad 與少量補跑節點不修改既有四時點', () => {
        const plist = buildLateBootLaunchAgentPlist('/tmp/late-boot-catchup.mjs');
        expect(plist).toContain('<key>RunAtLoad</key><true/>');
        expect(plist).toContain('<integer>55</integer>');
        expect(plist).toContain('<integer>58</integer>');
        expect(plist).toContain('--startup-catchup');
        expect(plist).not.toContain('--scheduled');
    });

    it('08:55 無原排程收據時獨立建 session 並只啟動一條採集', async () => {
        const { root, premarket } = await fixture();
        const session = { sessionId: `session-${tradeDate}-${'a'.repeat(24)}`,
            sessionIdentityHash: 'fixture-session-hash', connectionGeneration: 'simulation:fixture-generation-1234',
            baselineHash: 'b'.repeat(64), phase: 'starting' };
        let prepared = false;
        let captures = 0;
        const gate = { ready: true, generation: session.connectionGeneration,
            observedAt: at('08:55:00').toISOString(),
            checks: { simulation: true, apiGeneration: true, businessSession: true,
                snapshot2330: true, web: true, multiView: true, artifacts: true,
                exactCohort: true, baseline: true, configuredCohort: true,
                disk: true, generationStable: true, brokerWriteBlockade: true },
            artifacts: { resolvedConfig: {} }, generationAnchor: null };
        const args = { root, clock: () => at('08:55:00'),
            resolveTradingDay: async () => authority,
            inspectGates: async () => gate,
            inspectDailySession: async () => prepared
                ? { ready: true, session, approval: { approvedActiveLimit: 160 } }
                : { ready: false, reason: 'current_session_missing', session: null },
            prepareDailySession: async () => { prepared = true;
                return { baselineCurrent: true, session }; },
            readNoCurrentData: async () => true,
            runCapture: async () => { captures++; return { exitCode: 0 }; } };
        const result = await runLateBootPremarketCatchup(args);
        expect(result).toMatchObject({ executed: true, outcome: 'capture_completed',
            sessionId: session.sessionId });
        expect(captures).toBe(1);
        const preparedReceipt = JSON.parse(await readFile(path.join(premarket, 'receipts',
            `${tradeDate}-late-boot-prepared.json`), 'utf8'));
        expect(preparedReceipt).toMatchObject({ scheduled0820Present: false,
            scheduled0820Success: false, scheduled0850Present: false,
            sessionId: session.sessionId, coldStartRisk: true });
        await expect(readFile(path.join(premarket, 'receipts', `${tradeDate}-0820.json`)))
            .rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(path.join(premarket, 'receipts', `${tradeDate}-0850.json`)))
            .rejects.toMatchObject({ code: 'ENOENT' });
        expect(await runLateBootPremarketCatchup(args)).toMatchObject({
            executed: false, reason: 'capture_already_started' });
    });

    it('08:42 只建 session，交給原 08:50 啟動；09:00 一律不動', async () => {
        const { root } = await fixture();
        const session = { sessionId: `session-${tradeDate}-${'a'.repeat(24)}`,
            sessionIdentityHash: 'fixture-session-hash', phase: 'starting' };
        let prepared = false;
        let captures = 0;
        const args = { root, clock: () => at('08:42:00'),
            resolveTradingDay: async () => authority,
            inspectGates: async () => ({ ready: true,
                generation: 'simulation:fixture-generation-1234',
                checks: { simulation: true, businessSession: true, snapshot2330: true },
                generationAnchor: null }),
            inspectDailySession: async () => prepared
                ? { ready: true, session } : { ready: false,
                    reason: 'current_session_missing', session: null },
            prepareDailySession: async () => { prepared = true;
                return { baselineCurrent: true, session }; },
            readNoCurrentData: async () => true,
            runCapture: async () => { captures++; return { exitCode: 0 }; } };
        expect(await runLateBootPremarketCatchup(args)).toMatchObject({
            executed: true, outcome: 'session_prepared' });
        expect(captures).toBe(0);
        expect(await runLateBootPremarketCatchup({ ...args, clock: () => at('09:00:00') }))
            .toMatchObject({ executed: false, reason: 'late_boot_deadline_passed' });
    });

    it('前一日基準缺失或休市時保留失敗／no-op 證據且不建 claim', async () => {
        const { root, premarket, baseline } = await fixture();
        await rm(baseline);
        const args = { root, clock: () => at('08:55:00'),
            resolveTradingDay: async () => authority };
        expect(await runLateBootPremarketCatchup(args)).toMatchObject({
            executed: false, reason: 'baseline_missing' });
        expect(await runLateBootPremarketCatchup({ ...args,
            resolveTradingDay: async () => ({ ...authority, isTradingDate: false }) }))
            .toMatchObject({ executed: false, reason: 'official_non_trading_date' });
        await expect(readFile(path.join(premarket, 'claims',
            `${tradeDate}-late-boot.json`))).rejects.toMatchObject({ code: 'ENOENT' });
        const resultFiles = await import('node:fs/promises').then((fs) => fs.readdir(path.join(
            premarket, 'receipts', `${tradeDate}-late-boot-results`)));
        expect(resultFiles).toHaveLength(2);
    });

    it('服務延遲只做有界重查，generation 不一致不得啟動採集', async () => {
        const { root } = await fixture();
        let ready = false;
        let waits = 0;
        let captures = 0;
        const session = { sessionId: `session-${tradeDate}-${'a'.repeat(24)}` };
        const result = await runLateBootPremarketCatchup({ root, clock: () => at('08:55:00'),
            resolveTradingDay: async () => authority,
            inspectGates: async () => ready
                ? { ready: true, generation: 'simulation:new-generation-1234567890',
                    checks: { simulation: true, businessSession: true,
                        snapshot2330: true, baseline: true, artifacts: true },
                    generationAnchor: { generation: 'simulation:old-generation-1234567890' } }
                : { ready: false, checks: { simulation: false, businessSession: false,
                    snapshot2330: false, baseline: true, artifacts: true } },
            sleep: async () => { waits++; ready = true; },
            inspectDailySession: async () => ({ ready: true, session }),
            readNoCurrentData: async () => true,
            runCapture: async () => { captures++; return { exitCode: 0 }; } });
        expect(waits).toBe(1);
        expect(result).toMatchObject({ executed: false, reason: 'generation_mismatch' });
        expect(captures).toBe(0);
    });
});
