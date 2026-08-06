import {
    FIBONACCI_LEVEL_COLORS,
    FIBONACCI_MONOCHROME_COLOR,
    FIBONACCI_PENDING_GUIDE_COLOR,
    fibonacciAnchorPriceGuide,
    fibonacciLevels,
    type FibonacciDrawing,
    type FibonacciKind,
    type FibonacciPending,
    type FibonacciPoint,
    type FibonacciSnapshot,
} from './fibonacci-annotations';

export interface FibonacciCoordinateApi {
    timeToCoordinate(time: number): number | null;
    priceToCoordinate(price: number): number | null;
}

export interface FibonacciOverlayLine {
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    opacity: number;
    dash?: string;
    kind: 'level' | 'wave-guide' | 'pending-price-guide' | 'pending-price-halo';
}

export interface FibonacciOverlayBand {
    key: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    opacity: number;
}

export interface FibonacciOverlayLabel {
    key: string;
    x: number;
    y: number;
    text: string;
    color: string;
    anchor: 'start' | 'end';
    pendingGuide?: boolean;
}

export interface FibonacciOverlayAnchor {
    key: string;
    x: number;
    y: number;
    label: 'A' | 'B' | 'C';
    preview: boolean;
    opacity: number;
}

export interface FibonacciOverlayModel {
    lines: FibonacciOverlayLine[];
    bands: FibonacciOverlayBand[];
    labels: FibonacciOverlayLabel[];
    anchors: FibonacciOverlayAnchor[];
}

export interface FibonacciAutoscaleBounds {
    signature: string;
    lower: { time: number; value: number }[];
    upper: { time: number; value: number }[];
}

interface BuildOptions {
    width: number;
    height: number;
    rightEdge: number;
    coordinates: FibonacciCoordinateApi;
    formatPrice: (price: number) => string;
}

