import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    SMART_ORDER_EXCHANGE_TIME_MAX_SKEW_MS,
    SMART_ORDER_OFFICIAL_MARKET_CALENDAR_REFRESH_MS,
    SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES,
    buildOfficialMarketCalendarSnapshot,
    evaluateOfficialMarketCalendarObservation,
    parseTpexOfficialCalendar,
    parseTwseOfficialCalendar,
} from './official-market-calendar-core.mjs';
import {
    SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY,
    admitSmartOrderOfficialMarketQuoteObservation,
    isIssuedSmartOrderOfficialMarketCalendarAuthority,
} from './official-market-calendar-authority.mjs';
import { startSmartOrderRuntimeController } from './runtime-controller.mjs';

const TWSE_PAYLOAD = Object.freeze({
    stat: 'ok',
    date: '20260101',
    title: '115 年市場開休市日期',
    fields: Object.freeze(['日期', '名稱', '說明']),
    data: Object.freeze([
        Object.freeze(['2026-01-01', '中華民國開國紀念日', '依規定放假1日。']),
        Object.freeze(['2026-01-02', '國曆新年開始交易日', '國曆新年開始交易。']),
        Object.freeze(['2026-02-12', '市場無交易，僅辦理結算交割作業', '']),
        Object.freeze(['2026-02-13', '市場無交易，僅辦理結算交割作業', '']),
        Object.freeze(['2026-06-19', '端午節', '依規定放假1日。']),
    ]),
    queryYear: 2026,
    total: 2,
});

const TPEX_PAYLOAD = Object.freeze({
    data: Object.freeze({
        html: `
            <table class="page-table"><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table>
            <table class="page-table">
              <tr><th>紀念節日名稱</th><th>日期</th><th>星期</th><th>說明</th></tr>
              <tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr>
              <tr><td>國曆新年開始交易日</td><td>1月2日</td><td>五</td><td>國曆新年開始交易。</td></tr>
              <tr><td>國際債券交易系統最後交易日</td><td>2月10日</td><td>二</td><td>2月11日、2月12日及2月13日市場無交易。</td></tr>
              <tr><td>股票交易系統最後交易日</td><td>2月11日</td><td>三</td><td>2月12日及2月13日市場無交易。</td></tr>
              <tr><td>端午節</td><td>6月19日</td><td>五</td><td>依規定放假1日。</tr>
            </table>
        `,
    }),
});

function response(payload) {
    return Object.freeze({
        ok: true,
        status: 200,
        async json() {
            return payload;
        },
    });
}

function exchangeEpoch(tradeDate, time) {
    return Date.parse(`${tradeDate}T${time}+08:00`);
}

function observation(exchange, tradeDate, time, receiveTimeMs) {
    return Object.freeze({
        contractKey: `${exchange}:STK:2330`,
        exchangeTimeMs: exchangeEpoch(tradeDate, time),
        receiveTimeMs,
        tradeDate,
    });
}

beforeEach(() => {
    SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY.reset();
});

