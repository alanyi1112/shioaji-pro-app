// src/components/candle-chart.tsx — K-bar candlestick + volume chart
// (lightweight-charts v5), live-updated from the SSE tick stream.

import {
    AreaSeries,
    CandlestickSeries,
    ColorType,
    createChart,
    HistogramSeries,
    LineSeries,
    LineStyle,
    LineType,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type MouseEventParams,
    type SeriesDataItemTypeMap,
    type UTCTimestamp,
} from 'lightweight-charts';
import {
    ArrowDown,
    ArrowUp,
    Bell,
    Copy,
    Crosshair,
    Eye,
    EyeOff,
    Maximize2,
    MoreHorizontal,
    OctagonX,
    RotateCw,
    Settings2,
    Star,
    X,
} from 'lucide-react';
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { useQuote } from '../hooks/use-stream';
import {
    IndicatorDialog,
    IndicatorSettingsModal,
} from './indicator-dialog';
import { IndicatorReadoutValues } from './indicator-readout-values';
import { FibonacciOverlay } from './fibonacci-overlay';
import {
    buildIndicatorReadoutDisplay,
    colorWithOpacity,
    commitIndicatorDraft,
    DEF_BY_TYPE,
    duplicateInstance,
    instanceLabel,
    loadFavorites,
    getInstancesSnapshot,
    getIndicatorPersistenceStatus,
    newInstance,
    outputStyle,
    saveFavorites,
    splitKbarReadoutInstance,
    subscribeInstances,
    subscribeIndicatorPersistence,
    updateInstances,
    KBAR_READOUT_TYPE,
    SUPPORT_RESISTANCE_INSTANCE_TYPES,
    type IndicatorInstance,
} from '../lib/indicator-defs';
// side-effect import順序：custom-indicators 在 module 載入時就把已存的
// 自訂指標註冊進 DEF_BY_TYPE，canonical store 正規化時才不會把它們丟掉
import { subscribeCustoms } from '../lib/custom-indicators';
import type { IndicatorPoint } from '../lib/indicators';
import { DayBoundaryPaneManager } from '../lib/day-boundary-primitive';
import {
    buildCandleTimeIndex,
    buildKbarReadoutDisplay,
    buildPreviousSessionCloseIndex,
    formingDeadline,
    isReadoutBarForming,
    resolveReadoutReference,
    resolveReadoutCandle,
    selectDayBoundaries,
    taipeiWallClockNowSeconds,
    type KbarReadoutDisplay,
} from '../lib/kbar-readout';
import { priceDirection } from '../lib/price-direction';
import { LatestWinsScheduler } from '../lib/latest-wins-scheduler';
import { IndicatorCheckpointCache } from '../lib/indicator-checkpoints';
import {
    createFibonacciController,
    dispatchFibonacciPointer,
    fibonacciIdentity,
    subscribeFibonacciProductClear,
    futureTimeForLogicalPosition,
    resolveFibonacciAnchorPoint,
    type FibonacciController,
    type FibonacciKind,
    type FibonacciSnapshot,
} from '../lib/fibonacci-annotations';
import {
    completedExtensionAutoscaleBounds,
    LatestAnimationFrameScheduler,
} from '../lib/fibonacci-overlay';
import {
    detectFairValueGaps,
    fixedRangeVolumeProfile,
    normalizeFixedRange,
    type FixedRangeAnchors,
} from '../lib/market-overlays';
import { MarketOverlayPrimitive } from '../lib/market-overlay-primitive';
import {
    pivotSupportReason,
} from '../lib/traditional-pivot';
import { PivotPrimitive } from '../lib/pivot-primitive';
import {
    buildSupportResistanceProjection,
    resolveAutomaticSupportResistanceReference,
    resolveCompletedSupportResistanceReferenceForTime,
    supportResistanceProjectionStartTime,
    supportResistanceResolverRuntime,
    supportResistanceSelectionAllowed,
    type SupportResistanceFormulaId,
} from '../lib/support-resistance';
import {
    enabledSupportResistanceFormulas,
    getSupportResistanceFormulaStyle,
    setSupportResistanceFormulaStyle,
    updateSupportResistanceFormulaForProduct,
} from '../lib/support-resistance-indicator-state';
import {
    clearSupportResistanceProductState,
    getSupportResistanceProductState,
    getSupportResistanceProductStateVersion,
    setSupportResistanceProductState,
    subscribeSupportResistanceProductStates,
    supportResistanceProductKey,
} from '../lib/support-resistance-state';
import { cancelOrder, fetchKbars, updateOrderPrice } from '../lib/shioaji';
import {
    isLatestGeneration,
    nextGeneration,
} from '../lib/latest-generation';
import { setPickedPrice } from '../lib/price-sync';
import { notify, placeQuickOrder } from '../lib/trade';
import {
    addTrigger,
    removeTrigger,
    useTriggers,
} from '../lib/trigger-engine';
import type { ContractInfo } from '../lib/types/contract';
import type { Candle } from '../lib/types/market';
import { ACTIVE_ORDER_STATUSES, type Trade } from '../lib/types/order';
import { fmtContractPrice, fmtPrice } from '../lib/utils/format';
import { roundToTick } from '../lib/utils/ticksize';
import { getChartColors, useThemeSettings } from '../lib/theme-store';
import {
    aggregate,
    dateStrOffset,
    kbarsToCandles,
    wallClockToUtc,
} from '../lib/utils/kbars';
import * as panel from './panel.css';
import * as styles from './candle-chart.css';
import {
    SupportResistanceMenu,
    SupportResistanceStyleDialog,
} from './support-resistance-menu';

// NOTE: the kbars API only serves 1-minute bars, so 1D aggregates a huge
// payload (a year of TXF ≈ 280k bars / 18MB) — keep the range tight enough
// to load on slow machines without looking dead
const TIMEFRAMES = [
    { label: '1m', minutes: 1, days: 3 },
    { label: '5m', minutes: 5, days: 10 },
    { label: '15m', minutes: 15, days: 20 },
    { label: '60m', minutes: 60, days: 60 },
    { label: '1D', minutes: 1440, days: 240 },
] as const;

type TradeMode = 'observe' | 'buy' | 'sell' | 'stop' | 'take' | 'alert';

const TRADE_MODES: { key: TradeMode; label: string }[] = [
    { key: 'observe', label: '游標' },
    { key: 'buy', label: '點價買' },
    { key: 'sell', label: '點價賣' },
    { key: 'stop', label: '停損' },
    { key: 'take', label: '停利' },
    { key: 'alert', label: '警示' },
];

let fibonacciPanelSerial = 0;

function nextFibonacciPanelInstanceId() {
    fibonacciPanelSerial += 1;
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid
        ? `fibonacci-panel-${uuid}`
        : `fibonacci-panel-${Date.now()}-${fibonacciPanelSerial}`;
}

const EMPTY_FIBONACCI_SNAPSHOT: FibonacciSnapshot = {
    identity: '',
    status: 'idle',
    completed: [],
    pending: null,
    persistence: { state: 'ready' },
};

// keep paging until this floor — one page per fetch, spans widen with tf
const MAX_HISTORY_DAYS = 1095; // ~3 years