function finiteCoordinate(value: number | null): value is number {
    return value !== null && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function pointCoordinates(
    anchors: readonly FibonacciPoint[],
    coordinates: FibonacciCoordinateApi,
): { index: number; label: 'A' | 'B' | 'C'; x: number; y: number }[] {
    return anchors.flatMap((anchor, index) => {
        const x = coordinates.timeToCoordinate(anchor.time);
        const y = coordinates.priceToCoordinate(anchor.price);
        const label = (['A', 'B', 'C'] as const)[index];
        return label && finiteCoordinate(x) && finiteCoordinate(y)
            ? [{ index, label, x, y }]
            : [];
    });
}

function drawingColor(
    role: FibonacciDrawing['role'] | 'secondary',
    levelIndex: number,
): string {
    return role === 'secondary'
        ? FIBONACCI_MONOCHROME_COLOR
        : (FIBONACCI_LEVEL_COLORS[levelIndex] ?? FIBONACCI_MONOCHROME_COLOR);
}

function addAnchorsAndGuide(
    model: FibonacciOverlayModel,
    kind: FibonacciKind,
    anchors: readonly FibonacciPoint[],
    options: {
        coordinates: FibonacciCoordinateApi;
        rightEdge: number;
        height: number;
        pending: boolean;
        secondary: boolean;
        previewIndex?: number;
        keyPrefix: string;
    },
) {
    const points = pointCoordinates(anchors, options.coordinates);
    if (points.length >= 2) {
        const color = options.secondary
            ? FIBONACCI_MONOCHROME_COLOR
            : kind === 'retracement'
              ? '#f8fafc'
              : '#d8b4fe';
        for (let index = 1; index < points.length; index += 1) {
            const from = points[index - 1];
            const to = points[index];
            if (!from || !to) continue;
            model.lines.push({
                key: `${options.keyPrefix}-wave-${index}`,
                x1: from.x,
                y1: from.y,
                x2: to.x,
                y2: to.y,
                color,
                opacity: options.pending ? 0.72 : 1,
                dash: options.pending ? '5 5' : '8 7',
                kind: 'wave-guide',
            });
        }
    }
    points.forEach((point) => {
        if (
            point.x < -6 ||
            point.x > options.rightEdge + 6 ||
            point.y < -6 ||
            point.y > options.height + 6
        ) {
            return;
        }
        model.anchors.push({
            key: `${options.keyPrefix}-anchor-${point.index}`,
            x: point.x,
            y: point.y,
            label: point.label,
            preview: point.index === options.previewIndex,
            opacity: options.pending ? (point.index === options.previewIndex ? 1 : 0.82) : 1,
        });
    });
}

function addLevels(
    model: FibonacciOverlayModel,
    kind: FibonacciKind,
    anchors: readonly FibonacciPoint[],
    drawingLevels: ReturnType<typeof fibonacciLevels>,
    options: {
        coordinates: FibonacciCoordinateApi;
        formatPrice: (price: number) => string;
        rightEdge: number;
        height: number;
        pending: boolean;
        role: FibonacciDrawing['role'] | 'secondary';
        keyPrefix: string;
    },
) {
    if (drawingLevels.length === 0) return;
    const points = pointCoordinates(anchors, options.coordinates);
    const rangeIndexes = kind === 'extension' ? [1, 2] : [0, 1];
    const rangePoints = rangeIndexes
        .map((index) => points.find((point) => point.index === index))
        .filter((point): point is NonNullable<typeof point> => Boolean(point));
    if (rangePoints.length !== 2) return;
    const first = rangePoints[0];
    const second = rangePoints[1];
    if (!first || !second) return;
    const lineStartX = clamp(Math.min(first.x, second.x), 0, options.rightEdge);
    if (options.rightEdge - lineStartX < 1) return;
    const entries = drawingLevels
        .flatMap((level, levelIndex) => {
            const y = options.coordinates.priceToCoordinate(level.price);
            return finiteCoordinate(y) && y >= -16 && y <= options.height + 16
                ? [{ ...level, levelIndex, y }]
                : [];
        })
        .sort((left, right) => left.y - right.y);
    if (options.role !== 'secondary') {
        for (let index = 0; index < entries.length - 1; index += 1) {
            const current = entries[index];
            const next = entries[index + 1];
            if (!current || !next) continue;
            const top = clamp(Math.min(current.y, next.y), 0, options.height);
            const bottom = clamp(Math.max(current.y, next.y), 0, options.height);
            if (bottom - top < 0.5) continue;
            model.bands.push({
                key: `${options.keyPrefix}-band-${index}`,
                x: lineStartX,
                y: top,
                width: options.rightEdge - lineStartX,
                height: bottom - top,
                color: drawingColor(options.role, current.levelIndex),
                opacity: options.pending ? 0.12 * 0.72 : 0.12,
            });
        }
    }
    entries.forEach((entry) => {
        const color = drawingColor(options.role, entry.levelIndex);
        model.lines.push({
            key: `${options.keyPrefix}-level-${entry.levelIndex}`,
            x1: lineStartX,
            y1: entry.y,
            x2: options.rightEdge,
            y2: entry.y,
            color,
            opacity: options.pending ? 0.72 : 1,
            kind: 'level',
        });
        const text = `${entry.ratioText} (${options.formatPrice(entry.price)})`;
        const estimatedWidth = text.length * 7;
        const hasLeftSpace = lineStartX >= estimatedWidth + 12;
        model.labels.push({
            key: `${options.keyPrefix}-label-${entry.levelIndex}`,
            x: hasLeftSpace ? lineStartX - 7 : lineStartX + 7,
            y: clamp(entry.y + 4, 12, options.height - 4),
            text,
            color,
            anchor: hasLeftSpace ? 'end' : 'start',
        });
    });
}

function addCompletedDrawing(
    model: FibonacciOverlayModel,
    drawing: FibonacciDrawing,
    options: BuildOptions,
) {
    addLevels(model, drawing.kind, drawing.anchors, drawing.levels, {
        ...options,
        pending: false,
        role: drawing.role,
        keyPrefix: `completed-${drawing.kind}-${drawing.order}`,
    });
    addAnchorsAndGuide(model, drawing.kind, drawing.anchors, {
        ...options,
        pending: false,
        secondary: drawing.role === 'secondary',
        keyPrefix: `completed-${drawing.kind}-${drawing.order}`,
    });
}

function addPendingDrawing(
    model: FibonacciOverlayModel,
    pending: FibonacciPending,
    completed: readonly FibonacciDrawing[],
    options: BuildOptions,
) {
    const previewIndex = pending.preview ? pending.anchors.length : undefined;
    const anchors = pending.preview
        ? [...pending.anchors, pending.preview]
        : pending.anchors;
    const required = pending.kind === 'retracement' ? 2 : 3;
    const levels = anchors.length === required ? fibonacciLevels(pending.kind, anchors) : [];
    const secondary = completed.some((drawing) => drawing.kind !== pending.kind);
    addLevels(model, pending.kind, anchors, levels, {
        ...options,
        pending: true,
        role: secondary ? 'secondary' : 'primary',
        keyPrefix: `pending-${pending.kind}`,
    });
    addAnchorsAndGuide(model, pending.kind, anchors, {
        ...options,
        pending: true,
        secondary,
        previewIndex,
        keyPrefix: `pending-${pending.kind}`,
    });

    const guide = fibonacciAnchorPriceGuide(pending);
    if (!guide) return;
    const y = options.coordinates.priceToCoordinate(guide.point.price);
    if (!finiteCoordinate(y) || y < 0 || y > options.height) return;
    model.lines.push({
        key: 'pending-price-halo',
        x1: 0,
        y1: y,
        x2: options.rightEdge,
        y2: y,
        color: 'rgba(15, 23, 42, 0.94)',
        opacity: 1,
        kind: 'pending-price-halo',
    });
    model.lines.push({
        key: 'pending-price-guide',
        x1: 0,
        y1: y,
        x2: options.rightEdge,
        y2: y,
        color: FIBONACCI_PENDING_GUIDE_COLOR,
        opacity: 1,
        kind: 'pending-price-guide',
    });
    model.labels.push({
        key: 'pending-price-label',
        x: Math.max(8, options.rightEdge - 7),
        y: clamp(y + 4, 13, options.height - 5),
        text: `待選 ${guide.anchorLabel}｜${options.formatPrice(guide.point.price)}`,
        color: FIBONACCI_PENDING_GUIDE_COLOR,
        anchor: 'end',
        pendingGuide: true,
    });
}

export function buildFibonacciOverlayModel(
    snapshot: FibonacciSnapshot,
    options: BuildOptions,
): FibonacciOverlayModel {
    const model: FibonacciOverlayModel = {
        lines: [],
        bands: [],
        labels: [],
        anchors: [],
    };
    if (
        !Number.isFinite(options.width) ||
        !Number.isFinite(options.height) ||
        !Number.isFinite(options.rightEdge) ||
        options.width <= 0 ||
        options.height <= 0 ||
        options.rightEdge < 8
    ) {
        return model;
    }
    snapshot.completed.forEach((drawing) =>
        addCompletedDrawing(model, drawing, options),
    );
    if (snapshot.pending) {
        addPendingDrawing(model, snapshot.pending, snapshot.completed, options);
    }
    return model;
}

export function completedExtensionAutoscaleBounds(
    snapshot: FibonacciSnapshot,
): FibonacciAutoscaleBounds {
    const lowerByTime = new Map<number, number>();
    const upperByTime = new Map<number, number>();
    snapshot.completed
        .filter((drawing) => drawing.kind === 'extension')
        .forEach((drawing) => {
            const prices = drawing.levels
                .map((level) => level.price)
                .filter(Number.isFinite);
            const times = [drawing.anchors[1]?.time, drawing.anchors[2]?.time]
                .map(Number)
                .filter(Number.isFinite);
            if (prices.length === 0 || times.length === 0) return;
            const minimum = Math.min(...prices);
            const maximum = Math.max(...prices);
            times.forEach((time) => {
                lowerByTime.set(
                    time,
                    Math.min(lowerByTime.get(time) ?? minimum, minimum),
                );
                upperByTime.set(
                    time,
                    Math.max(upperByTime.get(time) ?? maximum, maximum),
                );
            });
        });
    const lower = [...lowerByTime]
        .sort(([left], [right]) => left - right)
        .map(([time, value]) => ({ time, value }));
    const upper = [...upperByTime]
        .sort(([left], [right]) => left - right)
        .map(([time, value]) => ({ time, value }));
    return {
        signature: JSON.stringify({ lower, upper }),
        lower,
        upper,
    };
}

export class LatestAnimationFrameScheduler {
    private frame: number | null = null;
    private latestJob: (() => void) | null = null;
    private generation = 0;

    constructor(
        private readonly requestFrame: (callback: FrameRequestCallback) => number =
            (callback) => requestAnimationFrame(callback),
        private readonly cancelFrame: (handle: number) => void =
            (handle) => cancelAnimationFrame(handle),
    ) {}

    schedule(job: () => void) {
        const scheduledGeneration = this.generation;
        this.latestJob = () => {
            if (scheduledGeneration === this.generation) job();
        };
        if (this.frame !== null) return;
        this.frame = this.requestFrame(() => {
            this.frame = null;
            const latest = this.latestJob;
            this.latestJob = null;
            latest?.();
        });
    }

    invalidate() {
        this.generation += 1;
        if (this.frame !== null) this.cancelFrame(this.frame);
        this.frame = null;
        this.latestJob = null;
    }

    hasPendingJob() {
        return this.frame !== null;
    }
}
