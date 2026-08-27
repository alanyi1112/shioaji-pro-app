import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import {
    consumePreparedSmartOrderTask03bOperation,
    prepareSmartOrderTask03bCandidateOperation,
    prepareSmartOrderTask03bOperation,
    prepareSmartOrderTask03bOperationAfterObserver,
} from './task0-3b-operation-preparer.mjs';

const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});
const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256(account);
const nowEpochMs = Date.parse('2026-08-24T02:00:00.000Z');
const runId = '123e4567-e89b-42d3-a456-426614174000';
const directories = [];

afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    );
});

function trade(price = 114.5) {
    return {
        contract: { code: '2330', exchange: 'TSE', security_type: 'STK' },
        order: {
            account,
            action: 'Buy',
            id: 'same-run-trade',
            order_cond: 'Cash',
            order_lot: 'Common',
            order_type: 'ROD',
            ordno: '000001',
            price,
            price_type: 'LMT',
            quantity: 1,
            seqno: '000001',
            custom_field: 'A1B2C3',
        },
        status: {
            cancel_quantity: 0,
            deal_quantity: 0,
            id: 'same-run-order',
            order_quantity: 1,
            status: 'Submitted',
        },
    };
}

function fetchFixture({ buyPrice = 115, sellPrice = 115.5 } = {}) {
    return async (url) => {
        const parsed = new URL(url);
        let body;
        if (parsed.pathname === '/api/v1/info') body = { simulation: true };
        else if (parsed.pathname === '/api/v1/auth/accounts') {
            body = [{ ...account, signed: true }];
        } else if (parsed.pathname === '/api/v1/portfolio/position_unit') body = [];
        else if (parsed.pathname === '/api/v1/order/trades') body = [trade()];
        else if (parsed.pathname === '/api/v1/data/contracts/2330/info') {
            body = {
                category: '24',
                code: '2330',
                exchange: 'TSE',
                limit_down: 103.5,
                limit_up: 126.5,
                reference: 115,
                security_type: 'STK',
                unit: 1_000,
                update_date: '2026-08-24',
            };
        } else if (parsed.pathname === '/api/v1/data/snapshots') {
            body = [{
                code: '2330',
                exchange: 'TSE',
                datetime: new Date(nowEpochMs - 500).toISOString(),
                buy_price: buyPrice,
                sell_price: sellPrice,
            }];
        } else throw new Error(`unexpected ${parsed.pathname}`);
        return {
            url,
            redirected: false,
            ok: true,
            headers: { get: () => 'application/json' },
            text: async () => JSON.stringify(body),
        };
    };
}

async function appSupport() {
    const directory = await mkdtemp(path.join(tmpdir(), 'task03b-prepare-'));
    directories.push(directory);
    await writeFile(path.join(directory, 'runtime-mode'), 'simulation\n', { mode: 0o600 });
    await writeFile(
        path.join(directory, 'runtime-api-generation'),
        'simulation:test-generation\n',
        { mode: 0o600 },
    );
    return realpath(directory);
}

function readiness() {
    return {
        accountScopeSha256,
        current: true,
        evidenceSha256: `sha256:${'a'.repeat(64)}`,
        validUntilEpochMs: nowEpochMs + 10_000,
    };
}

function privateTarget(overrides = {}) {
    return {
        schemaVersion: 'smart-order-task-0.3b-target-lineage/2026-08-24.1',
        originRunId: runId,
        targetIdSha256: `sha256:${'2'.repeat(64)}`,
        targetRevision: `sha256:${'3'.repeat(64)}`,
        accountScopeSha256,
        tradeDate: '2026-08-24',
        revision: 0,
        priceMinorUnits: 11_450,
        tradeId: 'same-run-trade',
        orderId: 'same-run-order',
        seqno: '000001',
        ordno: '000001',
        customField: 'A1B2C3',
        contractUnit: 1_000,
        status: 'Submitted',
        ...overrides,
    };
}

async function prepare(operation, target = null) {
    return prepareSmartOrderTask03bOperation({
        appSupportRoot: await appSupport(),
        expectedApiGeneration: 'simulation:test-generation',
        observerReadiness: readiness(),
        runId,
        operationId: '123e4567-e89b-42d3-a456-426614174002',
        nonce: '123e4567-e89b-42d3-a456-426614174003',
        operation,
        target,
        fetchImpl: fetchFixture(),
        now: () => nowEpochMs,
    });
}

