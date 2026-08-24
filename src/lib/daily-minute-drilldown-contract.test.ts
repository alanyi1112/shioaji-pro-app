import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import fixture from '../../test-fixtures/daily-minute-drilldown-contract.json';
import {
    commitTargetDateSnapshot,
    createTargetDateRequest,
    DailyCandleGestureArbiter,
    isCompletedTaiwanDailyTarget,
    TargetDateSingleFlight,
    validateTargetDateResponse,
    type DailyGestureEvent,
    type DrilldownChartContext,
    type TargetDateRequest,
} from './daily-minute-drilldown-contract';

const browserSource = readFileSync(
    new URL(
        '../../apps/multiview/public/static/daily-minute-drilldown-contract.js',
        import.meta.url,
    ),
    'utf8',
);
const sandbox: Record<string, unknown> = {
    globalThis: undefined,
    Date,
    Intl,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(browserSource, sandbox);

const browserContract = sandbox.QuoteDailyMinuteDrilldownContract as {
    isCompletedTaiwanDailyTarget: (input: unknown) => boolean;
    createTargetDateRequest: (input: unknown) => unknown;
    validateTargetDateResponse: (
        request: unknown,
        currentGeneration: number,
        response: unknown,
    ) => unknown;
    createTargetDateSingleFlight: () => {
        run: (request: unknown, load: (request: unknown) => unknown) => Promise<unknown>;
        size: () => number;
    };
    createDailyCandleGestureArbiter: (
        callbacks: {
            onSingle: (event: unknown) => void;
            onDrilldown: (event: unknown) => void;
        },
    ) => {
        handleClick: (event: unknown) => unknown;
        flush: (now: number) => unknown;
        cancel: () => boolean;
        snapshot: () => unknown;
    };
    commitTargetDateSnapshot: (input: unknown) => unknown;
};

function comparable(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value));
}

function request(): TargetDateRequest {
    const result = createTargetDateRequest(fixture.request);
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') throw new Error(result.reason);
    return result.request;
}

function response(patch: Record<string, unknown> = {}) {
    return {
        ...structuredClone(fixture.validResponse),
        ...patch,
    };
}

