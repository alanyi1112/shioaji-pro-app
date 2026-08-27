import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import {
    SMART_ORDER_TASK0_7_MAX_EVIDENCE_AGE_MS,
    currentSmartOrderTask0_7UnitCapabilityFingerprints,
    runSmartOrderTask0_7UnitCapabilityProbe,
    verifySmartOrderTask0_7UnitCapabilityEvidence,
} from './smart-order-task0-7-unit-capability.mjs';

const roots = [];
const NOW = Date.parse('2026-08-22T12:00:00+08:00');

afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

async function privateAppSupport() {
    const root = await mkdtemp(path.join(tmpdir(), 'task0-7-unit-'));
    roots.push(root);
    await chmod(root, 0o700);
    await writeFile(path.join(root, 'runtime-mode'), 'simulation\n', { mode: 0o600 });
    await writeFile(
        path.join(root, 'runtime-api-generation'),
        'simulation:generation-1\n',
        { mode: 0o600 },
    );
    return realpath(root);
}

function account(overrides = {}) {
    return {
        broker_id: 'sensitive-broker',
        account_id: 'sensitive-account',
        account_type: 'S',
        signed: true,
        ...overrides,
    };
}

function contract(code, overrides = {}) {
    return {
        category: code === '0050' ? '00' : '24',
        code,
        exchange: 'TSE',
        limit_down: 90,
        limit_up: 110,
        reference: 100,
        security_type: 'STK',
        unit: code === '0050' ? 1_000 : 500,
        update_date: '2026-08-22',
        ...overrides,
    };
}

function position(overrides = {}) {
    return {
        id: 1,
        code: '2330',
        direction: 'Buy',
        quantity: 500,
        price: 100,
        last_price: 101,
        pnl: 500,
        yd_quantity: 500,
        ...overrides,
    };
}

function commonTrade(fixedAccount = account(), overrides = {}) {
    return {
        contract: {
            code: '2330',
            exchange: 'TSE',
            security_type: 'STK',
        },
        order: {
            account: {
                broker_id: fixedAccount.broker_id,
                account_id: fixedAccount.account_id,
                account_type: fixedAccount.account_type,
            },
            order_lot: 'Common',
            quantity: 1,
            ...overrides.order,
        },
        status: {
            order_quantity: 1,
            status: 'Submitted',
            ...overrides.status,
        },
    };
}

