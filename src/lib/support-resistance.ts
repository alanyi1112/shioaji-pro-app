import { chronologicalCandles, roundReference } from './indicators';
import {
    PIVOT_SECURITY_TYPES,
    taipeiTradingDate,
    traditionalPivot,
    type PivotReferenceDay,
} from './traditional-pivot';
import type { SecurityType } from './types/contract';
import type { Candle } from './types/market';

export const SUPPORT_RESISTANCE_CONTRACT_VERSION =
    'support-resistance-projection-v1' as const;
export const THREE_LEVEL_PRICE_VERSION = 'three-level-price-tw-v1' as const;
export const CDP_VERSION = 'cdp-wilder-tw-v1' as const;

export type SupportResistanceFormulaId =
    | 'pivot-point'
    | 'three-level-price'
    | 'cdp';

export type SupportResistanceInteractionMode =
    | 'observe'
    | 'buy'
    | 'sell'
    | 'stop'
    | 'take'
    | 'alert';

export function supportResistanceSelectionAllowed(
    mode: SupportResistanceInteractionMode,
    timeframeMinutes: number,
    anyFormulaEnabled: boolean,
): boolean {
    return mode === 'observe' && timeframeMinutes === 1440 && anyFormulaEnabled;
}

export function supportResistanceProjectionStartTime(
    referenceFirstTime: number,
    timeframeMinutes: number,
): number {
    return timeframeMinutes >= 1440
        ? Math.floor(referenceFirstTime / 86_400) * 86_400
        : referenceFirstTime;
}

export const SUPPORT_RESISTANCE_FORMULA_ORDER = [
    'pivot-point',
    'three-level-price',
    'cdp',
] as const satisfies readonly SupportResistanceFormulaId[];

export const SUPPORT_RESISTANCE_FORMULA_VERSIONS = {
    'pivot-point': 'traditional-pivot-tw-v1',
    'three-level-price': THREE_LEVEL_PRICE_VERSION,
    cdp: CDP_VERSION,
} as const;

export interface ReferenceOhlc {
    high: number;
    low: number;
    close: number;
}

export interface SupportResistanceReference extends ReferenceOhlc {
    date: string;
    firstTime: number;
    lastTime: number;
    status: 'completed';
    mode: 'automatic' | 'pinned';
}

export interface SupportResistanceLevel {
    id: string;
    label: string;
    price: number;
    role: 'resistance' | 'pivot' | 'support';
    order: number;
}

export interface SupportResistanceProjection {
    contractVersion: typeof SUPPORT_RESISTANCE_CONTRACT_VERSION;
    formulaId: SupportResistanceFormulaId;
    formulaVersion: (typeof SUPPORT_RESISTANCE_FORMULA_VERSIONS)[SupportResistanceFormulaId];
    reference: SupportResistanceReference;
    levels: readonly SupportResistanceLevel[];
}

export interface ThreeLevelPriceLevels {
    up: number;
    mid: number;
    down: number;
}

export interface CdpLevels {
    ah: number;
    nh: number;
    cdp: number;
    nl: number;
    al: number;
}

export type ReferenceUnavailableReason =
    | 'unsupported-security-type'
    | 'no-completed-trading-day'
    | 'current-day-load-failed'
    | 'source-unavailable'
    | 'invalid-current-day-ohlc';

export type AutomaticReferenceResult =
    | { status: 'available'; reference: SupportResistanceReference }
    | { status: 'unavailable'; reason: ReferenceUnavailableReason };

export interface AutomaticReferenceInput {
    rows: readonly Candle[];
    securityType: SecurityType;
    now: Date | number;
    currentDayLoadState: 'success' | 'failed' | 'loading';
    sourceAvailable: boolean;
}

