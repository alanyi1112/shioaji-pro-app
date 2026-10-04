import { execFile as nodeExecFile } from 'node:child_process';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

export const INTRADAY_MONITOR_LOCAL_ALERT_SCHEMA = 'intraday-monitor-local-alert/1';

const APPLE_SCRIPT = [
    'on run argv',
    'display notification (item 2 of argv) with title (item 1 of argv)',
    'end run',
].join('\n');

const NOTICES = Object.freeze({
    direct_160_capture_failed: {
        title: '盤中監控擷取失敗',
        body: '今日正式擷取已失敗，不能視為監控正常；請查看本機排程與失敗收據。',
    },
    premarket_step_failed: {
        title: '盤中監控盤前檢查失敗',
        body: '今日盤前關卡未通過；請在 08:50 前查看本機排程收據與安全 Gate。',
    },
    capture_result_missing: {
        title: '盤中監控收盤證據未完成',
        body: '13:40 仍無今日完整正式擷取證據；請查看本機擷取狀態與失敗收據。',
    },
});

function osHandoff(execFileImpl, notice) {
    return new Promise((resolve, reject) => {
        execFileImpl('/usr/bin/osascript', ['-e', APPLE_SCRIPT, '--',
            notice.title, notice.body], { timeout: 5_000, maxBuffer: 16_384,
            windowsHide: true }, (error) => error ? reject(error) : resolve());
    });
}

export async function recordIntradayMonitorLocalIncident({ root, tradeDate, step,
    kind, at = new Date().toISOString(), platform = process.platform,
    execFileImpl = nodeExecFile } = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !/^\d{2}:\d{2}$/.test(step ?? '') || !NOTICES[kind] ||
        !Number.isFinite(Date.parse(at))) throw new TypeError('local incident identity is invalid');
    const directory = path.join(root, 'IntradayMonitor', 'local-alerts');
    const prefix = `${tradeDate}-${step.replace(':', '')}-${kind}`;
    let receiptPath = path.join(directory, `${prefix}.json`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let handle;
    try { handle = await open(receiptPath, 'wx', 0o600); }
    catch (error) {
        if (error?.code === 'EEXIST') {
            const prior = await readFile(receiptPath, 'utf8').then(JSON.parse).catch(() => null);
            if (prior?.handoff === 'os_handoff' || prior?.handoff === 'unsupported') {
                return { attempted: false, reason: 'already_recorded', receiptPath };
            }
            receiptPath = path.join(directory, `${prefix}-retry.json`);
            try { handle = await open(receiptPath, 'wx', 0o600); }
            catch (retryError) {
                if (retryError?.code === 'EEXIST') {
                    return { attempted: false, reason: 'retry_already_recorded', receiptPath };
                }
                throw retryError;
            }
        } else {
            throw error;
        }
    }
    let handoff = 'unsupported';
    if (platform === 'darwin') {
        try { await osHandoff(execFileImpl, NOTICES[kind]); handoff = 'os_handoff'; }
        catch { handoff = 'failed'; }
    }
    const receipt = { schemaVersion: INTRADAY_MONITOR_LOCAL_ALERT_SCHEMA,
        tradeDate, step, kind, attemptedAt: at, handoff,
        userSawNotification: null, brokerWriteAuthority: false,
        productionAuthority: false, serviceLifecycleAuthority: false };
    try { await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    return { attempted: true, receiptPath, handoff };
}
