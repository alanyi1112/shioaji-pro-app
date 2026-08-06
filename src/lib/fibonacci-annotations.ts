import type { Candle } from './types/market';

export const FIBONACCI_FORMULA_VERSION =
    'multichart-ecae7ca-fibonacci-v1' as const;
export const FIBONACCI_STORAGE_VERSION = 1 as const;
export const FIBONACCI_STORAGE_PREFIX = 'realtimestock.fibonacci.v1';

export const FIBONACCI_LEVEL_COLORS = [
    '#fb7185',
    '#fb923c',
    '#facc15',
    '#84cc16',
    '#2dd4bf',
    '#22d3ee',
    '#818cf8',
] as const;
export const FIBONACCI_MONOCHROME_COLOR = '#cbd5e1';
export const FIBONACCI_PENDING_GUIDE_COLOR = '#38bdf8';

export const RETRACEMENT_LEVELS = [
    0, 0.236, 0.382, 0.5, 0.618, 0.786, 1,
] as const;
export const EXTENSION_LEVELS = [
    0.618, 0.786, 1, 1.272, 1.414, 1.618, 2,
] as const;

export type FibonacciKind = 'retracement' | 'extension';
export type FibonacciClearTarget = FibonacciKind | 'all';
export type FibonacciControllerStatus =
    | 'idle'
    | 'pending-retracement'
    | 'pending-extension';
export type FibonacciPersistenceReason =
    | 'storage-invalid'
    | 'storage-read-failed'
    | 'storage-write-failed'
    | 'storage-clear-failed';

export interface FibonacciPoint {
    time: number;
    price: number;
}

export interface FibonacciLevel {
    ratio: number;
    ratioText: string;
    percentage: string;
    price: number;
}

interface StoredFibonacciDrawing {
    kind: FibonacciKind;
    anchors: FibonacciPoint[];
    order: number;
}

export interface FibonacciDrawing extends StoredFibonacciDrawing {
    levels: FibonacciLevel[];
    role: 'primary' | 'secondary';
}

export interface FibonacciPending {
    kind: FibonacciKind;
    anchors: FibonacciPoint[];
    preview?: FibonacciPoint;
    remaining: number;
}

export interface FibonacciSnapshot {
    identity: string;
    status: FibonacciControllerStatus;
    completed: FibonacciDrawing[];
    pending: FibonacciPending | null;
    persistence: {
        state: 'ready' | 'error';
        reasonCode?: FibonacciPersistenceReason;
    };
}

export interface FibonacciIdentityParts {
    securityType?: string | null;
    exchange?: string | null;
    canonicalCode: string;
    timeframeMinutes: number;
}

export interface FibonacciStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface FibonacciController {
    restore(): FibonacciSnapshot;
    arm(kind: FibonacciKind): boolean;
    previewPoint(point?: FibonacciPoint): boolean;
    addPoint(point: FibonacciPoint): {
        completed: boolean;
        remaining?: number;
        reason?: 'not-armed' | 'invalid-point';
    };
    cancel(): boolean;
    clear(target: FibonacciClearTarget): void;
    getSnapshot(): FibonacciSnapshot;
    hasPending(): boolean;
}

export interface FibonacciPointerDispatchResult {
    consumed: boolean;
    completed?: boolean;
    remaining?: number;
    reason?: 'invalid-point';
}

function finitePoint(point: unknown): point is FibonacciPoint {
    if (!point || typeof point !== 'object') return false;
    const candidate = point as Partial<FibonacciPoint>;
    return Number.isFinite(candidate.time) && Number.isFinite(candidate.price);
}

function clonePoint(point: FibonacciPoint): FibonacciPoint {
    return { time: Number(point.time), price: Number(point.price) };
}

function cloneStoredDrawing(
    drawing: StoredFibonacciDrawing,
): StoredFibonacciDrawing {
    return {
        kind: drawing.kind,
        order: drawing.order,
        anchors: drawing.anchors.map(clonePoint),
    };
}

function requiredAnchorCount(kind: FibonacciKind): 2 | 3 {
    return kind === 'retracement' ? 2 : 3;
}

export function fibonacciRatioText(ratio: number): string {
    return Number.isFinite(ratio) ? String(Number(ratio.toFixed(3))) : '';
}

