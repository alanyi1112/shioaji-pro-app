import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DYNAMIC_DAILY_SESSION_PROOF_SCHEMA =
    'intraday-monitor-daily-simulation-session-proof/1';

// 歷史基準唯讀請求使用目前既有 business session；info/health 單獨不足以核實它。
export async function verifyDynamicDailySessionProof({ appSupportRoot, apiPort,
    previousTradeDate, targetTradeDate, expectedGeneration,
    observedAt = new Date().toISOString() } = {}) {
    if (!path.isAbsolute(appSupportRoot ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(previousTradeDate ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(targetTradeDate ?? '') ||
        previousTradeDate >= targetTradeDate ||
        !/^simulation:[A-Za-z0-9_-]{16,100}$/.test(expectedGeneration ?? '') ||
        !Number.isFinite(Date.parse(observedAt)) ||
        typeof apiPort?.preflight !== 'function' ||
        typeof apiPort?.readSnapshot2330 !== 'function') {
        throw new TypeError('daily_session_proof_input_invalid');
    }
    const [mode, generation] = await Promise.all([
        readFile(path.join(appSupportRoot, 'runtime-mode'), 'utf8'),
        readFile(path.join(appSupportRoot, 'runtime-api-generation'), 'utf8'),
    ]).catch(() => { throw new Error('daily_session_proof_unavailable'); });
    if (mode.trim() !== 'simulation' || generation.trim() !== expectedGeneration) {
        throw new Error('daily_session_proof_mismatch');
    }
    const preflight = await apiPort.preflight()
        .catch(() => { throw new Error('daily_session_proof_unavailable'); });
    if (preflight?.simulation !== true) throw new Error('daily_session_proof_mismatch');
    const snapshots = await apiPort.readSnapshot2330()
        .catch(() => { throw new Error('daily_session_proof_unavailable'); });
    const snapshot = Array.isArray(snapshots) && snapshots.length === 1 ? snapshots[0] : null;
    const sourceDate = typeof snapshot?.datetime === 'string' ?
        snapshot.datetime.slice(0, 10) : null;
    if (snapshot?.code !== '2330' || snapshot.exchange !== 'TSE' ||
        ![previousTradeDate, targetTradeDate].includes(sourceDate)) {
        throw new Error('daily_session_proof_mismatch');
    }
    return Object.freeze({ schemaVersion: DYNAMIC_DAILY_SESSION_PROOF_SCHEMA,
        simulation: true, businessSessionCurrent: true,
        connectionGeneration: expectedGeneration,
        snapshotTradeDate: sourceDate, observedAt,
        sourceVersion: preflight.sourceVersion,
        secondLogin: false, secondStream: false,
        brokerWriteAuthority: false, productionAuthority: false,
        serviceLifecycleAuthority: false });
}
