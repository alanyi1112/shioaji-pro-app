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
import { groupDailyLevels, type DailyLevel } from './daily-indicator-levels';
import { layoutPriceLabels } from './price-label-layout';
import { keyPricePercent, resolveSupportReferenceClose, type KeyPricePercentContext } from './key-price-previous-close';

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
        if (!chart || !priceSeries || (!reference && this.owner.dailyLevels.length === 0)) return;
        target.useBitmapCoordinateSpace((scope) => {
            const anchor = chart
                .timeScale()
                .timeToCoordinate(
                    (projectionStartTime ?? reference?.firstTime ?? 0) as UTCTimestamp,
                );
            const context = scope.context;
            const xRatio = scope.horizontalPixelRatio;
            const yRatio = scope.verticalPixelRatio;
            const startX = Math.max(
                0,
                Math.round(Number(anchor ?? 0) * xRatio),
            );
            const endX = scope.bitmapSize.width;
            // Cull before label layout too: far daily levels must not affect the existing viewport or labels.
            const dailyGroups = groupDailyLevels(this.owner.dailyLevels).flatMap(g => {
                const coordinate = priceSeries.priceToCoordinate(g.price);
                return coordinate === null || !Number.isFinite(coordinate) || coordinate < 0 || coordinate * yRatio > scope.bitmapSize.height
                    ? [] : [{ ...g, coordinate }];
            });
            let labelWidth = dailyGroups.length ? Math.min(210, Math.max(108, ...dailyGroups.map(g => (g.label.length + 9) * 7))) : 82;
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
                          daily: null as (typeof dailyGroups)[number] | null,
                      }];
            });
            dailyGroups.forEach((g, i) => {
                const coordinate = g.coordinate;
                levels.push({ formulaId: 'pivot-point', item: { id: g.keys.join('/'), label: g.label, price: g.price, role: 'pivot', order: 100 + i }, y: Math.round(coordinate * yRatio), labelY: 0, daily: g });
            });
            levels.sort((left, right) => left.y - right.y || left.item.order - right.item.order);
            const supplied = this.owner.percentContext;
            const percentContext = supplied?.baseline.source === 'support-resistance-reference-close-v1'
                ? { ...supplied, baseline: resolveSupportReferenceClose(supplied.baseline.key,
                    reference && this.owner.referenceProductKey ? { key: this.owner.referenceProductKey, reference, pinned: reference.mode === 'pinned' } : null) }
                : supplied;
            const labels = levels.map(({ formulaId, item, daily }) => {
                const text = `${daily ? item.label : `${FORMULA_META[formulaId].prefix} ${item.label}`} ${(daily ? this.owner.dailyPriceFormatter : this.owner.priceFormatter)(item.price)}`;
                const percent = !daily && percentContext ? keyPricePercent(item.price, percentContext) : null;
                return { text, percent, width: this.owner.percentContext ? context.measureText(text + (percent ? `  ${percent.text}` : '')).width : 0 };
            });
            const enhanced = !!this.owner.percentContext;
            const wrap = enhanced && labels.some(l => l.width + 12 * xRatio > endX);
            if (enhanced) labelWidth = Math.min(endX / xRatio, Math.max(...labels.map(l => wrap
                ? Math.max(context.measureText(l.text).width, context.measureText(l.percent?.text ?? '').width) / xRatio + 12
                : l.width / xRatio + 12), 82));
            const rightEdge = enhanced ? Math.max(0, endX - labelWidth * xRatio) : Math.max(startX, endX - labelWidth * xRatio);
            const labelX = rightEdge + 4 * xRatio;
            const positions = layoutPriceLabels(levels.map(l => l.y), scope.bitmapSize.height, (wrap ? 27 : enhanced ? 13 : 12) * yRatio, (wrap ? 16 : enhanced ? 7 : 6) * yRatio);
            const evidence: PivotLabelEvidence[] = [];
            for (const [index, { formulaId, item, y, daily }] of levels.entries()) {
                const position = positions[index]!;
                const labelY = position.y;
                const columnWidth = Math.max(1, (endX - labelX) / position.columns);
                const textX = labelX + position.column * columnWidth;
                const meta = FORMULA_META[formulaId];
                const configured = this.owner.formulaStyles[formulaId];
                const color = daily?.style.color ?? configured?.color ?? meta[item.role];
                context.globalAlpha = daily ? daily.style.opacity / 100 * (daily.stale ? 0.65 : 1) : 1;
                context.beginPath();
                context.setLineDash(
                    (daily ? configuredDash(daily.stale ? 'dotted' : daily.style.lineStyle) : configured
                        ? configuredDash(configured.lineStyle)
                        : levelDash(formulaId, item.id)
                    ).map(
                        (length) => length * xRatio,
                    ),
                );
                context.lineWidth =
                    (daily?.style.width ?? configured?.width ?? (item.role === 'pivot' ? 1.5 : 1)) *
                    yRatio;
                context.strokeStyle = color;
                context.moveTo(daily ? 0 : startX, y);
                context.lineTo(rightEdge, y);
                context.stroke();
                if (Math.abs(labelY - y) > yRatio) {
                    context.beginPath();
                    context.setLineDash([]);
                    context.lineWidth = yRatio;
                    context.moveTo(rightEdge - 10 * xRatio, y);
                    context.lineTo(textX - 2 * xRatio, labelY);
                    context.stroke();
                }
                context.fillStyle = color;
                const label = labels[index]!;
                if (enhanced) {
                    context.fillText(label.text, textX, labelY - (wrap && label.percent ? 6 * yRatio : 0));
                    if (label.percent) {
                        context.fillStyle = label.percent.color;
                        context.fillText(label.percent.text, wrap ? textX : textX + context.measureText(label.text + '  ').width,
                            labelY + (wrap ? 7 * yRatio : 0));
                        evidence.push({ formulaId, level: item.label, price: item.price, text: label.text,
                            percent: label.percent.text, percentValue: label.percent.value, color: label.percent.color,
                            baselineClose: percentContext!.baseline.close,
                            baselineDate: percentContext!.baseline.source === 'support-resistance-reference-close-v1'
                                ? percentContext!.baseline.referenceDate : percentContext!.baseline.source === 'last-daily-chart-close-v1'
                                    ? percentContext!.baseline.date : percentContext!.baseline.previousDate,
                            x: textX / xRatio, y: labelY / yRatio, priceY: y / yRatio });
                    }
                } else context.fillText(label.text, textX, labelY, Math.max(1, columnWidth - 4 * xRatio));
            }
            this.owner.onLabelsDrawn?.(evidence);
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

