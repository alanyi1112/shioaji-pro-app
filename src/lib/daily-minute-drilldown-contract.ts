export const DAILY_MINUTE_REQUEST_REVISION =
    'daily-minute-target-request/2' as const;
export const DAILY_MINUTE_RESPONSE_REVISION =
    'daily-minute-target-response/2' as const;
export const TARGET_DATE_TURNOVER_SCHEMA_REVISION =
    'multiview-kbar-turnover/1' as const;
export const TARGET_DATE_TURNOVER_SOURCE_IDENTITY =
    'local-shioaji-simulation' as const;
export const DAILY_GESTURE_WINDOW_MS = 260;
export const DAILY_MINUTE_MAX_CANDLES = 600;

const SUPPORTED_TARGET_DATE_SOURCES = new Set([
    'local-shioaji-simulation',
]);
const TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
const TAIPEI_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});
const TAIWAN_DAY_SESSION_CLOSE_MINUTES = 13 * 60 + 30;

export type TargetDateRequestReason =
    | 'invalid_symbol'
    | 'invalid_target_date'
    | 'invalid_source_identity'
    | 'simulation_required'
    | 'invalid_generation';

export type TargetDateResponseReason =
    | 'stale_generation'
    | 'schema_mismatch'
    | 'response_identity_mismatch'
    | 'symbol_mismatch'
    | 'source_identity_mismatch'
    | 'simulation_required'
    | 'target_date_mismatch'
    | 'interval_mismatch'
    | 'time_zone_mismatch'
    | 'response_too_large'
    | 'empty_response'
    | 'invalid_candle'
    | 'candle_out_of_order'
    | 'mixed_session_date';

export type TargetDateRequest = Readonly<{
    schemaVersion: typeof DAILY_MINUTE_REQUEST_REVISION;
    symbol: string;
    sourceIdentity: string;
    mode: 'simulation';
    targetDate: string;
    startDate: string;
    endDate: string;
    targetInterval: '1m';
    timeZone: 'Asia/Taipei';
    generation: number;
    maxCandles: typeof DAILY_MINUTE_MAX_CANDLES;
    singleFlightKey: string;
    requestIdentity: string;
}>;

export type TargetDateRequestResult =
    | Readonly<{ status: 'accepted'; request: TargetDateRequest }>
    | Readonly<{ status: 'rejected'; reason: TargetDateRequestReason }>;

export type TargetDateCandle = Readonly<{
    time: number;
    sessionDate: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    turnoverTwd: number | null;
    turnoverSchemaRevision: typeof TARGET_DATE_TURNOVER_SCHEMA_REVISION;
    turnoverSourceIdentity: typeof TARGET_DATE_TURNOVER_SOURCE_IDENTITY;
}>;

export type TargetDateTurnoverAvailability =
    | 'available'
    | 'partial'
    | 'unavailable';

export type ValidatedTargetDateResponse = Readonly<{
    schemaVersion: typeof DAILY_MINUTE_RESPONSE_REVISION;
    requestIdentity: string;
    symbol: string;
    sourceIdentity: string;
    mode: 'simulation';
    targetDate: string;
    interval: '1m';
    timeZone: 'Asia/Taipei';
    turnoverSchemaRevision: typeof TARGET_DATE_TURNOVER_SCHEMA_REVISION;
    turnoverSourceIdentity: typeof TARGET_DATE_TURNOVER_SOURCE_IDENTITY;
    turnoverAvailability: TargetDateTurnoverAvailability;
    candles: readonly TargetDateCandle[];
}>;

export type TargetDateResponseValidation =
    | Readonly<{
          status: 'accepted';
          snapshot: ValidatedTargetDateResponse;
      }>
    | Readonly<{ status: 'rejected'; reason: TargetDateResponseReason }>;

function canonicalSymbol(value: unknown): string {
    return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function validSymbol(value: string): boolean {
    return /^[A-Z0-9^][A-Z0-9._^-]{0,31}$/.test(value);
}

function canonicalSourceIdentity(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validSourceIdentity(value: string): boolean {
    return SUPPORTED_TARGET_DATE_SOURCES.has(value);
}

function validCalendarDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month! - 1 &&
        date.getUTCDate() === day
    );
}

