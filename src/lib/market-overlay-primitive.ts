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
import type { FixedVolumeProfile, FvgMarker, FvgZone } from './market-overlays';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface MarketOverlayColors {
    bullish: string;
    bearish: string;
    profile: string;
    poc: string;
    valueArea: string;
}

const DEFAULT_COLORS: MarketOverlayColors = {
    bullish: 'rgba(32, 201, 151, 0.20)',
    bearish: 'rgba(255, 64, 85, 0.20)',
    profile: 'rgba(61, 139, 255, 0.28)',
    poc: '#e0a43c',
    valueArea: '#8b94a7',
};

class MarketOverlayRenderer implements IPrimitivePaneRenderer {
    constructor(private readonly owner: MarketOverlayPrimitive) {}

    draw(target: RenderTarget): void {
        const { chart, priceSeries } = this.owner;
        if (!chart || !priceSeries) return;
        target.useBitmapCoordinateSpace((scope) => {
            const context = scope.context;
            const xRatio = scope.horizontalPixelRatio;
            const yRatio = scope.verticalPixelRatio;
            context.save();
            for (const zone of this.owner.zones) {
                const start = chart
                    .timeScale()
                    .timeToCoordinate(zone.startTime as UTCTimestamp);
                const end = chart
                    .timeScale()
                    .timeToCoordinate(zone.endTime as UTCTimestamp);
                const upper = priceSeries.priceToCoordinate(zone.upper);
                const lower = priceSeries.priceToCoordinate(zone.lower);
                if (start === null || end === null || upper === null || lower === null) {
                    continue;
                }
                context.fillStyle =
                    zone.direction === 'bullish'
                        ? this.owner.colors.bullish
                        : this.owner.colors.bearish;
                context.fillRect(
                    Math.round(Math.min(Number(start), Number(end)) * xRatio),
                    Math.round(Math.min(Number(upper), Number(lower)) * yRatio),
                    Math.max(1, Math.round(Math.abs(Number(end) - Number(start)) * xRatio)),
                    Math.max(1, Math.round(Math.abs(Number(lower) - Number(upper)) * yRatio)),
                );
            }
            for (const marker of this.owner.markers) {
                const x = chart
                    .timeScale()
                    .timeToCoordinate(marker.time as UTCTimestamp);
                const y = priceSeries.priceToCoordinate(marker.price);
                if (x === null || y === null) continue;
                context.fillStyle =
                    marker.direction === 'bullish'
                        ? this.owner.colors.bullish
                        : this.owner.colors.bearish;
                context.fillRect(
                    Math.round(Number(x) * xRatio - 2 * xRatio),
                    Math.round(Number(y) * yRatio - 2 * yRatio),
                    Math.max(2, Math.round(4 * xRatio)),
                    Math.max(2, Math.round(4 * yRatio)),
                );
            }
            const profile = this.owner.profile;
            if (profile) {
                const start = chart
                    .timeScale()
                    .timeToCoordinate(profile.anchors.startTime as UTCTimestamp);
                const end = chart
                    .timeScale()
                    .timeToCoordinate(profile.anchors.endTime as UTCTimestamp);
                if (start !== null && end !== null) {
                    const right = Math.max(Number(start), Number(end));
                    const available = Math.max(
                        12,
                        Math.abs(Number(end) - Number(start)) * 0.35,
                    );
                    const maxVolume = Math.max(
                        1,
                        ...profile.bins.map((bin) => bin.volume),
                    );
                    context.fillStyle = this.owner.colors.profile;
                    for (const bin of profile.bins) {
                        if (bin.volume <= 0) continue;
                        const upper = priceSeries.priceToCoordinate(bin.upper);
                        const lower = priceSeries.priceToCoordinate(bin.lower);
                        if (upper === null || lower === null) continue;
                        const width = (bin.volume / maxVolume) * available;
                        context.fillRect(
                            Math.round((right - width) * xRatio),
                            Math.round(Math.min(Number(upper), Number(lower)) * yRatio),
                            Math.max(1, Math.round(width * xRatio)),
                            Math.max(1, Math.round(Math.abs(Number(lower) - Number(upper)) * yRatio)),
                        );
                    }
                    const drawLevel = (price: number, color: string) => {
                        const y = priceSeries.priceToCoordinate(price);
                        if (y === null) return;
                        context.fillStyle = color;
                        context.fillRect(
                            Math.round((right - available) * xRatio),
                            Math.round(Number(y) * yRatio),
                            Math.max(1, Math.round(available * xRatio)),
                            Math.max(1, Math.round(yRatio)),
                        );
                    };
                    drawLevel(profile.poc, this.owner.colors.poc);
                    drawLevel(profile.vah, this.owner.colors.valueArea);
                    drawLevel(profile.val, this.owner.colors.valueArea);
                }
            }
            context.restore();
        });
    }
}

class MarketOverlayPaneView implements IPanePrimitivePaneView {
    private readonly paneRenderer: MarketOverlayRenderer;

    constructor(owner: MarketOverlayPrimitive) {
        this.paneRenderer = new MarketOverlayRenderer(owner);
    }

    zOrder(): 'top' {
        return 'top';
    }

    renderer(): IPrimitivePaneRenderer {
        return this.paneRenderer;
    }
}

export class MarketOverlayPrimitive implements IPanePrimitive<Time> {
    chart: IChartApi | null = null;
    zones: readonly FvgZone[] = [];
    markers: readonly FvgMarker[] = [];
    profile: FixedVolumeProfile | null = null;
    colors = DEFAULT_COLORS;
    private requestUpdate: (() => void) | null = null;
    private readonly view = new MarketOverlayPaneView(this);

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
        zones: readonly FvgZone[],
        markers: readonly FvgMarker[],
        profile: FixedVolumeProfile | null,
        colors: MarketOverlayColors = DEFAULT_COLORS,
    ) {
        this.zones = zones;
        this.markers = markers;
        this.profile = profile;
        this.colors = colors;
        this.requestUpdate?.();
    }
}