describe('official TWSE/TPEx market calendar authority', () => {
    it('rejects an explicitly missing or forged controller authority', async () => {
        await expect(
            startSmartOrderRuntimeController({
                appSupportRoot: '/private/tmp/calendar-authority-must-not-open',
                apiGeneration: 'calendar-missing-generation',
                nowEpochMs: 1,
                officialMarketCalendarAuthority: null,
            }),
        ).rejects.toThrow(
            'runtime controller official market calendar authority is invalid',
        );
        await expect(
            startSmartOrderRuntimeController({
                appSupportRoot: '/private/tmp/calendar-authority-must-not-open',
                apiGeneration: 'calendar-forged-generation',
                nowEpochMs: 1,
                officialMarketCalendarAuthority: Object.freeze({
                    status: () => ({ activationReady: true }),
                }),
            }),
        ).rejects.toThrow(
            'runtime controller official market calendar authority is invalid',
        );

        const issued = SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY.create({
            fetchImpl: async () => response(TWSE_PAYLOAD),
            nowEpochMs: () => exchangeEpoch('2026-08-21', '10:00:00.000'),
        });
        expect(() =>
            admitSmartOrderOfficialMarketQuoteObservation(
                issued,
                observation(
                    'TSE',
                    '2026-08-21',
                    '10:00:00.000',
                    exchangeEpoch('2026-08-21', '10:00:00.000'),
                ),
            ),
        ).toThrow('official market quote observation authority is invalid');
    });

    it('pins the official sources, annual coverage, refresh cadence and 2-second policy', () => {
        expect(SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.TSE).toMatchObject({
            market: 'TWSE',
            landingPage: 'https://www.twse.com.tw/zh/trading/holiday.html',
        });
        expect(SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.OTC).toMatchObject({
            market: 'TPEx',
            landingPage: 'https://www.tpex.org.tw/zh-tw/announce/market/holiday.html',
        });
        expect(
            SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.TSE.annualUrl(2026),
        ).toContain('queryYear=115');
        expect(
            SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.OTC.annualUrl(2026),
        ).toContain('date=2026');
        expect(SMART_ORDER_OFFICIAL_MARKET_CALENDAR_REFRESH_MS).toBe(
            6 * 60 * 60 * 1_000,
        );
        expect(SMART_ORDER_EXCHANGE_TIME_MAX_SKEW_MS).toBe(2_000);
    });

    it('loads both official annual sources and requires fresh exchange-session time before activation', async () => {
        let now = exchangeEpoch('2026-08-21', '10:00:00.500');
        const fetchImpl = vi.fn(async (url) =>
            response(url.includes('twse.com.tw') ? TWSE_PAYLOAD : TPEX_PAYLOAD),
        );
        const authority = SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY.create({
            fetchImpl,
            nowEpochMs: () => now,
        });
        expect(isIssuedSmartOrderOfficialMarketCalendarAuthority(authority)).toBe(true);
        expect(isIssuedSmartOrderOfficialMarketCalendarAuthority(Object.freeze({}))).toBe(false);

        await authority.refresh();
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const parsedTpex = parseTpexOfficialCalendar(TPEX_PAYLOAD, 2026);
        expect(parsedTpex.closedDates).toEqual([
            '2026-01-01',
            '2026-02-12',
            '2026-02-13',
            '2026-06-19',
        ]);
        expect(authority.status()).toMatchObject({
            calendarCurrent: true,
            exchangeTimeCurrent: false,
            activationReady: false,
            coverageStart: '2026-01-01',
            coverageEnd: '2026-12-31',
            emergencyClosurePolicy: 'fresh_exchange_session_required',
            brokerWriteAuthority: false,
            exchangeEvidence: {
                TSE: { current: false },
                OTC: { current: false },
            },
        });

        const evidence = authority.admitObservation(
            observation('TSE', '2026-08-21', '10:00:00.000', now),
        );
        expect(evidence).toMatchObject({
            allowed: true,
            exchange: 'TSE',
            tradeDate: '2026-08-21',
        });
        expect(authority.status()).toMatchObject({
            exchangeTimeCurrent: true,
            activationReady: true,
            exchangeEvidence: {
                TSE: { current: true },
                OTC: { current: false },
            },
        });
        expect(() =>
            authority.assertDispatchEnvelope({
                contractKey: 'OTC:6488:STK:Common',
            }),
        ).toThrowError(expect.objectContaining({
            reason: 'dispatch_exchange_time_stale',
        }));
        expect(
            authority.assertDispatchEnvelope({
                contractKey: 'TSE:2330:STK:Common',
            }),
        ).toMatchObject({ allowed: true, exchange: 'TSE' });

        now += 2_001;
        expect(authority.status()).toMatchObject({
            exchangeTimeCurrent: false,
            activationReady: false,
            blocker: 'trusted_exchange_time_missing_or_stale',
        });
    });

    it.each([
        ['official holiday', 'TSE', '2026-01-01', '10:00:00.000', 0, 'official_market_closed'],
        ['outside session', 'OTC', '2026-08-21', '13:30:01.000', 0, 'business_session_closed'],
        ['more than 2 seconds skew', 'TSE', '2026-08-21', '10:00:00.000', 2_001, 'trusted_exchange_time_skew'],
    ])('fails closed for %s', async (_label, exchange, tradeDate, time, skew, reason) => {
        let now = exchangeEpoch(tradeDate, time) + skew;
        const authority = SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY.create({
            fetchImpl: async (url) =>
                response(url.includes('twse.com.tw') ? TWSE_PAYLOAD : TPEX_PAYLOAD),
            nowEpochMs: () => now,
        });
        await authority.refresh();
        expect(() =>
            authority.admitObservation(
                observation(exchange, tradeDate, time, now),
            ),
        ).toThrowError(expect.objectContaining({
            name: 'OfficialMarketCalendarBlockedError',
            reason,
        }));
        expect(authority.status().activationReady).toBe(false);
    });

    it('treats an annual weekday as schedule-only and never survives a missing emergency-session feed', async () => {
        let now = exchangeEpoch('2026-07-10', '10:00:00.500');
        const authority = SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY.create({
            fetchImpl: async (url) =>
                response(url.includes('twse.com.tw') ? TWSE_PAYLOAD : TPEX_PAYLOAD),
            nowEpochMs: () => now,
        });
        await authority.refresh();
        expect(authority.status().activationReady).toBe(false);
        now += 60_000;
        expect(authority.status().activationReady).toBe(false);
    });

    it('anchors evidence expiry to the original exchange time and never crosses 13:30', async () => {
        let now = exchangeEpoch('2026-08-21', '10:00:01.999');
        const authority = SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY.create({
            fetchImpl: async (url) =>
                response(url.includes('twse.com.tw') ? TWSE_PAYLOAD : TPEX_PAYLOAD),
            nowEpochMs: () => now,
        });
        await authority.refresh();
        authority.admitObservation(
            observation('TSE', '2026-08-21', '10:00:00.000', now),
        );
        expect(authority.status().exchangeEvidence.TSE.current).toBe(true);
        now += 2;
        expect(authority.status().exchangeEvidence.TSE.current).toBe(false);

        now = exchangeEpoch('2026-08-21', '13:30:00.000');
        expect(() =>
            authority.admitObservation(
                observation('TSE', '2026-08-21', '13:30:00.000', now),
            ),
        ).toThrowError(expect.objectContaining({
            reason: 'business_session_closed',
        }));

        now = exchangeEpoch('2026-08-21', '13:29:59.999');
        authority.admitObservation(
            observation('TSE', '2026-08-21', '13:29:59.999', now),
        );
        expect(authority.status().exchangeEvidence.TSE.current).toBe(true);
        now = exchangeEpoch('2026-08-21', '13:30:00.000');
        expect(authority.status().exchangeEvidence.TSE.current).toBe(false);
        expect(() =>
            authority.assertDispatchEnvelope({
                contractKey: 'TSE:2330:STK:Common',
            }),
        ).toThrowError(expect.objectContaining({
            reason: 'dispatch_exchange_time_stale',
        }));
    });

    it('fails closed when the local wall clock moves behind quote receipt', async () => {
        let now = exchangeEpoch('2026-08-21', '10:00:01.000');
        const authority = SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY.create({
            fetchImpl: async (url) =>
                response(url.includes('twse.com.tw') ? TWSE_PAYLOAD : TPEX_PAYLOAD),
            nowEpochMs: () => now,
        });
        await authority.refresh();
        authority.admitObservation(
            observation('TSE', '2026-08-21', '10:00:01.000', now),
        );
        expect(authority.status().exchangeEvidence.TSE.current).toBe(true);
        now -= 250;
        expect(authority.status().exchangeEvidence.TSE.current).toBe(false);
        expect(authority.status().activationReady).toBe(false);
    });

    it('rejects source schema drift and unknown next-year dates', () => {
        expect(() =>
            parseTwseOfficialCalendar({ ...TWSE_PAYLOAD, fields: ['date'] }, 2026),
        ).toThrow('schema changed');
        expect(() =>
            parseTpexOfficialCalendar({ data: { html: '<table></table>' } }, 2026),
        ).toThrow('response is invalid');
        expect(() =>
            parseTpexOfficialCalendar(
                {
                    data: {
                        html: `${TPEX_PAYLOAD.data.html}<table><tr><td>端午節</td><td>6月19日</td></tr></table>`,
                    },
                },
                2026,
            ),
        ).toThrow('special-date row schema changed');
        expect(
            parseTwseOfficialCalendar(
                {
                    ...TWSE_PAYLOAD,
                    data: [['2026-08-21', '新增特殊日期', '停止交易1日']],
                    total: 1,
                },
                2026,
            ).closedDates,
        ).toEqual(['2026-08-21']);

        const twse = parseTwseOfficialCalendar(TWSE_PAYLOAD, 2026);
        const conflictingTpex = Object.freeze({
            ...parseTpexOfficialCalendar(TPEX_PAYLOAD, 2026),
            closedDates: Object.freeze(
                parseTpexOfficialCalendar(TPEX_PAYLOAD, 2026).closedDates.filter(
                    (date) => date !== '2026-06-19',
                ),
            ),
        });
        expect(() =>
            buildOfficialMarketCalendarSnapshot({
                twse,
                tpex: conflictingTpex,
                fetchedAtEpochMs: exchangeEpoch('2026-08-21', '10:00:00.000'),
            }),
        ).toThrow('official market calendars conflict');

        const fetchedAtEpochMs = exchangeEpoch('2026-12-31', '23:59:59.000');
        const snapshot = buildOfficialMarketCalendarSnapshot({
            twse: parseTwseOfficialCalendar(TWSE_PAYLOAD, 2026),
            tpex: parseTpexOfficialCalendar(TPEX_PAYLOAD, 2026),
            fetchedAtEpochMs,
        });
        expect(
            evaluateOfficialMarketCalendarObservation({
                snapshot,
                observation: observation(
                    'TSE',
                    '2027-01-01',
                    '10:00:00.000',
                    exchangeEpoch('2027-01-01', '10:00:00.000'),
                ),
                nowEpochMs: exchangeEpoch('2027-01-01', '10:00:00.000'),
            }),
        ).toEqual({ allowed: false, reason: 'unknown_trade_date' });
    });

    it('is wired into the issued production controller dispatch boundary and expires closed', async () => {
        let now = exchangeEpoch('2026-08-21', '10:00:00.500');
        const authority = SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY.create({
            fetchImpl: async (url) =>
                response(url.includes('twse.com.tw') ? TWSE_PAYLOAD : TPEX_PAYLOAD),
            nowEpochMs: () => now,
        });
        await authority.refresh();
        const root = await mkdtemp(path.join(tmpdir(), 'smart-order-calendar-controller-'));
        await chmod(root, 0o700);
        try {
            const controller = await startSmartOrderRuntimeController({
                appSupportRoot: root,
                apiGeneration: 'calendar-controller-generation',
                nowEpochMs: now,
                runtimeEpochId: 'calendar-controller-runtime',
                senderFence: 'calendar-controller-fence',
                officialMarketCalendarAuthority: authority,
            });
            expect(controller.role).toBe('primary');
            await controller.markReady({
                reconciliationEvidenceHash: `sha256:${'a'.repeat(64)}`,
            });
            expect(controller.status()).toMatchObject({
                dispatchAllowed: false,
                officialMarketCalendar: {
                    calendarCurrent: true,
                    exchangeTimeCurrent: false,
                    activationReady: false,
                    brokerWriteAuthority: false,
                },
            });

            authority.admitObservation(
                observation('TSE', '2026-08-21', '10:00:00.000', now),
            );
            expect(controller.dispatchAllowed).toBe(true);
            now += 2_001;
            expect(controller.dispatchAllowed).toBe(false);
            expect(controller.status().officialMarketCalendar).toMatchObject({
                exchangeTimeCurrent: false,
                activationReady: false,
            });
            await controller.stop({ nowEpochMs: now });
        } finally {
            authority.close();
            await rm(root, { recursive: true, force: true });
        }
    });
});