export function isCompletedTaiwanDailyTarget(input: Readonly<{
    targetDate: unknown;
    nowMs?: number;
}>): boolean {
    if (!validCalendarDate(input.targetDate)) return false;
    const nowMs = input.nowMs ?? Date.now();
    if (!Number.isFinite(nowMs)) return false;
    const now = new Date(nowMs);
    if (Number.isNaN(now.getTime())) return false;
    const parts = TAIPEI_DATE_TIME_FORMATTER.formatToParts(
        now,
    ).reduce<Record<string, string>>((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    const currentDate = `${parts.year}-${parts.month}-${parts.day}`;
    if (input.targetDate < currentDate) return true;
    if (input.targetDate > currentDate) return false;
    const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
    return (
        Number.isFinite(currentMinutes) &&
        currentMinutes >= TAIWAN_DAY_SESSION_CLOSE_MINUTES
    );
}

export function createTargetDateRequest(input: Readonly<{
    symbol: unknown;
    sourceIdentity: unknown;
    mode: unknown;
    targetDate: unknown;
    generation: unknown;
}>): TargetDateRequestResult {
    const symbol = canonicalSymbol(input.symbol);
    if (!validSymbol(symbol)) {
        return { status: 'rejected', reason: 'invalid_symbol' };
    }
    if (!validCalendarDate(input.targetDate)) {
        return { status: 'rejected', reason: 'invalid_target_date' };
    }
    const sourceIdentity = canonicalSourceIdentity(input.sourceIdentity);
    if (!validSourceIdentity(sourceIdentity)) {
        return { status: 'rejected', reason: 'invalid_source_identity' };
    }
    if (input.mode !== 'simulation') {
        return { status: 'rejected', reason: 'simulation_required' };
    }
    if (!Number.isInteger(input.generation) || Number(input.generation) <= 0) {
        return { status: 'rejected', reason: 'invalid_generation' };
    }
    const generation = Number(input.generation);
    const singleFlightKey = `${sourceIdentity}|${symbol}|${input.targetDate}|1m`;
    return {
        status: 'accepted',
        request: Object.freeze({
            schemaVersion: DAILY_MINUTE_REQUEST_REVISION,
            symbol,
            sourceIdentity,
            mode: 'simulation',
            targetDate: input.targetDate,
            startDate: input.targetDate,
            endDate: input.targetDate,
            targetInterval: '1m',
            timeZone: 'Asia/Taipei',
            generation,
            maxCandles: DAILY_MINUTE_MAX_CANDLES,
            singleFlightKey,
            requestIdentity: `${singleFlightKey}|${generation}`,
        }),
    };
}

function validTargetDateRequest(value: unknown): value is TargetDateRequest {
    const request = record(value);
    if (!request) return false;
    const symbol = canonicalSymbol(request.symbol);
    const sourceIdentity = canonicalSourceIdentity(request.sourceIdentity);
    if (
        request.schemaVersion !== DAILY_MINUTE_REQUEST_REVISION ||
        !validSymbol(symbol) ||
        request.symbol !== symbol ||
        !validSourceIdentity(sourceIdentity) ||
        request.sourceIdentity !== sourceIdentity ||
        request.mode !== 'simulation' ||
        !validCalendarDate(request.targetDate) ||
        request.startDate !== request.targetDate ||
        request.endDate !== request.targetDate ||
        request.targetInterval !== '1m' ||
        request.timeZone !== 'Asia/Taipei' ||
        !Number.isInteger(request.generation) ||
        Number(request.generation) <= 0 ||
        request.maxCandles !== DAILY_MINUTE_MAX_CANDLES
    ) {
        return false;
    }
    const key = `${sourceIdentity}|${symbol}|${request.targetDate}|1m`;
    return (
        request.singleFlightKey === key &&
        request.requestIdentity === `${key}|${request.generation}`
    );
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function targetDateTurnoverAvailability(
    candles: readonly Readonly<{ turnoverTwd: number | null }>[],
): TargetDateTurnoverAvailability {
    const available = candles.filter(
        (candle) => candle.turnoverTwd !== null,
    ).length;
    if (available === 0) return 'unavailable';
    return available === candles.length ? 'available' : 'partial';
}

function normalizeTargetDateCandle(
    value: unknown,
): TargetDateCandle | TargetDateResponseReason {
    const candle = record(value);
    if (!candle) return 'invalid_candle';
    const priceValues = [
        candle.open,
        candle.high,
        candle.low,
        candle.close,
    ];
    if (
        !Number.isInteger(candle.time) ||
        Number(candle.time) <= 0 ||
        !validCalendarDate(candle.sessionDate) ||
        priceValues.some((price) => !finite(price)) ||
        priceValues.every((price) => price === 0) ||
        !finite(candle.volume) ||
        candle.volume < 0 ||
        !Object.hasOwn(candle, 'turnoverTwd') ||
        !(
            candle.turnoverTwd === null ||
            (Number.isSafeInteger(candle.turnoverTwd) &&
                Number(candle.turnoverTwd) >= 0)
        ) ||
        candle.turnoverSchemaRevision !==
            TARGET_DATE_TURNOVER_SCHEMA_REVISION ||
        candle.turnoverSourceIdentity !==
            TARGET_DATE_TURNOVER_SOURCE_IDENTITY ||
        Number(candle.high) <
            Math.max(Number(candle.open), Number(candle.close)) ||
        Number(candle.low) >
            Math.min(Number(candle.open), Number(candle.close)) ||
        Number(candle.high) < Number(candle.low)
    ) {
        return 'invalid_candle';
    }
    const normalized = {
        time: Number(candle.time),
        sessionDate: String(candle.sessionDate),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume),
        turnoverTwd:
            candle.turnoverTwd === null
                ? null
                : Number(candle.turnoverTwd),
        turnoverSchemaRevision: TARGET_DATE_TURNOVER_SCHEMA_REVISION,
        turnoverSourceIdentity: TARGET_DATE_TURNOVER_SOURCE_IDENTITY,
    };
    return Object.freeze(normalized);
}

function taipeiSessionDate(time: number): string {
    const parts = TAIPEI_DATE_FORMATTER.formatToParts(
        new Date(time * 1000),
    ).reduce<Record<string, string>>((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validateTargetDateResponse(
    request: TargetDateRequest,
    currentGeneration: number,
    value: unknown,
): TargetDateResponseValidation {
    if (!validTargetDateRequest(request)) {
        return { status: 'rejected', reason: 'schema_mismatch' };
    }
    if (request.generation !== currentGeneration) {
        return { status: 'rejected', reason: 'stale_generation' };
    }
    const response = record(value);
    if (
        !response ||
        response.schemaVersion !== DAILY_MINUTE_RESPONSE_REVISION
    ) {
        return { status: 'rejected', reason: 'schema_mismatch' };
    }
    if (response.requestIdentity !== request.singleFlightKey) {
        return {
            status: 'rejected',
            reason: 'response_identity_mismatch',
        };
    }
    if (canonicalSymbol(response.symbol) !== request.symbol) {
        return { status: 'rejected', reason: 'symbol_mismatch' };
    }
    if (
        canonicalSourceIdentity(response.sourceIdentity) !==
        request.sourceIdentity
    ) {
        return { status: 'rejected', reason: 'source_identity_mismatch' };
    }
    if (response.mode !== 'simulation') {
        return { status: 'rejected', reason: 'simulation_required' };
    }
    if (response.targetDate !== request.targetDate) {
        return { status: 'rejected', reason: 'target_date_mismatch' };
    }
    if (response.interval !== '1m') {
        return { status: 'rejected', reason: 'interval_mismatch' };
    }
    if (response.timeZone !== 'Asia/Taipei') {
        return { status: 'rejected', reason: 'time_zone_mismatch' };
    }
    if (
        response.turnoverSchemaRevision !==
            TARGET_DATE_TURNOVER_SCHEMA_REVISION ||
        response.turnoverSourceIdentity !==
            TARGET_DATE_TURNOVER_SOURCE_IDENTITY ||
        !['available', 'partial', 'unavailable'].includes(
            String(response.turnoverAvailability),
        )
    ) {
        return { status: 'rejected', reason: 'schema_mismatch' };
    }
    if (!Array.isArray(response.candles)) {
        return { status: 'rejected', reason: 'schema_mismatch' };
    }
    if (response.candles.length > request.maxCandles) {
        return { status: 'rejected', reason: 'response_too_large' };
    }
    if (response.candles.length === 0) {
        return { status: 'rejected', reason: 'empty_response' };
    }
    const candles: TargetDateCandle[] = [];
    let previousTime = 0;
    for (const value of response.candles) {
        const candle = normalizeTargetDateCandle(value);
        if (typeof candle === 'string') {
            return { status: 'rejected', reason: candle };
        }
        if (
            candle.sessionDate !== request.targetDate ||
            taipeiSessionDate(candle.time) !== request.targetDate
        ) {
            return { status: 'rejected', reason: 'mixed_session_date' };
        }
        if (candle.time <= previousTime) {
            return { status: 'rejected', reason: 'candle_out_of_order' };
        }
        previousTime = candle.time;
        candles.push(candle);
    }
    const turnoverAvailability = targetDateTurnoverAvailability(candles);
    if (response.turnoverAvailability !== turnoverAvailability) {
        return { status: 'rejected', reason: 'schema_mismatch' };
    }
    return {
        status: 'accepted',
        snapshot: Object.freeze({
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
            turnoverAvailability,
            candles: Object.freeze(candles),
        }),
    };
}

export class TargetDateSingleFlight<T> {
    private readonly inflight = new Map<string, Promise<T>>();

    run(
        request: TargetDateRequest,
        load: (request: TargetDateRequest) => Promise<T> | T,
    ): Promise<T> {
        const existing = this.inflight.get(request.singleFlightKey);
        if (existing) return existing;
        let promise: Promise<T>;
        promise = Promise.resolve()
            .then(() => load(request))
            .finally(() => {
                if (this.inflight.get(request.singleFlightKey) === promise) {
                    this.inflight.delete(request.singleFlightKey);
                }
            });
        this.inflight.set(request.singleFlightKey, promise);
        return promise;
    }

    size(): number {
        return this.inflight.size;
    }
}

export function createTargetDateSingleFlight<T>(): TargetDateSingleFlight<T> {
    return new TargetDateSingleFlight<T>();
}

export type DailyGestureOwner =
    | 'none'
    | 'fibonacci'
    | 'price_range'
    | 'fixed_vp'
    | 'drag'
    | 'drawing';

export type DailyGestureEvent = Readonly<{
    candleKey: string;
    eventTime: number;
    button: number;
    interval: string;
    validCandle: boolean;
    mode: string;
    owner: DailyGestureOwner;
}>;

export type DailyGestureResult = Readonly<{
    action: 'pending' | 'single' | 'drilldown' | 'passthrough';
    reason:
        | 'awaiting_second_click'
        | 'single_timeout'
        | 'matching_double_click'
        | 'not_left_button'
        | 'not_daily'
        | 'invalid_target'
        | 'trading_mode'
        | DailyGestureOwner;
}>;

type PendingDailyGesture = Readonly<{
    event: DailyGestureEvent;
    deadline: number;
}>;

function gesturePassthroughReason(
    event: DailyGestureEvent,
): DailyGestureResult['reason'] | null {
    if (event.button !== 0) return 'not_left_button';
    if (event.interval !== '1d') return 'not_daily';
    if (!event.validCandle || !event.candleKey) return 'invalid_target';
    if (event.mode !== 'observe') return 'trading_mode';
    if (event.owner !== 'none') return event.owner;
    if (!Number.isFinite(event.eventTime)) return 'invalid_target';
    return null;
}

export class DailyCandleGestureArbiter {
    private pending: PendingDailyGesture | null = null;

    constructor(
        private readonly callbacks: Readonly<{
            onSingle: (event: DailyGestureEvent) => void;
            onDrilldown: (event: DailyGestureEvent) => void;
        }>,
        private readonly windowMs = DAILY_GESTURE_WINDOW_MS,
    ) {}

    private commitPendingSingle(): DailyGestureResult | null {
        if (!this.pending) return null;
        const event = this.pending.event;
        this.pending = null;
        this.callbacks.onSingle(event);
        return { action: 'single', reason: 'single_timeout' };
    }

    handleClick(event: DailyGestureEvent): DailyGestureResult {
        const passthrough = gesturePassthroughReason(event);
        if (passthrough) {
            this.cancel();
            return { action: 'passthrough', reason: passthrough };
        }
        if (this.pending && event.eventTime > this.pending.deadline) {
            this.flush(this.pending.deadline);
        }
        if (
            this.pending &&
            this.pending.event.candleKey === event.candleKey &&
            event.eventTime <= this.pending.deadline
        ) {
            this.pending = null;
            this.callbacks.onDrilldown(event);
            return {
                action: 'drilldown',
                reason: 'matching_double_click',
            };
        }
        if (this.pending) this.commitPendingSingle();
        this.pending = Object.freeze({
            event: Object.freeze({ ...event }),
            deadline: event.eventTime + this.windowMs,
        });
        return { action: 'pending', reason: 'awaiting_second_click' };
    }

    flush(now: number): DailyGestureResult | null {
        if (!this.pending || now < this.pending.deadline) return null;
        return this.commitPendingSingle();
    }

    cancel(): boolean {
        const changed = this.pending !== null;
        this.pending = null;
        return changed;
    }

    snapshot(): PendingDailyGesture | null {
        return this.pending
            ? Object.freeze({
                  event: Object.freeze({ ...this.pending.event }),
                  deadline: this.pending.deadline,
              })
            : null;
    }
}

export function createDailyCandleGestureArbiter(
    callbacks: ConstructorParameters<typeof DailyCandleGestureArbiter>[0],
): DailyCandleGestureArbiter {
    return new DailyCandleGestureArbiter(callbacks);
}

export type DrilldownChartContext = Readonly<{
    symbol: string;
    panelIdentity: string;
    generation: number;
    interval: string;
    candles: readonly unknown[];
    source: unknown;
    readout: unknown;
    volume: unknown;
    indicators: unknown;
    dayBoundaries: unknown;
    viewport: unknown;
    tools: unknown;
}>;

export type TargetDateCommitReason =
    | TargetDateResponseReason
    | 'context_identity_mismatch'
    | 'request_cancelled'
    | 'projection_incomplete'
    | 'projection_failed';

type TargetDateCommitLayers = Readonly<{
    source: unknown;
    readout: unknown;
    volume: unknown;
    indicators: unknown;
    dayBoundaries: unknown;
    viewport: unknown;
}>;

export type TargetDateCommitResult =
    | Readonly<{ status: 'committed'; context: DrilldownChartContext }>
    | Readonly<{
          status: 'rejected';
          reason: TargetDateCommitReason;
          context: DrilldownChartContext;
      }>;

function completeLayers(value: unknown): value is TargetDateCommitLayers {
    const candidate = record(value);
    return (
        candidate !== null &&
        [
            'source',
            'readout',
            'volume',
            'indicators',
            'dayBoundaries',
            'viewport',
        ].every((key) => candidate[key] !== undefined)
    );
}

function cloneAndFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        return Object.freeze(value.map((item) => cloneAndFreeze(item))) as T;
    }
    if (value && typeof value === 'object') {
        const clone = Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                cloneAndFreeze(item),
            ]),
        );
        return Object.freeze(clone) as T;
    }
    return value;
}

