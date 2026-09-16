import { it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createTieredCohortManifests } from './tiered-capacity-stage-artifacts.mjs';
import { buildDirect160Baseline } from './build-direct-160-baseline.mjs';
import { fixtureBaseline, symbolFixture } from './fixtures/direct-160-baseline.mjs';

it('原始小數可雜湊，單檔缺資料只阻擋該檔與全量發布，已寫入數與報告一致', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rts-baseline-builder-'));
    try {
        const contracts = Array.from({ length: 160 }, (_, i) => ({ security_type: 'STK', region: 'TW',
            exchange: 'TSE', code: String(1001+i), target_code: null }));
        const manifest = createTieredCohortManifests({ contracts, config: { revision: 1,
            items: contracts.map(contract => ({ contract, enabled: true })) }, sourceVersion: 'fixture-only/1',
            createdAt: '2026-09-11T14:00:00+08:00' })[160];
        const calendar = fixtureBaseline(manifest).calendar;
        const save = (name, body) => writeFile(path.join(root,name), JSON.stringify(body), { flag: 'wx' });
        await save('cohort.json', manifest);
        await save('source.json', { simulation: true, cohortHash: manifest.manifestHash, tradeDate: '2026-09-11', version: 'fixture-only/1' });
        await save('twse-calendar.json', calendar.twse); await save('tpex-calendar.json', calendar.tpex);
        for (const [index, entry] of manifest.cohort.entries()) {
            const input = symbolFixture(entry, manifest.manifestHash, calendar);
            input.contract.margin_loan_ratio = 0.6;
            const code = entry.contractIdentity.code;
            await save(`${code}.contract.json`, input.contract);
            await save(`${code}.kbars-1.json`, input.first);
            await save(`${code}.kbars-2.json`, input.second);
            await save(`${code}.ticks.json`, index === 159 ? { datetime: [], volume: [], close: [] } : input.ticks);
        }
        const outputDirectory = path.join(root, 'verified');
        const report = await buildDirect160Baseline({ sourceDirectory: root, outputDirectory,
            manifestPath: path.join(root, 'cohort.json'), targetTradeDate: '2026-09-14', verifiedAt: '2026-09-11T14:05:00+08:00' });
        expect(report.verifiedCount).toBe(159);
        expect(report.results.filter(r => r.verified)).toHaveLength(159);
        expect(report.baselineUsable).toBe(false);
        expect((await readdir(outputDirectory)).includes('baseline-set.json')).toBe(false);
        const first = report.results[0];
        const raw = await readFile(path.join(outputDirectory, '1001.baseline.json'));
        expect(createHash('sha256').update(raw).digest('hex')).toBe(first.fileSha256);
    } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
