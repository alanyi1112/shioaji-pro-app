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
import {
    buildSupportResistanceProjection,
    pivotReferenceToSupportResistance,
    SUPPORT_RESISTANCE_FORMULA_ORDER,
    type SupportResistanceFormulaId,
    type SupportResistanceProjection,
    type SupportResistanceReference,
} from './support-resistance';
import type { SupportResistanceFormulaStyle } from './support-resistance-indicator-state';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];
const FORMULA_META: Record<
    SupportResistanceFormulaId,
    { prefix: string; resistance: string; pivot: string; support: string; dash: number[] }
> = {
    'pivot-point': {
        prefix: 'PP', resistance: '#f87171', pivot: '#e2e8f0', support: '#4ade80', dash: [],
    },
    'three-level-price': {
        prefix: '三關', resistance: '#fb923c', pivot: '#fbbf24', support: '#a3e635', dash: [7, 4],
    },
    cdp: {
        prefix: 'CDP', resistance: '#c084fc', pivot: '#60a5fa', support: '#22d3ee', dash: [2, 4],
    },
};

function levelDash(
    formulaId: SupportResistanceFormulaId,
    levelId: string,
): number[] {
    if (formulaId === 'pivot-point') {
        if (levelId === 'r2' || levelId === 's2') return [6, 4];
        if (levelId === 'r3' || levelId === 's3') return [2, 4];
    }
    return FORMULA_META[formulaId].dash;
}

function configuredDash(
    style: SupportResistanceFormulaStyle['lineStyle'],
): number[] {
    if (style === 'dashed') return [7, 4];
    if (style === 'dotted') return [2, 4];
    return [];
}

class PivotRenderer implements IPrimitivePaneRenderer {
    constructor(private readonly owner: PivotPrimitive) {}

    draw(target: RenderTarget): void {
            const {
                chart,
                priceSeries,
                reference,
                projections,
                projectionStartTime,
            } = this.owner;
        if (!chart || !priceSeries || !reference || projections.length === 0) return;
        target.useBitmapCoordinateSpace((scope) => {
            const anchor = chart
                .timeScale()
                .timeToCoordinate(
                    (projectionStartTime ?? reference.firstTime) as UTCTimestamp,
                );
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
            const formulaOrder = new Map(
                SUPPORT_RESISTANCE_FORMULA_ORDER.map((id, index) => [id, index]),
            );
            const levels = projections
                .flatMap((projection) =>
                    projection.levels
                        .filter((item) => Number.isFinite(item.price))
                        .map((item) => ({ projection, item })),
                )
                .sort((left, right) =>
                    (formulaOrder.get(left.projection.formulaId) ?? 99) -
                        (formulaOrder.get(right.projection.formulaId) ?? 99) ||
                    left.item.order - right.item.order,
                )
                .flatMap(({ projection, item }) => {
                const coordinate = priceSeries.priceToCoordinate(item.price);
                return coordinate === null
                    ? []
                    : [{
                          formulaId: projection.formulaId,
                          item,
                          y: Math.round(Number(coordinate) * yRatio),
                          labelY: 0,
                      }];
            }).sort((left, right) => left.y - right.y || left.item.order - right.item.order);
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
            for (const { formulaId, item, y, labelY } of levels) {
                const meta = FORMULA_META[formulaId];
                const configured = this.owner.formulaStyles[formulaId];
                const color = configured?.color ?? meta[item.role];
                context.beginPath();
                context.setLineDash(
                    (configured
                        ? configuredDash(configured.lineStyle)
                        : levelDash(formulaId, item.id)
                    ).map(
                        (length) => length * xRatio,
                    ),
                );
                context.lineWidth =
                    (configured?.width ?? (item.role === 'pivot' ? 1.5 : 1)) *
                    yRatio;
                context.strokeStyle = color;
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
                context.fillStyle = color;
                context.fillText(
                    `${meta.prefix} ${item.label} ${this.owner.priceFormatter(item.price)}`,
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
    reference: SupportResistanceReference | null = null;
    projections: readonly SupportResistanceProjection[] = [];
    pivotColor = '#e0a43c';
    levelColor = '#8b94a7';
    priceFormatter: (value: number) => string = (value) => String(value);
    formulaStyles: Partial<
        Record<SupportResistanceFormulaId, SupportResistanceFormulaStyle>
    > = {};
    projectionStartTime: number | null = null;
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
        this.reference = reference
            ? pivotReferenceToSupportResistance(reference, 'automatic')
            : null;
        this.projections = this.reference
            ? [buildSupportResistanceProjection('pivot-point', this.reference)]
            : [];
        this.pivotColor = pivotColor;
        this.levelColor = levelColor;
        this.formulaStyles = {};
        this.projectionStartTime = this.reference?.firstTime ?? null;
        this.priceFormatter = priceFormatter;
        this.requestUpdate?.();
    }

    setProjections(
        reference: SupportResistanceReference | null,
        projections: readonly SupportResistanceProjection[],
        priceFormatter: (value: number) => string = (value) => String(value),
        formulaStyles: Partial<
            Record<SupportResistanceFormulaId, SupportResistanceFormulaStyle>
        > = {},
        projectionStartTime: number | null = reference?.firstTime ?? null,
    ): void {
        this.reference = reference;
        this.projections = reference
            ? projections.filter(
                  (projection) =>
                      projection.reference.date === reference.date &&
                      projection.levels.every((level) =>
                          Number.isFinite(level.price),
                      ),
              )
            : [];
        this.priceFormatter = priceFormatter;
        this.formulaStyles = { ...formulaStyles };
        this.projectionStartTime = reference ? projectionStartTime : null;
        this.requestUpdate?.();
    }

    autoscaleInfo() {
        const values = this.projections.flatMap((projection) =>
            projection.levels
                .map((level) => level.price)
                .filter(Number.isFinite),
        );
        if (values.length === 0) return null;
        return {
            priceRange: {
                minValue: Math.min(...values),
                maxValue: Math.max(...values),
            },
        };
    }
}
