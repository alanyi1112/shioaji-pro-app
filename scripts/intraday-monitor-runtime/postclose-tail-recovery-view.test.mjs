import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { authorizeIntradayMonitorGatewayRequest } from './vite-local-api-gateway.mjs';
import { readPostcloseTailRecoveryView } from './postclose-tail-recovery-view.mjs';

const roots = [];
const DATE = '2026-10-02';
const HASH = 'a'.repeat(64);

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixtureRoot() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tail-recovery-view-'));
    roots.push(root);
    const directory = path.join(root, 'IntradayMonitor', 'postclose-tail-recovery', 'results');
    await mkdir(directory, { recursive: true });
    return { root, directory };
}

describe('盤後尾端復原唯讀投影', () => {
    it('舊資料未有衍生檔時保持未驗證', async () => {
        const { root } = await fixtureRoot();
        expect(readPostcloseTailRecoveryView(root, DATE)).toMatchObject({
            state: 'unverified', originalFormalAcceptanceEvidence: null,
            postcloseDataRecovered: false, notificationAuthority: false,
        });
    });

    it('原始擷取已存在但基準未發布時僅顯示等待，失敗收據保持未核實', async () => {
        const { root } = await fixtureRoot();
        const captureDirectory = path.join(root, 'direct-160-live');
        const receiptDirectory = path.join(root, 'IntradayMonitor', 'postclose-baseline', 'receipts');
        await mkdir(captureDirectory, { recursive: true });
        await mkdir(receiptDirectory, { recursive: true });
        await writeFile(path.join(captureDirectory, `capture-${DATE}.json`), '{}');
        expect(readPostcloseTailRecoveryView(root, DATE)).toMatchObject({
            state: 'source_pending', reason: 'baseline_receipt_missing',
            postcloseDataRecovered: false, originalFormalAcceptanceEvidence: null,
        });
        await writeFile(path.join(receiptDirectory, `${DATE}-attempt-03.json`),
            JSON.stringify({ tradeDate: DATE, outcome: 'failed', reason: 'source_unavailable' }));
        expect(readPostcloseTailRecoveryView(root, DATE)).toMatchObject({
            state: 'source_unverified', reason: 'source_unavailable',
            postcloseDataRecovered: false, notificationAuthority: false,
        });
    });

    it('160 檔盤後補齊仍明示原始 live 未通過', async () => {
        const { root, directory } = await fixtureRoot();
        const value = { schemaVersion: 'intraday-monitor-postclose-tail-recovery/1',
            tradeDate: DATE, sourceCaptureSha256: HASH,
            sourceManifestSha256: HASH, classification: 'correlated_tail_failure',
            verifiedAt: '2026-10-02T06:00:00Z', originalFormalAcceptanceEvidence: false,
            boundedDerivedAcceptance: false, postcloseDataRecovered: true,
            nextDayBaselineUsable: true, notificationAuthority: false,
            brokerWriteAuthority: false, productionAuthority: false,
            symbols: [{ canonicalSymbol: '2330.TW', originalLastLiveMinute: '13:29',
                state: 'postclose_data_recovered', sourceManifestId: `sha256:${HASH}`,
                rows: [{ minuteKey: '13:30', cumulativeVolume: 100,
                    sourceTradeDate: DATE, verifiedAt: '2026-10-02T06:00:00Z',
                    liveDelivered: false }] }] };
        const bytes = Buffer.from(JSON.stringify(value));
        await writeFile(path.join(directory, `${DATE}-${HASH}.json`), bytes);
        expect(readPostcloseTailRecoveryView(root, DATE)).toMatchObject({
            state: 'postclose_data_recovered', liveLastMinute: '13:29',
            originalFormalAcceptanceEvidence: false, boundedDerivedAcceptance: false,
            recoveredSymbolCount: 1, notificationAuthority: false,
            recoveryArtifactSha256: createHash('sha256').update(bytes).digest('hex'),
            recoveredRows: [{ minuteKey: '13:30', source: 'postclose_verified',
                liveDelivered: false, notificationAuthority: false }],
        });
    });

    it('GET 路由只接受單一交易日參數', () => {
        const request = (url) => ({ method: 'GET', url,
            rawHeaders: ['host', '127.0.0.1:5173'],
            socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' } });
        expect(authorizeIntradayMonitorGatewayRequest(request(
            `/api/intraday-monitor/v1/postclose-recovery?tradeDate=${DATE}`)))
            .toMatchObject({ allowed: true, route: 'postclose_recovery' });
        expect(authorizeIntradayMonitorGatewayRequest(request(
            `/api/intraday-monitor/v1/postclose-recovery?tradeDate=${DATE}&limit=10`)))
            .toMatchObject({ allowed: false, reason: 'invalid_query' });
    });
});
