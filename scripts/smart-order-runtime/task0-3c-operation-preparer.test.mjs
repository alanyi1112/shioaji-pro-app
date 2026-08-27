import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    consumePreparedSmartOrderTask03cOperation,
    prepareSmartOrderTask03cCandidateOperation,
    prepareSmartOrderTask03cOperationAfterObserver,
} from './task0-3c-operation-preparer.mjs';

const account = {
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
};
const nowEpochMs = Date.parse('2026-08-27T02:00:00.000Z');
const roots = [];

afterEach(async () => {
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

async function appSupport() {
    const root = await mkdtemp(path.join(tmpdir(), 'task0-3c-preparer-'));
    roots.push(root);
    await writeFile(path.join(root, 'runtime-mode'), 'simulation\n', {
        mode: 0o600,
    });
    await writeFile(
        path.join(root, 'runtime-api-generation'),
        'simulation:test-generation\n',
        { mode: 0o600 },
    );
    return realpath(root);
}

function fetchFixture({ quantity = 7_000 } = {}) {
    return async (url, init = {}) => {
        const parsed = new URL(url);
        let body;
        if (parsed.pathname === '/api/v1/info') body = { simulation: true };
        else if (parsed.pathname === '/api/v1/auth/accounts') {
            body = [{ ...account, signed: true }];
        } else if (parsed.pathname === '/api/v1/portfolio/position_unit') {
            expect(JSON.parse(init.body)).toEqual({ ...account, unit: 'Share' });
            body = [
                {
                    id: 1,
                    code: '2330',
                    direction: 'Buy',
                    quantity,
                    price: 100,
                    last_price: 101,
                    pnl: 1_000,
                    yd_quantity: quantity,
                },
            ];
        } else if (parsed.pathname === '/api/v1/order/trades') {
            body = [];
        } else if (parsed.pathname === '/api/v1/data/contracts/2330/info') {
            body = {
                category: '24',
                code: '2330',
                exchange: 'TSE',
                limit_down: 103.5,
                limit_up: 126.5,
                reference: 115,
                security_type: 'STK',
                unit: 1_000,
                update_date: '2026-08-27',
            };
        } else if (parsed.pathname === '/api/v1/data/snapshots') {
            body = [
                {
                    code: '2330',
                    exchange: 'TSE',
                    datetime: new Date(nowEpochMs - 500).toISOString(),
                    buy_price: 114.5,
                    sell_price: 115,
                },
            ];
        } else {
            throw new Error(`unexpected fixture path ${parsed.pathname}`);
        }
        return {
            url,
            redirected: false,
            ok: true,
            headers: { get: () => 'application/json' },
            text: async () => JSON.stringify(body),
        };
    };
}

function input(appSupportRoot, fetchImpl = fetchFixture()) {
    return {
        appSupportRoot,
        expectedApiGeneration: 'simulation:test-generation',
        runId: '123e4567-e89b-42d3-a456-426614174650',
        operationId: '123e4567-e89b-42d3-a456-426614174651',
        nonce: '123e4567-e89b-42d3-a456-426614174652',
        operationOrdinal: 1,
        previousTargets: [],
        fetchImpl,
        now: () => nowEpochMs,
    };
}

describe('Task 0.3c operation preparer', () => {
    it('does not expose authorization until observer-ready revalidation passes', async () => {
        const appSupportRoot = await appSupport();
        const candidate = await prepareSmartOrderTask03cCandidateOperation(
            input(appSupportRoot),
        );
        expect(candidate).toMatchObject({
            operationOrdinal: 1,
            observerReady: false,
            authorizationDisplayAllowed: false,
            brokerWriteAttempted: false,
        });
        const prepared = await prepareSmartOrderTask03cOperationAfterObserver({
            candidateAuthority: candidate.candidateAuthority,
            observerReadiness: {
                accountScopeSha256: candidate.accountScopeSha256,
                current: true,
                evidenceSha256: `sha256:${'a'.repeat(64)}`,
                validUntilEpochMs: nowEpochMs + 30_000,
            },
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        });
        expect(prepared.publicSummary).toMatchObject({
            taskId: '0.3c',
            side: 'Sell',
            operationOrdinal: 1,
            quantityCommonLots: 1,
            baselineWorkingSellCount: 0,
            positionQuantityShares: 7_000,
        });
        const privatePrepared = consumePreparedSmartOrderTask03cOperation({
            preparedAuthority: prepared.preparedAuthority,
            nowEpochMs,
        });
        expect(privatePrepared.marketPlan.priceMinorUnits).toBeGreaterThan(
            privatePrepared.quote.bestAskMinorUnits,
        );
        expect(privatePrepared.marketPlan.priceMinorUnits).toBeLessThanOrEqual(
            privatePrepared.contract.limitUpMinorUnits,
        );
    });

    it('fails before authorization display when the position cannot cover two lots', async () => {
        await expect(
            prepareSmartOrderTask03cCandidateOperation(
                input(await appSupport(), fetchFixture({ quantity: 1_000 })),
            ),
        ).rejects.toThrow('position');
    });
});
