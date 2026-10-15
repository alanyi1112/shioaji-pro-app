import { createHash } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export const DYNAMIC_DAILY_RUN_CLAIM_SCHEMA = 'intraday-monitor-daily-run-claim/1';

export function resolveDynamicDailySharedRegistryDirectory(appSupportRoot) {
    if (!path.isAbsolute(appSupportRoot ?? '')) {
        throw new TypeError('daily_registry_root_invalid');
    }
    return path.join(appSupportRoot, 'direct-160-live', 'registry');
}

// 與 direct-160-run-registry 共用 active.lock 與 generation 檔名空間。
// 因此每日路徑不能與 Stage 擷取同時建立另一條監控 SSE／batch。
export async function claimDynamicDailyRun({ directory, connectionGeneration,
    planHash, tradeDate, claimedAt } = {}) {
    if (!path.isAbsolute(directory ?? '') ||
        !/^simulation:[A-Za-z0-9_-]{16,100}$/.test(connectionGeneration ?? '') ||
        !/^[a-f0-9]{64}$/.test(planHash ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !Number.isFinite(Date.parse(claimedAt ?? ''))) {
        throw new TypeError('daily_run_claim_input_invalid');
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const generationHash = createHash('sha256').update(connectionGeneration).digest('hex');
    const activePath = path.join(directory, 'active.lock');
    const legacyPath = path.join(directory, `generation-${generationHash}.json`);
    const claimPath = path.join(directory, `daily-${tradeDate}-${generationHash}.json`);
    const active = await open(activePath, 'wx', 0o600).catch((error) => {
        if (error?.code === 'EEXIST') throw new Error('daily_monitor_session_already_active');
        throw error;
    });
    const activeBody = { claimPath, connectionGeneration, planHash, tradeDate,
        ownerPid: process.pid };
    const activeRaw = `${JSON.stringify(activeBody)}\n`;
    try {
        const prior = await readFile(legacyPath, 'utf8').then(JSON.parse).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw new Error('daily_generation_claim_unreadable');
        });
        if (prior && (prior.connectionGeneration !== connectionGeneration ||
            !/^\d{4}-\d{2}-\d{2}$/.test(prior.tradeDate ?? '') || prior.tradeDate >= tradeDate)) {
            throw new Error('daily_generation_already_used');
        }
        const claim = Object.freeze({ schemaVersion: DYNAMIC_DAILY_RUN_CLAIM_SCHEMA,
            connectionGeneration, planHash, tradeDate, claimedAt,
            ownerPid: process.pid,
            reusable: false, providerReleaseProven: false,
            secondLoginAllowed: false, secondStreamAllowed: false,
            rotationAllowed: false });
        const file = await open(claimPath, 'wx', 0o600).catch((error) => {
            if (error?.code === 'EEXIST') throw new Error('daily_generation_already_used');
            throw error;
        });
        try { await file.writeFile(`${JSON.stringify(claim)}\n`); await file.sync(); }
        finally { await file.close(); }
        // 保留 Stage 原始 generation 收據；首次使用留下 tombstone，不能同日切回 Stage。
        // 下一交易日使用獨立日期 claim，不能要求每日重啟 API 才能 rollover。
        if (!prior) {
            const legacy = await open(legacyPath, 'wx', 0o600);
            try { await legacy.writeFile(`${JSON.stringify(claim)}\n`); await legacy.sync(); }
            finally { await legacy.close(); }
        }
        await active.writeFile(activeRaw);
        await active.sync();
        let released = false;
        return Object.freeze({ claim, claimPath, activePath,
            async release() {
                if (released) return;
                released = true;
                await active.close();
                const current = await readFile(activePath, 'utf8').catch(() => null);
                if (current === activeRaw) await unlink(activePath).catch(() => {});
            } });
    } catch (error) {
        await active.close().catch(() => {});
        await unlink(activePath).catch(() => {});
        throw error;
    }
}