export function supportResistanceNow(): number {
    if (import.meta.env.DEV && typeof location !== 'undefined') {
        const value = new URLSearchParams(location.search).get('supportNow');
        if (value) {
            const parsed = Date.parse(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return Date.now();
}

export function supportResistanceResolverRuntime(
    currentDayLoadState: AutomaticReferenceInput['currentDayLoadState'],
    sourceAvailable: boolean,
): Pick<
    AutomaticReferenceInput,
    'now' | 'currentDayLoadState' | 'sourceAvailable'
> {
    if (import.meta.env.DEV && typeof location !== 'undefined') {
        const query = new URLSearchParams(location.search);
        const load = query.get('supportLoad');
        if (load === 'failed' || load === 'loading') {
            currentDayLoadState = load;
        }
        if (query.get('supportSource') === 'unavailable') {
            sourceAvailable = false;
        }
    }
    return {
        now: supportResistanceNow(),
        currentDayLoadState,
        sourceAvailable,
    };
}

export function assertValidReferenceOhlc(
    input: ReferenceOhlc,
    prefix = 'support-resistance',
): void {
    if (
        !Number.isFinite(input.high) ||
        !Number.isFinite(input.low) ||
        !Number.isFinite(input.close) ||
        input.high < input.low ||
        input.close < input.low ||
        input.close > input.high
    ) {
        throw new RangeError(`${prefix}:invalid-ohlc`);
    }
}

export function threeLevelPrice(input: ReferenceOhlc): ThreeLevelPriceLevels {
    assertValidReferenceOhlc(input, 'three-level-price');
    const spread = input.high - input.low;
    return {
        up: roundReference(input.high + spread * 0.382),
        mid: roundReference((input.high + input.low) / 2),
        down: roundReference(input.low - spread * 0.382),
    };
}

export function cdpWilder(input: ReferenceOhlc): CdpLevels {
    assertValidReferenceOhlc(input, 'cdp-wilder');
    const cdp = (2 * input.close + input.high + input.low) / 4;
    const spread = input.high - input.low;
    return {
        ah: roundReference(cdp + spread),
        nh: roundReference(2 * cdp - input.low),
        cdp: roundReference(cdp),
        nl: roundReference(2 * cdp - input.high),
        al: roundReference(cdp - spread),
    };
}

const level = (
    id: string,
    label: string,
    price: number,
    role: SupportResistanceLevel['role'],
    order: number,
): SupportResistanceLevel => ({ id, label, price, role, order });

export function buildSupportResistanceProjection(
    formulaId: SupportResistanceFormulaId,
    reference: SupportResistanceReference,
): SupportResistanceProjection {
    assertValidReferenceOhlc(reference);
    let levels: SupportResistanceLevel[];
    if (formulaId === 'pivot-point') {
        const values = traditionalPivot(
            reference.high,
            reference.low,
            reference.close,
        );
        levels = [
            level('r3', 'R3', values.r3, 'resistance', 0),
            level('r2', 'R2', values.r2, 'resistance', 1),
            level('r1', 'R1', values.r1, 'resistance', 2),
            level('p', 'P', values.p, 'pivot', 3),
            level('s1', 'S1', values.s1, 'support', 4),
            level('s2', 'S2', values.s2, 'support', 5),
            level('s3', 'S3', values.s3, 'support', 6),
        ];
    } else if (formulaId === 'three-level-price') {
        const values = threeLevelPrice(reference);
        levels = [
            level('up', '上', values.up, 'resistance', 0),
            level('mid', '中', values.mid, 'pivot', 1),
            level('down', '下', values.down, 'support', 2),
        ];
    } else {
        const values = cdpWilder(reference);
        levels = [
            level('ah', 'AH', values.ah, 'resistance', 0),
            level('nh', 'NH', values.nh, 'resistance', 1),
            level('cdp', 'CDP', values.cdp, 'pivot', 2),
            level('nl', 'NL', values.nl, 'support', 3),
            level('al', 'AL', values.al, 'support', 4),
        ];
    }
    return {
        contractVersion: SUPPORT_RESISTANCE_CONTRACT_VERSION,
        formulaId,
        formulaVersion: SUPPORT_RESISTANCE_FORMULA_VERSIONS[formulaId],
        reference,
        levels,
    };
}

export function pivotReferenceToSupportResistance(
    reference: PivotReferenceDay,
    mode: SupportResistanceReference['mode'] = 'automatic',
): SupportResistanceReference {
    if (reference.status !== 'completed') {
        throw new RangeError('support-resistance:provisional-reference');
    }
    return {
        date: reference.date,
        high: reference.high,
        low: reference.low,
        close: reference.close,
        firstTime: reference.firstTime,
        lastTime: reference.lastTime,
        status: 'completed',
        mode,
    };
}

interface AggregatedDay {
    date: string;
    firstTime: number;
    lastTime: number;
    high: number;
    low: number;
    close: number;
    valid: boolean;
}

function aggregateReferenceDays(rows: readonly Candle[]): AggregatedDay[] {
    const groups = new Map<string, Candle[]>();
    for (const row of chronologicalCandles([...rows])) {
        const date = taipeiTradingDate(row.time);
        const group = groups.get(date) ?? [];
        group.push(row);
        groups.set(date, group);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, group]) => {
            const high = Math.max(...group.map((row) => row.high));
            const low = Math.min(...group.map((row) => row.low));
            const close = group[group.length - 1]!.close;
            let valid = group.every(
                (row) =>
                    Number.isFinite(row.time) &&
                    Number.isFinite(row.open) &&
                    Number.isFinite(row.high) &&
                    Number.isFinite(row.low) &&
                    Number.isFinite(row.close) &&
                    row.high >= row.low &&
                    row.open >= row.low &&
                    row.open <= row.high &&
                    row.close >= row.low &&
                    row.close <= row.high,
            );
            try {
                assertValidReferenceOhlc({ high, low, close });
            } catch {
                valid = false;
            }
            return {
                date,
                firstTime: group[0]!.time,
                lastTime: group[group.length - 1]!.time,
                high: roundReference(high),
                low: roundReference(low),
                close: roundReference(close),
                valid,
            };
        });
}

function taipeiMinutesOfDay(now: Date | number): number {
    const date = typeof now === 'number' ? new Date(now) : now;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === type)?.value ?? 0);
    return value('hour') * 60 + value('minute');
}

