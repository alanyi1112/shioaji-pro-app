import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { prepareDynamicDailyPostclose }
    from './dynamic-daily-postclose-preparer.mjs';
import { fixtureBaseline } from './fixtures/direct-160-baseline.mjs';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))); });

function input(root, code = '1001') {
    const config = validateIntradayMonitorConfig({ schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision: 9, globalThreshold: '1.5', items: [{ contract: { security_type: 'STK',
            region: 'TW', exchange: 'TSE', code, target_code: null },
        enabled: true, thresholdOverride: null, source: 'manual' }] }).value;
    return { root, config,
        authority: { schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: true, isTradingDate: true, tradeDate: '2026-09-14',
            previousTradeDate: '2026-09-11', sourceVersions: ['fixture/1'],
            observedAt: '2026-09-11T13:35:00+08:00' },
        approval: { decision: 'go', approvedActiveLimit: 160,
            approvalHash: 'a'.repeat(64) },
        createdAt: '2026-09-11T13:36:00+08:00' };
}

describe('每日 plan 盤後候選與差異基準前置', () => {
    it('已有合法原 Stage 基準時依商品鍵值重用，完全不呼叫 provider', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-postclose-'));
        roots.push(root);
        const cohortManifest = { stage: 160, manifestHash: 'a'.repeat(64),
            cohort: Array.from({ length: 160 }, (_, index) => ({
                canonicalSymbol: `${1001 + index}.TW`,
                contractIdentity: { code: String(1001 + index), exchange: 'TSE',
                    security_type: 'STK', region: 'TW' },
            })) };
        const baseline = fixtureBaseline(cohortManifest);
        const result = await prepareDynamicDailyPostclose({ ...input(root),
            verifiedSets: [{ cohortManifest, baseline }] });
        expect(result).toMatchObject({ outcome: 'baseline_ready',
            coverage: { plannedCount: 1, baselineReadyCount: 1 },
            deltaReceiptPath: null, notificationAuthority: false });
        expect(JSON.parse(await readFile(result.planPath, 'utf8')).planHash)
            .toBe(result.plan.planHash);
        expect(baseline.manifests).toHaveLength(160);
    });

    it('缺基準且沒有已核准有界預算時只存候選 plan，不發動查詢或冒稱就緒', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-postclose-'));
        roots.push(root);
        const result = await prepareDynamicDailyPostclose(input(root, '2330'));
        expect(result).toMatchObject({ outcome: 'waiting_baseline',
            coverage: { plannedCount: 1, baselineReadyCount: 0,
                items: [{ canonicalSymbol: '2330.TW', reason: 'baseline_missing' }] },
            deltaReceiptPath: null, notificationAuthority: false });
        expect(JSON.parse(await readFile(result.planPath, 'utf8')).planHash)
            .toBe(result.plan.planHash);
    });
});
