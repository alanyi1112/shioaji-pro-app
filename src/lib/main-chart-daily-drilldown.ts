import {
    DAILY_MINUTE_RESPONSE_REVISION,
    TARGET_DATE_TURNOVER_SCHEMA_REVISION,
    TARGET_DATE_TURNOVER_SOURCE_IDENTITY,
    TargetDateSingleFlight,
    createTargetDateRequest,
    isCompletedTaiwanDailyTarget,
    targetDateTurnoverAvailability,
    validateTargetDateResponse,
    type TargetDateRequest,
    type TargetDateRequestReason,
    type TargetDateResponseReason,
    type ValidatedTargetDateResponse,
} from './daily-minute-drilldown-contract';
import type { Candle } from './types/market';
import type { SecurityType } from './types/contract';

export const MAIN_CHART_TARGET_DATE_SOURCE =
    'local-shioaji-simulation' as const;

export type MainChartTargetDateReason =
    | TargetDateRequestReason
    | TargetDateResponseReason
    | 'source_unavailable';

export type MainChartTargetDateLoadResult =
    | Readonly<{
          status: 'accepted';
          request: TargetDateRequest;
          response: ValidatedTargetDateResponse;
      }>
    | Readonly<{
          status: 'rejected';
          targetDate: string;
          reason: MainChartTargetDateReason;
      }>;

class MainChartTargetDateLoadError extends Error {
    constructor(readonly reason: MainChartTargetDateReason) {
        super(reason);
        this.name = 'MainChartTargetDateLoadError';
    }
}

const sharedTargetDateSingleFlight =
    new TargetDateSingleFlight<ValidatedTargetDateResponse>();

export function mainChartDailyTargetEligible(input: Readonly<{
    targetDate: unknown;
    securityType: SecurityType;
    nowMs?: number;
}>): boolean {
    return (
        ['STK', 'IND', 'WRT'].includes(String(input.securityType)) &&
        isCompletedTaiwanDailyTarget({
            targetDate: input.targetDate,
            nowMs: input.nowMs,
        })
    );
}

function wallClockSessionDate(time: number): string {
    return new Date(time * 1000).toISOString().slice(0, 10);
}

function responseForCandles(
    request: TargetDateRequest,
    candles: readonly Candle[],
): ValidatedTargetDateResponse {
    const projectedCandles = candles.map((candle) =>
        Object.freeze({
            time: candle.time,
            sessionDate: wallClockSessionDate(candle.time),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            turnoverTwd: candle.turnoverTwd ?? null,
            turnoverSchemaRevision: TARGET_DATE_TURNOVER_SCHEMA_REVISION,
            turnoverSourceIdentity: TARGET_DATE_TURNOVER_SOURCE_IDENTITY,
        }),
    );
    return Object.freeze({
        schemaVersion: DAILY_MINUTE_RESPONSE_REVISION,
        requestIdentity: request.singleFlightKey,
        symbol: request.symbol,
        sourceIdentity: request.sourceIdentity,
        mode: 'simulation',
        targetDate: request.targetDate,
        interval: '1m',
        timeZone: 'Asia/Taipei',
        turnoverSchemaRevision: TARGET_DATE_TURNOVER_SCHEMA_REVISION,
        turnoverSourceIdentity: TARGET_DATE_TURNOVER_SOURCE_IDENTITY,
        turnoverAvailability: targetDateTurnoverAvailability(projectedCandles),
        candles: Object.freeze(projectedCandles),
    });
}

export async function loadMainChartTargetDate(input: Readonly<{
    symbol: unknown;
    targetDate: unknown;
    generation: number;
    getInfo: () => Promise<Readonly<{ simulation?: unknown }>>;
    getKbars: (request: TargetDateRequest) => Promise<unknown>;
    normalizeKbars: (value: unknown) => readonly Candle[];
    singleFlight?: TargetDateSingleFlight<ValidatedTargetDateResponse>;
}>): Promise<MainChartTargetDateLoadResult> {
    const requestResult = createTargetDateRequest({
        symbol: input.symbol,
        sourceIdentity: MAIN_CHART_TARGET_DATE_SOURCE,
        mode: 'simulation',
        targetDate: input.targetDate,
        generation: input.generation,
    });
    if (requestResult.status === 'rejected') {
        return Object.freeze({
            status: 'rejected',
            targetDate: String(input.targetDate ?? ''),
            reason: requestResult.reason,
        });
    }
    const request = requestResult.request;
    try {
        const response = await (
            input.singleFlight ?? sharedTargetDateSingleFlight
        ).run(request, async () => {
            const info = await input.getInfo();
            if (info?.simulation !== true) {
                throw new MainChartTargetDateLoadError(
                    'simulation_required',
                );
            }
            const raw = await input.getKbars(request);
            return responseForCandles(
                request,
                input.normalizeKbars(raw),
            );
        });
        const validation = validateTargetDateResponse(
            request,
            input.generation,
            response,
        );
        if (validation.status === 'rejected') {
            return Object.freeze({
                status: 'rejected',
                targetDate: request.targetDate,
                reason: validation.reason,
            });
        }
        return Object.freeze({
            status: 'accepted',
            request,
            response: validation.snapshot,
        });
    } catch (error) {
        return Object.freeze({
            status: 'rejected',
            targetDate: request.targetDate,
            reason:
                error instanceof MainChartTargetDateLoadError
                    ? error.reason
                    : 'source_unavailable',
        });
    }
}

export function mainChartTargetDateReasonMessage(
    reason: MainChartTargetDateReason,
): string {
    const messages: Partial<Record<MainChartTargetDateReason, string>> = {
        simulation_required: '本機 Shioaji 目前不是 simulation，已拒絕切換',
        source_unavailable: '本機 simulation 指定日期資料目前不可用',
        empty_response: '該交易日沒有可驗證的 1 分 K',
        mixed_session_date: '指定日期資料混入其他交易日，已拒絕切換',
        stale_generation: '圖表內容已切換，本次舊結果已丟棄',
        response_too_large: '指定日期資料超過 600 根安全上限',
        invalid_candle: '指定日期資料含非法 K 棒，已拒絕切換',
        candle_out_of_order: '指定日期 K 棒排序不合法，已拒絕切換',
        symbol_mismatch: '指定日期資料商品不符，已拒絕切換',
        target_date_mismatch: '指定日期回應日期不符，已拒絕切換',
        response_identity_mismatch:
            '指定日期回應 identity 不符，已拒絕切換',
        source_identity_mismatch:
            '指定日期來源 identity 不符，已拒絕切換',
    };
    return messages[reason] ?? `指定日期 1 分 K 不可用（${reason}）`;
}