describe('指定日期 1 分 K request 與 response guard', () => {
    it.each([
        ['2026-08-23', '2026-08-24T05:29:59Z', true],
        ['2026-08-24', '2026-08-24T05:29:59Z', false],
        ['2026-08-24', '2026-08-24T05:30:00Z', true],
        ['2026-08-25', '2026-08-24T06:00:00Z', false],
        ['2026-02-30', '2026-08-24T06:00:00Z', false],
    ])(
        '只讓已收盤台股日 K 成為 target：target=%s now=%s',
        (date, now, expected) => {
            const input = { targetDate: date, nowMs: Date.parse(now) };
            expect(isCompletedTaiwanDailyTarget(input)).toBe(expected);
            expect(browserContract.isCompletedTaiwanDailyTarget(input)).toBe(
                expected,
            );
        },
    );

    it('非法 wall-clock 輸入 fail closed 而不拋例外', () => {
        const input = { targetDate: '2026-08-24', nowMs: 1e300 };
        expect(isCompletedTaiwanDailyTarget(input)).toBe(false);
        expect(browserContract.isCompletedTaiwanDailyTarget(input)).toBe(false);
    });

    it('建立 simulation-only 單日有界 request 並保持跨 runtime parity', () => {
        const main = createTargetDateRequest(fixture.request);
        const browser = browserContract.createTargetDateRequest(
            fixture.request,
        );
        expect(comparable(browser)).toEqual(comparable(main));
        expect(main).toMatchObject({
            status: 'accepted',
            request: {
                symbol: '2330',
                targetDate: '2026-08-21',
                startDate: '2026-08-21',
                endDate: '2026-08-21',
                targetInterval: '1m',
                timeZone: 'Asia/Taipei',
                mode: 'simulation',
                generation: 7,
                maxCandles: 600,
            },
        });
    });

    it.each([
        [{ symbol: '' }, 'invalid_symbol'],
        [{ targetDate: '2026-02-30' }, 'invalid_target_date'],
        [{ sourceIdentity: '' }, 'invalid_source_identity'],
        [{ sourceIdentity: 'yahoo-chart' }, 'invalid_source_identity'],
        [{ mode: 'production' }, 'simulation_required'],
        [{ generation: 0 }, 'invalid_generation'],
    ])('拒絕非法 request patch=%j', (patch, reason) => {
        const input = { ...fixture.request, ...patch };
        const main = createTargetDateRequest(input);
        const browser = browserContract.createTargetDateRequest(input);
        expect(main).toEqual({ status: 'rejected', reason });
        expect(comparable(browser)).toEqual(main);
    });

    it('接受同商品、同來源、單一台北日期且嚴格遞增的 immutable snapshot', () => {
        const target = request();
        const main = validateTargetDateResponse(
            target,
            7,
            fixture.validResponse,
        );
        const browser = browserContract.validateTargetDateResponse(
            target,
            7,
            fixture.validResponse,
        );
        expect(main.status).toBe('accepted');
        expect(comparable(browser)).toEqual(comparable(main));
        if (main.status === 'accepted') {
            expect(Object.isFrozen(main.snapshot)).toBe(true);
            expect(Object.isFrozen(main.snapshot.candles)).toBe(true);
            expect(main.snapshot.candles).toHaveLength(2);
        }
    });

    it.each([
        ['schema_mismatch', () => response({ schemaVersion: 'old' }), 7],
        [
            'response_identity_mismatch',
            () => response({ requestIdentity: 'replay|other' }),
            7,
        ],
        ['symbol_mismatch', () => response({ symbol: '2317' }), 7],
        [
            'source_identity_mismatch',
            () => response({ sourceIdentity: 'other-simulation' }),
            7,
        ],
        ['simulation_required', () => response({ mode: 'production' }), 7],
        [
            'target_date_mismatch',
            () => response({ targetDate: '2026-08-20' }),
            7,
        ],
        ['interval_mismatch', () => response({ interval: '5m' }), 7],
        ['time_zone_mismatch', () => response({ timeZone: 'UTC' }), 7],
        ['empty_response', () => response({ candles: [] }), 7],
        [
            'mixed_session_date',
            () => {
                const value = response();
                const candles = structuredClone(fixture.validResponse.candles);
                candles[1]!.sessionDate = '2026-08-20';
                value.candles = candles;
                return value;
            },
            7,
        ],
        [
            'mixed_session_date',
            () => {
                const candles = structuredClone(fixture.validResponse.candles);
                candles[0]!.time -= 86400;
                return response({ candles });
            },
            7,
        ],
        [
            'candle_out_of_order',
            () =>
                response({
                    candles: [...fixture.validResponse.candles].reverse(),
                }),
            7,
        ],
        [
            'invalid_candle',
            () => {
                const candles = structuredClone(fixture.validResponse.candles);
                candles[0]!.high = 100;
                return response({ candles });
            },
            7,
        ],
        [
            'invalid_candle',
            () => {
                const candles = structuredClone(fixture.validResponse.candles);
                Object.assign(candles[0]!, {
                    open: 0,
                    high: 0,
                    low: 0,
                    close: 0,
                });
                return response({ candles });
            },
            7,
        ],
        ['stale_generation', () => response(), 8],
    ])('拒絕 response fault：%s', (reason, build, generation) => {
        const target = request();
        const value = build();
        const main = validateTargetDateResponse(target, generation, value);
        const browser = browserContract.validateTargetDateResponse(
            target,
            generation,
            value,
        );
        expect(main).toEqual({ status: 'rejected', reason });
        expect(comparable(browser)).toEqual(main);
    });

    it('拒絕超過單日 response guard 的資料量', () => {
        const target = request();
        const first = fixture.validResponse.candles[0]!;
        const candles = Array.from({ length: 601 }, (_, index) => ({
            ...first,
            time: first.time + index * 60,
        }));
        const value = response({ candles });
        expect(validateTargetDateResponse(target, 7, value)).toEqual({
            status: 'rejected',
            reason: 'response_too_large',
        });
        expect(
            comparable(
                browserContract.validateTargetDateResponse(target, 7, value),
            ),
        ).toEqual({ status: 'rejected', reason: 'response_too_large' });
    });

    it('validator 重新驗證 request，拒絕竄改 guard 或 identity 的 forged request', () => {
        const forged = {
            ...request(),
            maxCandles: 9999,
        } as unknown as TargetDateRequest;
        expect(
            validateTargetDateResponse(forged, 7, fixture.validResponse),
        ).toEqual({ status: 'rejected', reason: 'schema_mismatch' });
        expect(
            comparable(
                browserContract.validateTargetDateResponse(
                    forged,
                    7,
                    fixture.validResponse,
                ),
            ),
        ).toEqual({ status: 'rejected', reason: 'schema_mismatch' });
    });

    it('相同 source/symbol/date 共用 single-flight，settle 後才允許新請求', async () => {
        const target = request();
        const nextRequestResult = createTargetDateRequest({
            ...fixture.request,
            generation: 8,
        });
        if (nextRequestResult.status !== 'accepted') {
            throw new Error(nextRequestResult.reason);
        }
        const nextTarget = nextRequestResult.request;
        const main = new TargetDateSingleFlight<number>();
        let resolveLoad!: (value: number) => void;
        let calls = 0;
        const loader = () => {
            calls += 1;
            return new Promise<number>((resolve) => {
                resolveLoad = resolve;
            });
        };
        const first = main.run(target, loader);
        const second = main.run(nextTarget, loader);
        expect(first).toBe(second);
        expect(main.size()).toBe(1);
        await Promise.resolve();
        expect(calls).toBe(1);
        resolveLoad(42);
        await expect(first).resolves.toBe(42);
        expect(main.size()).toBe(0);
        await expect(main.run(target, async () => 43)).resolves.toBe(43);

        const browser = browserContract.createTargetDateSingleFlight();
        let browserCalls = 0;
        let resolveBrowser!: (value: number) => void;
        const browserLoader = () => {
            browserCalls += 1;
            return new Promise<number>((resolve) => {
                resolveBrowser = resolve;
            });
        };
        const browserFirst = browser.run(target, browserLoader);
        const browserSecond = browser.run(nextTarget, browserLoader);
        expect(browserFirst).toBe(browserSecond);
        await Promise.resolve();
        expect(browserCalls).toBe(1);
        resolveBrowser(7);
        await expect(browserFirst).resolves.toBe(7);
        expect(browser.size()).toBe(0);
    });
});

