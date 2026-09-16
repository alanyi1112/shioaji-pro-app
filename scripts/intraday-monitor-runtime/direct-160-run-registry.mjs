import { createHash } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export const DIRECT_160_RUN_CLAIM_SCHEMA = 'intraday-monitor-direct-160-run-claim/1';

function digest(value) {
    return createHash('sha256').update(value).digest('hex');
}

export async function claimDirect160Run({ directory, connectionGeneration, manifestHash,
    tradeDate, claimedAt } = {}) {
    if (!path.isAbsolute(directory ?? '') || typeof connectionGeneration !== 'string' ||
        connectionGeneration.length < 16 || connectionGeneration.length > 128 ||
        !/^[a-f0-9]{64}$/.test(manifestHash ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !Number.isFinite(Date.parse(claimedAt ?? ''))) throw new TypeError('direct 160 run claim input is invalid');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const activePath = path.join(directory, 'active.lock');
    const claimPath = path.join(directory, `generation-${digest(connectionGeneration)}.json`);
    let activeFile;
    try {
        activeFile = await open(activePath, 'wx', 0o600);
    } catch (error) {
        if (error?.code === 'EEXIST') throw new Error('direct_160_stage_already_active');
        throw error;
    }
    try {
        const claim = Object.freeze({ schemaVersion: DIRECT_160_RUN_CLAIM_SCHEMA, connectionGeneration,
            manifestHash, tradeDate, claimedAt, reusable: false, providerReleaseProven: false });
        const file = await open(claimPath, 'wx', 0o600).catch((error) => {
            if (error?.code === 'EEXIST') throw new Error('direct_160_generation_already_used');
            throw error;
        });
        try { await file.writeFile(`${JSON.stringify(claim)}\n`); await file.sync(); } finally { await file.close(); }
        await activeFile.writeFile(`${JSON.stringify({ claimPath, connectionGeneration, manifestHash, tradeDate })}\n`);
        await activeFile.sync();
        return Object.freeze({ claim, claimPath, activePath,
            async release() { await activeFile.close(); await unlink(activePath).catch(() => {}); } });
    } catch (error) {
        await activeFile.close().catch(() => {});
        await unlink(activePath).catch(() => {});
        throw error;
    }
}

export async function inspectDirect160ActiveClaim(directory) {
    if (!path.isAbsolute(directory ?? '')) throw new TypeError('absolute registry directory required');
    try { return JSON.parse(await readFile(path.join(directory, 'active.lock'), 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
