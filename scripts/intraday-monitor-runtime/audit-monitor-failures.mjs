import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { recordIntradayMonitorLocalIncident } from './local-incident-alert.mjs';
import { resolveIntradayMonitorPremarketTradingDay } from './trading-calendar-authority.mjs';

export const MONITOR_FAILURE_AUDIT_LABEL = 'com.alanyi.realtimestock.intraday-failure-audit';
const rootDefault = () => process.env.REALTIME_STOCK_APP_SUPPORT ??
    path.join(os.homedir(), 'Library', 'Application Support', 'RealTimeStock');
const readJson = async (file) => readFile(file, 'utf8').then(JSON.parse).catch(() => null);

function localParts(now) {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
        minute: '2-digit', hourCycle: 'h23' });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    return { tradeDate: `${parts.year}-${parts.month}-${parts.day}`,
        minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute) };
}

export async function auditIntradayMonitorFailures({ root = rootDefault(), now = new Date(),
    resolveTradingDay = resolveIntradayMonitorPremarketTradingDay,
    notify = recordIntradayMonitorLocalIncident } = {}) {
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf()) ||
        typeof root !== 'string' || !path.isAbsolute(root)) {
        throw new TypeError('monitor failure audit input is invalid');
    }
    const { tradeDate, minuteOfDay } = localParts(now);
    const authority = await resolveTradingDay({ root, now });
    if (authority?.current !== true || authority.isTradingDate !== true ||
        authority.tradeDate !== tradeDate) {
        return { checked: false, reason: authority?.reason ?? 'not_trading_date', tradeDate };
    }
    const receiptRoot = path.join(root, 'IntradayMonitor', 'premarket', 'receipts');
    const claimRoot = path.join(root, 'IntradayMonitor', 'premarket', 'claims');
    const sessionRoot = path.join(root, 'IntradayMonitor', 'session-state', 'sessions');
    const captureRoot = path.join(root, 'direct-160-live');
    const notices = [];
    if (minuteOfDay >= 8 * 60 + 52) {
        const receipt = await readJson(path.join(receiptRoot, `${tradeDate}-0850.json`));
        const claim = await readJson(path.join(claimRoot, `${tradeDate}-0850.json`));
        const session = await readJson(path.join(sessionRoot, `${tradeDate}.json`));
        const failure = await readJson(path.join(captureRoot,
            `capture-${tradeDate}.json.failure.json`));
        const claimedAt = Date.parse(claim?.claimedAt ?? '');
        const updatedAt = Date.parse(session?.updatedAt ?? '');
        const captureInProgress = !receipt && !failure &&
            claim?.tradeDate === tradeDate && claim?.step === '08:50' &&
            session?.tradeDate === tradeDate &&
            ['starting', 'running'].includes(session.phase) &&
            session.controlPlane?.accepted === true && session.blocker == null &&
            Number.isFinite(claimedAt) && Number.isFinite(updatedAt) &&
            updatedAt >= claimedAt && now.valueOf() - claimedAt >= 0 &&
            now.valueOf() - claimedAt <= 5 * 60_000;
        if ((failure || !receipt || receipt.rolloverOutcome === 'failed') &&
            !captureInProgress) {
            const kind = receipt?.reason === 'direct_160_capture_failed'
                || failure ? 'direct_160_capture_failed' : 'premarket_step_failed';
            notices.push(await notify({ root, tradeDate, step: '08:50', kind }));
        }
    }
    if (minuteOfDay >= 13 * 60 + 40) {
        const failure = await readJson(path.join(captureRoot,
            `capture-${tradeDate}.json.failure.json`));
        const capture = await readJson(path.join(captureRoot, `capture-${tradeDate}.json`));
        if (failure || capture?.assessment?.formalAcceptanceEvidence !== true) {
            notices.push(await notify({ root, tradeDate, step: '13:40',
                kind: failure ? 'direct_160_capture_failed' : 'capture_result_missing' }));
        }
    }
    return { checked: true, tradeDate, notices, brokerWriteAuthority: false,
        productionAuthority: false, serviceLifecycleAuthority: false };
}

export async function recordMonitorFailureAuditRun({ root = rootDefault(),
    result, at = new Date().toISOString() } = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(result?.tradeDate ?? '') ||
        !Number.isFinite(Date.parse(at))) throw new TypeError('audit run receipt is invalid');
    const directory = path.join(root, 'IntradayMonitor', 'failure-audit-runs');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const receiptPath = path.join(directory,
        `${result.tradeDate}-${at.replaceAll(':', '-')}-${randomUUID()}.json`);
    const handle = await open(receiptPath, 'wx', 0o600);
    try {
        await handle.writeFile(`${JSON.stringify({ schemaVersion: 'intraday-monitor-failure-audit-run/1',
            at, tradeDate: result.tradeDate, checked: result.checked === true,
            reason: result.reason ?? null,
            notices: result.notices?.map((notice) => ({ attempted: notice.attempted,
                reason: notice.reason ?? null, handoff: notice.handoff ?? null,
                receiptPath: notice.receiptPath })) ?? [],
            brokerWriteAuthority: false, productionAuthority: false })}\n`);
        await handle.sync();
    } finally { await handle.close(); }
    return receiptPath;
}

export function monitorFailureAuditPlist(scriptPath) {
    if (typeof scriptPath !== 'string' || !path.isAbsolute(scriptPath)) {
        throw new TypeError('audit script path is invalid');
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${MONITOR_FAILURE_AUDIT_LABEL}</string><key>ProgramArguments</key><array><string>${process.execPath}</string><string>${scriptPath}</string><string>--scheduled</string></array><key>RunAtLoad</key><true/><key>StartCalendarInterval</key><array><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>52</integer></dict><dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>40</integer></dict></array><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>\n`;
}

export async function installMonitorFailureAudit({ scriptPath = new URL(import.meta.url).pathname } = {}) {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents',
        `${MONITOR_FAILURE_AUDIT_LABEL}.plist`);
    await mkdir(path.dirname(plistPath), { recursive: true, mode: 0o700 });
    await writeFile(plistPath, monitorFailureAuditPlist(scriptPath), { flag: 'wx', mode: 0o600 });
    return { plistPath, label: MONITOR_FAILURE_AUDIT_LABEL };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    if (process.argv.includes('--install')) {
        installMonitorFailureAudit().then((result) => console.log(JSON.stringify(result)))
            .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
    } else if (process.argv.includes('--scheduled')) {
        auditIntradayMonitorFailures().then((result) =>
            recordMonitorFailureAuditRun({ result })).catch((error) => {
            process.stderr.write(`${error.message}\n`); process.exitCode = 1;
        });
    } else {
        process.stderr.write('--scheduled or --install required\n'); process.exitCode = 1;
    }
}
