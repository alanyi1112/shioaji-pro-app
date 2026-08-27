import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
    canonicalManualStockBrokerWriteRequest,
} from './manual-broker-write-contract.mjs';
import { openTaskProbePinnedTransport } from './task-probe-pinned-transport.mjs';
import {
    SMART_ORDER_TASK_PROBE_WRITE_PREFLIGHT_SCHEMA_VERSION,
    createTaskProbeWritePreflightEvidence,
    readTaskProbeWritePreflightReceipt,
    writeTaskProbeWritePreflightEvidence,
} from './task-probe-write-preflight.mjs';

const capability = Buffer.alloc(32, 0x71);
const digest = (character) => `sha256:${character.repeat(64)}`;
const createdAtEpochMs = Date.parse('2026-08-24T02:00:00.000Z');
const directories = [];
const servers = [];
const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            (server) => new Promise((resolve) => server.close(() => resolve())),
        ),
    );
    await Promise.all(
        directories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    );
});

function request(operation) {
    const brokerPath =
        operation === 'place'
            ? '/api/v1/order/place_order'
            : operation === 'update_price'
              ? '/api/v1/order/update_price'
              : '/api/v1/order/cancel_order';
    const payload =
        operation === 'place'
            ? {
                  contract: {
                      security_type: 'STK',
                      region: 'TW',
                      exchange: 'TSE',
                      code: '2330',
                      target_code: null,
                  },
                  stock_order: {
                      action: 'Buy',
                      price: 114.5,
                      quantity: 1,
                      price_type: 'LMT',
                      order_type: 'ROD',
                      order_lot: 'Common',
                      account,
                  },
              }
            : operation === 'update_price'
              ? { trade_id: 'same-run-trade', price: 114, account }
              : { trade_id: 'same-run-trade', account };
    return canonicalManualStockBrokerWriteRequest({
        schemaVersion: SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
        operation,
        brokerPath,
        payload,
    });
}

function evidenceInput(canonical, index) {
    const operation = canonical.request.operation;
    return {
        schemaVersion: SMART_ORDER_TASK_PROBE_WRITE_PREFLIGHT_SCHEMA_VERSION,
        sourceFingerprintSha256: digest('1'),
        createdAtEpochMs,
        validUntilEpochMs: createdAtEpochMs + 4_000,
        coordinationId: `123e4567-e89b-42d3-a456-42661417400${index}`,
        runId: '123e4567-e89b-42d3-a456-426614174000',
        operationIdSha256: digest(String(index)),
        operation,
        requestSha256: canonical.requestSha256,
        envelopeSha256: digest('4'),
        marketPlanSha256: digest('5'),
        cliAuthorizationSha256: digest('6'),
        accountScopeSha256: digest('7'),
        tradeDate: '2026-08-24',
        targetIdSha256: operation === 'place' ? null : digest('9'),
        targetRevision: operation === 'place' ? null : index,
        apiGenerationSha256: digest('8'),
        modeExecutionLeaseEvidenceSha256: digest('9'),
        initialSimulationAttestationSha256: digest('a'),
        adjacentSimulationAttestationSha256: digest('b'),
        observerReadinessSha256: digest('c'),
        contractEvidenceSha256: digest('d'),
        quoteEvidenceSha256: digest('e'),
        positionsSha256: digest('f'),
        workingOrdersSha256: digest('0'),
        quantityCommonLots: 1,
        modeMarker: 'simulation',
        apiSimulation: true,
        sharedModeLeaseHeld: true,
        observerReady: true,
        caLoaded: false,
        productionLoaded: false,
        automaticRetryAllowed: false,
        blindCleanupAllowed: false,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        accountIdentifiersPersisted: false,
    };
}

function expected(input) {
    return {
        accountScopeSha256: input.accountScopeSha256,
        apiGenerationSha256: input.apiGenerationSha256,
        coordinationId: input.coordinationId,
        envelopeSha256: input.envelopeSha256,
        marketPlanSha256: input.marketPlanSha256,
        operation: input.operation,
        operationIdSha256: input.operationIdSha256,
        requestSha256: input.requestSha256,
        runId: input.runId,
        sourceFingerprintSha256: input.sourceFingerprintSha256,
        targetIdSha256: input.targetIdSha256,
        targetRevision: input.targetRevision,
    };
}