export function CandleChart({
    contract,
    trades = [],
    onOrdersChanged,
}: {
    contract: ContractInfo;
    trades?: Trade[];
    onOrdersChanged?: () => void;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const lastBarRef = useRef<Candle | null>(null);
    const [tfIdx, setTfIdx] = useState(1); // default 5m
    const [empty, setEmpty] = useState(false);
    const [loading, setLoading] = useState(false);
    // ticks must NOT touch the series until history for the current
    // (symbol, timeframe) is in place — updating a freshly-switched series
    // with a bucket older than its last point makes lightweight-charts
    // throw inside the effect, which unmounts the whole app (issue #1)
    const loadedKeyRef = useRef('');
    const chartLoadGenerationRef = useRef(0);
    const quote = useQuote(contract.code);
    const liveQuote = quote?.tick ?? quote?.index;
    const rawReference = quote?.index
        ? Number(quote.index.reference)
        : contract.reference;
    const currentReference =
        Number.isFinite(rawReference) && rawReference > 0
            ? rawReference
            : undefined;
    const tf = TIMEFRAMES[tfIdx] ?? TIMEFRAMES[1];
    const fibonacciIdentityValue = fibonacciIdentity({
        securityType: contract.security_type,
        exchange: contract.exchange,
        canonicalCode: contract.code,
        timeframeMinutes: tf.minutes,
    });
    const themeSettings = useThemeSettings();
    const colors = getChartColors(themeSettings);
    const themeKey = `${themeSettings.mode}-${themeSettings.convention}`;
    const [mode, setMode] = useState<TradeMode>('observe');
    const [tradeQty, setTradeQty] = useState(1);
    const [fibonacciSnapshot, setFibonacciSnapshot] =
        useState<FibonacciSnapshot>(EMPTY_FIBONACCI_SNAPSHOT);
    const [, setFibonacciRenderVersion] = useState(0);
    const [fibonacciLayout, setFibonacciLayout] = useState({
        width: 0,
        height: 0,
        rightEdge: 0,
    });
    const [fibonacciNotice, setFibonacciNotice] = useState('');
    const fibonacciIdentityRef = useRef(fibonacciIdentityValue);
    fibonacciIdentityRef.current = fibonacciIdentityValue;
    const fibonacciPanelInstanceIdRef = useRef('');
    if (!fibonacciPanelInstanceIdRef.current) {
        fibonacciPanelInstanceIdRef.current = nextFibonacciPanelInstanceId();
    }
    const fibonacciGenerationRef = useRef(0);
    const fibonacciFrameSchedulerRef = useRef<LatestAnimationFrameScheduler | null>(
        null,
    );
    if (fibonacciFrameSchedulerRef.current === null) {
        fibonacciFrameSchedulerRef.current = new LatestAnimationFrameScheduler();
    }
    const scheduleFibonacciRender = () => {
        const identity = fibonacciIdentityRef.current;
        const panelInstanceId = fibonacciPanelInstanceIdRef.current;
        const generation = fibonacciGenerationRef.current;
        fibonacciFrameSchedulerRef.current?.schedule(() => {
            if (
                identity !== fibonacciIdentityRef.current ||
                panelInstanceId !== fibonacciPanelInstanceIdRef.current ||
                generation !== fibonacciGenerationRef.current
            ) {
                return;
            }
            const host = hostRef.current;
            const chart = chartRef.current;
            if (!host?.isConnected || !chart) return;
            const width = Math.max(0, host.clientWidth);
            const height = Math.max(
                0,
                chart.panes()[0]?.getHeight() ?? host.clientHeight,
            );
            const rightEdge = Math.max(
                0,
                width - chart.priceScale('right').width() - 4,
            );
            setFibonacciLayout((current) =>
                current.width === width &&
                current.height === height &&
                current.rightEdge === rightEdge
                    ? current
                    : { width, height, rightEdge },
            );
            setFibonacciRenderVersion((version) => version + 1);
        });
    };
    const scheduleFibonacciRenderRef = useRef(scheduleFibonacciRender);
    scheduleFibonacciRenderRef.current = scheduleFibonacciRender;
    const fibonacciControllerRef = useRef<FibonacciController | null>(null);
    if (fibonacciControllerRef.current === null) {
        fibonacciControllerRef.current = createFibonacciController({
            getIdentity: () => fibonacciIdentityRef.current,
            onChange: (snapshot) => {
                setFibonacciSnapshot(snapshot);
                scheduleFibonacciRenderRef.current();
            },
        });
    }
    const fibonacciAutoScaleLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
    const fibonacciAutoScaleUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
    const fibonacciAutoScaleSignatureRef = useRef('');
    const mainPriceLineDefaultsRef = useRef(
        new Map<ISeriesApi<'Line' | 'Area'>, boolean>(),
    );
    const instances = useSyncExternalStore(
        subscribeInstances,
        getInstancesSnapshot,
        getInstancesSnapshot,
    );
    const indicatorPersistence = useSyncExternalStore(
        subscribeIndicatorPersistence,
        getIndicatorPersistenceStatus,
        getIndicatorPersistenceStatus,
    );
    const supportResistanceStateVersion = useSyncExternalStore(
        subscribeSupportResistanceProductStates,
        getSupportResistanceProductStateVersion,
        getSupportResistanceProductStateVersion,
    );
    const [pickerOpen, setPickerOpen] = useState(false);
    const [supportStyleFor, setSupportStyleFor] =
        useState<SupportResistanceFormulaId | null>(null);
    const [settingsFor, setSettingsFor] = useState<string | null>(null);
    const [settingsDraft, setSettingsDraft] =
        useState<IndicatorInstance | null>(null);
    const [settingsIsNew, setSettingsIsNew] = useState(false);
    const [settingsConflict, setSettingsConflict] = useState<string | null>(
        null,
    );
    const [legendMenuFor, setLegendMenuFor] = useState<string | null>(null);
    // legend live values: instId -> per-output {label,text,color}
    const [legendValues, setLegendValues] = useState<
        Record<
            string,
            { key: string; label: string; text: string; color: string }[]
        >
    >({});
    const [, setIndicatorRuntimeVersion] = useState(0);
    const indicatorRuntimeRef = useRef(
        new Map<
            string,
            {
                chartIdentity: string;
                generation: number;
                state: 'idle' | 'computing' | 'ready' | 'error';
                reasonCode?: 'compute-failed';
            }
        >(),
    );
    const legendMetaRef = useRef(
        new Map<
            string,
            {
                key: string;
                label: string;
                color: string;
                series: ISeriesApi<'Line' | 'Histogram'>;
                last?: number;
                precision?: number;
            }[]
        >(),
    );
    const legendRafRef = useRef(false);
    const [kbarReadout, setKbarReadout] = useState<KbarReadoutDisplay>(() =>
        buildKbarReadoutDisplay(null, 5, false, (value) =>
            fmtContractPrice(contract, value),
        ),
    );
    const selectedReadoutTimeRef = useRef<number | null>(null);
    const formingBarTimeRef = useRef<number | null>(null);
    const formingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const candleTimeIndexRef = useRef(new Map<number, Candle>());
    const readoutRafRef = useRef<number | null>(null);
    const readoutGenerationRef = useRef(0);
    const tfMinutesRef = useRef(tf.minutes);
    tfMinutesRef.current = tf.minutes;
    const dayBoundariesRef = useRef<ReturnType<typeof selectDayBoundaries>>([]);
    const dayPrimitiveManagerRef = useRef(new DayBoundaryPaneManager());
    const marketOverlayPrimitiveRef = useRef<MarketOverlayPrimitive | null>(
        null,
    );
    const pivotPrimitiveRef = useRef<PivotPrimitive | null>(null);
    const fixedRangeAnchorsRef = useRef(
        new Map<string, FixedRangeAnchors>(),
    );
    const rangeSelectionRef = useRef<{
        instanceId: string;
        firstTime: number | null;
    } | null>(null);
    const [overlayRuntimeVersion, setOverlayRuntimeVersion] = useState(0);
    const marketOverlayRefreshRef = useRef<() => void>(() => {});
    const pivotRefreshRef = useRef<() => void>(() => {});
    // sub-pane layout memory: instId -> pane index（上次重建的配置）與
    // instId -> 高度 px（使用者拖出來的上下圖比例，重建時還原）
    const paneAssignRef = useRef(new Map<string, number>());
    // stretch factor 是比例值 — 用它保存/還原上下圖比例才不會像 px
    // 高度那樣每次重建累積捨入漂移；'__main' 鍵保存主圖那份
    const paneStretchRef = useRef(new Map<string, number>());
    const paneHeightsRef = useRef(new Map<string, number>());
    // 副圖 legend 定位：instId -> pane 在 chartHost 內的 top offset px
    const [paneTops, setPaneTops] = useState<Record<string, number>>({});
    const paneRoRef = useRef<ResizeObserver | null>(null);
    const [dataVersion, setDataVersion] = useState(0);
    const barsRef = useRef<Candle[]>([]);
    // raw 1-min candles backing the current view — history pages merge here
    // and re-aggregate so buckets spanning a page seam stay correct
    const rawRef = useRef<Candle[]>([]);
    const supportResistanceAuthorityRef = useRef<{
        key: string;
        rows: Candle[];
        loadState: 'loading' | 'success' | 'failed';
        sourceAvailable: boolean;
    }>({ key: '', rows: [], loadState: 'loading', sourceAvailable: false });
    const historicalReferenceRef = useRef<ReadonlyMap<string, number>>(
        new Map(),
    );
    const rawIdentityRef = useRef('');
    const loadMoreRef = useRef<(() => void) | null>(null);
    const resolveFibonacciPoint = (
        param: MouseEventParams,
    ): ReturnType<typeof resolveFibonacciAnchorPoint> => {
        const pending = fibonacciControllerRef.current?.getSnapshot().pending;
        if (!pending || !param.point) return null;
        const rawPrice = candleSeriesRef.current?.coordinateToPrice(
            param.point.y,
        );
        if (rawPrice === null || rawPrice === undefined) return null;
        const time =
            typeof param.time === 'number'
                ? Number(param.time)
                : typeof param.logical === 'number'
                  ? futureTimeForLogicalPosition(
                        Number(param.logical),
                        barsRef.current,
                        tfMinutesRef.current,
                    )
                  : undefined;
        if (time === undefined) return null;
        return resolveFibonacciAnchorPoint(
            pending,
            { time, price: Number(rawPrice) },
            candleTimeIndexRef.current.get(time),
            {
                alternateModifier: param.sourceEvent?.altKey === true,
                normalizePrice: (price) =>
                    roundToTick(contractRef.current, price),
            },
        );
    };
    const resolveFibonacciPointRef = useRef(resolveFibonacciPoint);
    resolveFibonacciPointRef.current = resolveFibonacciPoint;
    const indSeriesRef = useRef<ISeriesApi<'Line' | 'Histogram'>[]>([]);
    const indSeriesByKeyRef = useRef(
        new Map<
            string,
            {
                series: ISeriesApi<'Line' | 'Histogram' | 'Area'>;
                plot: string;
                signed?: boolean;
                color: string;
            }
        >(),
    );
    const indicatorDataRefreshRef = useRef<() => void>(() => {});
    const indicatorCheckpointRef = useRef(new IndicatorCheckpointCache());
    const indicatorSchedulerRef = useRef<LatestWinsScheduler | null>(null);
    if (indicatorSchedulerRef.current === null) {
        indicatorSchedulerRef.current = new LatestWinsScheduler(120);
    }
    const indicatorGenerationRef = useRef(0);
    const scheduleIndicatorRefresh = () => {
        const generation = indicatorGenerationRef.current;
        indicatorSchedulerRef.current?.schedule(() => {
            if (generation !== indicatorGenerationRef.current) return;
            indicatorDataRefreshRef.current();
            marketOverlayRefreshRef.current();
            pivotRefreshRef.current();
        });
    };
    const scheduleIndicatorRefreshRef = useRef(scheduleIndicatorRefresh);
    scheduleIndicatorRefreshRef.current = scheduleIndicatorRefresh;
    const invalidateIndicatorRefresh = () => {
        indicatorGenerationRef.current += 1;
        indicatorSchedulerRef.current?.invalidate();
        indicatorCheckpointRef.current.clear();
    };
    const invalidateIndicatorRefreshRef = useRef(invalidateIndicatorRefresh);
    invalidateIndicatorRefreshRef.current = invalidateIndicatorRefresh;

    useEffect(() => {
        fibonacciGenerationRef.current += 1;
        fibonacciFrameSchedulerRef.current?.invalidate();
        const restored = fibonacciControllerRef.current?.restore();
        setFibonacciNotice(
            restored?.persistence.state === 'error'
                ? '費波那契圖形目前只保留在記憶體，尚未寫入瀏覽器儲存空間'
                : '',
        );
        scheduleFibonacciRenderRef.current();
    }, [fibonacciIdentityValue]);

    useEffect(
        () =>
            subscribeFibonacciProductClear((productIdentity) => {
                const changed =
                    fibonacciControllerRef.current?.applyProductClear(
                        productIdentity,
                    ) ?? false;
                if (!changed) return;
                fibonacciGenerationRef.current += 1;
                fibonacciFrameSchedulerRef.current?.invalidate();
                setFibonacciNotice('已同步清除目前商品所有時間級別的費波那契圖形');
                scheduleFibonacciRenderRef.current();
            }),
        [],
    );

    useEffect(() => {
        const cancelPending = (message: string) => {
            if (!fibonacciControllerRef.current?.cancel()) return;
            setFibonacciNotice(message);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') cancelPending('已取消費波那契選點');
        };
        const handleBlur = () => cancelPending('視窗失焦，已取消費波那契選點');
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('blur', handleBlur);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('blur', handleBlur);
            fibonacciGenerationRef.current += 1;
            fibonacciFrameSchedulerRef.current?.invalidate();
            fibonacciControllerRef.current?.cancel();
        };
    }, []);
    const triggers = useTriggers().filter((t) => t.code === contract.code);
    const workingOrders = useMemo(
        () =>
            trades.filter(
                (t) =>
                    (t.contract.code === contract.code ||
                        (contract.target_code &&
                            t.contract.code === contract.target_code)) &&
                    ACTIVE_ORDER_STATUSES.has(t.status.status),
            ),
        [trades, contract],
    );
    const workingOrdersRef = useRef(workingOrders);
    workingOrdersRef.current = workingOrders;
    const orderLinesRef = useRef(new Map<string, IPriceLine>());
    const onOrdersChangedRef = useRef(onOrdersChanged);
    onOrdersChangedRef.current = onOrdersChanged;

    // refs so the chart click handler always sees current values
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const qtyRef = useRef(tradeQty);
    qtyRef.current = tradeQty;
    const contractRef = useRef(contract);
    contractRef.current = contract;
    const referenceRef = useRef(currentReference);
    referenceRef.current = currentReference;
    const lastPriceRef = useRef<number | null>(null);

    // legend readout — crosshair position when hovering, latest bar otherwise
    const fmtLegendVal = (v: number, precision?: number) =>
        precision !== undefined
            ? v.toFixed(precision)
            : Math.abs(v) >= 10000
              ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
              : Math.abs(v) >= 100
                ? v.toFixed(1)
                : v.toFixed(2);
    const updateLegend = (param?: MouseEventParams) => {
        const out: Record<
            string,
            { key: string; label: string; text: string; color: string }[]
        > = {};
        legendMetaRef.current.forEach((metas, instId) => {
            out[instId] = metas.map((m) => {
                let v = m.last;
                const d = param?.seriesData?.get(m.series) as
                    | { value?: number }
                    | undefined;
                if (d && typeof d.value === 'number') v = d.value;
                return {
                    key: m.key,
                    label: m.label,
                    text:
                        v === undefined
                            ? '—'
                            : fmtLegendVal(v, m.precision),
                    color: m.color,
                };
            });
        });
        setLegendValues(out);
    };
    const updateLegendRef = useRef(updateLegend);
    updateLegendRef.current = updateLegend;

    const scheduleKbarReadout = () => {
        if (readoutRafRef.current !== null) return;
        const generation = readoutGenerationRef.current;
        readoutRafRef.current = requestAnimationFrame(() => {
            readoutRafRef.current = null;
            if (generation !== readoutGenerationRef.current) return;
            const candle = resolveReadoutCandle(
                barsRef.current,
                candleTimeIndexRef.current,
                selectedReadoutTimeRef.current,
            );
            const minutes = tfMinutesRef.current;
            const forming = candle
                ? isReadoutBarForming({
                      barTime: candle.time,
                      formingBarTime: formingBarTimeRef.current,
                      minutes,
                      securityType: contractRef.current.security_type,
                      nowWallClockSeconds: taipeiWallClockNowSeconds(),
                  })
                : false;
            const readoutReference = resolveReadoutReference({
                candle,
                reference: referenceRef.current,
                historicalReferences: historicalReferenceRef.current,
                securityType: contractRef.current.security_type,
                forming,
            });
            setKbarReadout(
                buildKbarReadoutDisplay(
                    candle,
                    minutes,
                    forming,
                    (value) => fmtContractPrice(contractRef.current, value),
                    readoutReference,
                ),
            );
        });
    };
    const scheduleKbarReadoutRef = useRef(scheduleKbarReadout);
    scheduleKbarReadoutRef.current = scheduleKbarReadout;
    useEffect(() => {
        scheduleKbarReadoutRef.current();
    }, [currentReference]);

    const updateDayPrimitives = () => {
        dayPrimitiveManagerRef.current.update(
            dayBoundariesRef.current,
            colors.grid,
        );
    };
    const updateDayPrimitivesRef = useRef(updateDayPrimitives);
    updateDayPrimitivesRef.current = updateDayPrimitives;

    const reconcileDayPrimitives = () => {
        const chart = chartRef.current;
        if (!chart) return;
        dayPrimitiveManagerRef.current.reconcile(
            chart.panes(),
            dayBoundariesRef.current,
            colors.grid,
        );
    };
    const reconcileDayPrimitivesRef = useRef(reconcileDayPrimitives);
    reconcileDayPrimitivesRef.current = reconcileDayPrimitives;

    const setCanonicalReadoutBars = (bars: Candle[]) => {
        candleTimeIndexRef.current = buildCandleTimeIndex(bars);
        dayBoundariesRef.current = selectDayBoundaries(
            bars,
            tfMinutesRef.current,
        );
        updateDayPrimitivesRef.current();
        scheduleKbarReadoutRef.current();
    };

    const clearFormingTimer = () => {
        if (formingTimerRef.current !== null) {
            clearTimeout(formingTimerRef.current);
            formingTimerRef.current = null;
        }
    };

    const markFormingBar = (barTime: number) => {
        clearFormingTimer();
        const deadline = formingDeadline(
            barTime,
            tfMinutesRef.current,
            contractRef.current.security_type,
        );
        const now = taipeiWallClockNowSeconds();
        if (deadline === null || deadline <= now) {
            formingBarTimeRef.current = null;
            scheduleKbarReadoutRef.current();
            return;
        }
        formingBarTimeRef.current = barTime;
        const generation = readoutGenerationRef.current;
        formingTimerRef.current = setTimeout(
            () => {
                formingTimerRef.current = null;
                if (generation !== readoutGenerationRef.current) return;
                if (formingBarTimeRef.current === barTime) {
                    formingBarTimeRef.current = null;
                    scheduleKbarReadoutRef.current();
                }
            },
            Math.max(0, (deadline - now) * 1000 + 20),
        );
        scheduleKbarReadoutRef.current();
    };

    // chart lifecycle
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const c = getChartColors(themeSettingsRef.current);
        const chart = createChart(host, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: c.text,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: c.grid },
                horzLines: { color: c.grid },
            },
            crosshair: {
                vertLine: {
                    color: c.crosshair,
                    labelBackgroundColor: c.labelBg,
                },
                horzLine: {
                    color: c.crosshair,
                    labelBackgroundColor: c.labelBg,
                },
            },
            rightPriceScale: { borderColor: c.border },
            timeScale: {
                borderColor: c.border,
                timeVisible: true,
                secondsVisible: false,
            },
            autoSize: true,
        });
        const candles = chart.addSeries(CandlestickSeries, {
            upColor: c.up,
            downColor: c.down,
            borderUpColor: c.up,
            borderDownColor: c.down,
            wickUpColor: c.up,
            wickDownColor: c.down,
        });
        const vol = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'vol',
        });
        const fibonacciAutoScaleLower = chart.addSeries(LineSeries, {
            color: 'rgba(0, 0, 0, 0)',
            lineVisible: false,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
        });
        const fibonacciAutoScaleUpper = chart.addSeries(LineSeries, {
            color: 'rgba(0, 0, 0, 0)',
            lineVisible: false,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
        });
        chart.priceScale('vol').applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
        });
        chartRef.current = chart;
        candleSeriesRef.current = candles;
        volSeriesRef.current = vol;
        fibonacciAutoScaleLowerRef.current = fibonacciAutoScaleLower;
        fibonacciAutoScaleUpperRef.current = fibonacciAutoScaleUpper;
        const marketOverlay = new MarketOverlayPrimitive(candles);
        chart.panes()[0]?.attachPrimitive(marketOverlay);
        marketOverlayPrimitiveRef.current = marketOverlay;
        const pivotPrimitive = new PivotPrimitive(candles);
        chart.panes()[0]?.attachPrimitive(pivotPrimitive);
        pivotPrimitiveRef.current = pivotPrimitive;
        reconcileDayPrimitivesRef.current();

        const handleChartClick = (param: MouseEventParams) => {
            const fibonacciResult = dispatchFibonacciPointer(
                fibonacciControllerRef.current!,
                'click',
                resolveFibonacciPointRef.current(param),
                () => {},
            );
            if (fibonacciResult.consumed) {
                if (fibonacciResult.reason === 'invalid-point') {
                    setFibonacciNotice(
                        '目前位置無法建立錨點；A／B 請選 K 棒，C 可選右側空白區',
                    );
                } else if (fibonacciResult.completed) {
                    setFibonacciNotice('費波那契圖形已完成並保存');
                } else if (fibonacciResult.remaining !== undefined) {
                    setFibonacciNotice(
                        `錨點已固定，尚需 ${fibonacciResult.remaining} 點`,
                    );
                }
                return;
            }
            const m = modeRef.current;
            if (!param.point) return;
            const raw = candles.coordinateToPrice(param.point.y);
            if (raw === null) return;
            const c = contractRef.current;
            const price = roundToTick(c, Number(raw));
            if (m === 'observe') {
                const selection = rangeSelectionRef.current;
                if (selection && typeof param.time === 'number') {
                    const selectedTime = Number(param.time);
                    if (selection.firstTime === null) {
                        selection.firstTime = selectedTime;
                    } else {
                        const key = `${selection.instanceId}|${c.code}|${tfMinutesRef.current}`;
                        fixedRangeAnchorsRef.current.set(
                            key,
                            normalizeFixedRange(
                                selection.firstTime,
                                selectedTime,
                            ),
                        );
                        rangeSelectionRef.current = null;
                    }
                    setOverlayRuntimeVersion((version) => version + 1);
                    return;
                }
                if (
                    supportResistanceSelectionAllowed(
                        m,
                        tfMinutesRef.current,
                        enabledSupportResistanceFormulas(
                            getInstancesSnapshot(),
                        ).length > 0,
                    ) &&
                    typeof param.time === 'number'
                ) {
                    const selected =
                        resolveCompletedSupportResistanceReferenceForTime(
                            {
                                rows: rawRef.current,
                                securityType: c.security_type,
                                ...supportResistanceResolverRuntime(
                                    'success',
                                    true,
                                ),
                            },
                            Number(param.time),
                        );
                    if (selected) {
                        const key = supportResistanceProductKey(c);
                        setSupportResistanceProductState({
                            key,
                            reference: selected,
                            pinned: true,
                        });
                        setFibonacciNotice(
                            `壓撐已改用 ${selected.date} K 棒重新計算`,
                        );
                        setOverlayRuntimeVersion((version) => version + 1);
                    } else {
                        setFibonacciNotice(
                            '此 K 棒尚未完成，壓撐 reference 保持不變',
                        );
                    }
                    return;
                }
                setPickedPrice(c.code, price); // sync to order tickets
                return;
            }
            const qty = qtyRef.current;
            const last = lastPriceRef.current;
            setMode('observe'); // one-shot
            if (m === 'buy' || m === 'sell') {
                const action = m === 'buy' ? 'Buy' : 'Sell';
                placeQuickOrder(c, action, price, qty)
                    .then((trade) =>
                        notify({
                            kind: 'ok',
                            title: `📈 圖表${action === 'Buy' ? '買進' : '賣出'}已送出`,
                            body: `${c.code} ${qty} @ ${fmtPrice(price)} (${trade.status.status})`,
                        }),
                    )
                    .catch((e) =>
                        notify({
                            kind: 'err',
                            title: '圖表下單失敗',
                            body: e instanceof Error ? e.message : String(e),
                        }),
                    );
                return;
            }
            // stop / take triggers — direction inferred from click vs last
            if (last === null) {
                notify({
                    kind: 'err',
                    title: '無法掛觸價單',
                    body: '尚未收到即時成交價',
                });
                return;
            }
            const below = price <= last;
            if (m === 'alert') {
                addTrigger({
                    code: c.code,
                    condition: below ? 'below' : 'above',
                    price,
                    action: 'Sell', // unused for alerts
                    quantity: 0,
                    kind: 'alert',
                });
                return;
            }
            if (m === 'stop') {
                addTrigger({
                    code: c.code,
                    condition: below ? 'below' : 'above',
                    price,
                    action: below ? 'Sell' : 'Buy',
                    quantity: qty,
                    kind: 'stop',
                });
            } else {
                addTrigger({
                    code: c.code,
                    condition: below ? 'below' : 'above',
                    price,
                    action: below ? 'Buy' : 'Sell',
                    quantity: qty,
                    kind: 'take',
                });
            }
        };
        chart.subscribeClick(handleChartClick);

        const handleCrosshairMove = (param: MouseEventParams) => {
            selectedReadoutTimeRef.current =
                param.point && typeof param.time === 'number'
                    ? Number(param.time)
                    : null;
            scheduleKbarReadoutRef.current();
            // legend value readout follows the crosshair（rAF-throttled）
            if (!legendRafRef.current) {
                legendRafRef.current = true;
                requestAnimationFrame(() => {
                    legendRafRef.current = false;
                    updateLegendRef.current(
                        param.point ? param : undefined,
                    );
                });
            }
            dispatchFibonacciPointer(
                fibonacciControllerRef.current!,
                'move',
                resolveFibonacciPointRef.current(param),
                () => {
                    if (!param.point) return;
                    const raw = candles.coordinateToPrice(param.point.y);
                    if (raw === null) return;
                    const c = contractRef.current;
                    setPickedPrice(c.code, roundToTick(c, Number(raw)));
                },
            );
            scheduleFibonacciRenderRef.current();
        };
        chart.subscribeCrosshairMove(handleCrosshairMove);

        const handlePointerLeave = () => {
            selectedReadoutTimeRef.current = null;
            scheduleKbarReadoutRef.current();
            updateLegendRef.current(undefined);
            if (fibonacciControllerRef.current?.hasPending()) {
                fibonacciControllerRef.current.previewPoint();
                scheduleFibonacciRenderRef.current();
            }
        };
        host.addEventListener('pointerleave', handlePointerLeave);
        host.addEventListener('mouseleave', handlePointerLeave);
        const handlePointerDownOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && host.contains(event.target)) {
                return;
            }
            handlePointerLeave();
        };
        document.addEventListener(
            'pointerdown',
            handlePointerDownOutside,
            true,
        );

        // TradingView-style infinite history: panning near the left edge
        // pulls an older page of kbars (handler injected by the load effect)
        const handleVisibleRangeChange = (range: { from: number } | null) => {
            scheduleFibonacciRenderRef.current();
            if (range && range.from < 30) loadMoreRef.current?.();
        };
        const handleTimeScaleSizeChange = () =>
            scheduleFibonacciRenderRef.current();
        const handleHostGeometryChange = () =>
            scheduleFibonacciRenderRef.current();
        chart.timeScale().subscribeVisibleLogicalRangeChange(
            handleVisibleRangeChange,
        );
        chart.timeScale().subscribeSizeChange(handleTimeScaleSizeChange);
        const fibonacciResizeObserver = new ResizeObserver(
            handleHostGeometryChange,
        );
        fibonacciResizeObserver.observe(host);
        host.addEventListener('pointermove', handleHostGeometryChange, true);
        host.addEventListener('wheel', handleHostGeometryChange, true);
        scheduleFibonacciRenderRef.current();

        return () => {
            readoutGenerationRef.current += 1;
            invalidateIndicatorRefreshRef.current();
            host.removeEventListener('pointerleave', handlePointerLeave);
            host.removeEventListener('mouseleave', handlePointerLeave);
            host.removeEventListener(
                'pointermove',
                handleHostGeometryChange,
                true,
            );
            host.removeEventListener('wheel', handleHostGeometryChange, true);
            fibonacciResizeObserver.disconnect();
            chart.unsubscribeClick(handleChartClick);
            chart.unsubscribeCrosshairMove(handleCrosshairMove);
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(
                handleVisibleRangeChange,
            );
            chart.timeScale().unsubscribeSizeChange(handleTimeScaleSizeChange);
            document.removeEventListener(
                'pointerdown',
                handlePointerDownOutside,
                true,
            );
            clearFormingTimer();
            if (readoutRafRef.current !== null) {
                cancelAnimationFrame(readoutRafRef.current);
                readoutRafRef.current = null;
            }
            dayPrimitiveManagerRef.current.destroy();
            try {
                chart.panes()[0]?.detachPrimitive(marketOverlay);
            } catch {
                // chart teardown may already have detached it
            }
            marketOverlayPrimitiveRef.current = null;
            try {
                chart.panes()[0]?.detachPrimitive(pivotPrimitive);
            } catch {
                // chart teardown may already have detached it
            }
            pivotPrimitiveRef.current = null;
            indSeriesByKeyRef.current.clear();
            fibonacciFrameSchedulerRef.current?.invalidate();
            fibonacciAutoScaleSignatureRef.current = '';
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volSeriesRef.current = null;
            fibonacciAutoScaleLowerRef.current = null;
            fibonacciAutoScaleUpperRef.current = null;
        };
    }, []);

    useEffect(() => {
        const lowerSeries = fibonacciAutoScaleLowerRef.current;
        const upperSeries = fibonacciAutoScaleUpperRef.current;
        if (!lowerSeries || !upperSeries) return;
        const bounds = completedExtensionAutoscaleBounds(fibonacciSnapshot);
        if (bounds.signature === fibonacciAutoScaleSignatureRef.current) return;
        fibonacciAutoScaleSignatureRef.current = bounds.signature;
        lowerSeries.setData(
            bounds.lower.map(({ time, value }) => ({
                time: time as UTCTimestamp,
                value,
            })),
        );
        upperSeries.setData(
            bounds.upper.map(({ time, value }) => ({
                time: time as UTCTimestamp,
                value,
            })),
        );
        if (bounds.lower.length > 0 || bounds.upper.length > 0) {
            candleSeriesRef.current?.priceScale().applyOptions({
                autoScale: true,
            });
        }
        scheduleFibonacciRenderRef.current();
    }, [fibonacciSnapshot]);

    useEffect(() => {
        const pending = fibonacciSnapshot.pending !== null;
        mainPriceLineDefaultsRef.current.forEach((defaultVisible, series) => {
            try {
                series.applyOptions({
                    crosshairMarkerVisible: pending ? false : defaultVisible,
                });
            } catch {
                // A concurrent indicator rebuild may already have removed it.
            }
        });
        return () => {
            if (!pending) return;
            mainPriceLineDefaultsRef.current.forEach(
                (defaultVisible, series) => {
                    try {
                        series.applyOptions({
                            crosshairMarkerVisible: defaultVisible,
                        });
                    } catch {
                        // Chart teardown owns final disposal.
                    }
                },
            );
        };
    }, [fibonacciSnapshot.pending !== null]);

    useEffect(() => {
        scheduleFibonacciRenderRef.current();
    }, [dataVersion, overlayRuntimeVersion, themeKey, fibonacciSnapshot]);

    // keep latest theme readable inside the chart-creation effect
    const themeSettingsRef = useRef(themeSettings);
    themeSettingsRef.current = themeSettings;

    // restyle chart on theme change
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.applyOptions({
            layout: { textColor: colors.text },
            grid: {
                vertLines: { color: colors.grid },
                horzLines: { color: colors.grid },
            },
            crosshair: {
                vertLine: {
                    color: colors.crosshair,
                    labelBackgroundColor: colors.labelBg,
                },
                horzLine: {
                    color: colors.crosshair,
                    labelBackgroundColor: colors.labelBg,
                },
            },
            rightPriceScale: { borderColor: colors.border },
            timeScale: { borderColor: colors.border },
        });
        candleSeriesRef.current?.applyOptions({
            upColor: colors.up,
            downColor: colors.down,
            borderUpColor: colors.up,
            borderDownColor: colors.down,
            wickUpColor: colors.up,
            wickDownColor: colors.down,
        });
        updateDayPrimitivesRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [themeKey]);

    // The candlestick body still describes open/close direction. Only the
    // latest price line and its right-scale label follow the reference price.
    useEffect(() => {
        const candle = barsRef.current[barsRef.current.length - 1] ?? null;
        const forming = candle
            ? isReadoutBarForming({
                  barTime: candle.time,
                  formingBarTime: formingBarTimeRef.current,
                  minutes: tfMinutesRef.current,
                  securityType: contract.security_type,
                  nowWallClockSeconds: taipeiWallClockNowSeconds(),
              })
            : false;
        const reference = resolveReadoutReference({
            candle,
            reference: currentReference,
            securityType: contract.security_type,
            forming,
        });
        const direction = priceDirection(candle?.close, reference);
        candleSeriesRef.current?.applyOptions({
            priceLineColor:
                direction === 'up'
                    ? colors.up
                    : direction === 'down'
                      ? colors.down
                      : colors.text,
        });
    }, [
        colors.down,
        colors.text,
        colors.up,
        contract.security_type,
        currentReference,
        dataVersion,
        liveQuote?.close,
        themeKey,
    ]);

    // recolor volume bars from cached data on theme change — never refetch
    useEffect(() => {
        const bars = barsRef.current;
        if (bars.length === 0) return;
        volSeriesRef.current?.setData(
            bars.map((b) => ({
                time: b.time as UTCTimestamp,
                value: b.volume,
                color: b.close >= b.open ? colors.upVol : colors.downVol,
            })),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [themeKey]);

    // load kbars on symbol/timeframe change; pages of older history are
    // pulled on demand by the visible-range subscription (loadMoreRef)
    useEffect(() => {
        let cancelled = false;
        const generation = nextGeneration(chartLoadGenerationRef);
        const isCurrent = () =>
            !cancelled &&
            isLatestGeneration(chartLoadGenerationRef, generation);
        const loadKey = `${contract.code}|${tf.minutes}`;
        invalidateIndicatorRefreshRef.current();
        readoutGenerationRef.current += 1;
        selectedReadoutTimeRef.current = null;
        formingBarTimeRef.current = null;
        clearFormingTimer();
        if (readoutRafRef.current !== null) {
            cancelAnimationFrame(readoutRafRef.current);
            readoutRafRef.current = null;
        }
        loadedKeyRef.current = ''; // freeze tick updates while loading
        rawIdentityRef.current = '';
        pivotPrimitiveRef.current?.setData(null);
        lastBarRef.current = null;
        loadMoreRef.current = null;
        setEmpty(false);
        setLoading(true);
        const clearSeries = (allowLive = true) => {
            // the series must never keep a stale timeframe's data — a later
            // tick bucketed for the new timeframe would be "older" than the
            // stale tail and crash the chart library
            candleSeriesRef.current?.setData([]);
            volSeriesRef.current?.setData([]);
            barsRef.current = [];
            rawRef.current = [];
            historicalReferenceRef.current = new Map();
            rawIdentityRef.current = loadKey;
            invalidateIndicatorRefreshRef.current();
            setCanonicalReadoutBars([]);
            setDataVersion((v) => v + 1);
            loadedKeyRef.current = allowLive ? loadKey : '';
        };
        const applyBars = (bars: Candle[]) => {
            candleSeriesRef.current?.setData(
                bars.map((b) => ({
                    time: b.time as UTCTimestamp,
                    open: b.open,
                    high: b.high,
                    low: b.low,
                    close: b.close,
                })),
            );
            volSeriesRef.current?.setData(
                bars.map((b) => ({
                    time: b.time as UTCTimestamp,
                    value: b.volume,
                    color: b.close >= b.open ? colors.upVol : colors.downVol,
                })),
            );
            barsRef.current = bars;
            historicalReferenceRef.current =
                buildPreviousSessionCloseIndex(rawRef.current);
            invalidateIndicatorRefreshRef.current();
            setCanonicalReadoutBars(bars);
            setDataVersion((v) => v + 1);
        };
        // Never label the previous symbol's drawing/readout as the new code
        // while its history request is still in flight.
        clearSeries(false);

        // ---- older-history paging (TradingView-style infinite scroll) ----
        let oldestDay: number = tf.days; // days-ago covered so far
        let fetching = false;
        let dryPages = 0; // consecutive empty pages → assume exhausted
        const loadMore = () => {
            if (fetching || !isCurrent()) return;
            if (loadedKeyRef.current !== loadKey) return;
            if (dryPages >= 3 || oldestDay >= MAX_HISTORY_DAYS) return;
            fetching = true;
            const from = Math.min(oldestDay + tf.days, MAX_HISTORY_DAYS);
            fetchKbars(
                contract,
                dateStrOffset(from),
                dateStrOffset(oldestDay + 1),
            )
                .then((k) => {
                    if (!isCurrent() || loadedKeyRef.current !== loadKey) return;
                    oldestDay = from;
                    const boundary = rawRef.current[0]?.time ?? Infinity;
                    const older = kbarsToCandles(k).filter(
                        (b) => b.time < boundary,
                    );
                    if (older.length === 0) {
                        dryPages += 1;
                        return;
                    }
                    dryPages = 0;
                    rawRef.current = [...older, ...rawRef.current];
                    const bars = aggregate(rawRef.current, tf.minutes);
                    // re-attach the live tail built from ticks since load —
                    // raw history doesn't contain those bars
                    const existing = barsRef.current;
                    const lastAgg =
                        bars.length > 0
                            ? bars[bars.length - 1]!.time
                            : -Infinity;
                    for (const b of existing) {
                        if (b.time === lastAgg) bars[bars.length - 1] = b;
                        else if (b.time > lastAgg) bars.push(b);
                    }
                    applyBars(bars);
                })
                .catch(() => {
                    dryPages += 1;
                })
                .finally(() => {
                    fetching = false;
                });
        };

        fetchKbars(contract, dateStrOffset(tf.days), dateStrOffset(0))
            .then((k) => {
                if (!isCurrent() || !candleSeriesRef.current) return;
                const raw = kbarsToCandles(k);
                const bars = aggregate(raw, tf.minutes);
                if (bars.length === 0) {
                    clearSeries();
                    setEmpty(true);
                    loadMoreRef.current = loadMore; // history may still exist
                    return;
                }
                rawRef.current = raw;
                rawIdentityRef.current = loadKey;
                applyBars(bars);
                lastBarRef.current = bars[bars.length - 1] ?? null;
                if (lastBarRef.current) {
                    markFormingBar(lastBarRef.current.time);
                }
                loadedKeyRef.current = loadKey;
                loadMoreRef.current = loadMore;
                chartRef.current?.timeScale().scrollToRealTime();
                // a manual price-axis drag disables autoScale and pins the
                // range; without re-enabling it the prior symbol's price band
                // sticks (e.g. a 1000元 stock leaves a 10元 stock off-screen,
                // issue #6) — restore auto-fit for every freshly loaded symbol
                candleSeriesRef.current
                    .priceScale()
                    .applyOptions({ autoScale: true });
            })
            .catch(() => {
                if (!isCurrent()) return;
                clearSeries();
                setEmpty(true);
            })
            .finally(() => {
                if (isCurrent()) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract, tf]);

    // A formula-enabled reload starts on 5m. Bootstrap one product-scoped,
    // timeframe-independent canonical 1m authority window so minute charts
    // can mirror the automatic 1D reference without using their viewport.
    useEffect(() => {
        let cancelled = false;
        const key = supportResistanceProductKey(contract);
        supportResistanceAuthorityRef.current = {
            key,
            rows: [],
            loadState: 'loading',
            sourceAvailable: false,
        };
        fetchKbars(contract, dateStrOffset(45), dateStrOffset(0))
            .then((kbars) => {
                if (cancelled) return;
                supportResistanceAuthorityRef.current = {
                    key,
                    rows: kbarsToCandles(kbars),
                    loadState: 'success',
                    sourceAvailable: true,
                };
            })
            .catch(() => {
                if (cancelled) return;
                supportResistanceAuthorityRef.current = {
                    key,
                    rows: [],
                    loadState: 'failed',
                    sourceAvailable: false,
                };
            })
            .finally(() => {
                if (!cancelled) {
                    setOverlayRuntimeVersion((version) => version + 1);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [contract]);

    // Live trade/index quote -> update the current bar. Index products use
    // quote_idx rather than the regular tick stream in Shioaji 1.7.
    if (liveQuote && liveQuote.code === contract.code) {
        const p = Number(liveQuote.close);
        if (Number.isFinite(p)) lastPriceRef.current = p;
    }
    useEffect(() => {
        if (!liveQuote || liveQuote.code !== contract.code) return;
        // 試撮 (simtrade) 揭示價可以是漲跌停天地價 — 畫進 K 棒會把
        // Y 軸尺度撐爆（issue #5），一律排除
        if ('simtrade' in liveQuote && liveQuote.simtrade) return;
        // history for this (symbol, timeframe) not in place yet
        if (loadedKeyRef.current !== `${contract.code}|${tf.minutes}`) return;
        const series = candleSeriesRef.current;
        if (!series) return;
        const price = Number(liveQuote.close);
        if (!Number.isFinite(price)) return;
        const tickTime = wallClockToUtc(
            `${liveQuote.date}T${liveQuote.time}`,
        );
        const rawMinuteTime = Math.floor(tickTime / 60) * 60;
        const rawTail = rawRef.current[rawRef.current.length - 1];
        if (!rawTail || rawMinuteTime > rawTail.time) {
            rawRef.current.push({
                time: rawMinuteTime,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: quote?.tick?.volume ?? 0,
            });
        } else if (rawMinuteTime === rawTail.time) {
            rawTail.high = Math.max(rawTail.high, price);
            rawTail.low = Math.min(rawTail.low, price);
            rawTail.close = price;
            rawTail.volume += quote?.tick?.volume ?? 0;
        }
        const bucketSec = tf.minutes * 60;
        const bucket =
            tf.minutes >= 1440
                ? Math.floor(tickTime / 86400) * 86400
                : Math.floor(tickTime / bucketSec) * bucketSec;
        let bar = lastBarRef.current;
        if (bar && bucket < bar.time) return; // stale/out-of-order quote
        let addedBar = false;
        if (!bar || bucket > bar.time) {
            bar = {
                time: bucket,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: quote?.tick?.volume ?? 0,
            };
            // a fresh bucket = the previous bar closed — keep barsRef in
            // sync (history paging re-attaches this tail) and recompute
            // indicators once per bar close
            barsRef.current.push(bar);
            addedBar = true;
            setDataVersion((v) => v + 1);
        } else {
            bar.high = Math.max(bar.high, price);
            bar.low = Math.min(bar.low, price);
            bar.close = price;
            bar.volume += quote?.tick?.volume ?? 0;
        }
        lastBarRef.current = bar;
        markFormingBar(bar.time);
        if (addedBar) setCanonicalReadoutBars(barsRef.current);
        else scheduleKbarReadoutRef.current();
        if (addedBar) invalidateIndicatorRefreshRef.current();
        else scheduleIndicatorRefreshRef.current();
        try {
            series.update({
                time: bar.time as UTCTimestamp,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
            });
            volSeriesRef.current?.update({
                time: bar.time as UTCTimestamp,
                value: bar.volume,
                color: bar.close >= bar.open ? colors.upVol : colors.downVol,
            });
        } catch {
            // a rejected update (e.g. timestamp older than the series tail)
            // must never take the app down — history reload will resync
        }
    }, [liveQuote, quote?.tick?.volume, contract.code, tf.minutes]);

    // 自訂指標增刪改 → 重算指標 effect；被刪掉的型別把殘留實例一併清掉
    const [customVer, setCustomVer] = useState(0);
    useEffect(
        () =>
            subscribeCustoms(() => {
                setCustomVer((v) => v + 1);
                updateInstances((cur) => {
                    const kept = cur.filter((i) => DEF_BY_TYPE.has(i.type));
                    if (kept.length === cur.length) return cur;
                    return kept;
                });
            }),
        [],
    );

    const refreshMarketOverlays = () => {
        const primitive = marketOverlayPrimitiveRef.current;
        if (!primitive) return;
        const active = getInstancesSnapshot().filter(
            (instance) =>
                !instance.hidden &&
                (!instance.visibleTf ||
                    instance.visibleTf.includes(tf.minutes)),
        );
        const showFvg = active.some(
            (instance) => instance.type === 'fair-value-gap',
        );
        const fvg = showFvg
            ? detectFairValueGaps(barsRef.current)
            : { zones: [], markers: [] };
        const profileInstance = active.find(
            (instance) => instance.type === 'fixed-volume-profile',
        );
        const anchors = profileInstance
            ? fixedRangeAnchorsRef.current.get(
                  `${profileInstance.id}|${contract.code}|${tf.minutes}`,
              )
            : undefined;
        const profile = anchors
            ? fixedRangeVolumeProfile(barsRef.current, anchors)
            : null;
        primitive.setData(fvg.zones, fvg.markers, profile, {
            bullish: 'rgba(32, 201, 151, 0.20)',
            bearish: 'rgba(255, 64, 85, 0.20)',
            profile: 'rgba(61, 139, 255, 0.28)',
            poc: '#e0a43c',
            valueArea: colors.text,
        });
    };
    marketOverlayRefreshRef.current = refreshMarketOverlays;

    const refreshPivot = () => {
        const primitive = pivotPrimitiveRef.current;
        if (!primitive) return;
        const snapshot = getInstancesSnapshot();
        const enabled = enabledSupportResistanceFormulas(snapshot);
        const productKey = supportResistanceProductKey(contract);
        if (
            enabled.length === 0 ||
            pivotSupportReason(contract.security_type, tf.minutes) ||
            rawIdentityRef.current !== `${contract.code}|${tf.minutes}`
        ) {
            primitive.setProjections(null, []);
            if (enabled.length === 0) {
                clearSupportResistanceProductState(productKey);
            }
            return;
        }
        let reference = getSupportResistanceProductState(productKey)?.reference ?? null;
        if (tf.minutes === 1440) {
            const current = getSupportResistanceProductState(productKey);
            if (!current?.pinned) {
                const resolved = resolveAutomaticSupportResistanceReference({
                    rows: rawRef.current,
                    securityType: contract.security_type,
                    ...supportResistanceResolverRuntime(
                        loading ? 'loading' : 'success',
                        !empty,
                    ),
                });
                reference =
                    resolved.status === 'available'
                        ? resolved.reference
                        : null;
            }
            if (reference) {
                setSupportResistanceProductState({
                    key: productKey,
                    reference,
                    pinned: reference.mode === 'pinned',
                });
            } else {
                clearSupportResistanceProductState(productKey);
            }
        } else if (!reference) {
            const authority = supportResistanceAuthorityRef.current;
            if (authority.key === productKey) {
                const resolved = resolveAutomaticSupportResistanceReference({
                    rows: authority.rows,
                    securityType: contract.security_type,
                    ...supportResistanceResolverRuntime(
                        authority.loadState,
                        authority.sourceAvailable,
                    ),
                });
                if (resolved.status === 'available') {
                    reference = resolved.reference;
                    setSupportResistanceProductState({
                        key: productKey,
                        reference,
                        pinned: false,
                    });
                }
            }
        }
        primitive.setProjections(
            reference,
            reference
                ? enabled.map((formulaId) =>
                      buildSupportResistanceProjection(formulaId, reference!),
                  )
                : [],
            fmtPrice,
            Object.fromEntries(
                enabled.flatMap((formulaId) => {
                    const style = getSupportResistanceFormulaStyle(
                        snapshot,
                        formulaId,
                    );
                    return style ? [[formulaId, style]] : [];
                }),
            ),
            reference
                ? supportResistanceProjectionStartTime(
                      reference.firstTime,
                      tf.minutes,
                  )
                : null,
        );
    };
    pivotRefreshRef.current = refreshPivot;

    const refreshIndicatorData = () => {
        const bars = barsRef.current;
        if (bars.length === 0) return;
        const generation = indicatorGenerationRef.current;
        const lastValue = (points: IndicatorPoint[]) => {
            for (let index = points.length - 1; index >= 0; index--) {
                if (points[index]!.value !== undefined) {
                    return points[index]!.value;
                }
            }
            return undefined;
        };
        for (const inst of getInstancesSnapshot()) {
            const def = DEF_BY_TYPE.get(inst.type);
            if (!def || def.kind !== 'series' || inst.hidden) continue;
            if (inst.visibleTf && !inst.visibleTf.includes(tf.minutes)) {
                continue;
            }
            const params = Object.fromEntries(
                def.params.map((param) => [
                    param.key,
                    inst.params[param.key] ?? param.def,
                ]),
            );
            let output: Record<string, IndicatorPoint[]>;
            const chartIdentity = `${contract.code}:${tf.minutes}`;
            const setRuntime = (
                state: 'computing' | 'ready' | 'error',
                reasonCode?: 'compute-failed',
            ) => {
                const previous = indicatorRuntimeRef.current.get(inst.id);
                const next = {
                    chartIdentity,
                    generation,
                    state,
                    ...(reasonCode ? { reasonCode } : {}),
                };
                if (
                    previous?.chartIdentity === next.chartIdentity &&
                    previous.generation === next.generation &&
                    previous.state === next.state &&
                    previous.reasonCode === next.reasonCode
                ) {
                    return;
                }
                indicatorRuntimeRef.current.set(inst.id, next);
                setIndicatorRuntimeVersion((version) => version + 1);
            };
            setRuntime('computing');
            try {
                output = indicatorCheckpointRef.current.compute(
                    inst.id,
                    inst.type,
                    bars,
                    params,
                    def.compute,
                );
            } catch {
                setRuntime('error', 'compute-failed');
                continue;
            }
            if (generation !== indicatorGenerationRef.current) return;
            for (const definition of def.outputs) {
                const runtime = indSeriesByKeyRef.current.get(
                    `${inst.id}:${definition.key}`,
                );
                const points = output[definition.key];
                if (!runtime || !points) continue;
                try {
                    if (runtime.plot === 'histogram') {
                        runtime.series.setData(
                            points
                                .filter((point) => point.value !== undefined)
                                .map((point) => ({
                                    time: point.time as UTCTimestamp,
                                    value: point.value!,
                                    color: runtime.signed
                                        ? point.value! >= 0
                                            ? colors.upVol
                                            : colors.downVol
                                        : runtime.color,
                                })) as SeriesDataItemTypeMap['Histogram'][],
                        );
                    } else {
                        runtime.series.setData(
                            points.map((point) =>
                                point.value === undefined
                                    ? { time: point.time as UTCTimestamp }
                                    : {
                                          time: point.time as UTCTimestamp,
                                          value: point.value,
                                      },
                            ) as SeriesDataItemTypeMap['Line'][],
                        );
                    }
                } catch {
                    // A single indicator runtime must not take down the chart.
                }
                const meta = legendMetaRef.current
                    .get(inst.id)
                    ?.find((item) => item.series === runtime.series);
                if (meta) meta.last = lastValue(points);
            }
            setRuntime('ready');
        }
        updateLegendRef.current();
    };
    indicatorDataRefreshRef.current = refreshIndicatorData;

    // indicator instances → chart series: overlays on the main pane,
    // every oscillator instance in its own sub-pane (lightweight-charts v5)
    const indicatorStructureKey = JSON.stringify(
        instances.map(({ params: _params, ...instance }) => instance),
    );
    const indicatorParamsKey = JSON.stringify(
        instances.map((instance) => ({
            id: instance.id,
            params: instance.params,
        })),
    );
    const indicatorStructureDataKey =
        barsRef.current.length > 0
            ? `${contract.code}:${tf.minutes}:ready`
            : `${contract.code}:${tf.minutes}:empty`;
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        // remember the user-dragged proportions of every pane BEFORE
        // teardown — rebuilds must not reset the 上下圖比例
        try {
            const panes = chart.panes();
            const mainSf = panes[0]?.getStretchFactor();
            if (mainSf) paneStretchRef.current.set('__main', mainSf);
            paneAssignRef.current.forEach((paneIdx, instId) => {
                const sf = panes[paneIdx]?.getStretchFactor();
                if (sf) paneStretchRef.current.set(instId, sf);
                const h = panes[paneIdx]?.getHeight();
                if (h && h > 0) paneHeightsRef.current.set(instId, h);
            });
        } catch {
            // pane API differences must never take the chart down
        }
        for (const series of indSeriesRef.current) {
            mainPriceLineDefaultsRef.current.delete(
                series as ISeriesApi<'Line' | 'Area'>,
            );
            try {
                chart.removeSeries(series);
            } catch {
                // already gone with chart teardown
            }
        }
        indSeriesRef.current = [];
        indSeriesByKeyRef.current.clear();
        // drop the now-empty sub-panes (pane 0 = main chart)
        try {
            for (let i = chart.panes().length - 1; i >= 1; i--) {
                chart.removePane(i);
            }
        } catch {
            // pane API differences must never take the chart down
        }
        const paneAssign = new Map<string, number>();
        const bars = barsRef.current;
        if (bars.length === 0) {
            paneAssignRef.current = paneAssign; // no panes exist right now
            setPaneTops({});
            reconcileDayPrimitivesRef.current();
            marketOverlayRefreshRef.current();
            pivotRefreshRef.current();
            return;
        }

        const toLineData = (pts: IndicatorPoint[]) =>
            pts.map((p) =>
                p.value === undefined
                    ? { time: p.time as UTCTimestamp }
                    : { time: p.time as UTCTimestamp, value: p.value },
            ) as SeriesDataItemTypeMap['Line'][];

        let paneIdx = 1;
        legendMetaRef.current = new Map();
        for (const inst of instances) {
            const def = DEF_BY_TYPE.get(inst.type);
            if (!def || def.kind !== 'series') continue;
            if (inst.hidden) continue; // 眼睛關閉 — 保留設定不畫線
            // 時框顯示設定（TradingView Visibility on intervals）
            if (inst.visibleTf && !inst.visibleTf.includes(tf.minutes)) {
                continue;
            }
            const params: Record<string, number> = {};
            for (const p of def.params) {
                params[p.key] = inst.params[p.key] ?? p.def;
            }
            let out: Record<string, IndicatorPoint[]>;
            try {
                out = def.compute(bars, params);
            } catch {
                continue; // a bad param combination must not kill the chart
            }
            const pane = def.render.pane === 'dedicated' ? paneIdx++ : 0;
            if (pane > 0) paneAssign.set(inst.id, pane);
            let firstSeries: ISeriesApi<'Line' | 'Histogram'> | null = null;
            const metas: {
                key: string;
                label: string;
                color: string;
                series: ISeriesApi<'Line' | 'Histogram'>;
                last?: number;
                precision?: number;
            }[] = [];
            const lastVal = (pts: IndicatorPoint[]) => {
                for (let i = pts.length - 1; i >= 0; i--) {
                    if (pts[i]!.value !== undefined) return pts[i]!.value;
                }
                return undefined;
            };
            // per-instance precision → axis/legend number formatting
            const priceFormatOpt =
                inst.precision !== undefined
                    ? {
                          priceFormat: {
                              type: 'price' as const,
                              precision: inst.precision,
                              minMove: Math.pow(10, -inst.precision),
                          },
                      }
                    : {};
            const labelOpts = {
                priceLineVisible: false,
                lastValueVisible: inst.showLabels ?? false,
            };
            const renderTargetOpt = def.render.priceScaleId
                ? { priceScaleId: def.render.priceScaleId }
                : {};
            for (const o of def.outputs) {
                const pts = out[o.key];
                if (!pts) continue;
                const st = outputStyle(inst, def, o.key);
                if (!st.visible) continue;
                const color = colorWithOpacity(st.color, st.opacity);
                let s: ISeriesApi<'Line' | 'Histogram' | 'Area'>;
                if (st.plot === 'histogram') {
                    s = chart.addSeries(
                        HistogramSeries,
                        {
                            color,
                            ...labelOpts,
                            ...renderTargetOpt,
                            ...priceFormatOpt,
                        },
                        pane,
                    );
                    s.setData(
                        pts
                            .filter((p) => p.value !== undefined)
                            .map((p) => ({
                                time: p.time as UTCTimestamp,
                                value: p.value!,
                                color: o.signed
                                    ? p.value! >= 0
                                        ? colors.upVol
                                        : colors.downVol
                                    : color,
                            })),
                    );
                } else if (st.plot === 'area') {
                    s = chart.addSeries(
                        AreaSeries,
                        {
                            lineColor: color,
                            lineWidth: st.width,
                            topColor: colorWithOpacity(
                                st.color,
                                Math.min(st.opacity, 28),
                            ),
                            bottomColor: 'rgba(0, 0, 0, 0)',
                            crosshairMarkerVisible: false,
                            ...renderTargetOpt,
                            ...labelOpts,
                            ...priceFormatOpt,
                        },
                        pane,
                    );
                    s.setData(toLineData(pts));
                } else {
                    s = chart.addSeries(
                        LineSeries,
                        {
                            color,
                            lineWidth: st.width,
                            lineStyle:
                                o.kind === 'dashed'
                                    ? LineStyle.Dashed
                                    : LineStyle.Solid,
                            lineType:
                                st.plot === 'step'
                                    ? LineType.WithSteps
                                    : LineType.Simple,
                            crosshairMarkerVisible: false,
                            ...renderTargetOpt,
                            ...(st.plot === 'circles'
                                ? {
                                      lineVisible: false,
                                      pointMarkersVisible: true,
                                      pointMarkersRadius: 1.5,
                                  }
                                : {}),
                            ...labelOpts,
                            ...priceFormatOpt,
                        },
                        pane,
                    );
                    s.setData(toLineData(pts));
                }
                indSeriesRef.current.push(
                    s as ISeriesApi<'Line' | 'Histogram'>,
                );
                indSeriesByKeyRef.current.set(`${inst.id}:${o.key}`, {
                    series: s,
                    plot: st.plot,
                    signed: o.signed,
                    color,
                });
                if (pane === 0 && st.plot !== 'histogram') {
                    const mainPriceSeries = s as ISeriesApi<'Line' | 'Area'>;
                    const defaultVisible =
                        mainPriceSeries.options().crosshairMarkerVisible ?? true;
                    mainPriceLineDefaultsRef.current.set(
                        mainPriceSeries,
                        defaultVisible,
                    );
                    if (fibonacciControllerRef.current?.hasPending()) {
                        mainPriceSeries.applyOptions({
                            crosshairMarkerVisible: false,
                        });
                    }
                }
                firstSeries ??= s as ISeriesApi<'Line' | 'Histogram'>;
                metas.push({
                    key: o.key,
                    label: o.label,
                    color: st.color,
                    series: s as ISeriesApi<'Line' | 'Histogram'>,
                    last: lastVal(pts),
                    precision: inst.precision,
                });
            }
            // 圖上不顯示數值時 legend 只留名稱
            legendMetaRef.current.set(
                inst.id,
                (inst.showValues ?? true) ? metas : [],
            );
            // reference levels（RSI 30/70、KD 20/80…）in the sub-pane
            if (pane > 0 && firstSeries && def.levels) {
                for (const lv of def.levels) {
                    firstSeries.createPriceLine({
                        price: lv,
                        color: colors.grid,
                        lineWidth: 1,
                        lineStyle: LineStyle.Dotted,
                        axisLabelVisible: false,
                        title: '',
                    });
                }
            }
        }
        // restore the remembered proportions（stretch factor 精確還原，
        // 含主圖；px 只當第一次出現的 pane 的預設值用）
        try {
            const panes = chart.panes();
            const mainSf = paneStretchRef.current.get('__main');
            if (mainSf && panes[0]) panes[0].setStretchFactor(mainSf);
            paneAssign.forEach((paneIdx, instId) => {
                const sf = paneStretchRef.current.get(instId);
                if (sf) {
                    panes[paneIdx]?.setStretchFactor(sf);
                } else {
                    panes[paneIdx]?.setHeight(
                        paneHeightsRef.current.get(instId) ?? 110,
                    );
                }
            });
        } catch {
            // pane API differences must never take the chart down
        }
        paneAssignRef.current = paneAssign;
        reconcileDayPrimitivesRef.current();
        // 副圖 legend 跟著自己的 pane 走 — 量出每個 pane 在 host 內的
        // top offset，pane 被拖動改高度時 ResizeObserver 會重新量
        try {
            const host = hostRef.current;
            const panes = chart.panes();
            const measure = () => {
                const hostTop = host?.getBoundingClientRect().top ?? 0;
                const tops: Record<string, number> = {};
                paneAssign.forEach((paneIdx, instId) => {
                    const el = panes[paneIdx]?.getHTMLElement();
                    if (el) {
                        tops[instId] =
                            el.getBoundingClientRect().top - hostTop;
                    }
                });
                setPaneTops(tops);
            };
            const ro = new ResizeObserver(measure);
            paneAssign.forEach((paneIdx) => {
                const el = panes[paneIdx]?.getHTMLElement();
                if (el) ro.observe(el);
            });
            paneRoRef.current = ro;
            requestAnimationFrame(measure);
        } catch {
            setPaneTops({}); // pane API 不可用 → 副圖 legend 退回主圖堆疊
        }
        updateLegendRef.current(); // seed legend with latest values
        marketOverlayRefreshRef.current();
        pivotRefreshRef.current();
        return () => {
            paneRoRef.current?.disconnect();
            paneRoRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        customVer,
        indicatorStructureDataKey,
        indicatorStructureKey,
        themeKey,
        tf.minutes,
    ]);

    useEffect(() => {
        indicatorDataRefreshRef.current();
        marketOverlayRefreshRef.current();
        pivotRefreshRef.current();
    }, [
        dataVersion,
        indicatorParamsKey,
        overlayRuntimeVersion,
        supportResistanceStateVersion,
    ]);

    const closeSettings = () => {
        setSettingsFor(null);
        setSettingsDraft(null);
        setSettingsIsNew(false);
        setSettingsConflict(null);
    };
    // 點選指標 → 先建立 modal-local draft；確定後才寫入 canonical store。
    const addIndicator = (type: string) => {
        const def = DEF_BY_TYPE.get(type);
        if (!def) return;
        if (type === 'traditional-pivot' && tf.minutes !== 1440) {
            setPickerOpen(false);
            notify({
                kind: 'info',
                title: 'Pivot 由 1D 管理',
                body: '請切換至 1D 建立、固定、隱藏或移除 Pivot；分鐘圖會同步顯示同一組七線。',
            });
            return;
        }
        if (def.kind !== 'series' && def.singleton) {
            const existing = instances.find((item) => item.type === type);
            if (existing) {
                setPickerOpen(false);
                openSettings(existing.id);
                return;
            }
        }
        const inst = newInstance(type);
        setPickerOpen(false);
        setSettingsFor(inst.id);
        setSettingsDraft(inst);
        setSettingsIsNew(true);
        setSettingsConflict(null);
    };
    const removeIndicator = (id: string) => {
        if (!settingsIsNew) {
            updateInstances((current) =>
                current.filter((instance) => instance.id !== id),
            );
        }
        for (const key of fixedRangeAnchorsRef.current.keys()) {
            if (key.startsWith(`${id}|`)) {
                fixedRangeAnchorsRef.current.delete(key);
            }
        }
        if (rangeSelectionRef.current?.instanceId === id) {
            rangeSelectionRef.current = null;
        }
        if (settingsFor === id) closeSettings();
    };
    const patchStoredInstance = (
        id: string,
        patch: Partial<IndicatorInstance>,
    ) => {
        updateInstances((current) =>
            current.map((instance) =>
                instance.id === id ? { ...instance, ...patch } : instance,
            ),
        );
    };
    const openSettings = (id: string) => {
        const current = getInstancesSnapshot().find(
            (instance) => instance.id === id,
        );
        if (!current) return;
        setLegendMenuFor(null);
        setSettingsFor(id);
        setSettingsDraft({
            ...current,
            params: { ...current.params },
            colors: { ...current.colors },
            ...(current.styles
                ? {
                      styles: Object.fromEntries(
                          Object.entries(current.styles).map(([key, value]) => [
                              key,
                              { ...value },
                          ]),
                      ),
                  }
                : {}),
            ...(current.visibleTf
                ? { visibleTf: [...current.visibleTf] }
                : {}),
        });
        setSettingsIsNew(false);
        setSettingsConflict(null);
    };
    const duplicateIndicator = (id: string) => {
        updateInstances((current) => {
            const idx = current.findIndex((instance) => instance.id === id);
            if (idx < 0) return current;
            const source = current[idx]!;
            if (DEF_BY_TYPE.get(source.type)?.kind === 'readout') return current;
            const next = [...current];
            next.splice(idx + 1, 0, duplicateInstance(source));
            return next;
        });
    };
    // 視覺順序：陣列順序 = 疊圖 z-order 與副圖 pane 排序
    const moveIndicator = (id: string, dir: -1 | 1) => {
        updateInstances((current) => {
            const idx = current.findIndex((instance) => instance.id === id);
            if (idx < 0) return current;
            if (DEF_BY_TYPE.get(current[idx]!.type)?.kind === 'readout') {
                return current;
            }
            const to = idx + dir;
            if (to < 0 || to >= current.length) return current;
            const next = [...current];
            const [item] = next.splice(idx, 1);
            next.splice(to, 0, item!);
            return next;
        });
    };
    const toggleFavorite = (type: string) => {
        const favs = loadFavorites();
        if (favs.has(type)) favs.delete(type);
        else favs.add(type);
        saveFavorites(favs);
    };
    const patchSettingsDraft = (patch: Partial<IndicatorInstance>) => {
        setSettingsDraft((draft) =>
            draft ? { ...draft, ...patch } : draft,
        );
    };
    const commitSettings = () => {
        const draft = settingsDraft;
        if (!draft) return;
        let conflict = false;
        updateInstances((current) => {
            const result = commitIndicatorDraft(
                current,
                draft,
                settingsIsNew,
            );
            conflict = result.conflict;
            return result.instances;
        });
        if (conflict) {
            setSettingsConflict(
                '此指標已在其他圖表中移除。草稿未寫回，請取消後重新新增。',
            );
            return;
        }
        closeSettings();
    };
    const settingsInst = settingsDraft;
    const retryIndicator = (id: string) => {
        indicatorCheckpointRef.current.clear();
        indicatorRuntimeRef.current.delete(id);
        setIndicatorRuntimeVersion((version) => version + 1);
        indicatorDataRefreshRef.current();
    };

    const cancelFibonacciPending = () => {
        const cancelled = fibonacciControllerRef.current?.cancel() ?? false;
        if (cancelled) setFibonacciNotice('已取消費波那契選點');
        return cancelled;
    };
    const armFibonacci = (kind: FibonacciKind) => {
        setMode('observe');
        rangeSelectionRef.current = null;
        if (!fibonacciControllerRef.current?.arm(kind)) {
            setFibonacciNotice('目前商品或時框無法建立費波那契圖形');
            return;
        }
        setOverlayRuntimeVersion((version) => version + 1);
        setFibonacciNotice(
            kind === 'retracement'
                ? '回撤：請依序選取 A（低點）、B（高點）'
                : '拓展：請依序選取 A（低點）、B（高點）、C（低點）',
        );
    };
    const changeTradeMode = (nextMode: TradeMode) => {
        cancelFibonacciPending();
        rangeSelectionRef.current = null;
        setMode(nextMode);
    };
    const changeTimeframe = (index: number) => {
        cancelFibonacciPending();
        setTfIdx(index);
    };
    const clearFibonacci = (target: FibonacciKind | 'all') => {
        fibonacciControllerRef.current?.clear(target);
        const label =
            target === 'retracement'
                ? '回撤'
                : target === 'extension'
                  ? '拓展'
                  : '目前商品所有時間級別的費波那契圖形';
        setFibonacciNotice(`已清除${label}`);
    };

    // recalibrate the view — re-fit both axes after the user has panned or
    // dragged the price scale into a corner (issue #6: no reset control)
    const resetView = () => {
        const chart = chartRef.current;
        if (!chart) return;
        candleSeriesRef.current?.priceScale().applyOptions({ autoScale: true });
        chart.timeScale().fitContent();
    };

    // draw working-order price lines (buy=up color / sell=down color)
    const orderKey = JSON.stringify(
        workingOrders.map((t) => [
            t.order.id,
            t.status.modified_price || t.order.price,
            t.order.quantity - t.status.deal_quantity,
        ]),
    );
    useEffect(() => {
        const series = candleSeriesRef.current;
        if (!series) return;
        const lines = new Map<string, IPriceLine>();
        for (const t of workingOrdersRef.current) {
            const price = t.status.modified_price || t.order.price;
            const remaining = t.order.quantity - t.status.deal_quantity;
            lines.set(
                t.order.id,
                series.createPriceLine({
                    price,
                    color: t.order.action === 'Buy' ? colors.up : colors.down,
                    lineWidth: 2,
                    lineStyle: 0, // solid
                    axisLabelVisible: true,
                    title: `${t.order.action === 'Buy' ? '買' : '賣'}${remaining} ⠿`,
                }),
            );
        }
        orderLinesRef.current = lines;
        return () => {
            for (const line of lines.values()) series.removePriceLine(line);
            orderLinesRef.current = new Map();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderKey, themeKey, contract.code]);

    // drag an order line to modify its price
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let dragging: { trade: Trade; line: IPriceLine; price: number } | null =
            null;
        // active document listeners — removed on unmount if a drag is live
        let activeMove: ((e: MouseEvent) => void) | null = null;
        let activeUp: (() => void) | null = null;

        const yOf = (e: MouseEvent) =>
            e.clientY - host.getBoundingClientRect().top;

        const findNear = (y: number) => {
            const series = candleSeriesRef.current;
            if (!series) return null;
            for (const t of workingOrdersRef.current) {
                const line = orderLinesRef.current.get(t.order.id);
                if (!line) continue;
                const coord = series.priceToCoordinate(line.options().price);
                if (coord !== null && Math.abs(coord - y) <= 6) {
                    return { trade: t, line };
                }
            }
            return null;
        };

        const hover = (e: MouseEvent) => {
            if (dragging) return;
            host.style.cursor = findNear(yOf(e)) ? 'ns-resize' : '';
        };

        const down = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const hit = findNear(yOf(e));
            if (!hit) return;
            e.preventDefault();
            e.stopPropagation();
            chartRef.current?.applyOptions({
                handleScroll: false,
                handleScale: false,
            });
            dragging = {
                trade: hit.trade,
                line: hit.line,
                price: hit.line.options().price,
            };

            const move = (ev: MouseEvent) => {
                const series = candleSeriesRef.current;
                if (!series || !dragging) return;
                const raw = series.coordinateToPrice(yOf(ev));
                if (raw === null) return;
                const np = roundToTick(contractRef.current, Number(raw));
                dragging.price = np;
                dragging.line.applyOptions({ price: np });
            };
            const up = () => {
                document.removeEventListener('mousemove', move, true);
                document.removeEventListener('mouseup', up, true);
                activeMove = null;
                activeUp = null;
                chartRef.current?.applyOptions({
                    handleScroll: true,
                    handleScale: true,
                });
                const d = dragging;
                dragging = null;
                if (!d) return;
                const orig =
                    d.trade.status.modified_price || d.trade.order.price;
                if (d.price === orig) return;
                updateOrderPrice(d.trade.order.id, d.price)
                    .then(() => {
                        notify({
                            kind: 'ok',
                            title: '✏️ 改價已送出',
                            body: `${d.trade.contract.code} ${fmtPrice(orig)} → ${fmtPrice(d.price)}`,
                        });
                        onOrdersChangedRef.current?.();
                    })
                    .catch((err) => {
                        notify({
                            kind: 'err',
                            title: '改價失敗',
                            body:
                                err instanceof Error
                                    ? err.message
                                    : String(err),
                        });
                        onOrdersChangedRef.current?.();
                    });
            };
            document.addEventListener('mousemove', move, true);
            document.addEventListener('mouseup', up, true);
            activeMove = move;
            activeUp = up;
        };

        host.addEventListener('mousedown', down, true); // capture: beat chart pan
        host.addEventListener('mousemove', hover, true);
        return () => {
            host.removeEventListener('mousedown', down, true);
            host.removeEventListener('mousemove', hover, true);
            // unmounted mid-drag — drop the document listeners too
            if (activeMove) {
                document.removeEventListener('mousemove', activeMove, true);
            }
            if (activeUp) document.removeEventListener('mouseup', activeUp, true);
        };
    }, []);

    // draw trigger price lines on the candle series
    useEffect(() => {
        const series = candleSeriesRef.current;
        if (!series) return;
        const lines = triggers.map((t) =>
            series.createPriceLine({
                price: t.price,
                color:
                    t.kind === 'stop'
                        ? '#e0a43c'
                        : t.kind === 'alert'
                          ? '#8b94a7'
                          : colors.crosshair,
                lineWidth: 1,
                lineStyle: 2, // dashed
                axisLabelVisible: true,
                title:
                    t.kind === 'alert'
                        ? '警示'
                        : `${t.kind === 'stop' ? '停損' : '停利'}${t.action === 'Buy' ? '買' : '賣'}${t.quantity}`,
            }),
        );
        return () => {
            for (const line of lines) series.removePriceLine(line);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(triggers), themeKey, contract.code]);

    // 單列 legend（主圖堆疊與各副圖 pane 共用同一套列與控制）
    const renderLegendRow = (inst: IndicatorInstance) => {
        const def = DEF_BY_TYPE.get(inst.type);
        if (!def) return null;
        if (def.kind === 'primitive') {
            if (SUPPORT_RESISTANCE_INSTANCE_TYPES.has(inst.type)) return null;
            const offTf =
                !!inst.visibleTf && !inst.visibleTf.includes(tf.minutes);
            const dimmed = !!inst.hidden || offTf;
            const anchorKey = `${inst.id}|${contract.code}|${tf.minutes}`;
            const anchors = fixedRangeAnchorsRef.current.get(anchorKey);
            const selection = rangeSelectionRef.current;
            const selecting = selection?.instanceId === inst.id;
            return (
                <div
                    key={inst.id}
                    className={styles.legendItem[dimmed ? 'hidden' : 'normal']}
                >
                    <button
                        className={styles.legendLabel}
                        title='開啟指標設定'
                        onClick={() => openSettings(inst.id)}
                    >
                        {instanceLabel(inst)}
                    </button>
                    {offTf && (
                        <span className={styles.legendNote}>此時框停用</span>
                    )}
                    {inst.type === 'fixed-volume-profile' && !offTf && (
                        <button
                            className={styles.legendCtrlBtn}
                            title='依序選取兩根 K 棒；交易模式優先'
                            disabled={mode !== 'observe'}
                            onClick={() => {
                                cancelFibonacciPending();
                                rangeSelectionRef.current = {
                                    instanceId: inst.id,
                                    firstTime: null,
                                };
                                setOverlayRuntimeVersion(
                                    (version) => version + 1,
                                );
                            }}
                        >
                            {selecting
                                ? selection.firstTime === null
                                    ? '請選第一根 K 棒'
                                    : '請選第二根 K 棒'
                                : anchors
                                  ? '重新設定區間'
                                  : '請設定固定區間'}
                        </button>
                    )}
                    <span className={styles.legendCtrls}>
                        <button
                            className={styles.legendCtrlBtn}
                            title={inst.hidden ? '顯示' : '隱藏'}
                            onClick={() =>
                                patchStoredInstance(inst.id, {
                                    hidden: !inst.hidden,
                                })
                            }
                        >
                            {inst.hidden ? (
                                <EyeOff size={11} />
                            ) : (
                                <Eye size={11} />
                            )}
                        </button>
                        <button
                            className={styles.legendCtrlBtn}
                            title='設定'
                            onClick={() => openSettings(inst.id)}
                        >
                            <Settings2 size={11} />
                        </button>
                        <button
                            className={styles.legendCtrlBtn}
                            title='移除'
                            onClick={() => removeIndicator(inst.id)}
                        >
                            <X size={11} />
                        </button>
                    </span>
                </div>
            );
        }
        if (def.kind !== 'series') return null;
        const idx = instances.findIndex((i) => i.id === inst.id);
        const vals = legendValues[inst.id] ?? [];
        const readout = buildIndicatorReadoutDisplay(inst, vals);
        const runtime = indicatorRuntimeRef.current.get(inst.id);
        const offTf =
            !!inst.visibleTf && !inst.visibleTf.includes(tf.minutes);
        const dimmed = inst.hidden || offTf;
        const nameColor = outputStyle(inst, def, def.outputs[0]!.key).color;
        return (
                                <div
                                    key={inst.id}
                                    className={
                                        styles.legendItem[
                                            dimmed ? 'hidden' : 'normal'
                                        ]
                                    }
                                >
                                    <button
                                        className={styles.legendLabel}
                                        style={{ color: nameColor }}
                                        title='開啟指標設定'
                                        onClick={() => openSettings(inst.id)}
                                    >
                                        {readout.label}
                                    </button>
                                    {offTf && (
                                        <span className={styles.legendNote}>
                                            此時框停用
                                        </span>
                                    )}
                                    {!dimmed && (
                                        <IndicatorReadoutValues
                                            values={readout.values}
                                        />
                                    )}
                                    {runtime?.state === 'error' && (
                                        <span
                                            className={styles.legendNote}
                                            title='compute-failed'
                                        >
                                            指標計算失敗
                                        </span>
                                    )}
                                    <span className={styles.legendCtrls}>
                                        {runtime?.state === 'error' && (
                                            <button
                                                className={
                                                    styles.legendCtrlBtn
                                                }
                                                title='重試指標計算'
                                                onClick={() =>
                                                    retryIndicator(inst.id)
                                                }
                                            >
                                                <RotateCw size={11} />
                                            </button>
                                        )}
                                        <button
                                            className={styles.legendCtrlBtn}
                                            title={
                                                inst.hidden ? '顯示' : '隱藏'
                                            }
                                            onClick={() =>
                                                patchStoredInstance(inst.id, {
                                                    hidden: !inst.hidden,
                                                })
                                            }
                                        >
                                            {inst.hidden ? (
                                                <EyeOff size={11} />
                                            ) : (
                                                <Eye size={11} />
                                            )}
                                        </button>
                                        <button
                                            className={styles.legendCtrlBtn}
                                            title='設定'
                                            onClick={() =>
                                                openSettings(inst.id)
                                            }
                                        >
                                            <Settings2 size={11} />
                                        </button>
                                        <button
                                            className={styles.legendCtrlBtn}
                                            title='移除'
                                            onClick={() =>
                                                removeIndicator(inst.id)
                                            }
                                        >
                                            <X size={11} />
                                        </button>
                                        <button
                                            className={styles.legendCtrlBtn}
                                            title='更多'
                                            onClick={() =>
                                                setLegendMenuFor(
                                                    legendMenuFor === inst.id
                                                        ? null
                                                        : inst.id,
                                                )
                                            }
                                        >
                                            <MoreHorizontal size={11} />
                                        </button>
                                    </span>
                                    {legendMenuFor === inst.id && (
                                        <>
                                            <div
                                                className={
                                                    styles.legendMenuBackdrop
                                                }
                                                onClick={() =>
                                                    setLegendMenuFor(null)
                                                }
                                            />
                                            <div
                                                className={styles.legendMenu}
                                            >
                                                <button
                                                    className={
                                                        styles.legendMenuItem
                                                    }
                                                    onClick={() => {
                                                        toggleFavorite(
                                                            inst.type,
                                                        );
                                                        setLegendMenuFor(
                                                            null,
                                                        );
                                                    }}
                                                >
                                                    <Star size={11} />
                                                    加入 / 移除我的最愛
                                                </button>
                                                <button
                                                    className={
                                                        styles.legendMenuItem
                                                    }
                                                    onClick={() => {
                                                        duplicateIndicator(
                                                            inst.id,
                                                        );
                                                        setLegendMenuFor(
                                                            null,
                                                        );
                                                    }}
                                                >
                                                    <Copy size={11} />
                                                    複製指標
                                                </button>
                                                <button
                                                    className={
                                                        styles.legendMenuItem
                                                    }
                                                    disabled={idx === 0}
                                                    onClick={() =>
                                                        moveIndicator(
                                                            inst.id,
                                                            -1,
                                                        )
                                                    }
                                                >
                                                    <ArrowUp size={11} />
                                                    上移（視覺順序）
                                                </button>
                                                <button
                                                    className={
                                                        styles.legendMenuItem
                                                    }
                                                    disabled={
                                                        idx ===
                                                        instances.length - 1
                                                    }
                                                    onClick={() =>
                                                        moveIndicator(
                                                            inst.id,
                                                            1,
                                                        )
                                                    }
                                                >
                                                    <ArrowDown size={11} />
                                                    下移（視覺順序）
                                                </button>
                                                <button
                                                    className={
                                                        styles.legendMenuItem
                                                    }
                                                    onClick={() =>
                                                        openSettings(inst.id)
                                                    }
                                                >
                                                    <Settings2 size={11} />
                                                    設定…
                                                </button>
                                                <button
                                                    className={
                                                        styles.legendMenuItemDanger
                                                    }
                                                    onClick={() => {
                                                        removeIndicator(
                                                            inst.id,
                                                        );
                                                        setLegendMenuFor(
                                                            null,
                                                        );
                                                    }}
                                                >
                                                    <X size={11} />
                                                    移除
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
        );
    };
    const { readout: kbarReadoutInst, rest: nonReadoutInstances } =
        splitKbarReadoutInstance(instances);
    const supportResistanceFormulas = enabledSupportResistanceFormulas(instances);
    const supportResistanceEnabled = new Set(supportResistanceFormulas);
    const supportResistanceKey = supportResistanceProductKey(contract);
    const supportResistanceState = getSupportResistanceProductState(
        supportResistanceKey,
    );
    const supportResistanceReference = supportResistanceState?.reference ?? null;
    const toggleSupportResistance = (
        formulaId: SupportResistanceFormulaId,
        enabled: boolean,
    ) => {
        if (tf.minutes !== 1440) return;
        const next = updateSupportResistanceFormulaForProduct(
            supportResistanceKey,
            formulaId,
            enabled,
        );
        if (enabledSupportResistanceFormulas(next).length === 0) {
            clearSupportResistanceProductState(supportResistanceKey);
        }
        setOverlayRuntimeVersion((version) => version + 1);
    };
    const returnSupportResistanceToLatest = () => {
        const resolved = resolveAutomaticSupportResistanceReference({
            rows: rawRef.current,
            securityType: contract.security_type,
            ...supportResistanceResolverRuntime(
                loading ? 'loading' : 'success',
                !empty,
            ),
        });
        if (resolved.status === 'available') {
            setSupportResistanceProductState({
                key: supportResistanceKey,
                reference: resolved.reference,
                pinned: false,
            });
            setFibonacciNotice(
                `壓撐已回到最新自動 reference：${resolved.reference.date}`,
            );
        } else {
            setFibonacciNotice('目前沒有可證明完整的壓撐 reference');
        }
        setOverlayRuntimeVersion((version) => version + 1);
    };
    const renderSupportResistanceReadout = () => (
        <div className={styles.legendItem.normal} data-support-resistance-readout='true'>
            <span className={styles.legendLabel}>壓撐</span>
            {supportResistanceReference ? (
                <span className={styles.legendVals}>
                    <span className={styles.legendVal}>
                        {supportResistanceReference.mode === 'pinned'
                            ? '固定歷史'
                            : '自動'}{' '}
                        {supportResistanceReference.date} 已完成
                    </span>
                </span>
            ) : (
                <span className={styles.legendNote}>reference unavailable</span>
            )}
            {tf.minutes === 1440 ? (
                <span className={styles.legendCtrls}>
                    <span className={styles.legendNote}>
                        點選已完成日 K 即重新計算
                    </span>
                    {supportResistanceState?.pinned && (
                        <button
                            className={styles.legendCtrlBtn}
                            onClick={returnSupportResistanceToLatest}
                        >
                            回到最新
                        </button>
                    )}
                </span>
            ) : (
                <span className={styles.legendNote}>由 1D 管理</span>
            )}
        </div>
    );
    const renderKbarReadoutRow = (inst: IndicatorInstance) => {
        const offTf =
            !!inst.visibleTf && !inst.visibleTf.includes(tf.minutes);
        const dimmed = !!inst.hidden || offTf;
        return (
            <div
                key={inst.id}
                className={styles.legendItem[dimmed ? 'hidden' : 'normal']}
                data-kbar-readout='true'
            >
                <button
                    className={styles.kbarReadoutTime}
                    title={kbarReadout.fullInterval}
                    aria-label={`${kbarReadout.fullInterval}；開啟 K 棒價量設定`}
                    onClick={() => openSettings(inst.id)}
                >
                    {kbarReadout.interval}
                </button>
                {offTf && (
                    <span className={styles.legendNote}>此時框停用</span>
                )}
                {!dimmed && (
                    <span className={styles.kbarReadoutFields}>
                        {kbarReadout.fields.map((field) => (
                            <span
                                key={field.key}
                                className={styles.kbarReadoutField}
                                title={`${field.label} ${field.value}`}
                            >
                                <span className={styles.kbarReadoutFieldLabel}>
                                    {field.label}
                                </span>{' '}
                                <span
                                    className={
                                        styles.kbarReadoutFieldValue[field.tone]
                                    }
                                >
                                    {field.value}
                                </span>
                            </span>
                        ))}
                    </span>
                )}
                <span className={styles.legendCtrls}>
                    <button
                        className={styles.legendCtrlBtn}
                        title={inst.hidden ? '顯示' : '隱藏'}
                        onClick={() =>
                            patchStoredInstance(inst.id, {
                                hidden: !inst.hidden,
                            })
                        }
                    >
                        {inst.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                    <button
                        className={styles.legendCtrlBtn}
                        title='設定'
                        onClick={() => openSettings(inst.id)}
                    >
                        <Settings2 size={11} />
                    </button>
                    <button
                        className={styles.legendCtrlBtn}
                        title='移除'
                        onClick={() => removeIndicator(inst.id)}
                    >
                        <X size={11} />
                    </button>
                </span>
            </div>
        );
    };
    // 主圖堆疊只放：主圖疊加類、被隱藏/此時框停用、或 pane 尚未量到位置的
    const mainLegendInsts = nonReadoutInstances.filter((inst) => {
        const def = DEF_BY_TYPE.get(inst.type);
        if (!def) return false;
        if (def.kind === 'primitive') {
            return !SUPPORT_RESISTANCE_INSTANCE_TYPES.has(inst.type);
        }
        if (def.kind !== 'series') return false;
        const offTf =
            !!inst.visibleTf && !inst.visibleTf.includes(tf.minutes);
        return (
            def.category === 'overlay' ||
            !!inst.hidden ||
            offTf ||
            paneTops[inst.id] === undefined
        );
    });
    return (
        <div className={styles.wrap}>
            <div className={styles.toolbar}>
                {TIMEFRAMES.map((t, i) => (
                    <button
                        key={t.label}
                        className={styles.tfBtn[i === tfIdx ? 'active' : 'normal']}
                        onClick={() => changeTimeframe(i)}
                    >
                        {t.label}
                    </button>
                ))}
                <button
                    className={styles.iconBtn}
                    onClick={resetView}
                    title='重設視圖（自動縮放）'
                    aria-label='重設視圖'
                >
                    <Maximize2 size={12} />
                </button>
                <span className={styles.toolbarDivider} />
                {TRADE_MODES.map((m) => (
                    <button
                        key={m.key}
                        className={
                            styles.modeBtn[
                                mode === m.key
                                    ? m.key === 'observe'
                                        ? 'active'
                                        : 'armed'
                                    : 'normal'
                            ]
                        }
                        onClick={() => changeTradeMode(m.key)}
                    >
                        {m.label}
                    </button>
                ))}
                <label
                    className={styles.qtyWrap}
                    title='圖表下單數量（點價買賣/停損/停利的口數或張數）'
                >
                    量
                    <input
                        className={styles.qtyInput}
                        value={tradeQty}
                        inputMode='numeric'
                        onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isInteger(v) && v >= 1) setTradeQty(v);
                        }}
                    />
                </label>
                <span className={styles.toolbarDivider} />
                <button
                    className={
                        styles.fibonacciBtn[
                            fibonacciSnapshot.status === 'pending-retracement'
                                ? 'active'
                                : 'normal'
                        ]
                    }
                    onClick={() => armFibonacci('retracement')}
                    title='費波那契回撤：A/B 預設吸附 K 棒低點/高點；按住 Option 改為高點/低點'
                >
                    回撤
                </button>
                <button
                    className={
                        styles.fibonacciBtn[
                            fibonacciSnapshot.status === 'pending-extension'
                                ? 'active'
                                : 'normal'
                        ]
                    }
                    onClick={() => armFibonacci('extension')}
                    title='費波那契拓展：A/B/C 預設吸附低點/高點/低點；按住 Option 可自由選價'
                >
                    拓展
                </button>
                <select
                    className={styles.fibonacciClear}
                    aria-label='清除費波那契圖形'
                    value=''
                    onChange={(event) => {
                        const target = event.target.value as
                            | FibonacciKind
                            | 'all'
                            | '';
                        if (target) clearFibonacci(target);
                    }}
                >
                    <option value=''>清除…</option>
                    <option value='retracement'>清除回撤</option>
                    <option value='extension'>清除拓展</option>
                    <option value='all'>全部清除</option>
                </select>
                <button
                    className={
                        styles.indicatorBtn[
                            instances.some(
                                (instance) =>
                                    !SUPPORT_RESISTANCE_INSTANCE_TYPES.has(
                                        instance.type,
                                    ),
                            )
                                ? 'active'
                                : 'normal'
                        ]
                    }
                    onClick={() => setPickerOpen(true)}
                >
                    指標
                </button>
                <SupportResistanceMenu
                    enabled={supportResistanceEnabled}
                    readOnly={tf.minutes !== 1440}
                    disabledReason={
                        pivotSupportReason(
                            contract.security_type,
                            tf.minutes,
                        ) ?? undefined
                    }
                    persistenceError={
                        indicatorPersistence.state === 'error'
                            ? indicatorPersistence.reasonCode
                            : undefined
                    }
                    onToggle={toggleSupportResistance}
                    onConfigure={setSupportStyleFor}
                />
                {supportStyleFor && (
                    <SupportResistanceStyleDialog
                        formulaId={supportStyleFor}
                        current={getSupportResistanceFormulaStyle(
                            instances,
                            supportStyleFor,
                        )}
                        onCancel={() => setSupportStyleFor(null)}
                        onCommit={(style) => {
                            setSupportResistanceFormulaStyle(
                                supportStyleFor,
                                style,
                            );
                            setSupportStyleFor(null);
                            setOverlayRuntimeVersion((version) => version + 1);
                        }}
                    />
                )}
                {indicatorPersistence.state === 'error' && (
                    <span
                        className={styles.legendNote}
                        title={indicatorPersistence.reasonCode}
                    >
                        設定尚未保存
                    </span>
                )}
                {pickerOpen && (
                    <IndicatorDialog
                        instances={instances}
                        onAdd={addIndicator}
                        onClose={() => setPickerOpen(false)}
                    />
                )}
                {settingsInst && (
                    <IndicatorSettingsModal
                        inst={settingsInst}
                        timeframes={TIMEFRAMES.map((t) => ({
                            label: t.label,
                            minutes: t.minutes,
                        }))}
                        errorMessage={settingsConflict ?? undefined}
                        onPatch={patchSettingsDraft}
                        onRemove={() => removeIndicator(settingsInst.id)}
                        onCommit={commitSettings}
                        onCancel={closeSettings}
                    />
                )}
            </div>
            <div
                ref={hostRef}
                className={styles.chartHost}
                data-fibonacci-panel-instance={
                    fibonacciPanelInstanceIdRef.current
                }
                data-fibonacci-identity={fibonacciIdentityValue}
            >
                {fibonacciLayout.width > 0 &&
                    fibonacciLayout.height > 0 &&
                    chartRef.current &&
                    candleSeriesRef.current && (
                        <FibonacciOverlay
                            snapshot={fibonacciSnapshot}
                            width={fibonacciLayout.width}
                            height={fibonacciLayout.height}
                            rightEdge={fibonacciLayout.rightEdge}
                            coordinates={{
                                timeToCoordinate: (time) =>
                                    chartRef.current
                                        ?.timeScale()
                                        .timeToCoordinate(
                                            time as UTCTimestamp,
                                        ) ?? null,
                                priceToCoordinate: (price) =>
                                    candleSeriesRef.current?.priceToCoordinate(
                                        price,
                                    ) ?? null,
                            }}
                            formatPrice={fmtPrice}
                        />
                    )}
                {loading && (
                    <div className={styles.emptyMsg}>
                        <span className={panel.mono}>
                            載入 {tf.label} K 線…
                        </span>
                    </div>
                )}
                {empty && !loading && (
                    <div className={styles.emptyMsg}>
                        <span className={panel.mono}>無 K 線資料</span>
                    </div>
                )}
                {mode !== 'observe' && (
                    <div className={styles.modeHint}>
                        {mode === 'buy' && '點擊圖表價位 → 限價買進'}
                        {mode === 'sell' && '點擊圖表價位 → 限價賣出'}
                        {mode === 'stop' && '點擊價位掛停損（觸價市價單）'}
                        {mode === 'take' && '點擊價位掛停利（觸價市價單）'}
                        {mode === 'alert' && '點擊價位設定到價警示（只通知不下單）'}
                    </div>
                )}
                {fibonacciSnapshot.pending && (
                    <div className={styles.fibonacciHint}>
                        {fibonacciSnapshot.pending.kind === 'retracement'
                            ? '費波回撤'
                            : '費波拓展'}
                        {' · 待選 '}
                        {
                            (['A', 'B', 'C'] as const)[
                                fibonacciSnapshot.pending.anchors.length
                            ]
                        }
                        {` · 尚需 ${fibonacciSnapshot.pending.remaining} 點 · ${
                            fibonacciSnapshot.pending.kind === 'retracement'
                                ? 'Option 高點/低點'
                                : 'Option 自由價位'
                        } · Esc 取消`}
                    </div>
                )}
                {fibonacciNotice && !fibonacciSnapshot.pending && (
                    <div className={styles.fibonacciNotice}>
                        {fibonacciNotice}
                    </div>
                )}
                {(workingOrders.length > 0 ||
                    triggers.length > 0 ||
                    instances.length > 0) && (
                    <div className={styles.triggerList}>
                        {kbarReadoutInst &&
                            renderKbarReadoutRow(kbarReadoutInst)}
                        {supportResistanceFormulas.length > 0 &&
                            renderSupportResistanceReadout()}
                        {mainLegendInsts.map((inst) =>
                            renderLegendRow(inst),
                        )}
                        {workingOrders.map((t) => {
                            const price =
                                t.status.modified_price || t.order.price;
                            const remaining =
                                t.order.quantity - t.status.deal_quantity;
                            return (
                                <div
                                    key={t.order.id}
                                    className={styles.triggerRow}
                                >
                                    <span
                                        className={
                                            panel.dirText[
                                                t.order.action === 'Buy'
                                                    ? 'up'
                                                    : 'down'
                                            ]
                                        }
                                    >
                                        委{t.order.action === 'Buy' ? '買' : '賣'}
                                        {remaining} @{fmtPrice(price)}
                                    </span>
                                    <button
                                        className={styles.orderCancel}
                                        title='刪單'
                                        onClick={() =>
                                            cancelOrder(t.order.id)
                                                .then(() => {
                                                    notify({
                                                        kind: 'ok',
                                                        title: '🗑 刪單已送出',
                                                        body: `${t.contract.code} @${fmtPrice(price)}`,
                                                    });
                                                    onOrdersChangedRef.current?.();
                                                })
                                                .catch((e) =>
                                                    notify({
                                                        kind: 'err',
                                                        title: '刪單失敗',
                                                        body:
                                                            e instanceof Error
                                                                ? e.message
                                                                : String(e),
                                                    }),
                                                )
                                        }
                                    >
                                        CANCEL
                                    </button>
                                </div>
                            );
                        })}
                        {triggers.map((t) => (
                            <div key={t.id} className={styles.triggerRow}>
                                <span>
                                    {t.kind === 'stop' ? (
                                        <OctagonX size={10} />
                                    ) : t.kind === 'take' ? (
                                        <Crosshair size={10} />
                                    ) : (
                                        <Bell size={10} />
                                    )}{' '}
                                    {t.condition === 'below' ? '≤' : '≥'}
                                    {fmtPrice(t.price)}
                                    {t.kind !== 'alert' &&
                                        ` ${t.action === 'Buy' ? '買' : '賣'}${t.quantity}`}
                                </span>
                                <button
                                    className={styles.triggerRemove}
                                    onClick={() => removeTrigger(t.id)}
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                {/* 副圖指標的 legend 疊在自己的 pane 左上角，不混進主圖 */}
                {instances.map((inst) => {
                    const def = DEF_BY_TYPE.get(inst.type);
                    if (
                        !def ||
                        def.kind !== 'series' ||
                        def.category !== 'pane' ||
                        inst.hidden
                    ) {
                        return null;
                    }
                    if (
                        inst.visibleTf &&
                        !inst.visibleTf.includes(tf.minutes)
                    ) {
                        return null;
                    }
                    const top = paneTops[inst.id];
                    if (top === undefined) return null;
                    return (
                        <div
                            key={`pane-legend-${inst.id}`}
                            className={styles.paneLegend}
                            style={{ top: top + 4 }}
                        >
                            {renderLegendRow(inst)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
