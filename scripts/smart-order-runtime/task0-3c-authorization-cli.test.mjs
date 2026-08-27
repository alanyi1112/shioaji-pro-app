import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    canonicalSmartOrderGateProbeSafetyEnvelope,
    smartOrderGateProbeAccountScopeSha256,
} from './gate-probe-safety-envelope.mjs';
import { runSmartOrderTask03cAuthorizationCli } from './task0-3c-authorization-cli.mjs';

const roots = [];
const nowEpochMs = Date.parse('2026-08-27T02:00:00.000Z');
const generation = 'simulation:task0-3c-test';

afterEach(async () => {
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

function envelope() {
    const account = {
        broker_id: 'SIM-BROKER',
        account_id: 'SIM-ACCOUNT',
        account_type: 'S',
    };
    return {
        schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
        runId: '123e4567-e89b-42d3-a456-426614174640',
        operationId: '123e4567-e89b-42d3-a456-426614174641',
        nonce: '123e4567-e89b-42d3-a456-426614174642',
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
                    action: 'Sell',
                    price: 116,
                    quantity: 1,
                    price_type: 'LMT',
                    order_type: 'ROD',
                    order_lot: 'Common',
                    custom_field: 'EXT001',
                    account,
                },
            },
        },
        target: null,
        tradeDate: '2026-08-27',
        confirmation: {
            accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account),
            confirmed: true,
            expectedOperation: 'place',
            maximumCommonLots: 1,
            simulation: true,
        },
        validUntilEpochMs: nowEpochMs + 60_000,
    };
}

async function appSupport({ discovery = false } = {}) {
    const root = await mkdtemp(path.join(tmpdir(), 'task0-3c-auth-'));
    roots.push(root);
    await writeFile(path.join(root, 'runtime-mode'), 'simulation\n', {
        mode: 0o600,
    });
    await writeFile(path.join(root, 'runtime-api-generation'), `${generation}\n`, {
        mode: 0o600,
    });
    if (discovery) {
        const runDirectory = path.join(root, 'smart-order', 'run');
        await mkdir(runDirectory, { recursive: true, mode: 0o700 });
        await writeFile(path.join(runDirectory, 'control-plane.json'), '{}\n', {
            mode: 0o600,
        });
    }
    return root;
}

function ttyPair(answer) {
    const input = new PassThrough();
    const output = new PassThrough();
    input.isTTY = true;
    output.isTTY = true;
    input.end(`${answer}\n`);
    return { input, output };
}

describe('Task 0.3c sidecar-stopped authorization CLI', () => {
    it('sounds once and accepts only the exact request-bound phrase', async () => {
        const source = envelope();
        const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(source);
        const generationSuffix = `sha256:${createHash('sha256')
            .update(generation)
            .digest('hex')}`.slice(-12);
        const phrase = `AUTHORIZE EXTERNAL SELL ${canonical.envelope.requestSha256.slice(-16)} ${canonical.envelope.operationId.slice(-12)} ${generationSuffix}`;
        const { input, output } = ttyPair(phrase);
        const notifyAuthorizationRequired = vi.fn();
        await expect(
            runSmartOrderTask03cAuthorizationCli({
                appSupportRoot: await appSupport(),
                authorizationDeadlineEpochMs: nowEpochMs + 30_000,
                envelope: source,
                expectedApiGeneration: generation,
                input,
                output,
                now: () => nowEpochMs,
                notifyAuthorizationRequired,
            }),
        ).resolves.toMatchObject({
            authorizedAtEpochMs: nowEpochMs,
            brokerWriteAttempted: false,
            brokerAuthority: false,
        });
        expect(notifyAuthorizationRequired).toHaveBeenCalledTimes(1);
    });

    it('refuses authorization while sidecar discovery exists', async () => {
        const { input, output } = ttyPair('anything');
        await expect(
            runSmartOrderTask03cAuthorizationCli({
                appSupportRoot: await appSupport({ discovery: true }),
                authorizationDeadlineEpochMs: nowEpochMs + 30_000,
                envelope: envelope(),
                expectedApiGeneration: generation,
                input,
                output,
                now: () => nowEpochMs,
                notifyAuthorizationRequired: vi.fn(),
            }),
        ).rejects.toThrow('sidecar');
    });
});