export function commitTargetDateSnapshot(input: Readonly<{
    baseline: DrilldownChartContext;
    request: TargetDateRequest;
    currentIdentity: Readonly<{
        symbol: string;
        panelIdentity: string;
        generation: number;
    }>;
    response: unknown;
    cancelled?: boolean;
    buildLayers: (
        snapshot: ValidatedTargetDateResponse,
        baseline: DrilldownChartContext,
    ) => TargetDateCommitLayers;
}>): TargetDateCommitResult {
    const { baseline, request, currentIdentity } = input;
    if (input.cancelled) {
        return {
            status: 'rejected',
            reason: 'request_cancelled',
            context: baseline,
        };
    }
    if (
        canonicalSymbol(currentIdentity.symbol) !== request.symbol ||
        canonicalSymbol(baseline.symbol) !== request.symbol ||
        baseline.interval !== '1d' ||
        currentIdentity.panelIdentity !== baseline.panelIdentity
    ) {
        return {
            status: 'rejected',
            reason: 'context_identity_mismatch',
            context: baseline,
        };
    }
    const validation = validateTargetDateResponse(
        request,
        currentIdentity.generation,
        input.response,
    );
    if (validation.status === 'rejected') {
        return { ...validation, context: baseline };
    }
    let layers: TargetDateCommitLayers;
    try {
        layers = input.buildLayers(
            validation.snapshot,
            cloneAndFreeze(baseline),
        );
    } catch {
        return {
            status: 'rejected',
            reason: 'projection_failed',
            context: baseline,
        };
    }
    if (!completeLayers(layers)) {
        return {
            status: 'rejected',
            reason: 'projection_incomplete',
            context: baseline,
        };
    }
    return {
        status: 'committed',
        context: cloneAndFreeze({
            symbol: request.symbol,
            panelIdentity: baseline.panelIdentity,
            generation: request.generation,
            interval: '1m',
            candles: validation.snapshot.candles,
            source: layers.source,
            readout: layers.readout,
            volume: layers.volume,
            indicators: layers.indicators,
            dayBoundaries: layers.dayBoundaries,
            viewport: layers.viewport,
            tools: baseline.tools,
        }),
    };
}
