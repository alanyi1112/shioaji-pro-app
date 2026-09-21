import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { prepareLivePilotCohort, selectConfiguredPilotCohort } from './prepare-live-pilot-cohort.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function item(index, enabled = true) {
    return { contract: { security_type: 'STK', region: 'TW', exchange: index % 2 ? 'OTC' : 'TSE',
        code: String(1001 + index), target_code: null }, enabled };
}

describe('live pilot cohort preparation', () => {
    it('依設定穩定排序只取前 20 個 enabled 商品', () => {
        const items = [item(0, false), ...Array.from({ length: 23 }, (_, index) => item(index + 1))];
        expect(selectConfiguredPilotCohort({ revision: 7, items })).toEqual(
            items.slice(1, 21).map((entry) => `${entry.contract.code}.${entry.contract.exchange === 'TSE' ? 'TW' : 'TWO'}`));
        expect(() => selectConfiguredPilotCohort({ revision: 7, items: items.slice(0, 20) }))
            .toThrowError('exactly_20_enabled_unique_items_required');
    });

    it('保留但略過 bounded KBar 不支援的非四位數商品', () => {
        const unsupported = { ...item(0), contract: { ...item(0).contract, code: '00988A' } };
        const unsupportedEtf = { ...item(0), contract: { ...item(0).contract, code: '0050' } };
        const items = [unsupported, unsupportedEtf, ...Array.from({ length: 21 }, (_, index) => item(index + 1))];
        const cohort = selectConfiguredPilotCohort({ revision: 8, items });
        expect(cohort).toHaveLength(20);
        expect(cohort).not.toContain('00988A.TW');
        expect(cohort).not.toContain('0050.TW');
        expect(cohort[0]).toBe('1002.TWO');
    });

    it('只讀本機 simulation endpoints 並建立不具任何 authority 的 receipt manifest', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'pilot-cohort-'));
        roots.push(root);
        const outputPath = path.join(root, 'receipts.json');
        const items = Array.from({ length: 23 }, (_, index) => item(index));
        const requests = [];
        const fetchImpl = async (url, init) => {
            requests.push({ url, method: init.method });
            if (url.endsWith('/api/v1/info')) return Response.json({ simulation: true, version: '1.7.1' });
            if (url.endsWith('/config')) return Response.json({ config: { revision: 4, items } });
            return Response.json({ contracts: items.map((entry) => entry.contract) });
        };
        const result = await prepareLivePilotCohort({ fetchImpl, outputPath,
            verifiedAt: '2026-09-07T11:30:00+08:00' });
        expect(result).toMatchObject({ configuredCount: 23, enabledCount: 23, cohort: { length: 20 },
            simulation: true, providerRequestAuthority: false, subscriptionTransportAuthority: false,
            serviceLifecycleAuthority: false, brokerWriteAuthority: false });
        expect(requests.every((request) => request.method === 'GET')).toBe(true);
        expect(JSON.parse(await readFile(outputPath, 'utf8'))).toMatchObject({ cohort: { length: 20 },
            providerRequestAuthority: false, subscriptionTransportAuthority: false });
    });
});
