import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

export const PREMARKET_CAPTURE_START_CLAIM_SCHEMA =
    'intraday-monitor-premarket-capture-start-claim/1';

export function premarketCaptureStartClaimPath(root, tradeDate) {
    if (!path.isAbsolute(root ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '')) {
        throw new TypeError('premarket capture start identity is invalid');
    }
    return path.join(root, 'IntradayMonitor', 'premarket', 'claims',
        `${tradeDate}-capture-start.json`);
}

export async function claimPremarketCaptureStart({ root, tradeDate, source,
    sessionId, generation, now = new Date() } = {}) {
    if (!['scheduled_0850', 'late_boot'].includes(source) ||
        typeof sessionId !== 'string' || !sessionId.startsWith(`session-${tradeDate}-`) ||
        typeof generation !== 'string' || !generation.startsWith('simulation:') ||
        !(now instanceof Date) || !Number.isFinite(now.valueOf())) {
        throw new TypeError('premarket capture start claim input is invalid');
    }
    const claimPath = premarketCaptureStartClaimPath(root, tradeDate);
    await mkdir(path.dirname(claimPath), { recursive: true, mode: 0o700 });
    const claim = Object.freeze({ schemaVersion: PREMARKET_CAPTURE_START_CLAIM_SCHEMA,
        tradeDate, source, sessionId, generation, claimedAt: now.toISOString(),
        brokerWriteAuthority: false, productionAuthority: false });
    const file = await open(claimPath, 'wx', 0o600).catch((error) => {
        if (error?.code === 'EEXIST') throw new Error('premarket_capture_already_claimed');
        throw error;
    });
    try { await file.writeFile(`${JSON.stringify(claim)}\n`); await file.sync(); }
    finally { await file.close(); }
    return Object.freeze({ claimPath, claim });
}

export async function readPremarketCaptureStartClaim(root, tradeDate) {
    const claimPath = premarketCaptureStartClaimPath(root, tradeDate);
    try { return JSON.parse(await readFile(claimPath, 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
