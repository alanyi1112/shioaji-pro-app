import type {
    IChartApi,
    IPanePrimitive,
    IPanePrimitivePaneView,
    IPrimitivePaneRenderer,
    ISeriesApi,
    PaneAttachedParameter,
    Time,
    UTCTimestamp,
} from 'lightweight-charts';
import type { PivotReferenceDay } from './traditional-pivot';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];
const LEVEL_ORDER = ['r3', 'r2', 'r1', 'p', 's1', 's2', 's3'] as const;
const LEVEL_STYLES = {
    p: { color: '#e2e8f0', dash: [] as number[], emphasis: false },
    r1: { color: '#fca5a5', dash: [] as number[], emphasis: true },
    r2: { color: '#f87171', dash: [6, 4], emphasis: false },
    r3: { color: '#ef4444', dash: [2, 4], emphasis: false },
    s1: { color: '#86efac', dash: [] as number[], emphasis: true },
    s2: { color: '#4ade80', dash: [6, 4], emphasis: false },
    s3: { color: '#22c55e', dash: [2, 4], emphasis: false },
} as const;

class PivotRenderer implements IPrimitivePaneRenderer {
    constructor(private readonly owner: PivotPrimitive) {}

    draw(target: RenderTarget): void {
        const { chart, priceSeries, reference } = this.owner;
        if (!chart || !priceSeries || !reference) return;
        target.useBitmapCoordinateSpace((scope) => {
            const anchor = chart
                .timeScale()
                .timeToCoordinate(reference.firstTime as UTCTimestamp);
            const context = scope.context;
            const xRatio = scope.horizontalPixelRatio;
            const yRatio = scope.verticalPixelRatio;
            const startX = Math.max(
                0,
                Math.round(Number(anchor ?? 0) * xRatio),
            );
            const endX = scope.bitmapSize.width;
            const rightEdge = Math.max(startX, endX - 82 * xRatio);
            const labelX = rightEdge + 4 * xRatio;
            context.save();
            context.font = `${Math.max(10, Math.round(10 * yRatio))}px monospace`;
            context.textBaseline = 'middle';
            const levels = LEVEL_ORDER.flatMap((key) => {
                const value = reference.levels[key];
                const coordinate = priceSeries.priceToCoordinate(value);
                return coordinate === null
                    ? []
                    : [{ key, value, y: Math.round(Number(coordinate) * yRatio), labelY: 0 }];
            }).sort((left, right) => left.y - right.y);
            const labelGap = 12 * yRatio;
            levels.forEach((level, index) => {
                level.labelY = Math.max(6 * yRatio, level.y);
                if (index > 0) {
                    level.labelY = Math.max(
                        level.labelY,
                        levels[index - 1]!.labelY + labelGap,
                    );
                }
            });
            for (let index = levels.length - 2; index >= 0; index -= 1) {
                levels[index]!.labelY = Math.min(
                    levels[index]!.labelY,
                    levels[index + 1]!.labelY - labelGap,
                );
            }
            for (const { key, value, y, labelY } of levels) {
                const style = LEVEL_STYLES[key];
                context.beginPath();
                context.setLineDash(style.dash.map((length) => length * xRatio));
                context.lineWidth = (style.emphasis ? 1.5 : 1) * yRatio;
                context.strokeStyle = style.color;
                context.moveTo(startX, y);
                context.lineTo(rightEdge, y);
                context.stroke();
                if (Math.abs(labelY - y) > yRatio) {
                    context.beginPath();
                    context.setLineDash([]);
                    context.lineWidth = yRatio;
                    context.moveTo(rightEdge - 10 * xRatio, y);
                    context.lineTo(rightEdge - 2 * xRatio, labelY);
                    context.stroke();
                }
                context.fillStyle = style.color;
                context.fillText(
                    `${key.toUpperCase()} ${this.owner.priceFormatter(value)}`,
                    labelX,
                    labelY,
                );
            }
            context.restore();
        });
    }
}

class PivotPaneView implements IPanePrimitivePaneView {
    private readonly paneRenderer: PivotRenderer;

    constructor(owner: PivotPrimitive) {
        this.paneRenderer = new PivotRenderer(owner);
    }

    zOrder(): 'top' {
        return 'top';
    }

    renderer(): IPrimitivePaneRenderer {
        return this.paneRenderer;
    }
}

export class PivotPrimitive implements IPanePrimitive<Time> {
    chart: IChartApi | null = null;
    reference: PivotReferenceDay | null = null;
    pivotColor = '#e0a43c';
    levelColor = '#8b94a7';
    priceFormatter: (value: number) => string = (value) => String(value);
    private requestUpdate: (() => void) | null = null;
    private readonly view = new PivotPaneView(this);

    constructor(
        public readonly priceSeries: ISeriesApi<'Candlestick'> | null,
    ) {}

    attached(param: PaneAttachedParameter<Time>): void {
        this.chart = param.chart as IChartApi;
        this.requestUpdate = param.requestUpdate;
    }

    detached(): void {
        this.chart = null;
        this.requestUpdate = null;
    }

    paneViews(): readonly IPanePrimitivePaneView[] {
        return [this.view];
    }

    setData(
        reference: PivotReferenceDay | null,
        pivotColor = '#e0a43c',
        levelColor = '#8b94a7',
        priceFormatter: (value: number) => string = (value) => String(value),
    ) {
        this.reference = reference;
        this.pivotColor = pivotColor;
        this.levelColor = levelColor;
        this.priceFormatter = priceFormatter;
        this.requestUpdate?.();
    }

    autoscaleInfo() {
        if (!this.reference) return null;
        const values = Object.values(this.reference.levels);
        return {
            priceRange: {
                minValue: Math.min(...values),
                maxValue: Math.max(...values),
            },
        };
    }
}
