import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { claimDirect160Run, inspectDirect160ActiveClaim } from './direct-160-run-registry.mjs';

describe('direct 160 persistent generation registry', () => {
    it('同時只允許一個 stage，release 後相同 generation 仍不可重用', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'direct-160-registry-'));
        const input = { directory: root, connectionGeneration: 'simulation:generation-a',
            manifestHash: 'a'.repeat(64), tradeDate: '2026-09-15', claimedAt: '2026-09-15T08:50:00+08:00' };
        try {
            const first = await claimDirect160Run(input);
            expect(await inspectDirect160ActiveClaim(root)).toMatchObject({ connectionGeneration: input.connectionGeneration });
            await expect(claimDirect160Run({ ...input, connectionGeneration: 'simulation:generation-b' }))
                .rejects.toThrow('already_active');
            await first.release();
            expect(await inspectDirect160ActiveClaim(root)).toBeNull();
            await expect(claimDirect160Run(input)).rejects.toThrow('generation_already_used');
        } finally { await rm(root, { recursive: true, force: true }); }
    });
});