export type PivotLabelEvidence = { formulaId: string; level: string; price: number; text: string; percent: string;
    percentValue: number | null; color: string; baselineClose: number | null; baselineDate: string | null; x: number; y: number; priceY: number };
export class PivotPrimitive implements IPanePrimitive<Time> {
    /** Bounded passive DOM diagnostics, mirroring labels actually drawn. */
    onLabelsDrawn?: (labels: readonly PivotLabelEvidence[]) => void;
    percentContext: KeyPricePercentContext | undefined;
    setPercentContext(context: KeyPricePercentContext | undefined) { this.percentContext = context; this.onLabelsDrawn?.([]); this.requestUpdate?.(); }
    dailyLevels: readonly DailyLevel[] = [];
    dailyPriceFormatter: (value: number) => string = String;
    setDailyLevels(levels: readonly DailyLevel[], formatter: (value: number) => string = String) {
        this.dailyLevels = levels; this.dailyPriceFormatter = formatter; this.requestUpdate?.();
    }
    chart: IChartApi | null = null;
    reference: SupportResistanceReference | null = null;
    referenceProductKey: string | null = null;
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
        this.referenceProductKey = null;
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
        productKey?: string,
    ): void {
        this.reference = reference;
        this.referenceProductKey = reference ? productKey ?? null : null;
        if (!reference) this.onLabelsDrawn?.([]);
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