function gestureEvent(patch: Partial<DailyGestureEvent> = {}): DailyGestureEvent {
    return {
        ...(fixture.gesture.base as DailyGestureEvent),
        ...patch,
    };
}

describe('日 K bounded gesture arbiter', () => {
    it('單擊逾時只提交一次，第二次 flush 不重送', () => {
        const singles: string[] = [];
        const drilldowns: string[] = [];
        const arbiter = new DailyCandleGestureArbiter({
            onSingle: (event) => singles.push(event.candleKey),
            onDrilldown: (event) => drilldowns.push(event.candleKey),
        });
        expect(arbiter.handleClick(gestureEvent())).toEqual({
            action: 'pending',
            reason: 'awaiting_second_click',
        });
        expect(arbiter.flush(1259)).toBeNull();
        expect(arbiter.flush(1260)).toEqual({
            action: 'single',
            reason: 'single_timeout',
        });
        expect(arbiter.flush(2000)).toBeNull();
        expect(singles).toEqual(['2330|2026-08-21']);
        expect(drilldowns).toEqual([]);
    });

    it('同一 K 棒第二擊取消單擊並只交付一次 drill-down，跨 runtime parity', () => {
        const mainEvents: string[] = [];
        const browserEvents: string[] = [];
        const main = new DailyCandleGestureArbiter({
            onSingle: () => mainEvents.push('single'),
            onDrilldown: () => mainEvents.push('drilldown'),
        });
        const browser = browserContract.createDailyCandleGestureArbiter({
            onSingle: () => browserEvents.push('single'),
            onDrilldown: () => browserEvents.push('drilldown'),
        });
        const first = gestureEvent();
        const second = gestureEvent({ eventTime: 1100 });
        expect(comparable(browser.handleClick(first))).toEqual(
            main.handleClick(first),
        );
        expect(comparable(browser.handleClick(second))).toEqual(
            main.handleClick(second),
        );
        expect(main.flush(2000)).toBeNull();
        expect(browser.flush(2000)).toBeNull();
        expect(mainEvents).toEqual(['drilldown']);
        expect(browserEvents).toEqual(mainEvents);
    });

    it('不同 K 棒不合併成雙擊，先提交前一單擊再等待新單擊', () => {
        const events: string[] = [];
        const arbiter = new DailyCandleGestureArbiter({
            onSingle: (event) => events.push(`single:${event.candleKey}`),
            onDrilldown: (event) =>
                events.push(`drilldown:${event.candleKey}`),
        });
        arbiter.handleClick(gestureEvent());
        expect(
            arbiter.handleClick(
                gestureEvent({
                    candleKey: '2330|2026-08-20',
                    eventTime: 1100,
                }),
            ),
        ).toEqual({ action: 'pending', reason: 'awaiting_second_click' });
        expect(events).toEqual(['single:2330|2026-08-21']);
        arbiter.flush(1360);
        expect(events).toEqual([
            'single:2330|2026-08-21',
            'single:2330|2026-08-20',
        ]);
    });

    it.each(fixture.gesture.passthrough)(
        '工具或非法目標保留既有 ownership：$reason',
        ({ patch, reason }) => {
            const events: string[] = [];
            const browserEvents: string[] = [];
            const main = new DailyCandleGestureArbiter({
                onSingle: () => events.push('single'),
                onDrilldown: () => events.push('drilldown'),
            });
            const browser = browserContract.createDailyCandleGestureArbiter({
                onSingle: () => browserEvents.push('single'),
                onDrilldown: () => browserEvents.push('drilldown'),
            });
            const event = gestureEvent(patch as Partial<DailyGestureEvent>);
            const result = main.handleClick(event);
            expect(result).toEqual({ action: 'passthrough', reason });
            expect(comparable(browser.handleClick(event))).toEqual(result);
            expect(main.snapshot()).toBeNull();
            expect(browser.snapshot()).toBeNull();
            expect(events).toEqual([]);
            expect(browserEvents).toEqual([]);
        },
    );
});

