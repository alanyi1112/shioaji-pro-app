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

class PivotRenderer implements IPrimitivePaneRenderer {
    constructor(private readonly owner: PivotPrimitive) {}

    draw(target: RenderTarget): void {
        const { chart, priceSeries, reference } = this.owner;
        if (!chart || !priceSeries || !reference?.applicationStartTime) return;
        target.useBitmapCoordinateSpace((scope) => {
            const start = chart
                .timeScale()
                .timeToCoordinate(
                    reference.applicationStartTime as UTCTimestamp,
                );
            if (start === null) return;
            const context = scope.context;
            const xRatio = scope.horizontalPixelRatio;
            const yRatio = scope.verticalPixelRatio;
            const startX = Math.round(Number(start) * xRatio);
            const endX = scope.bitmapSize.width;
            context.save();
            context.font = `${Math.max(10, Math.round(10 * yRatio))}px monospace`;
            context.textBaseline = 'bottom';
            let previousLabelY = -Infinity;
            for (const key of LEVEL_ORDER) {
                const value = reference.levels[key];
                const coordinate = priceSeries.priceToCoordinate(value);
                if (coordinate === null) continue;
                const y = Math.round(Number(coordinate) * yRatio);
                context.fillStyle =
                    key === 'p' ? this.owner.pivotColor : this.owner.levelColor;
                context.fillRect(startX, y, Math.max(1, endX - startX), Math.max(1, Math.round(yRatio)));
                const labelY = Math.min(
                    scope.bitmapSize.height,
                    Math.max(
                        0,
                        y - 2 * yRatio,
                        previousLabelY + 12 * yRatio,
                    ),
                );
                previousLabelY = labelY;
                context.fillText(
                    `${key.toUpperCase()} ${value}`,
                    Math.min(endX - 76 * xRatio, startX + 4 * xRatio),
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
    ) {
        this.reference = reference;
        this.pivotColor = pivotColor;
        this.levelColor = levelColor;
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
