#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import { currentSmartOrderNodeSqliteCapabilityFingerprints } from './smart-order-runtime/gate-evidence-verifier.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const WORKER_FILE = fileURLToPath(
    new URL('./smart-order-node-sqlite-capability-probe.mjs', import.meta.url),
);
const MAXIMUM_REPORT_BYTES = 256 * 1024;

function requiredAbsoluteEnvironmentPath(name) {
    const value = process.env[name];
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new Error(`${name} managed binding is required`);
    }
    return path.resolve(value);
}

export async function runManagedNodeSqliteCapabilityLauncher() {
    const appSupportRoot = requiredAbsoluteEnvironmentPath(
        'REALTIME_STOCK_NODE_SQLITE_APP_SUPPORT',
    );
    const launchAgentPlistPath = requiredAbsoluteEnvironmentPath(
        'REALTIME_STOCK_NODE_SQLITE_LAUNCHAGENT_PLIST',
    );
    const before = await currentSmartOrderNodeSqliteCapabilityFingerprints();
    const child = spawn(process.execPath, [WORKER_FILE], {
        cwd: path.resolve(path.dirname(THIS_FILE), '..'),
        env: {
            LANG: 'C',
            LC_ALL: 'C',
            PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
            REALTIME_STOCK_NODE_SQLITE_APP_SUPPORT: appSupportRoot,
            REALTIME_STOCK_NODE_SQLITE_EXPECTED_FINGERPRINTS:
                canonicalJson(before),
            REALTIME_STOCK_NODE_SQLITE_LAUNCHAGENT_PLIST:
                launchAgentPlistPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderrBytes = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > MAXIMUM_REPORT_BYTES) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 64 * 1024) child.kill('SIGKILL');
    });
    const exit = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    if (exit.code !== 0 || exit.signal !== null || !stdout.endsWith('\n')) {
        throw new Error('managed capability child failed closed');
    }
    let report;
    try {
        report = JSON.parse(stdout);
    } catch {
        throw new Error('managed capability child report is not canonical JSON');
    }
    const after = await currentSmartOrderNodeSqliteCapabilityFingerprints();
    if (
        canonicalJson(before) !== canonicalJson(after) ||
        canonicalJson(report.fingerprint) !== canonicalJson(before) ||
        report.overall !== 'pass' ||
        report.executionMode !== 'managed-local-capability' ||
        report.evidenceClass !== 'node_sqlite_arm64_platform_capability'
    ) {
        throw new Error('managed capability source or report changed during execution');
    }
    return Object.freeze(report);
}

async function main() {
    const report = await runManagedNodeSqliteCapabilityLauncher();
    process.stdout.write(`${canonicalJson(report)}\n`);
}

if (
    process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
    await main();
}