describe('staged load 與 atomic commit', () => {
    const baseline = fixture.baseline as DrilldownChartContext;
    const currentIdentity = {
        symbol: '2330',
        panelIdentity: 'main-chart',
        generation: 7,
    } as const;

    it('成功時一次提交所有圖層並保留既有工具狀態', () => {
        const input = {
            baseline,
            request: request(),
            currentIdentity,
            response: fixture.validResponse,
            buildLayers: () => fixture.commitLayers,
        };
        const main = commitTargetDateSnapshot(input);
        const browser = browserContract.commitTargetDateSnapshot(input);
        expect(main.status).toBe('committed');
        expect(comparable(browser)).toEqual(comparable(main));
        if (main.status === 'committed') {
            expect(main.context).toMatchObject({
                symbol: '2330',
                panelIdentity: 'main-chart',
                generation: 7,
                interval: '1m',
                source: fixture.commitLayers.source,
                readout: fixture.commitLayers.readout,
                volume: fixture.commitLayers.volume,
                indicators: fixture.commitLayers.indicators,
                dayBoundaries: fixture.commitLayers.dayBoundaries,
                viewport: fixture.commitLayers.viewport,
                tools: fixture.baseline.tools,
            });
            expect(main.context.candles).toHaveLength(2);
        }
    });

    it('identity、generation、response fault 都回傳同一份原 context', () => {
        const target = request();
        const cases = [
            {
                expected: 'context_identity_mismatch',
                currentIdentity: { ...currentIdentity, symbol: '2317' },
                response: fixture.validResponse,
            },
            {
                expected: 'stale_generation',
                currentIdentity: { ...currentIdentity, generation: 8 },
                response: fixture.validResponse,
            },
            {
                expected: 'context_identity_mismatch',
                baseline: { ...baseline, interval: '5m' },
                currentIdentity,
                response: fixture.validResponse,
            },
            {
                expected: 'context_identity_mismatch',
                baseline: { ...baseline, symbol: '2317' },
                currentIdentity,
                response: fixture.validResponse,
            },
            {
                expected: 'mixed_session_date',
                currentIdentity,
                response: response({
                    candles: fixture.validResponse.candles.map((candle, index) =>
                        index === 1
                            ? { ...candle, sessionDate: '2026-08-20' }
                            : candle,
                    ),
                }),
            },
        ];
        for (const row of cases) {
            const rowBaseline =
                'baseline' in row && row.baseline ? row.baseline : baseline;
            const result = commitTargetDateSnapshot({
                baseline: rowBaseline,
                request: target,
                currentIdentity: row.currentIdentity,
                response: row.response,
                buildLayers: () => fixture.commitLayers,
            });
            expect(result).toMatchObject({
                status: 'rejected',
                reason: row.expected,
            });
            expect(result.context).toBe(rowBaseline);
            expect(
                comparable(
                    browserContract.commitTargetDateSnapshot({
                        baseline: rowBaseline,
                        request: target,
                        currentIdentity: row.currentIdentity,
                        response: row.response,
                        buildLayers: () => fixture.commitLayers,
                    }),
                ),
            ).toEqual(comparable(result));
        }
    });

    it('明確取消時保持原 context，不執行 projection builder', () => {
        let called = false;
        const result = commitTargetDateSnapshot({
            baseline,
            request: request(),
            currentIdentity,
            response: fixture.validResponse,
            cancelled: true,
            buildLayers: () => {
                called = true;
                return fixture.commitLayers;
            },
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'request_cancelled',
            context: baseline,
        });
        expect(called).toBe(false);
        expect(
            comparable(
                browserContract.commitTargetDateSnapshot({
                    baseline,
                    request: request(),
                    currentIdentity,
                    response: fixture.validResponse,
                    cancelled: true,
                    buildLayers: () => fixture.commitLayers,
                }),
            ),
        ).toEqual(comparable(result));
    });

    it('任一 layer fault 或 projection throw 都不產生半套 context', () => {
        for (const key of Object.keys(fixture.commitLayers)) {
            const incomplete = { ...fixture.commitLayers } as Record<
                string,
                unknown
            >;
            delete incomplete[key];
            const result = commitTargetDateSnapshot({
                baseline,
                request: request(),
                currentIdentity,
                response: fixture.validResponse,
                buildLayers: () => incomplete as typeof fixture.commitLayers,
            });
            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'projection_incomplete',
            });
            expect(result.context).toBe(baseline);
        }
        const thrown = commitTargetDateSnapshot({
            baseline,
            request: request(),
            currentIdentity,
            response: fixture.validResponse,
            buildLayers: () => {
                throw new Error('fault injection');
            },
        });
        expect(thrown).toMatchObject({
            status: 'rejected',
            reason: 'projection_failed',
        });
        expect(thrown.context).toBe(baseline);
        expect(fixture.baseline.interval).toBe('1d');
        expect(fixture.baseline.viewport).toEqual({ from: 0, to: 100 });
    });

    it('projection 只能讀取 immutable baseline，commit 後 layer snapshot 不受外部改寫', () => {
        const mutableLayers = structuredClone(fixture.commitLayers);
        let baselineWasFrozen = false;
        const result = commitTargetDateSnapshot({
            baseline,
            request: request(),
            currentIdentity,
            response: fixture.validResponse,
            buildLayers: (_snapshot, immutableBaseline) => {
                baselineWasFrozen = Object.isFrozen(immutableBaseline);
                return mutableLayers;
            },
        });
        expect(result.status).toBe('committed');
        expect(baselineWasFrozen).toBe(true);
        mutableLayers.source.provider = 'forged-after-commit';
        if (result.status === 'committed') {
            expect(result.context.source).toEqual(
                fixture.commitLayers.source,
            );
            expect(Object.isFrozen(result.context)).toBe(true);
            expect(Object.isFrozen(result.context.source)).toBe(true);
        }
    });
});