describe('Task 0.3b production operation preparer', () => {
    it('keeps candidate details hidden until observer-ready revalidation matches', async () => {
        const appSupportRoot = await appSupport();
        const common = {
            appSupportRoot,
            expectedApiGeneration: 'simulation:test-generation',
            runId,
            operationId: '123e4567-e89b-42d3-a456-426614174002',
            nonce: '123e4567-e89b-42d3-a456-426614174003',
            operation: 'place',
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        };
        const candidate = await prepareSmartOrderTask03bCandidateOperation(common);
        expect(candidate).toMatchObject({
            observerReady: false,
            authorizationDisplayAllowed: false,
            brokerAuthority: false,
        });
        expect(JSON.stringify(candidate)).not.toContain('114.5');
        const prepared = await prepareSmartOrderTask03bOperationAfterObserver({
            candidateAuthority: candidate.candidateAuthority,
            observerReadiness: readiness(),
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        });
        expect(prepared.publicSummary).toMatchObject({ price: '114.5' });
    });

    it('prepares exact dynamic P1 only after observer and double-read preflight', async () => {
        const result = await prepare('place');
        expect(result.publicSummary).toMatchObject({
            operation: 'place',
            price: '114.5',
            accountRef: `…${accountScopeSha256.slice(-12)}`,
            brokerWriteAttempted: false,
        });
        const consumed = consumePreparedSmartOrderTask03bOperation({
            preparedAuthority: result.preparedAuthority,
            nowEpochMs,
        });
        expect(consumed.operationContract.canonical.request.payload.stock_order).toMatchObject({
            price: 114.5,
            account,
        });
        expect(() =>
            consumePreparedSmartOrderTask03bOperation({
                preparedAuthority: result.preparedAuthority,
                nowEpochMs,
            }),
        ).toThrow('consumed');
    });

    it('keeps the exact candidate request stable across safe BBO movement after observer readiness', async () => {
        const appSupportRoot = await appSupport();
        const candidate = await prepareSmartOrderTask03bCandidateOperation({
            appSupportRoot,
            expectedApiGeneration: 'simulation:test-generation',
            runId,
            operationId: '123e4567-e89b-42d3-a456-426614174002',
            nonce: '123e4567-e89b-42d3-a456-426614174003',
            operation: 'place',
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        });
        const prepared = await prepareSmartOrderTask03bOperationAfterObserver({
            candidateAuthority: candidate.candidateAuthority,
            observerReadiness: readiness(),
            fetchImpl: fetchFixture({ buyPrice: 115.5, sellPrice: 116 }),
            now: () => nowEpochMs + 1_000,
        });
        expect(prepared.publicSummary.price).toBe('114.5');
        const consumed = consumePreparedSmartOrderTask03bOperation({
            preparedAuthority: prepared.preparedAuthority,
            nowEpochMs: nowEpochMs + 1_000,
        });
        expect(
            consumed.operationContract.canonical.envelope.requestSha256,
        ).toBe(candidate.requestSha256);
    });

    it('rejects the fixed candidate request when fresh BBO makes it marketable', async () => {
        const appSupportRoot = await appSupport();
        const candidate = await prepareSmartOrderTask03bCandidateOperation({
            appSupportRoot,
            expectedApiGeneration: 'simulation:test-generation',
            runId,
            operationId: '123e4567-e89b-42d3-a456-426614174002',
            nonce: '123e4567-e89b-42d3-a456-426614174003',
            operation: 'place',
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        });
        await expect(
            prepareSmartOrderTask03bOperationAfterObserver({
                candidateAuthority: candidate.candidateAuthority,
                observerReadiness: readiness(),
                fetchImpl: fetchFixture({ buyPrice: 114, sellPrice: 114.5 }),
                now: () => nowEpochMs + 1_000,
            }),
        ).rejects.toThrow('purpose drifted');
    });

    it('prepares exact P2 and cancel only for the supplied same-run target', async () => {
        const updated = await prepare('update_price', privateTarget());
        expect(updated.publicSummary).toMatchObject({
            operation: 'update_price',
            price: '114',
            target: { revision: 0 },
        });
        const cancelled = await prepare(
            'cancel',
            privateTarget({ priceMinorUnits: 11_400, revision: 1 }),
        );
        expect(cancelled.publicSummary).toMatchObject({
            operation: 'cancel',
            price: null,
            target: { revision: 1 },
        });
    });

    it('rejects target confusion and expiration without broker authority', async () => {
        await expect(prepare('place', privateTarget())).rejects.toThrow('target');
        await expect(prepare('update_price', null)).rejects.toThrow('target');
        const result = await prepare('place');
        expect(() =>
            consumePreparedSmartOrderTask03bOperation({
                preparedAuthority: result.preparedAuthority,
                nowEpochMs: nowEpochMs + 300_001,
            }),
        ).toThrow('expired');
    });
});
