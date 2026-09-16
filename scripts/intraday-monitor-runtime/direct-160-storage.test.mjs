import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DIRECT_160_STORAGE, assessDirect160Disk, canonicalDirect160, hashDirect160, writeDirect160Artifact } from './direct-160-storage.mjs';
import { evaluateTieredCapacityStageGate } from './tiered-capacity-evidence.mjs';
import { decideTieredRollback } from './tiered-capacity-stage-artifacts.mjs';

describe('直接 160 檔容量與防覆寫', () => {
    it('允許 20 GO 直接測試 160，但不能冒用 100 或重用 token', () => {
        const gate = { targetStage: 160, priorApprovedStage: 20, priorDecision: 'GO', priorBundleValid: true, priorBundleSha256: 'a'.repeat(64) };
        expect(evaluateTieredCapacityStageGate(gate).readyForExecutionAuthority).toBe(true);
        for (const invalid of [{ priorDecision: 'NO_GO' }, { priorBundleValid: false }, { priorApprovedStage: 100 }, { executionTokenUsed: true }]) {
            expect(evaluateTieredCapacityStageGate({ ...gate, ...invalid }).readyForExecutionAuthority).toBe(false);
        }
        expect(decideTieredRollback({ attemptedStage: 160 })).toMatchObject({ retainedActiveLimit: 20, automaticRetryAuthority: false });
    });
    it('磁碟少於 8 GiB、未知或事後降低預算一律拒絕', () => {
        const floor = DIRECT_160_STORAGE.minimumAvailableDiskBytes;
        expect(assessDirect160Disk(floor).ready).toBe(true);
        for (const size of [floor - 1, NaN, null, -1]) expect(assessDirect160Disk(size).ready).toBe(false);
        expect(assessDirect160Disk(floor, 1).ready).toBe(false);
    });
    it('43,200 個分鐘結構超過舊 4 MiB，專用 session hash 可往返且拒絕超限', () => {
        const value = { evidenceClass: 'synthetic_load_only', rows: Array.from({ length: 43_200 }, (_, n) => ({ canonicalSymbol: `SYNTHETIC_${n % 160}`, minute: n % 270, sequence: n, cumulativeVolume: n, sourceVersion: 'fixture-only', completeness: 'complete' })) };
        const encoded = canonicalDirect160(value, 'session');
        expect(Buffer.byteLength(encoded)).toBeGreaterThan(4 * 1024 * 1024);
        expect(hashDirect160(JSON.parse(encoded), 'session')).toBe(hashDirect160(value, 'session'));
        expect(() => canonicalDirect160({ payload: 'x'.repeat(DIRECT_160_STORAGE.sessionCanonicalBytes) }, 'session')).toThrow();
        expect(() => canonicalDirect160({}, 'unbounded')).toThrow();
    });
    it('exclusive 原子落檔不覆寫成功結果，失敗清除本次暫存', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'direct160-storage-test-'));
        try {
            const file = path.join(dir, 'evidence.json');
            await writeDirect160Artifact(file, { value: 1 }, 'capture');
            await expect(writeDirect160Artifact(file, { value: 2 }, 'capture')).rejects.toThrow();
            expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ value: 1 });
            expect(await readdir(dir)).toEqual(['evidence.json']);
        } finally { await rm(dir, { recursive: true, force: true }); }
    });
});