export function fibonacciPercentageText(ratio: number): string {
    if (!Number.isFinite(ratio)) return '';
    const percentage = ratio * 100;
    return `${Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}

export function fibonacciLevels(
    kind: FibonacciKind,
    anchors: readonly FibonacciPoint[],
): FibonacciLevel[] {
    if (anchors.length !== requiredAnchorCount(kind)) return [];
    if (!anchors.every(finitePoint)) return [];
    const [a, b, c] = anchors;
    if (!a || !b || (kind === 'extension' && !c)) return [];
    const ratios =
        kind === 'retracement' ? RETRACEMENT_LEVELS : EXTENSION_LEVELS;
    return ratios
        .map((ratio) => ({
            ratio,
            ratioText: fibonacciRatioText(ratio),
            percentage: fibonacciPercentageText(ratio),
            price:
                kind === 'retracement'
                    ? b.price - ratio * (b.price - a.price)
                    : c!.price + ratio * (b.price - a.price),
        }))
        .filter((level) => Number.isFinite(level.price));
}

export function fibonacciIdentity(parts: FibonacciIdentityParts): string {
    const securityType =
        String(parts.securityType || 'AUTO').trim().toUpperCase() || 'AUTO';
    const exchange =
        String(parts.exchange || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
    const code = String(parts.canonicalCode || '').trim().toUpperCase();
    const timeframe = Number(parts.timeframeMinutes);
    if (!code || !Number.isFinite(timeframe) || timeframe <= 0) return '';
    return `${securityType}|${exchange}|${code}|${timeframe}`;
}

export function fibonacciStorageKey(identity: string): string {
    const normalized = String(identity || '').trim();
    return normalized
        ? `${FIBONACCI_STORAGE_PREFIX}.${encodeURIComponent(normalized)}`
        : '';
}

export function resolveFibonacciAnchorPoint(
    pending: Pick<FibonacciPending, 'kind' | 'anchors'> | null,
    rawPoint: FibonacciPoint,
    candle: Pick<Candle, 'time' | 'low' | 'high'> | undefined,
    options: {
        freePrice?: boolean;
        normalizePrice?: (price: number) => number;
    } = {},
): FibonacciPoint | null {
    if (!pending || !finitePoint(rawPoint)) return null;
    const anchorIndex = pending.anchors.length;
    if (anchorIndex < 0 || anchorIndex >= requiredAnchorCount(pending.kind)) {
        return null;
    }
    const candleTime = Number(candle?.time);
    const hasCandle = Number.isFinite(candleTime);
    const time = hasCandle ? candleTime : rawPoint.time;
    const normalizePrice = options.normalizePrice ?? ((price: number) => price);
    if (options.freePrice) {
        const price = normalizePrice(rawPoint.price);
        return Number.isFinite(price) ? { time, price } : null;
    }
    if (anchorIndex === 0 || anchorIndex === 1) {
        const price = anchorIndex === 0 ? Number(candle?.low) : Number(candle?.high);
        return hasCandle && Number.isFinite(price) ? { time, price } : null;
    }
    const low = Number(candle?.low);
    if (hasCandle && Number.isFinite(low)) return { time, price: low };
    const price = normalizePrice(rawPoint.price);
    return Number.isFinite(price) ? { time, price } : null;
}

export function futureTimeForLogicalPosition(
    logical: number,
    candles: readonly Pick<Candle, 'time'>[],
    timeframeMinutes: number,
): number | undefined {
    if (
        !Number.isFinite(logical) ||
        !Number.isFinite(timeframeMinutes) ||
        timeframeMinutes <= 0 ||
        candles.length === 0
    ) {
        return undefined;
    }
    const lastIndex = candles.length - 1;
    const lastTime = Number(candles[lastIndex]?.time);
    if (!Number.isFinite(lastTime)) return undefined;
    if (logical <= lastIndex) {
        const candle = candles[Math.max(0, Math.min(lastIndex, Math.round(logical)))];
        return Number.isFinite(candle?.time) ? Number(candle?.time) : undefined;
    }
    const barsAhead = Math.max(1, Math.round(logical - lastIndex));
    return lastTime + barsAhead * timeframeMinutes * 60;
}

export function fibonacciAnchorPriceGuide(
    pending: FibonacciPending | null,
): { anchorLabel: 'A' | 'B' | 'C'; point: FibonacciPoint } | null {
    if (!pending?.preview || !finitePoint(pending.preview)) return null;
    const anchorLabel = (['A', 'B', 'C'] as const)[pending.anchors.length];
    return anchorLabel
        ? { anchorLabel, point: clonePoint(pending.preview) }
        : null;
}

export function dispatchFibonacciPointer(
    controller: FibonacciController,
    phase: 'move' | 'click',
    point: FibonacciPoint | null,
    fallback: () => void,
): FibonacciPointerDispatchResult {
    if (!controller.hasPending()) {
        fallback();
        return { consumed: false };
    }
    if (phase === 'move') {
        controller.previewPoint(point ?? undefined);
        return { consumed: true };
    }
    if (!point) return { consumed: true, reason: 'invalid-point' };
    const result = controller.addPoint(point);
    return {
        consumed: true,
        completed: result.completed,
        ...(result.remaining !== undefined
            ? { remaining: result.remaining }
            : {}),
        ...(result.reason === 'invalid-point'
            ? { reason: result.reason }
            : {}),
    };
}

function normalizeCompleted(value: unknown): StoredFibonacciDrawing[] | null {
    if (!Array.isArray(value)) return null;
    const byKind = new Map<FibonacciKind, StoredFibonacciDrawing>();
    value.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        const candidate = entry as Partial<StoredFibonacciDrawing>;
        if (
            candidate.kind !== 'retracement' &&
            candidate.kind !== 'extension'
        ) {
            return;
        }
        if (
            !Array.isArray(candidate.anchors) ||
            candidate.anchors.length !== requiredAnchorCount(candidate.kind) ||
            !candidate.anchors.every(finitePoint)
        ) {
            return;
        }
        const order =
            Number.isFinite(candidate.order) && Number(candidate.order) > 0
                ? Number(candidate.order)
                : index + 1;
        const normalized: StoredFibonacciDrawing = {
            kind: candidate.kind,
            anchors: candidate.anchors.map(clonePoint),
            order,
        };
        const previous = byKind.get(candidate.kind);
        if (!previous || previous.order <= order) {
            byKind.set(candidate.kind, normalized);
        }
    });
    return [...byKind.values()].sort((left, right) => left.order - right.order);
}

function browserStorage(): FibonacciStorage | undefined {
    try {
        return globalThis.localStorage;
    } catch {
        return undefined;
    }
}

export function createFibonacciController(options: {
    getIdentity: () => string;
    storage?: FibonacciStorage;
    onChange?: (snapshot: FibonacciSnapshot) => void;
}): FibonacciController {
    const storage = options.storage ?? browserStorage();
    const onChange = options.onChange ?? (() => {});
    const memoryByIdentity = new Map<string, StoredFibonacciDrawing[]>();
    let identity = '';
    let completed: StoredFibonacciDrawing[] = [];
    let pending: Omit<FibonacciPending, 'remaining'> | null = null;
    let nextOrder = 1;
    let persistence: FibonacciSnapshot['persistence'] = { state: 'ready' };

    const currentIdentity = () => String(options.getIdentity() || '').trim();

    const setPersistenceError = (reasonCode: FibonacciPersistenceReason) => {
        persistence = { state: 'error', reasonCode };
    };

    const snapshot = (): FibonacciSnapshot => {
        const completedSnapshot = completed.map((drawing, index) => ({
            ...cloneStoredDrawing(drawing),
            role: index === 0 ? ('primary' as const) : ('secondary' as const),
            levels: fibonacciLevels(drawing.kind, drawing.anchors),
        }));
        const pendingSnapshot = pending
            ? {
                  kind: pending.kind,
                  anchors: pending.anchors.map(clonePoint),
                  ...(pending.preview
                      ? { preview: clonePoint(pending.preview) }
                      : {}),
                  remaining:
                      requiredAnchorCount(pending.kind) - pending.anchors.length,
              }
            : null;
        return {
            identity,
            status: pending
                ? pending.kind === 'retracement'
                    ? 'pending-retracement'
                    : 'pending-extension'
                : 'idle',
            completed: completedSnapshot,
            pending: pendingSnapshot,
            persistence: { ...persistence },
        };
    };

    const notify = () => onChange(snapshot());

    const remember = () => {
        if (!identity) return;
        memoryByIdentity.set(identity, completed.map(cloneStoredDrawing));
    };

    const save = () => {
        remember();
        const key = fibonacciStorageKey(identity);
        if (!key || !storage) return;
        try {
            storage.setItem(
                key,
                JSON.stringify({
                    version: FIBONACCI_STORAGE_VERSION,
                    formulaVersion: FIBONACCI_FORMULA_VERSION,
                    completed,
                }),
            );
            persistence = { state: 'ready' };
        } catch {
            setPersistenceError('storage-write-failed');
        }
    };

    const removeStored = () => {
        memoryByIdentity.set(identity, []);
        const key = fibonacciStorageKey(identity);
        if (!key || !storage) return;
        try {
            storage.removeItem(key);
            persistence = { state: 'ready' };
        } catch {
            setPersistenceError('storage-clear-failed');
        }
    };

    const restore = (): FibonacciSnapshot => {
        identity = currentIdentity();
        pending = null;
        persistence = { state: 'ready' };
        const remembered = memoryByIdentity.get(identity);
        if (remembered) {
            completed = remembered.map(cloneStoredDrawing);
            nextOrder =
                Math.max(0, ...completed.map((drawing) => drawing.order)) + 1;
            notify();
            return snapshot();
        }
        completed = [];
        nextOrder = 1;
        const key = fibonacciStorageKey(identity);
        if (!key || !storage) {
            notify();
            return snapshot();
        }
        let raw: string | null;
        try {
            raw = storage.getItem(key);
        } catch {
            setPersistenceError('storage-read-failed');
            notify();
            return snapshot();
        }
        if (!raw) {
            remember();
            notify();
            return snapshot();
        }
        try {
            const parsed = JSON.parse(raw) as {
                version?: unknown;
                formulaVersion?: unknown;
                completed?: unknown;
            };
            if (
                parsed.version !== FIBONACCI_STORAGE_VERSION ||
                parsed.formulaVersion !== FIBONACCI_FORMULA_VERSION
            ) {
                throw new Error('unsupported');
            }
            const normalized = normalizeCompleted(parsed.completed);
            if (!normalized) throw new Error('invalid');
            completed = normalized;
            nextOrder =
                Math.max(0, ...completed.map((drawing) => drawing.order)) + 1;
            remember();
        } catch {
            completed = [];
            nextOrder = 1;
            setPersistenceError('storage-invalid');
            try {
                storage.removeItem(key);
            } catch {
                // Keep the diagnostic identity-scoped and avoid exposing raw data.
            }
            remember();
        }
        notify();
        return snapshot();
    };

    const arm = (kind: FibonacciKind): boolean => {
        if (kind !== 'retracement' && kind !== 'extension') return false;
        if (currentIdentity() !== identity) restore();
        pending = { kind, anchors: [] };
        notify();
        return true;
    };

    const previewPoint = (point?: FibonacciPoint): boolean => {
        if (!pending) return false;
        if (!point || !finitePoint(point)) {
            if (!pending.preview) return false;
            delete pending.preview;
            notify();
            return true;
        }
        const preview = clonePoint(point);
        if (
            pending.preview?.time === preview.time &&
            pending.preview.price === preview.price
        ) {
            return false;
        }
        pending.preview = preview;
        notify();
        return true;
    };

    const addPoint = (point: FibonacciPoint) => {
        if (!pending) return { completed: false, reason: 'not-armed' as const };
        if (!finitePoint(point)) {
            return { completed: false, reason: 'invalid-point' as const };
        }
        delete pending.preview;
        pending.anchors.push(clonePoint(point));
        const required = requiredAnchorCount(pending.kind);
        if (pending.anchors.length < required) {
            const remaining = required - pending.anchors.length;
            notify();
            return { completed: false, remaining };
        }
        completed = [
            ...completed.filter((drawing) => drawing.kind !== pending!.kind),
            {
                kind: pending.kind,
                anchors: pending.anchors.slice(0, required).map(clonePoint),
                order: nextOrder,
            },
        ].sort((left, right) => left.order - right.order);
        nextOrder += 1;
        pending = null;
        save();
        notify();
        return { completed: true };
    };

    const cancel = (): boolean => {
        if (!pending) return false;
        pending = null;
        notify();
        return true;
    };

    const clear = (target: FibonacciClearTarget) => {
        pending = null;
        completed =
            target === 'all'
                ? []
                : completed.filter((drawing) => drawing.kind !== target);
        if (completed.length > 0) save();
        else removeStored();
        notify();
    };

    return {
        restore,
        arm,
        previewPoint,
        addPoint,
        cancel,
        clear,
        getSnapshot: snapshot,
        hasPending: () => pending !== null,
    };
}
