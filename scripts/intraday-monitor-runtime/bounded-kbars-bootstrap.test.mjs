import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    TAIWAN_REGULAR_SESSION_CALENDAR_SCHEMA,
    issueTaiwanRegularSessionAuthority,
} from './minute-accumulator.mjs';
import {
    IntradayMonitorEvidenceRepository,
    resolveIntradayMonitorEvidenceDatabasePath,
} from './evidence-repository.mjs';
import {
    INTRADAY_MONITOR_BOOTSTRAP_POLICY_SCHEMA,
    createIntradayMonitorBoundedKbarsBootstrap,
    createLocalShioajiKbarsBootstrapProvider,
    issueIntradayMonitorBootstrapPolicy,
} from './bounded-kbars-bootstrap.mjs';

const roots = [];
const sessionNow = Date.parse('2026-09-04T10:30:30+08:00');

function repository() {
    const root = mkdtempSync(path.join(tmpdir(), 'intraday-bootstrap-'));
    roots.push(root);
    return new IntradayMonitorEvidenceRepository(
        resolveIntradayMonitorEvidenceDatabasePath(root),
    );
}

function authority(exchange = 'TSE', state = 'open') {
    return issueTaiwanRegularSessionAuthority(
        {
            schemaVersion: TAIWAN_REGULAR_SESSION_CALENDAR_SCHEMA,
            exchange,
            tradeDate: '2026-09-04',
            officialTradingDates: ['2026-09-03', '2026-09-04'],
            generatedAtEpochMs: sessionNow - 1_000,
            validUntilEpochMs: sessionNow + 60_000,
            sourceVersion: `sha256:${'a'.repeat(64)}`,
            sessionState: state,
            timeZone: 'Asia/Taipei',
        },
        sessionNow,
    );
}

function policy(overrides = {}) {
    return issueIntradayMonitorBootstrapPolicy({
        schemaVersion: INTRADAY_MONITOR_BOOTSTRAP_POLICY_SCHEMA,
        simulation: true,
        source: 'shioaji-kbars',
        sourceVersion: '1.7.1',
        requestSpacingMs: 260,
        perRequestTimeoutMs: 8_000,
        totalDeadlineMs: 75_000,
        maxContracts: 200,
        periodicPolling: false,
        ...overrides,
    });
}

function contract(code = '2330') {
    return {
        securityType: 'STK',
        region: 'TW',
        exchange: 'TSE',
        code,
        targetCode: null,
        canonicalSymbol: `${code}.TW`,
    };
}

function runInput(codes = ['2330']) {
    return {
        configRevision: 7,
        items: codes.map((code) => ({
            contract: contract(code),
            enabled: true,
            effectiveThreshold: { decimal: '1.5' },
        })),
        activationMinuteKey: '10:30',
    };
}

function combinedKbars(codes = ['2330']) {
    void codes;
    const rows = [
        ['2026-09-03T09:01:00', 10],
        ['2026-09-03T10:00:00', 5],
        ['2026-09-03T13:30:00', 5],
        ['2026-09-04T09:01:00', 20],
        ['2026-09-04T10:00:00', 10],
        ['2026-09-04T10:29:00', 5],
    ];
    return {
        datetime: rows.map(([datetime]) => datetime),
        Open: rows.map(() => 100),
        High: rows.map(() => 101),
        Low: rows.map(() => 99),
        Close: rows.map(() => 100),
        Volume: rows.map(([, volume]) => volume),
        Amount: rows.map(() => 1_000),
    };
}

function provider(body = combinedKbars(), coverageReceiptAvailable = false) {
    return {
        preflight: vi.fn(async () => ({ simulation: true, sourceVersion: '1.7.1' })),
        fetchKbars: vi.fn(async () => ({ ok: true, status: 200, body })),
        coverageReceiptAvailable,
    };
}

