import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import {
    consumeSmartOrderTaskProbeReadonlyAuthority,
    runSmartOrderTaskProbeAdjacentRevalidation,
    runSmartOrderTaskProbeReadonlyPreflight,
    SMART_ORDER_TASK_PROBE_AUTHORIZATION_WINDOW_MS,
} from './task-probe-readonly-preflight.mjs';

const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});
const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256(account);
const nowEpochMs = Date.parse('2026-08-24T02:00:00.000Z');
const directories = [];

afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    );
});

function trade() {
    return {
        contract: {
            code: '2330',
            exchange: 'TSE',
            security_type: 'STK',
        },
        order: {
            account,
            action: 'Buy',
            id: 'same-run-trade',
            order_cond: 'Cash',
            order_lot: 'Common',
            order_type: 'ROD',
            ordno: '000001',
            price: 114.5,
            price_type: 'LMT',
            quantity: 1,
            seqno: '000001',
            custom_field: 'P3B001',
        },
        status: {
            status: 'Submitted',
            id: 'same-run-trade',
            order_quantity: 1,
            deal_quantity: 0,
            cancel_quantity: 0,
        },
    };
}

function contract() {
    return {
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
}

function snapshot(overrides = {}) {
    return [{
        code: '2330',
        exchange: 'TSE',
        datetime: new Date(nowEpochMs - 500).toISOString(),
        buy_price: 114.5,
        sell_price: 115,
        ...overrides,
    }];
}

function fetchFixture({
    snapshotDrift = false,
    snapshotTimeEpochMs = nowEpochMs - 500,
    generationInfo = true,
    tradePrice,
} = {}) {
    const counts = new Map();
    const fetchImpl = async (url, init = {}) => {
        const parsed = new URL(url);
        counts.set(parsed.pathname, (counts.get(parsed.pathname) ?? 0) + 1);
        let body;
        if (parsed.pathname === '/api/v1/info') body = { simulation: generationInfo };
        else if (parsed.pathname === '/api/v1/auth/accounts') {
            body = [{ ...account, signed: true }];
        } else if (parsed.pathname === '/api/v1/portfolio/position_unit') {
            expect(JSON.parse(init.body)).toEqual({ ...account, unit: 'Share' });
            body = [];
        } else if (parsed.pathname === '/api/v1/order/trades') {
            expect(JSON.parse(init.body)).toEqual(account);
            body = [
                tradePrice === undefined
                    ? trade()
                    : {
                          ...trade(),
                          order: { ...trade().order, price: tradePrice },
                      },
            ];
        } else if (parsed.pathname === '/api/v1/data/contracts/2330/info') {
            body = contract();
        } else if (parsed.pathname === '/api/v1/data/snapshots') {
            body = snapshot(
                snapshotDrift && counts.get(parsed.pathname) === 2
                    ? { buy_price: 114 }
                    : { datetime: new Date(snapshotTimeEpochMs).toISOString() },
            );
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
    fetchImpl.counts = counts;
    return fetchImpl;
}

async function appSupport() {
    const directory = await mkdtemp(path.join(tmpdir(), 'task-probe-readonly-'));
    directories.push(directory);
    await writeFile(path.join(directory, 'runtime-mode'), 'simulation\n', {
        mode: 0o600,
    });
    await writeFile(
        path.join(directory, 'runtime-api-generation'),
        'simulation:test-generation\n',
        { mode: 0o600 },
    );
    return realpath(directory);
}

function readiness(overrides = {}) {
    return {
        accountScopeSha256,
        current: true,
        evidenceSha256: `sha256:${'a'.repeat(64)}`,
        validUntilEpochMs: nowEpochMs + 10_000,
        ...overrides,
    };
}

describe('task-specific readonly market/account preflight', () => {
    it('keeps market evidence short-lived while reserving a five-minute authorization window', async () => {
        expect(SMART_ORDER_TASK_PROBE_AUTHORIZATION_WINDOW_MS).toBe(300_000);
        const result = await runSmartOrderTaskProbeReadonlyPreflight({
            appSupportRoot: await appSupport(),
            expectedApiGeneration: 'simulation:test-generation',
            observerReadiness: readiness({
                validUntilEpochMs: nowEpochMs + 360_000,
            }),
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        });
        expect(result.projection).toMatchObject({
            contract: { validUntilEpochMs: nowEpochMs + 30_000 },
            quote: { validUntilEpochMs: nowEpochMs + 30_000 },
            authorizationDisplayAllowed: true,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
        });
    });

    it('double-reads current account, contract, BBO and returns only redacted hashes', async () => {
        const result = await runSmartOrderTaskProbeReadonlyPreflight({
            appSupportRoot: await appSupport(),
            expectedApiGeneration: 'simulation:test-generation',
            observerReadiness: readiness(),
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        });
        expect(result.projection).toMatchObject({
            accountScopeSha256,
            accountRef: `…${accountScopeSha256.slice(-12)}`,
            tradeDate: '2026-08-24',
            contract: {
                referenceMinorUnits: 11_500,
                limitDownMinorUnits: 10_350,
                limitUpMinorUnits: 12_650,
            },
            quote: {
                bestBidMinorUnits: 11_450,
                bestAskMinorUnits: 11_500,
            },
            brokerAuthority: false,
            brokerWriteAttempted: false,
        });
        expect(JSON.stringify(result.projection)).not.toContain('SIM-ACCOUNT');
        expect(
            consumeSmartOrderTaskProbeReadonlyAuthority(result.authority),
        ).toMatchObject({ account, positions: [], trades: [trade()] });
        expect(() =>
            consumeSmartOrderTaskProbeReadonlyAuthority(result.authority),
        ).toThrow('consumed');
    });

    it.each([
        ['observer missing', { observerReadiness: readiness({ current: false }) }],
        ['observer account drift', { observerReadiness: readiness({ accountScopeSha256: `sha256:${'b'.repeat(64)}` }) }],
        ['API not simulation', { fetchImpl: fetchFixture({ generationInfo: false }) }],
    ])('fails closed on %s', async (_label, overrides) => {
        await expect(
            runSmartOrderTaskProbeReadonlyPreflight({
                appSupportRoot: await appSupport(),
                expectedApiGeneration: 'simulation:test-generation',
                observerReadiness: readiness(),
                fetchImpl: fetchFixture(),
                now: () => nowEpochMs,
                ...overrides,
            }),
        ).rejects.toThrow();
    });

    it('accepts a fresh BBO update while retaining exact account, contract, positions and orders', async () => {
        const result = await runSmartOrderTaskProbeReadonlyPreflight({
            appSupportRoot: await appSupport(),
            expectedApiGeneration: 'simulation:test-generation',
            observerReadiness: readiness(),
            fetchImpl: fetchFixture({ snapshotDrift: true }),
            now: () => nowEpochMs,
        });

        expect(result.projection.quote.bestBidMinorUnits).toBe(11_400);
        expect(result.projection.quote.bestAskMinorUnits).toBe(11_500);
        expect(result.projection.brokerWriteAttempted).toBe(false);
    });

    it('performs one bounded authorization-adjacent read set and accepts a sparse-market timestamp within the exact envelope lifetime', async () => {
        const appSupportRoot = await appSupport();
        const observerReadiness = readiness({
            validUntilEpochMs: nowEpochMs + 60_000,
        });
        const initial = await runSmartOrderTaskProbeReadonlyPreflight({
            appSupportRoot,
            expectedApiGeneration: 'simulation:test-generation',
            observerReadiness,
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        });
        const privateInitial = consumeSmartOrderTaskProbeReadonlyAuthority(
            initial.authority,
        );
        const adjacentFetch = fetchFixture();
        const adjacent = await runSmartOrderTaskProbeAdjacentRevalidation({
            appSupportRoot,
            expectedApiGeneration: 'simulation:test-generation',
            observerReadiness,
            priorProjection: initial.projection,
            account: privateInitial.account,
            fetchImpl: adjacentFetch,
            now: () => nowEpochMs + 40_000,
        });

        expect(adjacent.projection).toMatchObject({
            accountScopeSha256,
            authorizationDisplayAllowed: false,
            brokerWriteAttempted: false,
            brokerAuthority: false,
        });
        expect(adjacentFetch.counts.get('/api/v1/info')).toBe(1);
        expect(adjacentFetch.counts.get('/api/v1/auth/accounts')).toBeUndefined();
        expect(adjacentFetch.counts.get('/api/v1/portfolio/position_unit')).toBe(1);
        expect(adjacentFetch.counts.get('/api/v1/order/trades')).toBe(1);
        expect(adjacentFetch.counts.get('/api/v1/data/contracts/2330/info')).toBe(1);
        expect(adjacentFetch.counts.get('/api/v1/data/snapshots')).toBe(1);
        expect(
            consumeSmartOrderTaskProbeReadonlyAuthority(adjacent.authority),
        ).toMatchObject({ account, trades: [trade()] });
        await expect(
            runSmartOrderTaskProbeAdjacentRevalidation({
                appSupportRoot,
                expectedApiGeneration: 'simulation:test-generation',
                observerReadiness,
                priorProjection: initial.projection,
                account: privateInitial.account,
                fetchImpl: fetchFixture(),
                now: () => nowEpochMs + 41_000,
            }),
        ).rejects.toThrow('configuration is invalid');
    });

    it('accepts fresh authorization-adjacent evidence after the original market projection expires', async () => {
        const appSupportRoot = await appSupport();
        const observerReadiness = readiness({
            validUntilEpochMs: nowEpochMs + 360_000,
        });
        const initial = await runSmartOrderTaskProbeReadonlyPreflight({
            appSupportRoot,
            expectedApiGeneration: 'simulation:test-generation',
            observerReadiness,
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        });
        const privateInitial = consumeSmartOrderTaskProbeReadonlyAuthority(
            initial.authority,
        );
        const authorizationAcceptedAtEpochMs = nowEpochMs + 31_000;
        const adjacent = await runSmartOrderTaskProbeAdjacentRevalidation({
            appSupportRoot,
            expectedApiGeneration: 'simulation:test-generation',
            observerReadiness,
            priorProjection: initial.projection,
            account: privateInitial.account,
            fetchImpl: fetchFixture({
                snapshotTimeEpochMs: authorizationAcceptedAtEpochMs - 500,
            }),
            now: () => authorizationAcceptedAtEpochMs,
        });

        expect(initial.projection.quote.validUntilEpochMs).toBe(
            nowEpochMs + 30_000,
        );
        expect(adjacent.projection.quote.validUntilEpochMs).toBe(
            authorizationAcceptedAtEpochMs + 5_000,
        );
        expect(adjacent.projection.authorizationDisplayAllowed).toBe(false);
    });

    it('rejects a candidate-only projection even when a caller fabricates matching readiness fields', async () => {
        const appSupportRoot = await appSupport();
        const candidate = await runSmartOrderTaskProbeReadonlyPreflight({
            appSupportRoot,
            expectedApiGeneration: 'simulation:test-generation',
            candidateOnly: true,
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        });
        const privateCandidate = consumeSmartOrderTaskProbeReadonlyAuthority(
            candidate.authority,
        );

        await expect(
            runSmartOrderTaskProbeAdjacentRevalidation({
                appSupportRoot,
                expectedApiGeneration: 'simulation:test-generation',
                observerReadiness: {
                    accountScopeSha256,
                    current: true,
                    evidenceSha256: candidate.projection.observerReadinessSha256,
                    validUntilEpochMs: nowEpochMs + 60_000,
                },
                priorProjection: candidate.projection,
                account: privateCandidate.account,
                fetchImpl: fetchFixture(),
                now: () => nowEpochMs,
            }),
        ).rejects.toThrow('authority is stale or drifted');
    });

    it('rejects authorization-adjacent working-order drift without consuming broker authority', async () => {
        const appSupportRoot = await appSupport();
        const observerReadiness = readiness({
            validUntilEpochMs: nowEpochMs + 60_000,
        });
        const initial = await runSmartOrderTaskProbeReadonlyPreflight({
            appSupportRoot,
            expectedApiGeneration: 'simulation:test-generation',
            observerReadiness,
            fetchImpl: fetchFixture(),
            now: () => nowEpochMs,
        });
        const privateInitial = consumeSmartOrderTaskProbeReadonlyAuthority(
            initial.authority,
        );

        await expect(
            runSmartOrderTaskProbeAdjacentRevalidation({
                appSupportRoot,
                expectedApiGeneration: 'simulation:test-generation',
                observerReadiness,
                priorProjection: initial.projection,
                account: privateInitial.account,
                fetchImpl: fetchFixture({ tradePrice: 114 }),
                now: () => nowEpochMs + 1_000,
            }),
        ).rejects.toThrow('working orders drifted');
    });

    it('rejects stale exchange time, Proxy readiness and generation drift', async () => {
        const appSupportRoot = await appSupport();
        await expect(
            runSmartOrderTaskProbeReadonlyPreflight({
                appSupportRoot,
                expectedApiGeneration: 'simulation:test-generation',
                observerReadiness: readiness({
                    validUntilEpochMs: nowEpochMs + 60_000,
                }),
                fetchImpl: fetchFixture(),
                now: () => nowEpochMs + 31_000,
            }),
        ).rejects.toThrow();
        await expect(
            runSmartOrderTaskProbeReadonlyPreflight({
                appSupportRoot,
                expectedApiGeneration: 'simulation:test-generation',
                observerReadiness: new Proxy(readiness(), {}),
                fetchImpl: fetchFixture(),
                now: () => nowEpochMs,
            }),
        ).rejects.toThrow('non-Proxy');
        await expect(
            runSmartOrderTaskProbeReadonlyPreflight({
                appSupportRoot,
                expectedApiGeneration: 'simulation:other',
                observerReadiness: readiness(),
                fetchImpl: fetchFixture(),
                now: () => nowEpochMs,
            }),
        ).rejects.toThrow('generation');
    });
});