describe('task-specific pinned simulation transport', () => {
    it('uses one pinned socket, exact one-shot receipts and strips unsupported account fields', async () => {
        const observations = [];
        const server = createServer((incoming, response) => {
            const chunks = [];
            incoming.on('data', (chunk) => chunks.push(chunk));
            incoming.on('end', () => {
                observations.push({
                    path: incoming.url,
                    remotePort: incoming.socket.remotePort,
                    body:
                        chunks.length === 0
                            ? null
                            : JSON.parse(Buffer.concat(chunks).toString('utf8')),
                });
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(
                    incoming.url === '/api/v1/info'
                        ? JSON.stringify({ simulation: true })
                        : '{}',
                );
            });
        });
        servers.push(server);
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const directory = await mkdtemp(path.join(tmpdir(), 'task-probe-transport-'));
        directories.push(directory);
        const canonicals = ['place', 'update_price', 'cancel'].map(request);
        const receipts = [];
        for (let index = 0; index < canonicals.length; index += 1) {
            const source = evidenceInput(canonicals[index], index + 1);
            const evidence = createTaskProbeWritePreflightEvidence({
                capability,
                input: source,
            });
            const evidencePath = path.join(directory, `${source.operation}.json`);
            await writeTaskProbeWritePreflightEvidence({ evidence, evidencePath });
            receipts.push(
                (
                    await readTaskProbeWritePreflightReceipt({
                        capability,
                        evidencePath,
                        expected: expected(source),
                        nowEpochMs: createdAtEpochMs + 1,
                    })
                ).receipt,
            );
        }
        const transport = await openTaskProbePinnedTransport({
            port: server.address().port,
        });
        for (let index = 0; index < canonicals.length; index += 1) {
            const response = await transport.write(
                canonicals[index].request,
                receipts[index],
            );
            response.bodyBytes.fill(0);
        }
        await expect(
            transport.write(canonicals[2].request, receipts[2]),
        ).rejects.toThrow('unconsumed receipt');
        transport.close();
        expect(observations.map((entry) => entry.path)).toEqual([
            '/api/v1/info',
            '/api/v1/order/place_order',
            '/api/v1/order/update_price',
            '/api/v1/order/cancel_order',
        ]);
        expect(new Set(observations.map((entry) => entry.remotePort)).size).toBe(1);
        expect(observations[1].body.stock_order.account).toEqual(account);
        expect(observations[2].body).toEqual({
            trade_id: 'same-run-trade',
            price: 114,
        });
        expect(observations[3].body).toEqual({ trade_id: 'same-run-trade' });
        expect(JSON.stringify(observations.slice(2))).not.toContain('SIM-ACCOUNT');
    });

    it('consumes a mismatched receipt before any POST byte and never retries', async () => {
        const observations = [];
        const server = createServer((incoming, response) => {
            observations.push(incoming.url);
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ simulation: true }));
        });
        servers.push(server);
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const directory = await mkdtemp(path.join(tmpdir(), 'task-probe-mismatch-'));
        directories.push(directory);
        const placed = request('place');
        const source = evidenceInput(placed, 4);
        const evidence = createTaskProbeWritePreflightEvidence({ capability, input: source });
        const evidencePath = path.join(directory, 'place.json');
        await writeTaskProbeWritePreflightEvidence({ evidence, evidencePath });
        const { receipt } = await readTaskProbeWritePreflightReceipt({
            capability,
            evidencePath,
            expected: expected(source),
            nowEpochMs: createdAtEpochMs + 1,
        });
        const transport = await openTaskProbePinnedTransport({
            port: server.address().port,
        });
        await expect(transport.write(request('cancel').request, receipt)).rejects.toThrow();
        await expect(transport.write(placed.request, receipt)).rejects.toThrow(
            'unconsumed receipt',
        );
        transport.close();
        expect(observations).toEqual(['/api/v1/info']);
    });
});