function bootstrap(options = {}) {
    let monotonic = 0;
    const sleeps = [];
    const repo = options.repository ?? repository();
    const instance = createIntradayMonitorBoundedKbarsBootstrap({
        policy: options.policy ?? policy(),
        sessionAuthorities: [authority()],
        provider: options.provider ?? provider(),
        repository: repo,
        coverageVerifier: options.coverageVerifier,
        sessionNowEpochMs: () => sessionNow,
        monotonicNowMs: () => monotonic,
        wallClockIso: () => '2026-09-04T10:30:31+08:00',
        sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
            monotonic += milliseconds;
        },
    });
    return { instance, repo, sleeps, advance: (milliseconds) => { monotonic += milliseconds; } };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('盤中監控一次性 Kbars bootstrap', () => {
    it('coverage receipt 完整時建立上一日 baseline、今日歷史 observation 與不通知的 historical trigger', async () => {
        const source = provider(combinedKbars(), true);
        const { instance, repo } = bootstrap({
            provider: source,
            coverageVerifier: () => true,
        });
        const result = await instance.run(runInput());

        expect(result).toMatchObject({
            configured: 1,
            baselineComplete: 1,
            todayBackfilled: 1,
            waitingBaseline: 0,
            historicalTriggerCount: 1,
            notificationDispatchAuthority: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
            requestPolicy: { periodicPolling: false },
        });
        expect(result.results[0].baseline).toMatchObject({
            requestedMinuteStart: '09:01',
            requestedMinuteEnd: '13:30',
            actualMinuteStart: '09:01',
            actualMinuteEnd: '13:30',
            expectedMinuteCount: 270,
            actualMinuteCount: 270,
            coverageReceipt: 'verified',
            completeness: 'complete',
        });
        expect(result.results[0].today).toMatchObject({
            requestedMinuteEnd: '10:29',
            expectedMinuteCount: 89,
            actualMinuteCount: 89,
            monitoringEffectiveFrom: '09:01',
            earlierMinutesBackfilled: true,
        });
        expect(repo.listTriggers('2026-09-04')).toHaveLength(1);
        expect(repo.listTriggers('2026-09-04')[0]).toMatchObject({
            kind: 'historical',
            minuteKey: '09:01',
            previousCumulativeVolume: 10,
            currentCumulativeVolume: 20,
        });
        expect(source.fetchKbars).toHaveBeenCalledOnce();
        repo.close();
    });

    it('Shioaji 無 coverage receipt 時保存 incomplete 與 activation 起點，不建立 observation、trigger 或估算', async () => {
        const { instance, repo } = bootstrap({ coverageVerifier: () => true });
        const result = await instance.run(runInput());

        expect(result).toMatchObject({
            baselineComplete: 0,
            todayBackfilled: 0,
            waitingBaseline: 1,
            monitoringEffectiveFromActivation: 1,
            historicalTriggerCount: 0,
        });
        expect(result.results[0].baseline).toMatchObject({
            coverageReceipt: 'unavailable',
            completeness: 'incomplete',
            reasonCode: 'coverage_unverified',
            actualMinuteCount: 3,
        });
        expect(result.results[0].today).toMatchObject({
            coverageReceipt: 'unavailable',
            completeness: 'incomplete',
            monitoringEffectiveFrom: '10:30',
            earlierMinutesBackfilled: false,
            reasonCode: 'coverage_unverified',
            actualMinuteCount: 3,
        });
        expect(repo.listTriggers('2026-09-04')).toEqual([]);
        expect(repo.readBootstrapManifest('today', '2330.TW', '2026-09-04'))
            .toEqual(result.results[0].today);
        repo.close();
    });

    it('多商品 request 採 start-to-start 260ms 節流且每檔只請求一次涵蓋兩日', async () => {
        let monotonic = 0;
        const starts = [];
        const repo = repository();
        const source = provider(combinedKbars(), true);
        source.fetchKbars.mockImplementation(async ({ start, end }) => {
            starts.push({ at: monotonic, start, end });
            return { ok: true, status: 200, body: combinedKbars() };
        });
        const instance = createIntradayMonitorBoundedKbarsBootstrap({
            policy: policy(),
            sessionAuthorities: [authority()],
            provider: source,
            repository: repo,
            coverageVerifier: () => false,
            sessionNowEpochMs: () => sessionNow,
            monotonicNowMs: () => monotonic,
            wallClockIso: () => '2026-09-04T10:30:31+08:00',
            sleep: async (milliseconds) => { monotonic += milliseconds; },
        });
        await instance.run(runInput(['2330', '2454', '2449']));
        expect(starts).toEqual([
            { at: 0, start: '2026-09-03', end: '2026-09-04' },
            { at: 260, start: '2026-09-03', end: '2026-09-04' },
            { at: 520, start: '2026-09-03', end: '2026-09-04' },
        ]);
        repo.close();
    });

    it('provider 忽略 abort 時仍由 hard timeout 有界結束並保存安全原因', async () => {
        const source = {
            preflight: async () => ({ simulation: true, sourceVersion: '1.7.1' }),
            fetchKbars: () => new Promise(() => {}),
        };
        const { instance, repo } = bootstrap({
            provider: source,
            policy: policy({ perRequestTimeoutMs: 5, totalDeadlineMs: 20, maxContracts: 1 }),
            coverageVerifier: () => false,
        });
        const result = await instance.run(runInput());
        expect(result.results[0]).toMatchObject({
            requestReason: 'request_timeout',
            baseline: {
                completeness: 'incomplete',
                actualMinuteCount: 0,
                reasonCode: 'request_timeout',
            },
            today: {
                completeness: 'incomplete',
                monitoringEffectiveFrom: '10:30',
                reasonCode: 'request_timeout',
            },
            historicalTriggerIds: [],
        });
        repo.close();
    });

    it('provider preflight 忽略 abort 時也由 hard timeout 有界拒絕', async () => {
        const source = {
            preflight: () => new Promise(() => {}),
            fetchKbars: vi.fn(),
        };
        const { instance, repo } = bootstrap({
            provider: source,
            policy: policy({ perRequestTimeoutMs: 5, totalDeadlineMs: 20, maxContracts: 1 }),
        });
        await expect(instance.run(runInput())).rejects.toThrow(
            'bootstrap provider preflight failed',
        );
        expect(source.fetchKbars).not.toHaveBeenCalled();
        repo.close();
    });

    it('同一批完整證據於不同 fetchedAt 重跑仍維持冪等', async () => {
        const repo = repository();
        const source = provider(combinedKbars(), true);
        let fetchedAt = '2026-09-04T10:30:31+08:00';
        const instance = createIntradayMonitorBoundedKbarsBootstrap({
            policy: policy(),
            sessionAuthorities: [authority()],
            provider: source,
            repository: repo,
            coverageVerifier: () => true,
            sessionNowEpochMs: () => sessionNow,
            monotonicNowMs: () => 0,
            wallClockIso: () => fetchedAt,
            sleep: async () => {},
        });
        const first = await instance.run(runInput());
        const firstRevision = repo.currentRevision();
        fetchedAt = '2026-09-04T10:31:31+08:00';
        const second = await instance.run(runInput());
        expect(second.results[0].baseline.payloadHash).toBe(
            first.results[0].baseline.payloadHash,
        );
        expect(repo.currentRevision()).toBe(firstRevision);
        expect(repo.listTriggers('2026-09-04')).toHaveLength(1);
        repo.close();
    });

    it('拒絕 production、週期 polling、超量及非 loopback provider', () => {
        expect(issueIntradayMonitorBootstrapPolicy({
            schemaVersion: INTRADAY_MONITOR_BOOTSTRAP_POLICY_SCHEMA,
            simulation: false,
            source: 'shioaji-kbars',
            sourceVersion: '1.7.1',
            requestSpacingMs: 260,
            perRequestTimeoutMs: 8_000,
            totalDeadlineMs: 75_000,
            maxContracts: 200,
            periodicPolling: false,
        })).toMatchObject({ issued: false, brokerWriteAuthority: false });
        expect(policy({ periodicPolling: true })).toMatchObject({ issued: false });
        expect(policy({ maxContracts: 201 })).toMatchObject({ issued: false });
        expect(() => createLocalShioajiKbarsBootstrapProvider({
            baseUrl: 'https://example.com',
        })).toThrow(/loopback/);
    });

    it('local provider preflight 必須實際確認 simulation 並只送固定 Kbars payload', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ simulation: true, version: '1.7.1' })))
            .mockResolvedValueOnce(new Response(JSON.stringify(combinedKbars())));
        const source = createLocalShioajiKbarsBootstrapProvider({ fetchImpl });
        expect(await source.preflight()).toEqual({ simulation: true, sourceVersion: '1.7.1' });
        const response = await source.fetchKbars({
            contract: contract(),
            start: '2026-09-03',
            end: '2026-09-04',
            signal: new AbortController().signal,
        });
        expect(response.ok).toBe(true);
        expect(fetchImpl.mock.calls[1][0]).toBe('http://127.0.0.1:8080/api/v1/data/kbars');
        expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
            contract: {
                security_type: 'STK',
                region: 'TW',
                exchange: 'TSE',
                code: '2330',
                target_code: null,
            },
            start: '2026-09-03',
            end: '2026-09-04',
        });
        expect(source).toMatchObject({
            coverageReceiptAvailable: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    });
});