function positionOpenApi(overrides = {}) {
    const unitEnum = overrides.unitEnum ?? ['Common', 'Share'];
    return {
        paths: {
            '/api/v1/portfolio/position_unit': {
                post: {
                    operationId: 'get_positions',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/shioaji.server.http.portf.PositionRequest',
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'array',
                                        items: {
                                            $ref: '#/components/schemas/shioaji.api.api_v1.portf.positions.Position',
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        components: {
            schemas: {
                'shioaji.server.http.portf.PositionRequest': {
                    allOf: [
                        {
                            $ref: '#/components/schemas/shioaji.server.http.types.AccountRequest',
                        },
                        {
                            type: 'object',
                            properties: {
                                unit: {
                                    $ref: '#/components/schemas/shioaji.api.api_v1.portf.positions.Unit',
                                },
                            },
                        },
                    ],
                },
                'shioaji.api.api_v1.portf.positions.Unit': {
                    type: 'string',
                    enum: unitEnum,
                },
                'shioaji.api.api_v1.portf.positions.Position': {
                    oneOf: [
                        {
                            $ref: '#/components/schemas/shioaji.api.api_v1.portf.positions.StockPosition',
                        },
                    ],
                },
                'shioaji.api.api_v1.portf.positions.StockPosition': {
                    required: ['quantity', 'yd_quantity'],
                    properties: {
                        quantity: { type: 'integer', format: 'int32' },
                        yd_quantity: { type: 'integer', format: 'int32' },
                    },
                },
            },
        },
    };
}

function jsonResponse(url, value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return {
        url,
        redirected: false,
        ok: true,
        headers: new Headers({
            'content-type': 'application/json',
            'content-length': String(bytes.byteLength),
        }),
        async arrayBuffer() {
            return bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            );
        },
    };
}

function fixtureFetch(scenario = {}) {
    const fixedAccount = scenario.account ?? account();
    const calls = [];
    let infoReads = 0;
    let positionReads = 0;
    let stockReads = 0;
    let tradeReads = 0;
    let openApiReads = 0;
    const fetchImpl = vi.fn(async (url, init = {}) => {
        calls.push({ url, init });
        const parsed = new URL(url);
        if (parsed.pathname === '/openapi.json') {
            openApiReads += 1;
            return jsonResponse(
                url,
                positionOpenApi({
                    unitEnum:
                        scenario.openApiAfterDrift && openApiReads === 2
                            ? ['Common']
                            : scenario.positionUnitEnum,
                }),
            );
        }
        if (parsed.pathname === '/api/v1/info') {
            infoReads += 1;
            return jsonResponse(url, {
                protocols: ['http', 'sse'],
                simulation: true,
                version: 'v1.7.1',
                ...(scenario.infoAfterDrift && infoReads === 2
                    ? { version: 'v1.7.2' }
                    : {}),
            });
        }
        if (parsed.pathname === '/api/v1/auth/accounts') {
            return jsonResponse(url, [fixedAccount]);
        }
        if (parsed.pathname === '/api/v1/portfolio/position_unit') {
            positionReads += 1;
            const body = JSON.parse(init.body);
            if (body.unit !== 'Share') throw new Error('unit was not Share');
            return jsonResponse(url, [
                position(
                    scenario.positionAfterDrift && positionReads === 2
                        ? { quantity: 1_000 }
                        : scenario.positionOverrides,
                ),
            ]);
        }
        if (parsed.pathname === '/api/v1/order/trades') {
            tradeReads += 1;
            return jsonResponse(
                url,
                scenario.trades ?? [
                    commonTrade(fixedAccount, {
                        ...scenario.tradeOverrides,
                        ...(scenario.tradeAfterDrift && tradeReads === 2
                            ? { order: { quantity: 2 } }
                            : {}),
                    }),
                ],
            );
        }
        if (parsed.pathname === '/api/v1/data/contracts/2330/info') {
            stockReads += 1;
            return jsonResponse(
                url,
                contract('2330', {
                    ...scenario.stockOverrides,
                    ...(scenario.stockAfterDrift && stockReads === 2
                        ? { unit: 1_000 }
                        : {}),
                }),
            );
        }
        if (parsed.pathname === '/api/v1/data/contracts/0050/info') {
            return jsonResponse(url, contract('0050', scenario.etfOverrides));
        }
        throw new Error(`unexpected ${init.method ?? 'GET'} ${parsed.pathname}`);
    });
    return { calls, fetchImpl };
}

function authority(fetchImpl, options = {}) {
    let attestations = 0;
    return {
        fetchImpl,
        async acquireSharedLease() {
            return {
                acquired: true,
                mode: 'shared',
                brokerAuthority: false,
                async close() {},
            };
        },
        processAttestor: {
            async attest() {
                attestations += 1;
                return {
                    processStartIdentitySha256:
                        options.processDrift && attestations === 2
                            ? 'b'.repeat(64)
                            : 'a'.repeat(64),
                };
            },
        },
        isManagedAttestation: () => true,
    };
}

async function runFixture(scenario = {}, authorityOptions = {}) {
    const root = await privateAppSupport();
    const { calls, fetchImpl } = fixtureFetch(scenario);
    vi.stubGlobal('fetch', fetchImpl);
    const report = await runSmartOrderTask0_7UnitCapabilityProbe({
        appSupportRoot: root,
        authority: authority(fetchImpl, authorityOptions),
        nowEpochMs: () => NOW,
        runId: '00000000-0000-4000-8000-000000000007',
    });
    return { calls, report, root };
}

function rehash(report) {
    report.resultHash = createHash('sha256')
        .update(canonicalJson({ ...report, resultHash: '' }))
        .digest('hex');
    return report;
}

describe('Task 0.7 Share/CommonLot live-readonly capability evidence', () => {
    it('produces a redacted current report from stable Share positions, Common orders and stock/ETF metadata', async () => {
        const { calls, report } = await runFixture();
        expect(report).toMatchObject({
            executionMode: 'managed-live-readonly',
            evidenceClass: 'task0_7_unit_capability',
            accountIdentifiersPersisted: false,
            overall: 'pass',
            network: {
                requestCount: 13,
                accountingReads: 13,
                brokerWritesAttempted: 0,
                brokerWritesNetworked: 0,
            },
            sourceProjection: {
                positionsUnit: 'Share',
                positionApiContractSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                commonOrderUnit: 'CommonLot',
                commonOrderCommonLots: 1,
                commonOrderContractUnit: 500,
                commonOrderQuantityShares: 500,
                commonOrderStatus: 'Submitted',
                commonOrderStatusQuantityCommonLots: 1,
                stock: {
                    code: '2330',
                    kind: 'stock',
                    categoryCode: '24',
                    contractUnit: 500,
                    referenceMinorUnits: 10_000,
                    limitDownMinorUnits: 9_000,
                    limitUpMinorUnits: 11_000,
                    updateDate: '2026-08-22',
                },
                etf: {
                    code: '0050',
                    kind: 'etf',
                    categoryCode: '00',
                    contractUnit: 1_000,
                },
            },
        });
        const serialized = JSON.stringify(report);
        expect(serialized).not.toContain('sensitive-account');
        expect(serialized).not.toContain('sensitive-broker');
        expect(calls.every(({ url }) => !url.includes('/api/v1/order/place'))).toBe(true);
        expect(
            calls
                .filter(({ url }) => url.includes('position_unit'))
                .every(({ init }) => JSON.parse(init.body).unit === 'Share'),
        ).toBe(true);
        const verified = verifySmartOrderTask0_7UnitCapabilityEvidence({
            report,
            expectedSourceMatrixSha256: report.fingerprint.sourceMatrixSha256,
            nowEpochMs: NOW,
        });
        expect(verified).toMatchObject({ eligible: true, evidenceId: report.runId });
    });

    it.each([
        ['fractional contract unit', { stockOverrides: { unit: 500.5 } }],
        ['invalid category', { etfOverrides: { category: 'ETF' } }],
        ['inconsistent limits', { stockOverrides: { reference: 80 } }],
        ['stale update date', { etfOverrides: { update_date: '2026-08-07' } }],
        ['fractional Share position', { positionOverrides: { quantity: 500.5 } }],
        ['OpenAPI without Share unit', { positionUnitEnum: ['Common'] }],
        ['missing Common order', { trades: [] }],
        [
            'fractional Common status quantity',
            { tradeOverrides: { status: { order_quantity: 0.5 } } },
        ],
        [
            'foreign account Common order',
            { trades: [commonTrade(account({ account_id: 'foreign' }))] },
        ],
    ])('fails closed for %s', async (_label, scenario) => {
        await expect(runFixture(scenario)).rejects.toThrow();
    });

    it.each([
        ['Share position snapshot drift', { positionAfterDrift: true }, {}],
        ['canonical metadata drift', { stockAfterDrift: true }, {}],
        ['Common order quantity drift', { tradeAfterDrift: true }, {}],
        ['position OpenAPI drift', { openApiAfterDrift: true }, {}],
        ['API fingerprint drift', { infoAfterDrift: true }, {}],
        ['managed process drift', {}, { processDrift: true }],
    ])('fails closed for %s during the bounded window', async (_label, scenario, options) => {
        await expect(runFixture(scenario, options)).rejects.toThrow();
    });

    it('rejects stale, replayed, forged, source-drift and duplicate-check reports independently', async () => {
        const { report } = await runFixture();
        const expected = report.fingerprint.sourceMatrixSha256;
        const cases = [];

        const stale = structuredClone(report);
        stale.generatedAt = new Date(
            NOW - SMART_ORDER_TASK0_7_MAX_EVIDENCE_AGE_MS - 1,
        ).toISOString();
        cases.push(rehash(stale));

        const forged = structuredClone(report);
        forged.sourceProjection.stock.contractUnit = 1_000;
        cases.push(forged);

        const sourceDrift = structuredClone(report);
        sourceDrift.fingerprint.sourceMatrixSha256 = 'f'.repeat(64);
        cases.push(rehash(sourceDrift));

        const duplicate = structuredClone(report);
        duplicate.checks.push(structuredClone(duplicate.checks[0]));
        cases.push(rehash(duplicate));

        const writeObserved = structuredClone(report);
        writeObserved.network.brokerWritesAttempted = 1;
        cases.push(rehash(writeObserved));

        for (const candidate of cases) {
            expect(
                verifySmartOrderTask0_7UnitCapabilityEvidence({
                    report: candidate,
                    expectedSourceMatrixSha256: expected,
                    nowEpochMs: NOW,
                }).eligible,
            ).toBe(false);
        }
    });

    it('binds verification to the current production parser/observer/adapter source matrix', async () => {
        const current = await currentSmartOrderTask0_7UnitCapabilityFingerprints();
        expect(current.sources.map(({ path: sourcePath }) => sourcePath)).toEqual([
            'scripts/smart-order-task0-7-unit-probe',
            'scripts/smart-order-task0-7-unit-capability.mjs',
            'scripts/smart-order-runtime/canonical-stock-unit-contract.mjs',
            'scripts/smart-order-runtime/shioaji-trade-observer.mjs',
            'scripts/smart-order-runtime/node-safe-broker-adapter.mjs',
            'scripts/smart-order-runtime/node-safe-broker-target.mjs',
        ]);
        expect(current.sourceMatrixSha256).toMatch(/^[a-f0-9]{64}$/);
    });
});
