import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTieredCohortManifests } from './tiered-capacity-stage-artifacts.mjs';
import { fixtureBaseline } from './fixtures/direct-160-baseline.mjs';
import { createBaselineBandwidthBudget, readVerifiedBaselineBandwidthSamples } from
    './baseline-bandwidth-budget.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
const hash = 'a'.repeat(64);
const limit = 524_288_000;
const samples = ['2026-09-14', '2026-09-15'].map((tradeDate, index) => ({
    tradeDate, manifestHash: hash, consumedBytes: index ? 19_719_021 : 17_933_604,
    providerLimitBytes: limit, verificationSha256: 'b'.repeat(64),
    baselineSha256: 'c'.repeat(64),
    sourceSha256: 'd'.repeat(64), usageStartSha256: 'e'.repeat(64),
    usageEndSha256: 'f'.repeat(64),
}));

describe('160 檔採集流量動態預算', () => {
    it('依同 cohort 實測最大用量三倍與 quota 四分之一保留，低於舊 256 MiB 仍可啟動', () => {
        const remaining = 227_509_396;
        const budget = createBaselineBandwidthBudget({
            usage: { limit_bytes: limit, bytes: limit - remaining, remaining_bytes: remaining },
            samples, manifestHash: hash, tradeDate: '2026-09-23', attempt: 2,
        });
        expect(budget).toMatchObject({ ready: true, providerRemainingBytes: remaining,
            reserveBytes: 131_072_000, forecastBytes: 59_157_063,
            requiredStartBytes: 190_229_063, attempt: 2 });
        expect(budget.requiredStartBytes).toBeLessThan(256 * 1024 ** 2);
    });

    it('實際餘額跌破動態要求時 fail closed，保留計算結果', () => {
        const remaining = 180_000_000;
        const budget = createBaselineBandwidthBudget({
            usage: { limit_bytes: limit, bytes: limit - remaining, remaining_bytes: remaining },
            samples, manifestHash: hash, tradeDate: '2026-09-23', attempt: 1,
        });
        expect(budget).toMatchObject({ ready: false,
            blocker: 'provider_bandwidth_budget_insufficient',
            requiredStartBytes: 190_229_063 });
    });

    it('不同 cohort、少於兩個驗證日或 usage 算術不符都不能規劃', () => {
        const usage = { limit_bytes: limit, bytes: 300_000_000,
            remaining_bytes: limit - 300_000_000 };
        const input = { usage, samples, manifestHash: hash,
            tradeDate: '2026-09-23', attempt: 1 };
        expect(() => createBaselineBandwidthBudget({ ...input,
            samples: [samples[0], { ...samples[1], manifestHash: 'd'.repeat(64) }],
        })).toThrow('baseline_bandwidth_samples_insufficient');
        expect(() => createBaselineBandwidthBudget({ ...input,
            samples: [samples[0], { ...samples[1], tradeDate: samples[0].tradeDate }],
        })).toThrow('baseline_bandwidth_samples_insufficient');
        expect(() => createBaselineBandwidthBudget({ ...input,
            usage: { ...usage, remaining_bytes: usage.remaining_bytes + 1 },
        })).toThrow('baseline_bandwidth_usage_invalid');
    });

    it('僅辨識有來源目錄與完整驗證報告相互對應的重試樣本', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'baseline-budget-'));
        roots.push(root);
        const contracts = Array.from({ length: 160 }, (_, index) => ({
            security_type: 'STK', region: 'TW', exchange: 'TSE',
            code: String(1001 + index), target_code: null,
        }));
        const manifest = createTieredCohortManifests({ contracts, config: { revision: 1,
            items: contracts.map((contract) => ({ contract, enabled: true })) },
        sourceVersion: 'fixture-only/1', createdAt: '2026-09-11T14:00:00+08:00' })[160];
        const baseline = fixtureBaseline(manifest);
        const parent = path.join(root, 'intraday-baselines');
        const source = path.join(parent, '2026-09-11-direct160-attempt-02-source');
        const output = path.join(parent, '2026-09-11-for-2026-09-14-verified');
        const budgetPath = path.join(root, 'IntradayMonitor', 'postclose-baseline',
            'budgets', '2026-09-11-attempt-02.json');
        await mkdir(source, { recursive: true });
        await mkdir(output);
        await mkdir(path.dirname(budgetPath), { recursive: true });
        const budgetRaw = JSON.stringify({ schemaVersion: 'intraday-monitor-baseline-bandwidth-budget/1',
            tradeDate: '2026-09-11', attempt: 2, manifestHash: manifest.manifestHash,
            providerLimitBytes: limit, ready: true });
        await writeFile(budgetPath, budgetRaw);
        await writeFile(path.join(source, 'source.json'), JSON.stringify({ simulation: true,
            cohortHash: manifest.manifestHash, tradeDate: '2026-09-11', attempt: 2,
            budgetSha256: createHash('sha256').update(budgetRaw).digest('hex') }));
        await writeFile(path.join(source, 'usage-start.json'), JSON.stringify({ bytes: 1_000,
            remaining_bytes: limit - 1_000, limit_bytes: limit }));
        await writeFile(path.join(source, 'usage-160.json'), JSON.stringify({ bytes: 20_001_000,
            remaining_bytes: limit - 20_001_000, limit_bytes: limit }));
        await writeFile(path.join(output, 'baseline-set.json'), JSON.stringify(baseline));
        const reportPath = path.join(output, 'verification.json');
        const report = { previousTradeDate: '2026-09-11', targetTradeDate: '2026-09-14',
            manifestHash: manifest.manifestHash, sourceDirectory: source,
            verifiedCount: 160, expectedCount: 160, baselineUsable: true };
        await writeFile(reportPath, JSON.stringify(report));
        const found = await readVerifiedBaselineBandwidthSamples({ root, manifest,
            tradeDate: '2026-09-16' });
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ tradeDate: '2026-09-11', consumedBytes: 20_000_000 });
        await writeFile(budgetPath, `${budgetRaw} `);
        expect(await readVerifiedBaselineBandwidthSamples({ root, manifest,
            tradeDate: '2026-09-16' })).toEqual([]);
        await writeFile(budgetPath, budgetRaw);
        await writeFile(reportPath, JSON.stringify({ ...report, sourceDirectory: '/wrong/source' }));
        expect(await readVerifiedBaselineBandwidthSamples({ root, manifest,
            tradeDate: '2026-09-16' })).toEqual([]);
        expect(JSON.parse(await readFile(path.join(source, 'source.json'), 'utf8')).simulation).toBe(true);
    });
});
