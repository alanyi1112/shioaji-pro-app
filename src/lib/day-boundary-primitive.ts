import type {
    IChartApi,
    IPaneApi,
    IPanePrimitive,
    IPanePrimitivePaneView,
    IPrimitivePaneRenderer,
    PaneAttachedParameter,
    Time,
    UTCTimestamp,
} from 'lightweight-charts';
import type { DayBoundary } from './kbar-readout';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];
export const DAY_BOUNDARY_WIDTH_CSS_PX = 1.2;

class DayBoundaryRenderer implements IPrimitivePaneRenderer {
    constructor(private readonly owner: DayBoundaryPrimitive) {}

    draw(target: RenderTarget): void {
        const chart = this.owner.chart;
        if (!chart || this.owner.boundaries.length === 0) return;
        target.useBitmapCoordinateSpace((scope) => {
            const context = scope.context;
            const lineWidth = Math.max(
                1,
                DAY_BOUNDARY_WIDTH_CSS_PX * scope.horizontalPixelRatio,
            );
            context.save();
            context.fillStyle = this.owner.color;
            for (const boundary of this.owner.boundaries) {
                const previous = chart
                    .timeScale()
                    .timeToCoordinate(boundary.previousTime as UTCTimestamp);
                const next = chart
                    .timeScale()
                    .timeToCoordinate(boundary.nextTime as UTCTimestamp);
                if (previous === null || next === null) continue;
                const mediaX = (Number(previous) + Number(next)) / 2;
                const bitmapX =
                    mediaX * scope.horizontalPixelRatio - lineWidth / 2;
                context.fillRect(bitmapX, 0, lineWidth, scope.bitmapSize.height);
            }
            context.restore();
        });
    }
}

class DayBoundaryPaneView implements IPanePrimitivePaneView {
    private readonly paneRenderer: DayBoundaryRenderer;

    constructor(owner: DayBoundaryPrimitive) {
        this.paneRenderer = new DayBoundaryRenderer(owner);
    }

    zOrder(): 'bottom' {
        return 'bottom';
    }

    renderer(): IPrimitivePaneRenderer {
        return this.paneRenderer;
    }
}

// One instance is attached to each pane. All instances receive the same
// canonical boundaries so their vertical lines stay aligned across panes.
export class DayBoundaryPrimitive implements IPanePrimitive<Time> {
    chart: IChartApi | null = null;
    boundaries: readonly DayBoundary[] = [];
    color = '#facc15';

    private requestUpdate: (() => void) | null = null;
    private readonly view = new DayBoundaryPaneView(this);

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

    setData(boundaries: readonly DayBoundary[], color: string): void {
        this.boundaries = boundaries;
        this.color = color;
        this.requestUpdate?.();
    }
}

type BoundaryPane = Pick<
    IPaneApi<Time>,
    'attachPrimitive' | 'detachPrimitive'
>;

// Keeps exactly one background primitive on every live pane. Panning, zooming
// and resizing are handled by lightweight-charts redraws; data and theme
// changes explicitly request a redraw through setData().
export class DayBoundaryPaneManager {
    private readonly primitives = new Map<
        BoundaryPane,
        DayBoundaryPrimitive
    >();

    constructor(
        private readonly createPrimitive = () => new DayBoundaryPrimitive(),
    ) {}

    reconcile(
        panes: readonly BoundaryPane[],
        boundaries: readonly DayBoundary[],
        color: string,
    ): void {
        const livePanes = new Set(panes);
        for (const [pane, primitive] of this.primitives) {
            if (livePanes.has(pane)) continue;
            try {
                pane.detachPrimitive(primitive);
            } catch {
                // lightweight-charts may already have removed a destroyed pane
            }
            this.primitives.delete(pane);
        }
        for (const pane of panes) {
            let primitive = this.primitives.get(pane);
            if (!primitive) {
                primitive = this.createPrimitive();
                pane.attachPrimitive(primitive);
                this.primitives.set(pane, primitive);
            }
            primitive.setData(boundaries, color);
        }
    }

    update(boundaries: readonly DayBoundary[], color: string): void {
        for (const primitive of this.primitives.values()) {
            primitive.setData(boundaries, color);
        }
    }

    destroy(): void {
        for (const [pane, primitive] of this.primitives) {
            try {
                pane.detachPrimitive(primitive);
            } catch {
                // chart teardown may have detached the primitive already
            }
        }
        this.primitives.clear();
    }

    get size(): number {
        return this.primitives.size;
    }
}
