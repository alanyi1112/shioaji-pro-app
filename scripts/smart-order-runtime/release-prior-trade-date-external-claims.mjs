#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './canonical-json.mjs';
import { prepareSmartOrderPrivateStorage } from './private-storage.mjs';
import { openSmartOrderRepository } from './repository-client.mjs';
import { canonicalizeShioajiRefreshedStockTrades } from './shioaji-broker-event-mapper.mjs';

const API_ROOT = 'http://127.0.0.1:8080';
const MAX_RESPONSE_BYTES = 256 * 1024;

function taipeiTradeDate(nowEpochMs) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(nowEpochMs));
}

async function requestJson(pathname, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const response = await fetch(`${API_ROOT}${pathname}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: body === undefined
                ? { accept: 'application/json' }
                : {
                      accept: 'application/json',
                      'content-type': 'application/json',
                  },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
        });
        if (!response.ok || response.redirected) {
            throw new Error(`read-only API request failed: ${response.status}`);
        }
        const responseText = await response.text();
        if (Buffer.byteLength(responseText) > MAX_RESPONSE_BYTES) {
            throw new Error('read-only API response exceeded its bound');
        }
        return JSON.parse(responseText);
    } finally {
        clearTimeout(timer);
    }
}

function selectOnlySignedStockAccount(accounts) {
    if (!Array.isArray(accounts) || accounts.length > 64) {
        throw new Error('account response is invalid');
    }
    const candidates = accounts.filter(
        (account) =>
            account?.signed === true &&
            account?.account_type === 'S' &&
            typeof account.broker_id === 'string' &&
            account.broker_id.length > 0 &&
            typeof account.account_id === 'string' &&
            account.account_id.length > 0,
    );
    if (candidates.length !== 1) {
        throw new Error(
            'maintenance release requires exactly one signed stock account',
        );
    }
    return Object.freeze({
        broker_id: candidates[0].broker_id,
        account_id: candidates[0].account_id,
        account_type: 'S',
    });
}

async function currentEmptyTradeSetEvidence(account) {
    const first = canonicalizeShioajiRefreshedStockTrades(
        await requestJson('/api/v1/order/trades', account),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const second = canonicalizeShioajiRefreshedStockTrades(
        await requestJson('/api/v1/order/trades', account),
    );
    const firstJson = canonicalJson(first);
    const secondJson = canonicalJson(second);
    if (firstJson !== secondJson || second.length !== 0) {
        throw new Error(
            'current broker trade set is non-empty or changed between reads',
        );
    }
    return Object.freeze({
        count: 0,
        evidenceSha256: `sha256:${createHash('sha256')
            .update(
                canonicalJson({
                    account,
                    stableReadCount: 2,
                    trades: second,
                }),
            )
            .digest('hex')}`,
    });
}

async function assertSidecarStopped(appSupportRoot) {
    const service = `gui/${process.getuid()}/com.alanyi.realtimestock.smart-order-sidecar`;
    if (spawnSync('launchctl', ['print', service], { stdio: 'ignore' }).status === 0) {
        throw new Error('smart-order sidecar must be stopped before repair');
    }
    const discoveryPath = path.join(
        appSupportRoot,
        'smart-order',
        'run',
        'control-plane.json',
    );
    try {
        await lstat(discoveryPath);
        throw new Error(
            'smart-order discovery must be absent before repair',
        );
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

export async function releasePriorTradeDateExternalClaims({
    appSupportRoot,
    now = () => Date.now(),
}) {
    const mode = (await readFile(path.join(appSupportRoot, 'runtime-mode'), 'utf8')).trim();
    if (mode !== 'simulation') {
        throw new Error('maintenance release is simulation-only');
    }
    const info = await requestJson('/api/v1/info');
    if (info?.simulation !== true) {
        throw new Error('maintenance release API is not simulation');
    }
    const account = selectOnlySignedStockAccount(
        await requestJson('/api/v1/auth/accounts'),
    );
    const observation = await currentEmptyTradeSetEvidence(account);
    await assertSidecarStopped(appSupportRoot);
    const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
    const repository = await openSmartOrderRepository({
        appSupportRoot,
        databasePath: storage.paths.databasePath,
        backupDirectory: storage.paths.backupDirectory,
        repositoryExpectationPath: storage.paths.repositoryExpectationPath,
        installationIdPath: storage.paths.installationIdPath,
        identityKeyPath: storage.paths.identityKeyPath,
    });
    try {
        const observedAtEpochMs = now();
        const result = await repository.request(
            'releasePriorTradeDateExternalClaims',
            {
                accountBrokerRef: account.broker_id,
                accountIdRef: account.account_id,
                currentTradeDate: taipeiTradeDate(observedAtEpochMs),
                currentTradeRecordCount: observation.count,
                nowEpochMs: now(),
                observedAtEpochMs,
                sourceEvidenceSha256: observation.evidenceSha256,
            },
        );
        return Object.freeze({
            schemaVersion:
                'smart-order-prior-trade-date-external-claim-repair/2026-09-15.1',
            state: result.state,
            currentTradeDate: result.currentTradeDate,
            currentTradeRecordCount: result.currentTradeRecordCount,
            stableReadCount: 2,
            releasedExternalSellClaimCount:
                result.releasedExternalSellClaimCount,
            sourceEvidenceSha256: result.sourceEvidenceSha256,
            accountIdentifiersExposed: false,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            writeMasterAuthority: false,
        });
    } finally {
        await repository.close();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const appSupportRoot =
        process.env.REALTIME_STOCK_APP_SUPPORT ??
        path.join(
            process.env.HOME,
            'Library',
            'Application Support',
            'RealTimeStock',
        );
    releasePriorTradeDateExternalClaims({ appSupportRoot })
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error?.message ?? String(error)}\n`);
            process.exitCode = 1;
        });
}
