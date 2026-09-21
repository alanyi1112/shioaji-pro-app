#!/usr/bin/env node

import { open, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ACCEPTANCE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_SCRIPT = path.join(ACCEPTANCE_ROOT, 'capture-bounded-kbar-shadow.mjs');

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function xml(value) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function buildOneShotKbarCaptureLaunchAgent({ label, nodePath, captureScript,
    cohortPath, tradeDate, outputPath, logPath } = {}) {
    const paths = [nodePath, captureScript, cohortPath, outputPath, logPath];
    if (typeof label !== 'string' || !/^com\.alanyi\.realtimestock\.intraday-kbar-shadow-\d{8}$/.test(label) ||
        paths.some((value) => typeof value !== 'string' || !path.isAbsolute(value)) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '')) {
        throw new TypeError('one-shot capture launch options are invalid');
    }
    const args = [nodePath, captureScript, '--execute', '--mode=full-session',
        `--cohort-receipts=${cohortPath}`, `--trade-date=${tradeDate}`, `--output=${outputPath}`];
    const argumentXml = args.map((value) => `        <string>${xml(value)}</string>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xml(label)}</string>
    <key>ProgramArguments</key>
    <array>
${argumentXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${xml(logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

async function pathExists(value) {
    try { await stat(value); return true; } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

async function main() {
    if (!process.argv.includes('--execute')) {
        throw new Error('REFUSED: --execute is required');
    }
    const tradeDate = argument('trade-date');
    const cohortPath = argument('cohort-receipts');
    const outputPath = argument('output');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        typeof cohortPath !== 'string' || !path.isAbsolute(cohortPath) ||
        typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
        throw new Error('usage: --execute --trade-date=YYYY-MM-DD --cohort-receipts=ABSOLUTE_PATH --output=ABSOLUTE_PATH');
    }
    const startEpochMs = Date.now();
    if (startEpochMs < Date.parse(`${tradeDate}T08:50:00+08:00`) ||
        startEpochMs > Date.parse(`${tradeDate}T09:00:30+08:00`)) {
        throw new Error('REFUSED: full_session_start_window_closed');
    }
    if (await pathExists(outputPath) || await pathExists(`${outputPath}.failure.json`)) {
        throw new Error('REFUSED: capture outcome already exists');
    }
    const compactDate = tradeDate.replaceAll('-', '');
    const label = `com.alanyi.realtimestock.intraday-kbar-shadow-${compactDate}`;
    const logPath = `/tmp/realtimestock-kbar-shadow-${tradeDate}.log`;
    const plistPath = `/tmp/${label}.plist`;
    const plist = buildOneShotKbarCaptureLaunchAgent({ label, nodePath: process.execPath,
        captureScript: CAPTURE_SCRIPT, cohortPath, tradeDate, outputPath, logPath });
    const handle = await open(plistPath, 'wx', 0o600);
    try { await handle.writeFile(plist); await handle.sync(); } finally { await handle.close(); }
    const result = spawnSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath],
        { encoding: 'utf8', timeout: 10_000 });
    if (result.status !== 0) {
        await unlink(plistPath).catch(() => {});
        throw new Error(`launchctl bootstrap failed: ${(result.stderr || result.stdout || 'unknown').trim()}`);
    }
    process.stdout.write(`${JSON.stringify({ launched: true, label, plistPath, logPath, outputPath,
        keepAlive: false, productionAuthority: false, brokerWriteAuthority: false,
        serviceLifecycleScope: 'capture_job_only' }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
