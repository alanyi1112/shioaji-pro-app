import { describe, expect, it } from 'vitest';
import {
    INTRADAY_MONITOR_BASELINE_SCHEMA,
    INTRADAY_MONITOR_BOOTSTRAP_MANIFEST_SCHEMA,
    INTRADAY_MONITOR_CAPACITY_SCHEMA,
    INTRADAY_MONITOR_CONFIG_SCHEMA,
    INTRADAY_MONITOR_LEASE_SCHEMA,
    INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT,
    INTRADAY_MONITOR_OBSERVATION_SCHEMA,
    INTRADAY_MONITOR_REQUIRED_HEADROOM,
    INTRADAY_MONITOR_TRIGGER_SCHEMA,
    isIntradayMonitorBaseline,
    isIntradayMonitorBootstrapManifest,
    isIntradayMonitorCapacityStatus,
    isIntradayMonitorMinuteObservation,
    isIntradayMonitorPageLease,
    isIntradayMonitorTriggerEvent,
    isTaiwanRegularLotStockContract,
    parseIntradayThreshold,
    parseTaiwanRegularLotStockContract,
    validateIntradayMonitorConfig,
} from './intraday-relative-volume-monitor-domain';

const tse = (code: string) => ({
    security_type: 'STK',
    region: 'TW',
    exchange: 'TSE',
    code,
    target_code: null,
});

const item = (code: string, thresholdOverride: string | null = null) => ({
    contract: tse(code),
    enabled: true,
    thresholdOverride,
    source: 'manual',
});

const draft = (items = [item('2330')]) => ({
    schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
    revision: 7,
    globalThreshold: '1.50',
    items,
});

