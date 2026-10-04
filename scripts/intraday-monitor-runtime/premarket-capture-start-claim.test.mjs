import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { claimPremarketCaptureStart } from './premarket-capture-start-claim.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true, force: true }))));

describe('盤前採集共同獨占 claim', () => {
    it('晚開機與固定 08:50 只有一個可取得同日啟動權', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-capture-claim-'));
        roots.push(root);
        const args = { root, tradeDate: '2026-10-01',
            sessionId: `session-2026-10-01-${'a'.repeat(24)}`,
            generation: 'simulation:fixture-generation-1234' };
        const first = await claimPremarketCaptureStart({ ...args, source: 'late_boot' });
        await expect(claimPremarketCaptureStart({ ...args, source: 'scheduled_0850' }))
            .rejects.toThrow('premarket_capture_already_claimed');
        expect(JSON.parse(await readFile(first.claimPath, 'utf8'))).toMatchObject({
            source: 'late_boot', tradeDate: '2026-10-01', productionAuthority: false });
    });
});