function availableReference(day: AggregatedDay): AutomaticReferenceResult {
    return {
        status: 'available',
        reference: {
            date: day.date,
            high: day.high,
            low: day.low,
            close: day.close,
            firstTime: day.firstTime,
            lastTime: day.lastTime,
            status: 'completed',
            mode: 'automatic',
        },
    };
}

export function resolveAutomaticSupportResistanceReference(
    input: AutomaticReferenceInput,
): AutomaticReferenceResult {
    if (!PIVOT_SECURITY_TYPES.has(input.securityType)) {
        return { status: 'unavailable', reason: 'unsupported-security-type' };
    }
    const now = typeof input.now === 'number' ? new Date(input.now) : input.now;
    const today = taipeiTradingDate(now.getTime() / 1000);
    const days = aggregateReferenceDays(input.rows);
    const eligible = days.filter((day) => day.date <= today);
    const latest = eligible.at(-1);
    if (!latest) {
        return { status: 'unavailable', reason: 'no-completed-trading-day' };
    }
    if (latest.date < today) {
        const prior = [...eligible].reverse().find((day) => day.valid);
        return prior
            ? availableReference(prior)
            : { status: 'unavailable', reason: 'no-completed-trading-day' };
    }
    const previous = [...eligible]
        .slice(0, -1)
        .reverse()
        .find((day) => day.valid);
    if (taipeiMinutesOfDay(now) < 13 * 60 + 35) {
        return previous
            ? availableReference(previous)
            : { status: 'unavailable', reason: 'no-completed-trading-day' };
    }
    if (input.currentDayLoadState !== 'success') {
        return previous
            ? availableReference(previous)
            : { status: 'unavailable', reason: 'current-day-load-failed' };
    }
    if (!input.sourceAvailable) {
        return previous
            ? availableReference(previous)
            : { status: 'unavailable', reason: 'source-unavailable' };
    }
    if (!latest.valid) {
        return previous
            ? availableReference(previous)
            : { status: 'unavailable', reason: 'invalid-current-day-ohlc' };
    }
    return availableReference(latest);
}

export function resolveCompletedSupportResistanceReferenceForTime(
    input: AutomaticReferenceInput,
    timestamp: number,
): SupportResistanceReference | null {
    const targetDate = taipeiTradingDate(timestamp);
    const now = typeof input.now === 'number' ? new Date(input.now) : input.now;
    const today = taipeiTradingDate(now.getTime() / 1000);
    const target = aggregateReferenceDays(input.rows).find(
        (day) => day.date === targetDate && day.valid,
    );
    if (!target || target.date > today) return null;
    if (target.date === today) {
        const automatic = resolveAutomaticSupportResistanceReference(input);
        if (
            automatic.status !== 'available' ||
            automatic.reference.date !== target.date
        ) {
            return null;
        }
    }
    return {
        date: target.date,
        high: target.high,
        low: target.low,
        close: target.close,
        firstTime: target.firstTime,
        lastTime: target.lastTime,
        status: 'completed',
        mode: 'pinned',
    };
}
