import { bollinger, referenceSma } from './indicators';
import type { IndicatorInstance, OutputStyle } from './indicator-defs';
import type { Candle } from './types/market';

export const DAILY_LEVEL_TYPE = 'daily-indicator-levels';
export const DAILY_LEVEL_OUTPUTS = [
    { key: 'ma5', label: '日5MA', period: 5, color: '#e0a43c' },
    { key: 'ma10', label: '日10MA', period: 10, color: '#b06fff' },
    { key: 'ma20', label: '日20MA', period: 20, color: '#3d8bff' },
    { key: 'ma60', label: '日60MA', period: 60, color: '#19b6c9' },
    { key: 'ma120', label: '日120MA', period: 120, color: '#8b94a7' },
    { key: 'upper', label: '日BOLL上軌', period: 0, color: '#5a89c9' },
    { key: 'mid', label: '日BOLL中軌', period: 0, color: '#8b94a7' },
    { key: 'lower', label: '日BOLL下軌', period: 0, color: '#5a89c9' },
] as const;
export type DailyLevelKey = (typeof DAILY_LEVEL_OUTPUTS)[number]['key'];
export type DailyLevelSnapshot = Readonly<{
    key: string;
    bars: readonly Candle[];
    phase: 'forming' | 'closed' | 'unknown';
    state: 'idle' | 'loading' | 'ready' | 'stale' | 'unavailable';
    asOf: number | null;
    receivedAt: number | null;
    generation: number;
    reason?: string;
    knownGap?: boolean;
}>;
export type DailyLevel = {
    key: DailyLevelKey;
    label: string;
    value: number | null;
    required: number;
    available: number;
    status: 'available' | 'insufficient' | 'stale' | 'unavailable';
    style: Required<Pick<OutputStyle, 'color' | 'width' | 'visible' | 'opacity' | 'lineStyle'>>;
};

export function dailyLevelParams(inst: Pick<IndicatorInstance, 'params'>) {
    const { period = 20, mult = 2 } = inst.params;
    if (!Number.isInteger(period) || period < 2 || period > 200 ||
        !Number.isFinite(mult) || mult < 0.5 || mult > 5 || mult * 2 % 1 !== 0) throw new Error('daily_levels_invalid_params');
    return { period, mult };
}

export function dailyLevelDemand(inst: IndicatorInstance | undefined): number {
    if (!inst || inst.hidden) return 0;
    const { period } = dailyLevelParams(inst);
    return Math.max(0, ...DAILY_LEVEL_OUTPUTS.filter(o => inst.styles?.[o.key]?.visible !== false)
        .map(o => o.period || period));
}

export function validDailyLevelBars(bars: readonly Candle[]): boolean {
    return bars.every((b, i) => Number.isFinite(b.time) && b.time % 86400 === 0 &&
        (i === 0 || b.time > bars[i - 1]!.time) &&
        [b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) &&
        b.volume >= 0 && b.low <= b.high && b.open >= b.low && b.open <= b.high &&
        b.close >= b.low && b.close <= b.high);
}

export function computeDailyLevels(snapshot: DailyLevelSnapshot, inst: IndicatorInstance, expectedKey = snapshot.key): DailyLevel[] {
    const { period, mult } = dailyLevelParams(inst);
    const valid = snapshot.key === expectedKey && !snapshot.knownGap && validDailyLevelBars(snapshot.bars);
    const bars = valid ? [...snapshot.bars] : [];
    const bands = bollinger(bars, period, mult);
    return DAILY_LEVEL_OUTPUTS.map(o => {
        const s = inst.styles?.[o.key];
        const required = o.period || period;
        const points = o.period ? referenceSma(bars, o.period) : bands[o.key as 'upper' | 'mid' | 'lower'];
        const value = points.at(-1)?.value;
        const unavailable = !valid || snapshot.state === 'unavailable' || snapshot.state === 'idle';
        return {
            key: o.key, label: o.label, required, available: bars.length,
            value: unavailable || !Number.isFinite(value) ? null : value!,
            status: unavailable ? 'unavailable' : bars.length < required ? 'insufficient' :
                snapshot.state === 'stale' || snapshot.reason === 'new_day_history_pending' ? 'stale' : 'available',
            style: { color: s?.color ?? inst.colors[o.key] ?? o.color, width: s?.width ?? 1,
                visible: s?.visible ?? true, opacity: s?.opacity ?? 100, lineStyle: s?.lineStyle ?? 'dashed' },
        };
    });
}

/** Only exactly equal values share a label. Price-format rounding is never an identity. */
export function groupDailyLevels(levels: readonly DailyLevel[]) {
    const groups = new Map<number, { price: number; label: string; keys: DailyLevelKey[]; style: DailyLevel['style']; stale: boolean }>();
    for (const l of levels) {
        if (!l.style.visible || l.value === null) continue;
        const old = groups.get(l.value);
        if (old) { old.label += `／${l.label}`; old.keys.push(l.key); }
        else groups.set(l.value, { price: l.value, label: l.label, keys: [l.key], style: l.style, stale: l.status === 'stale' });
    }
    return [...groups.values()];
}
