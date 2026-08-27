import { createHash, randomBytes } from 'node:crypto';
import {
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    canonicalSmartOrderGateProbeSafetyEnvelope,
    smartOrderGateProbeAccountScopeSha256,
} from './gate-probe-safety-envelope.mjs';
import {
    runSmartOrderGateProbeCli,
    smartOrderGateProbeCliOperationSummary,
} from './gate-probe-cli.mjs';
import { verifySmartOrderGateProbeCliAuthorization } from './gate-probe-cli-authorization.mjs';

const roots = [];
const TEST_GENERATION = 'simulation:generation-1';
const TEST_RUNTIME_EPOCH = 'runtime-gate-probe-cli-test';
const TEST_NOW = 1_787_400_000_000;

afterEach(async () => {
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

function envelope() {
    const account = {
        broker_id: 'broker-private-canary',
        account_id: 'account-private-canary',
        account_type: 'S',
    };
    return {
        schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
        runId: '123e4567-e89b-42d3-a456-426614174500',
        operationId: '123e4567-e89b-42d3-a456-426614174501',
        nonce: '123e4567-e89b-42d3-a456-426614174502',
        request: {
            schemaVersion:
                'smart-order-manual-broker-write-request/2026-08-14.1',
            operation: 'place',
            brokerPath: '/api/v1/order/place_order',
            payload: {
                contract: {
                    security_type: 'STK',
                    region: 'TW',
                    exchange: 'TSE',
                    code: '2330',
                    target_code: null,
                },
                stock_order: {
                    action: 'Buy',
                    price: 100,
                    quantity: 1,
                    price_type: 'LMT',
                    order_type: 'ROD',
                    order_lot: 'Common',
                    account,
                },
            },
        },
        target: null,
        tradeDate: '2026-08-22',
        confirmation: {
            accountScopeSha256:
                smartOrderGateProbeAccountScopeSha256(account),
            confirmed: true,
            expectedOperation: 'place',
            maximumCommonLots: 1,
            simulation: true,
        },
        validUntilEpochMs: 1_787_400_060_000,
    };
}

async function privateEnvelopeFile(mode = 0o600) {
    const root = await mkdtemp(path.join(tmpdir(), 'gate-probe-cli-'));
    roots.push(root);
    const filePath = path.join(root, 'envelope.json');
    await writeFile(filePath, JSON.stringify(envelope()), { mode });
    await chmod(filePath, mode);
    const capabilityDirectory = path.join(
        root,
        'smart-order',
        'private',
    );
    await mkdir(capabilityDirectory, { recursive: true, mode: 0o700 });
    await writeFile(
        path.join(capabilityDirectory, 'gate-probe-cli-capability.bin'),
        randomBytes(32),
        { mode: 0o600 },
    );
    const runDirectory = path.join(root, 'smart-order', 'run');
    await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    await writeFile(
        path.join(runDirectory, 'control-plane.json'),
        `${JSON.stringify({
            schemaVersion: 'smart-order-local-sidecar/2026-08-11.1',
            host: '127.0.0.1',
            port: 31337,
            runtimeEpochId: TEST_RUNTIME_EPOCH,
            startedAtEpochMs: TEST_NOW,
        })}\n`,
        { mode: 0o600 },
    );
    return {
        appSupportRoot: await realpath(root),
        envelopeFilePath: await realpath(filePath),
    };
}

function ttyPair(answer) {
    const input = new PassThrough();
    const output = new PassThrough();
    input.isTTY = true;
    output.isTTY = true;
    input.end(`${answer}\n`);
    return { input, output };
}

describe('independent Gate 0 probe CLI', () => {
    it('shows the exact new update value in the human-readable authorization summary', () => {
        const source = envelope();
        const account = source.request.payload.stock_order.account;
        const tradeId = 'probe-trade-1';
        const update = (price) => ({
            ...source,
            request: {
                schemaVersion:
                    'smart-order-manual-broker-write-request/2026-08-14.1',
                operation: 'update_price',
                brokerPath: '/api/v1/order/update_price',
                payload: { trade_id: tradeId, price, account },
            },
            target: {
                originRunId: source.runId,
                targetIdSha256: `sha256:${'1'.repeat(64)}`,
                tradeIdSha256: `sha256:${createHash('sha256')
                    .update(JSON.stringify(tradeId))
                    .digest('hex')}`,
                accountScopeSha256:
                    smartOrderGateProbeAccountScopeSha256(account),
                tradeDate: source.tradeDate,
                revision: 3,
                quantityCommonLots: 1,
                nonTerminal: true,
                correlationUnique: true,
            },
            confirmation: {
                accountScopeSha256:
                    smartOrderGateProbeAccountScopeSha256(account),
                confirmed: true,
                expectedOperation: 'update',
                maximumCommonLots: 1,
                simulation: true,
            },
        });
        expect(smartOrderGateProbeCliOperationSummary(update(100))).toContain(
            'newPrice=100',
        );
        expect(smartOrderGateProbeCliOperationSummary(update(999))).toContain(
            'newPrice=999',
        );
        expect(smartOrderGateProbeCliOperationSummary(update(100))).not.toBe(
            smartOrderGateProbeCliOperationSummary(update(999)),
        );
    });

    it('requires an exact interactive authorization and exposes only the masked account scope', async () => {
        const source = envelope();
        const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(source);
        const suffix = canonical.envelope.accountScopeSha256.slice(-12);
        const envelopeSuffix = canonical.envelopeSha256.slice(-16);
        const runtimeSuffix = `sha256:${createHash('sha256')
            .update(TEST_RUNTIME_EPOCH)
            .digest('hex')}`.slice(-12);
        const generationSuffix = `sha256:${createHash('sha256')
            .update(TEST_GENERATION)
            .digest('hex')}`.slice(-12);
        const { input, output } = ttyPair(
            `AUTHORIZE PLACE ${envelopeSuffix} ${canonical.envelope.operationId.slice(-12)} ${runtimeSuffix} ${generationSuffix}`,
        );
        const prepare = vi.fn(async ({ envelope: prepared }) => ({
            prepared: true,
            operationId: prepared.operationId,
            brokerWriteAttempted: false,
        }));
        const notifyAuthorizationRequired = vi.fn();
        let transcript = '';
        output.on('data', (chunk) => {
            transcript += chunk.toString('utf8');
        });
        const privateInput = await privateEnvelopeFile();
        await expect(
            runSmartOrderGateProbeCli({
                ...privateInput,
                expectedApiGeneration: TEST_GENERATION,
                input,
                output,
                prepare,
                notifyAuthorizationRequired,
                now: () => TEST_NOW,
            }),
        ).resolves.toMatchObject({
            prepared: true,
            brokerWriteAttempted: false,
        });
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(notifyAuthorizationRequired).toHaveBeenCalledTimes(1);
        expect(transcript).toContain(`account=…${suffix}`);
        expect(transcript).not.toContain('broker-private-canary');
        expect(transcript).not.toContain('account-private-canary');
    });

    it('returns a one-use HMAC only in memory for the Task 0.3 authorize-only path', async () => {
        const source = envelope();
        const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(source);
        const runtimeSuffix = `sha256:${createHash('sha256')
            .update(TEST_RUNTIME_EPOCH)
            .digest('hex')}`.slice(-12);
        const generationSuffix = `sha256:${createHash('sha256')
            .update(TEST_GENERATION)
            .digest('hex')}`.slice(-12);
        const phrase = `AUTHORIZE PLACE ${canonical.envelopeSha256.slice(-16)} ${canonical.envelope.operationId.slice(-12)} ${runtimeSuffix} ${generationSuffix}`;
        const privateInput = await privateEnvelopeFile();
        const prepare = vi.fn();
        const result = await runSmartOrderGateProbeCli({
            appSupportRoot: privateInput.appSupportRoot,
            envelope: source,
            expectedApiGeneration: TEST_GENERATION,
            ...ttyPair(phrase),
            prepare,
            returnAuthorizationOnly: true,
            now: () => TEST_NOW,
        });
        expect(result).toMatchObject({
            schemaVersion:
                'smart-order-gate-probe-cli-memory-authorization/2026-08-22.1',
            authorized: true,
            envelopeSha256: canonical.envelopeSha256,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
            writeMasterAuthority: false,
        });
        expect(prepare).not.toHaveBeenCalled();
        expect(result.authorization).toMatchObject({
            envelopeSha256: canonical.envelopeSha256,
        });
        const capability = await readFile(
            path.join(
                privateInput.appSupportRoot,
                'smart-order',
                'private',
                'gate-probe-cli-capability.bin',
            ),
        );
        try {
            expect(
                verifySmartOrderGateProbeCliAuthorization({
                    capability,
                    envelope: source,
                    authorization: result.authorization,
                    nowEpochMs: TEST_NOW,
                    expectedApiGenerationSha256: `sha256:${createHash('sha256')
                        .update(TEST_GENERATION)
                        .digest('hex')}`,
                    expectedRuntimeEpochIdSha256: `sha256:${createHash('sha256')
                        .update(TEST_RUNTIME_EPOCH)
                        .digest('hex')}`,
                }),
            ).toMatchObject({
                envelopeSha256: canonical.envelopeSha256,
            });
        } finally {
            capability.fill(0);
        }
    });

    it('rejects a sidecar capability rotation while the prompt is open', async () => {
        const source = envelope();
        const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(source);
        const runtimeSuffix = `sha256:${createHash('sha256')
            .update(TEST_RUNTIME_EPOCH)
            .digest('hex')}`.slice(-12);
        const generationSuffix = `sha256:${createHash('sha256')
            .update(TEST_GENERATION)
            .digest('hex')}`.slice(-12);
        const phrase = `AUTHORIZE PLACE ${canonical.envelopeSha256.slice(-16)} ${canonical.envelope.operationId.slice(-12)} ${runtimeSuffix} ${generationSuffix}`;
        const privateInput = await privateEnvelopeFile();
        const input = new PassThrough();
        const output = new PassThrough();
        input.isTTY = true;
        output.isTTY = true;
        let rotated = false;
        output.on('data', async (chunk) => {
            if (rotated || !chunk.toString('utf8').includes('Type exactly:')) {
                return;
            }
            rotated = true;
            await writeFile(
                path.join(
                    privateInput.appSupportRoot,
                    'smart-order',
                    'private',
                    'gate-probe-cli-capability.bin',
                ),
                randomBytes(32),
                { mode: 0o600 },
            );
            input.end(`${phrase}\n`);
        });
        const prepare = vi.fn();
        await expect(
            runSmartOrderGateProbeCli({
                ...privateInput,
                expectedApiGeneration: TEST_GENERATION,
                input,
                output,
                prepare,
                now: () => TEST_NOW,
            }),
        ).rejects.toThrow('Runtime generation changed');
        expect(prepare).not.toHaveBeenCalled();
    });

    it('expires a task-specific prompt before it can consume stale authorization', async () => {
        const privateInput = await privateEnvelopeFile();
        const input = new PassThrough();
        const output = new PassThrough();
        input.isTTY = true;
        output.isTTY = true;
        await expect(
            runSmartOrderGateProbeCli({
                ...privateInput,
                expectedApiGeneration: TEST_GENERATION,
                input,
                output,
                authorizationDeadlineEpochMs: TEST_NOW + 20,
                now: () => TEST_NOW,
            }),
        ).rejects.toThrow('expired before confirmation');
    });

    it('fails closed for non-interactive, mismatched, or non-private input', async () => {
        const prepare = vi.fn();
        const nonTty = ttyPair('unused');
        nonTty.input.isTTY = false;
        await expect(
            runSmartOrderGateProbeCli({
                envelopeFilePath: '/not/read',
                appSupportRoot: '/private/app-support',
                expectedApiGeneration: 'simulation:generation-1',
                ...nonTty,
                prepare,
            }),
        ).rejects.toThrow('interactive terminal');

        const mismatchInput = await privateEnvelopeFile();
        await expect(
            runSmartOrderGateProbeCli({
                ...mismatchInput,
                expectedApiGeneration: 'simulation:generation-1',
                ...ttyPair('AUTHORIZE PLACE 2 COMMONLOT SIMULATION invalid'),
                prepare,
                now: () => TEST_NOW,
            }),
        ).rejects.toThrow('explicit authorization did not match');

        const broadInput = await privateEnvelopeFile(0o644);
        await expect(
            runSmartOrderGateProbeCli({
                ...broadInput,
                expectedApiGeneration: 'simulation:generation-1',
                ...ttyPair('unused'),
                prepare,
            }),
        ).rejects.toThrow('current-user 0600 file');
        expect(prepare).not.toHaveBeenCalled();
    });
});