describe('盤中相對成交量監控 domain', () => {
    it('以精確百分之一解析 1.00–100.00 門檻，不接受 exponent、負數或多餘小數', () => {
        expect(parseIntradayThreshold('1.00')).toEqual({
            decimal: '1',
            hundredths: 100,
        });
        expect(parseIntradayThreshold('1.5')).toEqual({
            decimal: '1.5',
            hundredths: 150,
        });
        expect(parseIntradayThreshold('100.00')).toEqual({
            decimal: '100',
            hundredths: 10_000,
        });
        for (const value of ['0.99', '100.01', '1.001', '-1', '1e2', 1.5]) {
            expect(parseIntradayThreshold(value)).toBeNull();
        }
    });

    it('只接受已解析的 TW STK 整股 contract，固定 canonical symbol', () => {
        const normalized = parseTaiwanRegularLotStockContract(tse('2330'));
        expect(normalized).toEqual({
            securityType: 'STK',
            region: 'TW',
            exchange: 'TSE',
            code: '2330',
            targetCode: null,
            canonicalSymbol: '2330.TW',
        });
        expect(isTaiwanRegularLotStockContract(normalized)).toBe(true);
        expect(isTaiwanRegularLotStockContract(tse('2330'))).toBe(false);
        expect(
            parseTaiwanRegularLotStockContract({
                ...tse('6547'),
                exchange: 'OTC',
            }),
        ).toMatchObject({ canonicalSymbol: '6547.TWO' });
        expect(
            parseTaiwanRegularLotStockContract({
                ...tse('2330'),
                security_type: 'IND',
            }),
        ).toBeNull();
        expect(
            parseTaiwanRegularLotStockContract({ ...tse('2330'), extra: true }),
        ).toBeNull();
    });

    it('原子正規化設定、保留輸入順序並套用逐商品門檻', () => {
        const result = validateIntradayMonitorConfig(
            draft([item('2454', '3.00'), item('2330')]),
            7,
        );
        expect(result).toMatchObject({
            ok: true,
            value: {
                revision: 7,
                globalThreshold: '1.5',
                items: [
                    {
                        position: 0,
                        contract: { canonicalSymbol: '2454.TW' },
                        thresholdOverride: '3',
                        effectiveThreshold: {
                            decimal: '3',
                            hundredths: 300,
                            source: 'item_override',
                        },
                    },
                    {
                        position: 1,
                        contract: { canonicalSymbol: '2330.TW' },
                        thresholdOverride: null,
                        effectiveThreshold: {
                            decimal: '1.5',
                            hundredths: 150,
                            source: 'global',
                        },
                    },
                ],
            },
        });
    });

    it('接受恰好 200 檔，201 檔、重複、非法 contract 或 revision conflict 都整筆拒絕', () => {
        const twoHundred = Array.from({ length: 200 }, (_, index) =>
            item(String(1000 + index)),
        );
        expect(validateIntradayMonitorConfig(draft(twoHundred))).toMatchObject({
            ok: true,
            value: { items: { length: 200 } },
        });
        expect(
            validateIntradayMonitorConfig(
                draft([...twoHundred, item('1200')]),
            ),
        ).toMatchObject({
            ok: false,
            errors: expect.arrayContaining([{ path: '$.items', code: 'too_many_items' }]),
        });
        expect(
            validateIntradayMonitorConfig(draft([item('2330'), item('2330')])),
        ).toMatchObject({
            ok: false,
            errors: expect.arrayContaining([
                { path: '$.items[1].contract', code: 'duplicate_contract' },
            ]),
        });
        expect(
            validateIntradayMonitorConfig(
                draft([item('2330'), { ...item('2454'), contract: { ...tse('2454'), security_type: 'WRT' } }]),
            ),
        ).toMatchObject({ ok: false });
        expect(validateIntradayMonitorConfig(draft(), 8)).toMatchObject({
            ok: false,
            errors: [{ path: '$.revision', code: 'revision_conflict' }],
        });
    });

    it('版本化 runtime schema 拒絕未知欄位、不明單位與不合法時間', () => {
        const observation = {
            schemaVersion: INTRADAY_MONITOR_OBSERVATION_SCHEMA,
            contract: parseTaiwanRegularLotStockContract(tse('2330'))!,
            tradeDate: '2026-09-04',
            minuteKey: '12:46',
            exchangeTime: '12:46:54.249715',
            receivedTime: '2026-09-04T12:46:54.300000+08:00',
            connectionGeneration: 'generation_000001',
            sequence: 1,
            cumulativeVolume: 68971,
            unit: 'common_lot',
            source: 'shioaji-tick-stk',
            sourceVersion: '1.7.1',
            simtrade: false,
            intradayOdd: false,
            continuity: 'complete',
        };
        expect(isIntradayMonitorMinuteObservation(observation)).toBe(true);
        expect(
            isIntradayMonitorMinuteObservation({ ...observation, unit: 'share' }),
        ).toBe(false);
        expect(
            isIntradayMonitorMinuteObservation({ ...observation, extra: true }),
        ).toBe(false);

        const lease = {
            schemaVersion: INTRADAY_MONITOR_LEASE_SCHEMA,
            leaseId: 'lease_0000000001',
            clientId: 'client_000000001',
            generation: 'generation_000001',
            acquiredAt: '2026-09-04T12:00:00+08:00',
            expiresAt: '2026-09-04T12:00:30+08:00',
        };
        expect(isIntradayMonitorPageLease(lease)).toBe(true);
        expect(
            isIntradayMonitorPageLease({
                ...lease,
                expiresAt: lease.acquiredAt,
            }),
        ).toBe(false);
    });

    it('baseline 強制分鐘遞增與累積量單調，trigger 強制非零分母', () => {
        const baseline = {
            schemaVersion: INTRADAY_MONITOR_BASELINE_SCHEMA,
            canonicalSymbol: '2330.TW',
            tradeDate: '2026-09-03',
            timeZone: 'Asia/Taipei',
            source: 'shioaji-kbars',
            sourceVersion: '1.7.1',
            sourceUnit: 'common_lot',
            canonicalUnit: 'common_lot',
            expectedMinuteCount: 270,
            completeness: 'complete',
            rows: [
                { minuteKey: '09:01', cumulativeVolume: 10, provenance: 'observed' },
                { minuteKey: '09:02', cumulativeVolume: 10, provenance: 'carry_forward' },
            ],
            payloadHash: 'a'.repeat(64),
            fetchedAt: '2026-09-04T08:00:00+08:00',
        };
        expect(isIntradayMonitorBaseline(baseline)).toBe(true);
        expect(
            isIntradayMonitorBaseline({
                ...baseline,
                rows: [...baseline.rows, { minuteKey: '09:03', cumulativeVolume: 9, provenance: 'observed' }],
            }),
        ).toBe(false);

        const trigger = {
            schemaVersion: INTRADAY_MONITOR_TRIGGER_SCHEMA,
            eventId: 'trigger_000000001',
            eventHash: 'b'.repeat(64),
            kind: 'live',
            tradeDate: '2026-09-04',
            baselineTradeDate: '2026-09-03',
            canonicalSymbol: '2330.TW',
            exchange: 'TSE',
            minuteKey: '12:46',
            configRevision: 7,
            threshold: '1.5',
            currentCumulativeVolume: 150,
            previousCumulativeVolume: 100,
            unit: 'common_lot',
            sourceVersion: '1.7.1',
            formulaVersion: 'intraday-relative-volume/1',
            completeness: 'complete',
            createdAt: '2026-09-04T12:47:00+08:00',
        };
        expect(isIntradayMonitorTriggerEvent(trigger)).toBe(true);
        expect(
            isIntradayMonitorTriggerEvent({
                ...trigger,
                previousCumulativeVolume: 0,
            }),
        ).toBe(false);
    });

    it('bootstrap manifest 分開保存實際涵蓋、完整度與今日有效起點', () => {
        const manifest = {
            schemaVersion: INTRADAY_MONITOR_BOOTSTRAP_MANIFEST_SCHEMA,
            kind: 'today',
            canonicalSymbol: '2330.TW',
            tradeDate: '2026-09-04',
            timeZone: 'Asia/Taipei',
            source: 'shioaji-kbars',
            sourceVersion: '1.7.1',
            sourceUnit: 'common_lot',
            canonicalUnit: 'common_lot',
            requestedMinuteStart: '09:01',
            requestedMinuteEnd: '10:29',
            actualMinuteStart: '09:01',
            actualMinuteEnd: '10:29',
            expectedMinuteCount: 89,
            actualMinuteCount: 89,
            coverageReceipt: 'verified',
            completeness: 'complete',
            monitoringEffectiveFrom: '09:01',
            earlierMinutesBackfilled: true,
            reasonCode: 'none',
            payloadHash: 'c'.repeat(64),
            fetchedAt: '2026-09-04T10:30:00+08:00',
        };
        expect(isIntradayMonitorBootstrapManifest(manifest)).toBe(true);
        expect(
            isIntradayMonitorBootstrapManifest({
                ...manifest,
                coverageReceipt: 'unavailable',
            }),
        ).toBe(false);
        expect(
            isIntradayMonitorBootstrapManifest({
                ...manifest,
                completeness: 'incomplete',
                actualMinuteCount: 80,
                coverageReceipt: 'unavailable',
                monitoringEffectiveFrom: '10:30',
                earlierMinutesBackfilled: false,
                reasonCode: 'coverage_unverified',
            }),
        ).toBe(true);
    });

    it('Gate 0 不完整時 capacity 強制為 0，完整時依 confirmed usage 計算', () => {
        const closed = {
            schemaVersion: INTRADAY_MONITOR_CAPACITY_SCHEMA,
            gate0EvidenceCurrent: false,
            globalOwnershipComplete: false,
            subscriptionTransportAuthority: false,
            configured: 200,
            eligible: 200,
            active: 0,
            waiting: 200,
            degraded: 0,
            confirmedPhysicalUsage: null,
            confirmedOtherPhysicalUsage: null,
            localPhysicalLimit: INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT,
            requiredHeadroom: INTRADAY_MONITOR_REQUIRED_HEADROOM,
            availableForMonitor: 0,
            connectionGeneration: null,
            evidenceAt: null,
        };
        expect(isIntradayMonitorCapacityStatus(closed)).toBe(true);
        expect(
            isIntradayMonitorCapacityStatus({ ...closed, active: 1, waiting: 199 }),
        ).toBe(false);

        const ready = {
            ...closed,
            gate0EvidenceCurrent: true,
            globalOwnershipComplete: true,
            subscriptionTransportAuthority: true,
            confirmedPhysicalUsage: 37,
            confirmedOtherPhysicalUsage: 37,
            availableForMonitor: 123,
            connectionGeneration: 'generation_000001',
            evidenceAt: '2026-09-04T12:00:00+08:00',
        };
        expect(isIntradayMonitorCapacityStatus(ready)).toBe(true);
        expect(
            isIntradayMonitorCapacityStatus({ ...ready, availableForMonitor: 124 }),
        ).toBe(false);
    });
});
