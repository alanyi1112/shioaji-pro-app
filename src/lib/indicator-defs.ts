// src/lib/indicator-defs.ts — indicator registry, instances, persistence.
// Each definition declares its params, output series (with render hints)
// and a compute() over candles; candle-chart renders overlays on the main
// pane and gives every oscillator instance its own sub-pane.

import {
    atr,
    bias,
    bollinger,
    cci,
    dmi,
    donchian,
    ema,
    keltner,
    macd,
    mfi,
    obv,
    referenceSma,
    roc,
    sar,
    sma,
    stoch,
    stochRsi,
    supertrend,
    vwap,
    wilderRsiSeries,
    willr,
    wma,
    type IndicatorPoint,
} from './indicators';
import type { Candle } from './types/market';

export type OutputKind = 'line' | 'dashed' | 'histogram' | 'points';

export interface ParamDef {
    key: string;
    label: string;
    def: number;
    min: number;
    max: number;
    step?: number;
}

export interface OutputDef {
    key: string;
    label: string;
    kind: OutputKind;
    color: string; // default color
    width?: 1 | 2;
    // histogram only: color positive/negative halves with up/down colors
    signed?: boolean;
}

export interface SeriesRenderTarget {
    pane: 'main' | 'dedicated';
    priceScaleId?: string;
}

interface IndicatorDefBase {
    type: string;
    label: string; // list label, e.g. "MA 移動平均"
    short: string; // legend label, e.g. "MA"
    desc: string; // one-line description shown in the picker
    aliases: string[]; // extra search keywords（中英文）
    category: 'overlay' | 'pane';
    params: ParamDef[];
}

export interface SeriesIndicatorDef extends IndicatorDefBase {
    kind: 'series';
    outputs: OutputDef[];
    render: SeriesRenderTarget;
    // horizontal reference levels drawn in the sub-pane (e.g. RSI 30/70)
    levels?: number[];
    validateParams?: (params: Record<string, number>) => Record<string, string>;
    compute: (
        bars: Candle[],
        p: Record<string, number>,
    ) => Record<string, IndicatorPoint[]>;
}

export interface ReadoutIndicatorDef extends IndicatorDefBase {
    kind: 'readout';
    category: 'overlay';
    singleton: true;
    iconText: string;
}

export interface PrimitiveIndicatorDef extends IndicatorDefBase {
    kind: 'primitive';
    category: 'overlay';
    primitive:
        | 'fair-value-gap'
        | 'fixed-volume-profile'
        | 'traditional-pivot';
    iconText: string;
    singleton: true;
}

export type IndicatorDef =
    | SeriesIndicatorDef
    | ReadoutIndicatorDef
    | PrimitiveIndicatorDef;

type SeriesIndicatorConfig = Omit<SeriesIndicatorDef, 'kind' | 'render'> & {
    render?: SeriesRenderTarget;
};

function orderedPeriodErrors(
    params: Record<string, number>,
    shorter: string,
    longer: string,
): Record<string, string> {
    return params[shorter]! < params[longer]!
        ? {}
        : {
              [shorter]: '短週期必須小於長週期',
              [longer]: '長週期必須大於短週期',
          };
}

const SERIES_INDICATOR_DEFS: SeriesIndicatorConfig[] = [
    // ---- 主圖疊加 ----
    {
        type: 'sma',
        label: 'MA 移動平均',
        short: 'MA',
        desc: '簡單移動平均線，最常用的趨勢基準',
        aliases: ['ma', 'sma', 'moving average', '均線', '移動平均'],
        category: 'overlay',
        params: [{ key: 'period', label: '週期', def: 20, min: 1, max: 500 }],
        outputs: [{ key: 'line', label: 'MA', kind: 'line', color: '#e0a43c' }],
        compute: (b, p) => ({ line: sma(b, p.period!) }),
    },
    {
        type: 'reference-ma-pack',
        label: '參考均線組',
        short: 'MA組',
        desc: '固定顯示 SMA5／10／20／60／120 五條參考均線',
        aliases: ['ma pack', 'reference ma', '均線組', '多均線'],
        category: 'overlay',
        params: [],
        outputs: [
            { key: 'ma5', label: 'SMA5', kind: 'line', color: '#e0a43c' },
            { key: 'ma10', label: 'SMA10', kind: 'line', color: '#b06fff' },
            { key: 'ma20', label: 'SMA20', kind: 'line', color: '#3d8bff' },
            { key: 'ma60', label: 'SMA60', kind: 'line', color: '#19b6c9' },
            { key: 'ma120', label: 'SMA120', kind: 'line', color: '#8b94a7' },
        ],
        compute: (bars) => ({
            ma5: referenceSma(bars, 5),
            ma10: referenceSma(bars, 10),
            ma20: referenceSma(bars, 20),
            ma60: referenceSma(bars, 60),
            ma120: referenceSma(bars, 120),
        }),
    },
    {
        type: 'ema',
        label: 'EMA 指數移動平均',
        short: 'EMA',
        desc: '加重近期價格的均線，反應比 MA 快',
        aliases: ['ema', 'exponential', '指數均線'],
        category: 'overlay',
        params: [{ key: 'period', label: '週期', def: 12, min: 1, max: 500 }],
        outputs: [{ key: 'line', label: 'EMA', kind: 'line', color: '#19b6c9' }],
        compute: (b, p) => ({ line: ema(b, p.period!) }),
    },
    {
        type: 'wma',
        label: 'WMA 加權移動平均',
        short: 'WMA',
        desc: '線性加權均線，越近的 K 棒權重越大',
        aliases: ['wma', 'weighted', '加權均線'],
        category: 'overlay',
        params: [{ key: 'period', label: '週期', def: 20, min: 1, max: 500 }],
        outputs: [{ key: 'line', label: 'WMA', kind: 'line', color: '#b06fff' }],
        compute: (b, p) => ({ line: wma(b, p.period!) }),
    },
    {
        type: 'boll',
        label: 'BOLL 布林通道',
        short: 'BOLL',
        desc: '均線 ± 標準差通道，衡量波動與乖離',
        aliases: ['boll', 'bollinger', 'bands', '布林', '保力加'],
        category: 'overlay',
        params: [
            { key: 'period', label: '週期', def: 20, min: 2, max: 200 },
            { key: 'mult', label: '標準差倍數', def: 2, min: 0.5, max: 5, step: 0.5 },
        ],
        outputs: [
            { key: 'mid', label: '中軌', kind: 'line', color: '#8b94a7' },
            { key: 'upper', label: '上軌', kind: 'line', color: '#5a89c9' },
            { key: 'lower', label: '下軌', kind: 'line', color: '#5a89c9' },
        ],
        compute: (b, p) => {
            const r = bollinger(b, p.period!, p.mult!);
            return { mid: r.mid, upper: r.upper, lower: r.lower };
        },
    },
    {
        type: 'volume-ma',
        label: 'Volume MA 成交量均線',
        short: 'VolMA',
        desc: '成交量 SMA5／10／20；MA20 為 RealTimeStock 延伸',
        aliases: ['volume ma', 'volma', '成交量均線', '量均線'],
        category: 'overlay',
        render: { pane: 'main', priceScaleId: 'vol' },
        params: [],
        outputs: [
            { key: 'ma5', label: 'Vol MA5', kind: 'line', color: '#e0a43c' },
            { key: 'ma10', label: 'Vol MA10', kind: 'line', color: '#b06fff' },
            { key: 'ma20', label: 'Vol MA20', kind: 'line', color: '#3d8bff' },
        ],
        compute: (bars) => ({
            ma5: referenceSma(bars, 5, 'volume'),
            ma10: referenceSma(bars, 10, 'volume'),
            ma20: referenceSma(bars, 20, 'volume'),
        }),
    },
    {
        type: 'vwap',
        label: 'VWAP 成交量加權均價',
        short: 'VWAP',
        desc: '當日成交量加權平均價，日內交易基準線',
        aliases: ['vwap', 'volume weighted', '均價線'],
        category: 'overlay',
        params: [],
        outputs: [
            { key: 'line', label: 'VWAP', kind: 'line', color: '#f5f7fa', width: 2 },
        ],
        compute: (b) => ({ line: vwap(b) }),
    },
    {
        type: 'sar',
        label: 'SAR 拋物線',
        short: 'SAR',
        desc: '拋物線停損轉向點，追蹤趨勢的移動停損',
        aliases: ['sar', 'parabolic', '拋物線', '停損點'],
        category: 'overlay',
        params: [
            { key: 'step', label: '加速因子', def: 0.02, min: 0.01, max: 0.1, step: 0.01 },
            { key: 'max', label: '上限', def: 0.2, min: 0.1, max: 0.5, step: 0.05 },
        ],
        outputs: [
            { key: 'line', label: 'SAR', kind: 'points', color: '#e0a43c' },
        ],
        compute: (b, p) => ({ line: sar(b, p.step!, p.max!) }),
    },
    {
        type: 'supertrend',
        label: 'SuperTrend 超級趨勢',
        short: 'ST',
        desc: 'ATR 通道趨勢線，多空翻轉一目了然',
        aliases: ['supertrend', 'st', '超級趨勢'],
        category: 'overlay',
        params: [
            { key: 'period', label: 'ATR 週期', def: 10, min: 1, max: 100 },
            { key: 'mult', label: '倍數', def: 3, min: 0.5, max: 10, step: 0.5 },
        ],
        outputs: [
            { key: 'up', label: '多頭', kind: 'line', color: '#1fd286', width: 2 },
            { key: 'down', label: '空頭', kind: 'line', color: '#ff4d6a', width: 2 },
        ],
        compute: (b, p) => {
            const r = supertrend(b, p.period!, p.mult!);
            return { up: r.up, down: r.down };
        },
    },
    {
        type: 'donchian',
        label: 'Donchian 唐奇安通道',
        short: 'DC',
        desc: 'N 期最高/最低價通道，突破策略經典',
        aliases: ['donchian', 'channel', '唐奇安', '海龜'],
        category: 'overlay',
        params: [{ key: 'period', label: '週期', def: 20, min: 2, max: 200 }],
        outputs: [
            { key: 'upper', label: '上軌', kind: 'line', color: '#5a89c9' },
            { key: 'mid', label: '中軌', kind: 'dashed', color: '#8b94a7' },
            { key: 'lower', label: '下軌', kind: 'line', color: '#5a89c9' },
        ],
        compute: (b, p) => {
            const r = donchian(b, p.period!);
            return { upper: r.upper, mid: r.mid, lower: r.lower };
        },
    },
    {
        type: 'keltner',
        label: 'Keltner 肯特納通道',
        short: 'KC',
        desc: 'EMA ± ATR 通道，比布林更平滑的波動帶',
        aliases: ['keltner', 'kc', '肯特納'],
        category: 'overlay',
        params: [
            { key: 'period', label: 'EMA 週期', def: 20, min: 2, max: 200 },
            { key: 'atrPeriod', label: 'ATR 週期', def: 10, min: 1, max: 100 },
            { key: 'mult', label: 'ATR 倍數', def: 2, min: 0.5, max: 5, step: 0.5 },
        ],
        outputs: [
            { key: 'mid', label: '中軌', kind: 'line', color: '#8b94a7' },
            { key: 'upper', label: '上軌', kind: 'line', color: '#c9a25a' },
            { key: 'lower', label: '下軌', kind: 'line', color: '#c9a25a' },
        ],
        compute: (b, p) => {
            const r = keltner(b, p.period!, p.atrPeriod!, p.mult!);
            return { mid: r.mid, upper: r.upper, lower: r.lower };
        },
    },
    // ---- 副圖震盪 ----
    {
        type: 'macd',
        label: 'MACD 指數平滑異同',
        short: 'MACD',
        desc: 'DIF/DEA 交叉與柱狀動能，最經典的趨勢動能指標',
        aliases: ['macd', 'dif', 'dea', '指數平滑'],
        category: 'pane',
        params: [
            { key: 'fastPeriod', label: '快線週期', def: 12, min: 2, max: 200 },
            { key: 'slowPeriod', label: '慢線週期', def: 26, min: 3, max: 200 },
            { key: 'signalPeriod', label: '訊號週期', def: 9, min: 2, max: 100 },
        ],
        outputs: [
            { key: 'hist', label: '柱狀', kind: 'histogram', color: '#8b94a7', signed: true },
            { key: 'macd', label: 'DIF', kind: 'line', color: '#3d8bff' },
            { key: 'signal', label: 'DEA', kind: 'line', color: '#e0a43c' },
        ],
        levels: [0],
        validateParams: (params) =>
            orderedPeriodErrors(params, 'fastPeriod', 'slowPeriod'),
        compute: (b, p) => {
            const r = macd(
                b,
                p.fastPeriod!,
                p.slowPeriod!,
                p.signalPeriod!,
            );
            return { macd: r.macd, signal: r.signal, hist: r.hist };
        },
    },
    {
        type: 'rsi',
        label: 'RSI 相對強弱',
        short: 'RSI',
        desc: '漲跌力道比值 0-100，30/70 超賣超買',
        aliases: ['rsi', 'relative strength', '相對強弱'],
        category: 'pane',
        params: [
            { key: 'shortPeriod', label: '短週期', def: 5, min: 2, max: 100 },
            { key: 'longPeriod', label: '長週期', def: 10, min: 2, max: 100 },
        ],
        outputs: [
            { key: 'short', label: 'RSI 短', kind: 'line', color: '#b06fff' },
            { key: 'long', label: 'RSI 長', kind: 'line', color: '#e0a43c' },
        ],
        levels: [30, 50, 70],
        validateParams: (params) =>
            orderedPeriodErrors(params, 'shortPeriod', 'longPeriod'),
        compute: (b, p) => ({
            short: wilderRsiSeries(b, p.shortPeriod!),
            long: wilderRsiSeries(b, p.longPeriod!),
        }),
    },
    {
        type: 'kd',
        label: 'KD 隨機指標',
        short: 'KD',
        desc: '台股慣用 (9,3,3)，K/D 交叉與 20/80 鈍化',
        aliases: ['kd', 'stochastic', 'stoch', '隨機', '威廉KD'],
        category: 'pane',
        params: [
            { key: 'period', label: 'RSV 週期', def: 9, min: 2, max: 100 },
            { key: 'rsvWeight', label: 'K 權重', def: 3, min: 1, max: 20 },
            { key: 'kWeight', label: 'D 權重', def: 3, min: 1, max: 20 },
        ],
        outputs: [
            { key: 'k', label: 'K', kind: 'line', color: '#3d8bff' },
            { key: 'd', label: 'D', kind: 'line', color: '#e0a43c' },
        ],
        levels: [20, 80],
        compute: (b, p) => {
            const r = stoch(b, p.period!, p.rsvWeight!, p.kWeight!);
            return { k: r.k, d: r.d };
        },
    },
    {
        type: 'stochrsi',
        label: 'StochRSI 隨機相對強弱',
        short: 'SRSI',
        desc: '對 RSI 再取隨機值，靈敏度更高的擺盪指標',
        aliases: ['stochrsi', 'srsi', '隨機rsi'],
        category: 'pane',
        params: [
            { key: 'rsiPeriod', label: 'RSI 週期', def: 14, min: 2, max: 100 },
            { key: 'stochPeriod', label: 'Stoch 週期', def: 14, min: 2, max: 100 },
            { key: 'k', label: 'K 平滑', def: 3, min: 1, max: 50 },
            { key: 'd', label: 'D 平滑', def: 3, min: 1, max: 50 },
        ],
        outputs: [
            { key: 'k', label: 'K', kind: 'line', color: '#3d8bff' },
            { key: 'd', label: 'D', kind: 'line', color: '#e0a43c' },
        ],
        levels: [20, 80],
        compute: (b, p) => {
            const r = stochRsi(b, p.rsiPeriod!, p.stochPeriod!, p.k!, p.d!);
            return { k: r.k, d: r.d };
        },
    },
    {
        type: 'cci',
        label: 'CCI 順勢指標',
        short: 'CCI',
        desc: '價格偏離統計均值的程度，±100 為超買賣區',
        aliases: ['cci', 'commodity channel', '順勢'],
        category: 'pane',
        params: [{ key: 'period', label: '週期', def: 20, min: 2, max: 200 }],
        outputs: [{ key: 'line', label: 'CCI', kind: 'line', color: '#19b6c9' }],
        levels: [-100, 100],
        compute: (b, p) => ({ line: cci(b, p.period!) }),
    },
    {
        type: 'atr',
        label: 'ATR 真實波幅',
        short: 'ATR',
        desc: '平均真實波動範圍，衡量波動大小與停損距離',
        aliases: ['atr', 'average true range', '波幅', '真實波動'],
        category: 'pane',
        params: [{ key: 'period', label: '週期', def: 14, min: 2, max: 100 }],
        outputs: [{ key: 'line', label: 'ATR', kind: 'line', color: '#e0a43c' }],
        compute: (b, p) => ({ line: atr(b, p.period!) }),
    },
    {
        type: 'obv',
        label: 'OBV 能量潮',
        short: 'OBV',
        desc: '成交量累積方向，量先價行的量能指標',
        aliases: ['obv', 'on balance volume', '能量潮', '量能'],
        category: 'pane',
        params: [],
        outputs: [{ key: 'line', label: 'OBV', kind: 'line', color: '#5a89c9' }],
        compute: (b) => ({ line: obv(b) }),
    },
    {
        type: 'mfi',
        label: 'MFI 資金流量',
        short: 'MFI',
        desc: '帶量的 RSI，衡量資金流入流出強度',
        aliases: ['mfi', 'money flow', '資金流'],
        category: 'pane',
        params: [{ key: 'period', label: '週期', def: 14, min: 2, max: 100 }],
        outputs: [{ key: 'line', label: 'MFI', kind: 'line', color: '#1fd286' }],
        levels: [20, 80],
        compute: (b, p) => ({ line: mfi(b, p.period!) }),
    },
    {
        type: 'willr',
        label: 'W%R 威廉指標',
        short: 'W%R',
        desc: '收盤價在 N 期高低區間的位置，-20/-80 超買賣',
        aliases: ['willr', 'williams', '威廉'],
        category: 'pane',
        params: [{ key: 'period', label: '週期', def: 14, min: 2, max: 100 }],
        outputs: [{ key: 'line', label: 'W%R', kind: 'line', color: '#ff8a3d' }],
        levels: [-80, -20],
        compute: (b, p) => ({ line: willr(b, p.period!) }),
    },
    {
        type: 'dmi',
        label: 'DMI/ADX 趨向指標',
        short: 'DMI',
        desc: '+DI/-DI 多空方向與 ADX 趨勢強度',
        aliases: ['dmi', 'adx', 'di', '趨向'],
        category: 'pane',
        params: [
            { key: 'period', label: 'DI 週期', def: 14, min: 2, max: 100 },
            { key: 'adx', label: 'ADX 平滑', def: 14, min: 2, max: 100 },
        ],
        outputs: [
            { key: 'plus', label: '+DI', kind: 'line', color: '#1fd286' },
            { key: 'minus', label: '-DI', kind: 'line', color: '#ff4d6a' },
            { key: 'adx', label: 'ADX', kind: 'line', color: '#f5f7fa', width: 2 },
        ],
        levels: [25],
        compute: (b, p) => {
            const r = dmi(b, p.period!, p.adx!);
            return { plus: r.plus, minus: r.minus, adx: r.adx };
        },
    },
    {
        type: 'roc',
        label: 'ROC 變動率',
        short: 'ROC',
        desc: 'N 期價格變動百分比，動能與背離觀察',
        aliases: ['roc', 'rate of change', '變動率', '動能'],
        category: 'pane',
        params: [{ key: 'period', label: '週期', def: 12, min: 1, max: 200 }],
        outputs: [{ key: 'line', label: 'ROC', kind: 'line', color: '#b06fff' }],
        levels: [0],
        compute: (b, p) => ({ line: roc(b, p.period!) }),
    },
    {
        type: 'bias',
        label: 'BIAS 乖離率',
        short: 'BIAS',
        desc: '價格偏離均線的百分比，台股常用的回歸指標',
        aliases: ['bias', '乖離', '乖離率'],
        category: 'pane',
        params: [{ key: 'period', label: 'MA 週期', def: 20, min: 1, max: 200 }],
        outputs: [{ key: 'line', label: 'BIAS', kind: 'line', color: '#19b6c9' }],
        levels: [0],
        compute: (b, p) => ({ line: bias(b, p.period!) }),
    },
];

export const KBAR_READOUT_TYPE = 'kbar-ohlcv-readout';

export const KBAR_READOUT_DEF: ReadoutIndicatorDef = {
    kind: 'readout',
    type: KBAR_READOUT_TYPE,
    label: 'K 棒價量',
    short: 'OHLCV',
    desc: '游標所在 K 棒的時間區間、開高低收與成交量',
    aliases: ['k棒價量', '價量', 'ohlcv', '開高低收', '時間區間'],
    category: 'overlay',
    params: [],
    singleton: true,
    iconText: 'K',
};

export const BUILTIN_PRIMITIVE_DEFS: PrimitiveIndicatorDef[] = [
    {
        kind: 'primitive',
        type: 'fair-value-gap',
        label: 'FVG 公允價值缺口',
        short: 'FVG',
        desc: '三根 K 棒缺口；顯示最新 20 個標記與 12 個尚未完全填補區域',
        aliases: ['fvg', 'fair value gap', '公允價值缺口', '缺口'],
        category: 'overlay',
        params: [],
        primitive: 'fair-value-gap',
        iconText: 'F',
        singleton: true,
    },
    {
        kind: 'primitive',
        type: 'fixed-volume-profile',
        label: 'K 線固定區間 Volume Profile',
        short: '固定區間 VP',
        desc: '依手動選取的 K 線固定區間統計 24 個價位 bins；不同於逐筆分價量',
        aliases: [
            'volume profile',
            'fixed range',
            '固定區間',
            '成交量分布',
            'k線',
        ],
        category: 'overlay',
        params: [],
        primitive: 'fixed-volume-profile',
        iconText: 'VP',
        singleton: true,
    },
    {
        kind: 'primitive',
        type: 'traditional-pivot',
        label: 'Traditional Pivot Point',
        short: 'Pivot',
        desc: '以最後完成的 STK／IND／WRT 交易日 H／L／C 投影下一交易日七條水平線',
        aliases: ['pivot', 'traditional pivot', '樞紐點', '支撐壓力'],
        category: 'overlay',
        params: [],
        primitive: 'traditional-pivot',
        iconText: 'P',
        singleton: true,
    },
];

export const INDICATOR_DEFS: IndicatorDef[] = [
    KBAR_READOUT_DEF,
    ...BUILTIN_PRIMITIVE_DEFS,
    ...SERIES_INDICATOR_DEFS.map(
        (def): SeriesIndicatorDef => ({
            kind: 'series',
            ...def,
            render:
                def.render ??
                {
                    pane: def.category === 'pane' ? 'dedicated' : 'main',
                },
        }),
    ),
];

export const DEF_BY_TYPE = new Map(INDICATOR_DEFS.map((d) => [d.type, d]));

// ---- instances ----

// how one output is drawn（TradingView plot styles → lightweight-charts）
export type PlotKind = 'line' | 'step' | 'area' | 'histogram' | 'circles';

export interface OutputStyle {
    color?: string;
    width?: 1 | 2 | 3 | 4;
    visible?: boolean;
    opacity?: number; // 0–100
    plot?: PlotKind;
}

export interface IndicatorInstance {
    id: string;
    type: string;
    params: Record<string, number>;
    // output key -> color override（legacy，讀取時遷移到 styles）
    colors: Record<string, string>;
    // output key -> style overrides
    styles?: Record<string, OutputStyle>;
    hidden?: boolean; // 眼睛暫時隱藏，不刪設定
    // 只在這些時框顯示（tf minutes）；undefined = 全部時框
    visibleTf?: number[];
    precision?: number; // 數值小數位數；undefined = 自動
    showLabels?: boolean; // 價格軸最新值標籤（預設 false）
    showValues?: boolean; // legend 顯示數值（預設 true）
}

// merged effective style for one output
export function outputStyle(
    inst: IndicatorInstance,
    def: SeriesIndicatorDef,
    key: string,
): Required<Omit<OutputStyle, 'plot'>> & { plot: PlotKind } {
    const out = def.outputs.find((o) => o.key === key);
    const s = inst.styles?.[key] ?? {};
    return {
        color: s.color ?? inst.colors[key] ?? out?.color ?? '#8b94a7',
        width: s.width ?? out?.width ?? 1,
        visible: s.visible ?? true,
        opacity: s.opacity ?? 100,
        plot:
            s.plot ??
            (out?.kind === 'histogram'
                ? 'histogram'
                : out?.kind === 'points'
                  ? 'circles'
                  : 'line'),
    };
}

// hex + 0-100 opacity → rgba()（100% 直接回傳 hex，保住主題原色）
export function colorWithOpacity(hex: string, opacity: number): string {
    if (opacity >= 100 || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${(opacity / 100).toFixed(2)})`;
}

export function instanceLabel(inst: IndicatorInstance): string {
    const def = DEF_BY_TYPE.get(inst.type);
    if (!def) return inst.type;
    if (def.kind === 'readout') return def.short;
    const args = def.params.map((p) => inst.params[p.key] ?? p.def);
    return args.length > 0 ? `${def.short}(${args.join(',')})` : def.short;
}

export function newInstance(type: string): IndicatorInstance {
    const def = DEF_BY_TYPE.get(type);
    const params: Record<string, number> = {};
    for (const p of def?.params ?? []) params[p.key] = p.def;
    const saved = loadTypeDefaults()[type];
    return {
        id: `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        params: { ...params, ...saved?.params },
        colors: {},
        ...(saved?.styles ? { styles: saved.styles } : {}),
        ...(saved?.precision !== undefined
            ? { precision: saved.precision }
            : {}),
        ...(saved?.showLabels !== undefined
            ? { showLabels: saved.showLabels }
            : {}),
        ...(saved?.showValues !== undefined
            ? { showValues: saved.showValues }
            : {}),
    };
}

export function duplicateInstance(inst: IndicatorInstance): IndicatorInstance {
    return {
        ...JSON.parse(JSON.stringify(inst)),
        id: `${inst.type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    };
}

export function commitIndicatorDraft(
    current: readonly IndicatorInstance[],
    draft: IndicatorInstance,
    isNew: boolean,
): { instances: readonly IndicatorInstance[]; conflict: boolean } {
    if (isNew) {
        return current.some((instance) => instance.id === draft.id)
            ? { instances: current, conflict: true }
            : { instances: [...current, draft], conflict: false };
    }
    if (!current.some((instance) => instance.id === draft.id)) {
        return { instances: current, conflict: true };
    }
    return {
        instances: current.map((instance) =>
            instance.id === draft.id ? draft : instance,
        ),
        conflict: false,
    };
}

// ---- per-type user defaults（設定視窗「存為我的預設」）----

export interface TypeDefaults {
    params?: Record<string, number>;
    styles?: Record<string, OutputStyle>;
    precision?: number;
    showLabels?: boolean;
    showValues?: boolean;
}

export const LEGACY_DEFAULTS_KEY = 'sj-pro-ind-defaults-v1';
export const DEFAULTS_KEY = 'sj-pro-ind-defaults-v2';

interface TypeDefaultsEnvelope {
    schemaVersion: 2;
    defaults: Record<string, TypeDefaults>;
}

export function loadTypeDefaults(): Record<string, TypeDefaults> {
    try {
        const raw = localStorage.getItem(DEFAULTS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            if (
                isRecord(parsed) &&
                parsed.schemaVersion === 2 &&
                isRecord(parsed.defaults)
            ) {
                return normalizeTypeDefaults(parsed.defaults, 'v2');
            }
        }
    } catch {
        // fall back to the legacy defaults source below
    }
    try {
        const legacy = localStorage.getItem(LEGACY_DEFAULTS_KEY);
        if (!legacy) return {};
        const migrated = normalizeTypeDefaults(JSON.parse(legacy), 'v1');
        try {
            const envelope: TypeDefaultsEnvelope = {
                schemaVersion: 2,
                defaults: migrated,
            };
            localStorage.setItem(DEFAULTS_KEY, JSON.stringify(envelope));
        } catch {
            // migration remains available in memory; legacy source is preserved
        }
        return migrated;
    } catch {
        return {};
    }
}

export function saveTypeDefault(inst: IndicatorInstance) {
    const all = loadTypeDefaults();
    all[inst.type] = {
        params: inst.params,
        ...(inst.styles ? { styles: inst.styles } : {}),
        ...(inst.precision !== undefined ? { precision: inst.precision } : {}),
        ...(inst.showLabels !== undefined
            ? { showLabels: inst.showLabels }
            : {}),
        ...(inst.showValues !== undefined
            ? { showValues: inst.showValues }
            : {}),
    };
    try {
        const envelope: TypeDefaultsEnvelope = {
            schemaVersion: 2,
            defaults: normalizeTypeDefaults(all, 'v2'),
        };
        localStorage.setItem(DEFAULTS_KEY, JSON.stringify(envelope));
    } catch {
        // phase two replaces this with the canonical memory-first store
    }
}

// factory-reset one instance（清掉自訂參數與樣式，回到內建預設）
export function factoryInstance(inst: IndicatorInstance): IndicatorInstance {
    const def = DEF_BY_TYPE.get(inst.type);
    const params: Record<string, number> = {};
    for (const p of def?.params ?? []) params[p.key] = p.def;
    return {
        id: inst.id,
        type: inst.type,
        params,
        colors: {},
        ...(inst.hidden ? { hidden: inst.hidden } : {}),
        ...(inst.visibleTf ? { visibleTf: inst.visibleTf } : {}),
    };
}

// ---- persistence（全域，跨圖表共用；v1 Set 格式自動遷移）----

export const STORE_KEY = 'sj-pro-indicators-v3';
export const LEGACY_V2_STORE_KEY = 'sj-pro-indicators-v2';
const LEGACY_KEY = 'sj-pro-indicators';

export interface IndicatorStoreEnvelope {
    schemaVersion: 3;
    revision: number;
    updatedAt: number;
    writerId: string;
    instances: IndicatorInstance[];
}

export type IndicatorPersistenceStatus =
    | { state: 'saved' }
    | { state: 'error'; reasonCode: 'storage-unavailable' };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumberRecord(value: unknown): Record<string, number> {
    if (!isRecord(value)) return {};
    const out: Record<string, number> = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'number' && Number.isFinite(item)) out[key] = item;
    }
    return out;
}

function stringRecord(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {};
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string') out[key] = item;
    }
    return out;
}

function defaultParams(def: IndicatorDef): Record<string, number> {
    return Object.fromEntries(def.params.map((param) => [param.key, param.def]));
}

function validParamValue(raw: unknown, param: ParamDef): number | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    if (raw < param.min || raw > param.max) return undefined;
    if ((param.step ?? 1) >= 1 && !Number.isInteger(raw)) return undefined;
    return raw;
}

function normalizeParamsForType(
    type: string,
    value: unknown,
    source: 'v2' | 'v3',
): Record<string, number> {
    const def = DEF_BY_TYPE.get(type);
    if (!def) return {};
    const raw = finiteNumberRecord(value);
    const defaults = defaultParams(def);
    let candidates: Record<string, number> = raw;
    if (source === 'v2') {
        if (type === 'rsi') {
            candidates = { shortPeriod: 5, longPeriod: 10 };
        } else if (type === 'kd') {
            candidates = {
                period: raw.period ?? defaults.period!,
                rsvWeight: raw.k ?? defaults.rsvWeight!,
                kWeight: raw.d ?? defaults.kWeight!,
            };
        } else if (type === 'macd') {
            candidates = {
                fastPeriod: raw.fast ?? defaults.fastPeriod!,
                slowPeriod: raw.slow ?? defaults.slowPeriod!,
                signalPeriod: raw.signal ?? defaults.signalPeriod!,
            };
        }
    }
    const normalized: Record<string, number> = {};
    for (const param of def.params) {
        normalized[param.key] =
            validParamValue(candidates[param.key], param) ?? param.def;
    }
    if (
        def.kind === 'series' &&
        def.validateParams &&
        Object.keys(def.validateParams(normalized)).length > 0
    ) {
        return defaults;
    }
    return normalized;
}

const PLOT_KINDS = new Set<PlotKind>([
    'line',
    'step',
    'area',
    'histogram',
    'circles',
]);

function outputStyleRecord(value: unknown): Record<string, OutputStyle> | undefined {
    if (!isRecord(value)) return undefined;
    const out: Record<string, OutputStyle> = {};
    for (const [key, raw] of Object.entries(value)) {
        if (!isRecord(raw)) continue;
        const style: OutputStyle = {};
        if (typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color)) {
            style.color = raw.color;
        }
        if (
            typeof raw.width === 'number' &&
            [1, 2, 3, 4].includes(raw.width)
        ) {
            style.width = raw.width as 1 | 2 | 3 | 4;
        }
        if (typeof raw.visible === 'boolean') style.visible = raw.visible;
        if (
            typeof raw.opacity === 'number' &&
            Number.isFinite(raw.opacity) &&
            raw.opacity >= 0 &&
            raw.opacity <= 100
        ) {
            style.opacity = raw.opacity;
        }
        if (typeof raw.plot === 'string' && PLOT_KINDS.has(raw.plot as PlotKind)) {
            style.plot = raw.plot as PlotKind;
        }
        if (Object.keys(style).length > 0) out[key] = style;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function migrateStyles(
    type: string,
    value: unknown,
    source: 'v2' | 'v3',
): Record<string, OutputStyle> | undefined {
    const styles = outputStyleRecord(value);
    if (!styles || source !== 'v2' || type !== 'rsi') return styles;
    const migrated = { ...styles };
    if (migrated.line && !migrated.short) migrated.short = migrated.line;
    delete migrated.line;
    return Object.keys(migrated).length > 0 ? migrated : undefined;
}

function migrateColors(
    type: string,
    value: unknown,
    source: 'v2' | 'v3',
): Record<string, string> {
    const colors = stringRecord(value);
    if (source === 'v2' && type === 'rsi' && colors.line && !colors.short) {
        colors.short = colors.line;
        delete colors.line;
    }
    return colors;
}

function normalizeTypeDefaults(
    value: unknown,
    source: 'v1' | 'v2',
): Record<string, TypeDefaults> {
    if (!isRecord(value)) return {};
    const out: Record<string, TypeDefaults> = {};
    for (const [type, raw] of Object.entries(value)) {
        const def = DEF_BY_TYPE.get(type);
        if (!def || !isRecord(raw)) continue;
        const normalized: TypeDefaults = {
            params: normalizeParamsForType(
                type,
                raw.params,
                source === 'v1' ? 'v2' : 'v3',
            ),
        };
        const styles = migrateStyles(
            type,
            raw.styles,
            source === 'v1' ? 'v2' : 'v3',
        );
        if (styles) normalized.styles = styles;
        if (
            typeof raw.precision === 'number' &&
            Number.isInteger(raw.precision) &&
            raw.precision >= 0 &&
            raw.precision <= 10
        ) {
            normalized.precision = raw.precision;
        }
        if (typeof raw.showLabels === 'boolean') {
            normalized.showLabels = raw.showLabels;
        }
        if (typeof raw.showValues === 'boolean') {
            normalized.showValues = raw.showValues;
        }
        out[type] = normalized;
    }
    return out;
}

// Runtime-normalize localStorage before it reaches chart code.  In addition to
// filtering unknown/corrupt definitions this enforces singleton readouts while
// preserving the relative order and settings of every unrelated indicator.
export function normalizeIndicatorInstances(
    value: unknown,
    source: 'v2' | 'v3' = 'v3',
): IndicatorInstance[] {
    if (!Array.isArray(value)) return [];
    const out: IndicatorInstance[] = [];
    const singletonTypes = new Set<string>();
    for (const raw of value) {
        if (!isRecord(raw)) continue;
        const type = typeof raw.type === 'string' ? raw.type : '';
        const id = typeof raw.id === 'string' ? raw.id : '';
        const def = DEF_BY_TYPE.get(type);
        if (!def || !id) continue;
        if (def.kind !== 'series' && def.singleton) {
            if (singletonTypes.has(type)) continue;
            singletonTypes.add(type);
        }
        const params = normalizeParamsForType(type, raw.params, source);
        const normalized: IndicatorInstance = {
            id,
            type,
            params,
            colors: migrateColors(type, raw.colors, source),
        };
        const styles = migrateStyles(type, raw.styles, source);
        if (styles) normalized.styles = styles;
        if (typeof raw.hidden === 'boolean') normalized.hidden = raw.hidden;
        if (Array.isArray(raw.visibleTf)) {
            normalized.visibleTf = raw.visibleTf.filter(
                (item): item is number =>
                    typeof item === 'number' && Number.isFinite(item),
            );
        }
        if (
            typeof raw.precision === 'number' &&
            Number.isInteger(raw.precision) &&
            raw.precision >= 0 &&
            raw.precision <= 10
        ) {
            normalized.precision = raw.precision;
        }
        if (typeof raw.showLabels === 'boolean') {
            normalized.showLabels = raw.showLabels;
        }
        if (typeof raw.showValues === 'boolean') {
            normalized.showValues = raw.showValues;
        }
        out.push(normalized);
    }
    return out;
}

export function splitKbarReadoutInstance(
    instances: readonly IndicatorInstance[],
): {
    readout: IndicatorInstance | null;
    rest: IndicatorInstance[];
} {
    let readout: IndicatorInstance | null = null;
    const rest: IndicatorInstance[] = [];
    for (const instance of instances) {
        if (instance.type === KBAR_READOUT_TYPE && readout === null) {
            readout = instance;
        } else if (instance.type !== KBAR_READOUT_TYPE) {
            rest.push(instance);
        }
    }
    return { readout, rest };
}

function migrateLegacy(): IndicatorInstance[] {
    try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (!raw) return [];
        const keys = JSON.parse(raw) as string[];
        const out: IndicatorInstance[] = [];
        for (const k of keys) {
            if (k.startsWith('ma')) {
                const inst = newInstance('sma');
                inst.params.period = Number(k.slice(2)) || 20;
                out.push(inst);
            } else if (k === 'ema12') {
                out.push(newInstance('ema'));
            } else if (k === 'bb') {
                out.push(newInstance('boll'));
            } else if (k === 'vwap') {
                out.push(newInstance('vwap'));
            }
        }
        localStorage.removeItem(LEGACY_KEY);
        return out;
    } catch {
        return [];
    }
}

// 指標實例 canonical store。記憶體 snapshot 是執行期唯一真相來源；storage
// 只負責跨 reload / 跨視窗同步，寫入失敗不得回滾已完成的 UI mutation。
const instanceListeners = new Set<() => void>();
const persistenceListeners = new Set<() => void>();
const STORE_WRITER_ID = `indicator-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

let storeStorage: Storage | null | undefined;
let instanceSnapshot: readonly IndicatorInstance[] | undefined;
let storeMeta = { revision: 0, updatedAt: 0, writerId: '' };
let persistenceStatus: IndicatorPersistenceStatus = { state: 'saved' };
let storageListenerInstalled = false;

function currentStorage(): Storage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

function cloneInstances(
    instances: readonly IndicatorInstance[],
): IndicatorInstance[] {
    return instances.map((instance) => ({
        ...instance,
        params: { ...instance.params },
        colors: { ...instance.colors },
        ...(instance.styles
            ? {
                  styles: Object.fromEntries(
                      Object.entries(instance.styles).map(([key, style]) => [
                          key,
                          { ...style },
                      ]),
                  ),
              }
            : {}),
        ...(instance.visibleTf
            ? { visibleTf: [...instance.visibleTf] }
            : {}),
    }));
}

function immutableSnapshot(
    instances: readonly IndicatorInstance[],
): readonly IndicatorInstance[] {
    const cloned = cloneInstances(instances);
    for (const instance of cloned) {
        Object.freeze(instance.params);
        Object.freeze(instance.colors);
        if (instance.styles) {
            for (const style of Object.values(instance.styles)) {
                Object.freeze(style);
            }
            Object.freeze(instance.styles);
        }
        if (instance.visibleTf) Object.freeze(instance.visibleTf);
        Object.freeze(instance);
    }
    return Object.freeze(cloned);
}

function parseV3Envelope(raw: string): IndicatorStoreEnvelope | null {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (
            !isRecord(parsed) ||
            parsed.schemaVersion !== 3 ||
            !Array.isArray(parsed.instances)
        ) {
            return null;
        }
        return {
            schemaVersion: 3,
            revision:
                typeof parsed.revision === 'number' &&
                Number.isSafeInteger(parsed.revision) &&
                parsed.revision >= 0
                    ? parsed.revision
                    : 0,
            updatedAt:
                typeof parsed.updatedAt === 'number' &&
                Number.isFinite(parsed.updatedAt) &&
                parsed.updatedAt >= 0
                    ? parsed.updatedAt
                    : 0,
            writerId:
                typeof parsed.writerId === 'string'
                    ? parsed.writerId
                    : 'v3-migration',
            instances: normalizeIndicatorInstances(parsed.instances, 'v3'),
        };
    } catch {
        return null;
    }
}

function compareStoreMeta(
    left: Pick<IndicatorStoreEnvelope, 'revision' | 'updatedAt' | 'writerId'>,
    right: Pick<IndicatorStoreEnvelope, 'revision' | 'updatedAt' | 'writerId'>,
): number {
    if (left.revision !== right.revision) {
        return left.revision - right.revision;
    }
    if (left.updatedAt !== right.updatedAt) {
        return left.updatedAt - right.updatedAt;
    }
    return left.writerId.localeCompare(right.writerId);
}

function notifyInstances() {
    for (const listener of instanceListeners) listener();
}

function setPersistenceStatus(next: IndicatorPersistenceStatus) {
    if (
        persistenceStatus.state === next.state &&
        (persistenceStatus.state !== 'error' ||
            (next.state === 'error' &&
                persistenceStatus.reasonCode === next.reasonCode))
    ) {
        return;
    }
    persistenceStatus = next;
    for (const listener of persistenceListeners) listener();
}

function persistEnvelope(envelope: IndicatorStoreEnvelope): boolean {
    const storage = currentStorage();
    if (!storage) {
        setPersistenceStatus({
            state: 'error',
            reasonCode: 'storage-unavailable',
        });
        return false;
    }
    try {
        storage.setItem(STORE_KEY, JSON.stringify(envelope));
        setPersistenceStatus({ state: 'saved' });
        return true;
    } catch {
        setPersistenceStatus({
            state: 'error',
            reasonCode: 'storage-unavailable',
        });
        return false;
    }
}

function installStorageListener() {
    if (storageListenerInstalled || typeof window === 'undefined') return;
    window.addEventListener('storage', (event) => {
        if (event.key !== STORE_KEY || !event.newValue) return;
        applyIndicatorStorageValue(event.newValue);
    });
    storageListenerInstalled = true;
}

function initializeStore() {
    const storage = currentStorage();
    // Test environments may replace the Storage object between cases. Treat
    // that as a fresh document without weakening the app's stable snapshot.
    if (instanceSnapshot !== undefined && storeStorage === storage) return;
    storeStorage = storage;
    instanceSnapshot = undefined;
    storeMeta = { revision: 0, updatedAt: 0, writerId: '' };
    persistenceStatus = { state: 'saved' };

    try {
        const envelope = storage?.getItem(STORE_KEY);
        const parsed = envelope ? parseV3Envelope(envelope) : null;
        if (parsed) {
            instanceSnapshot = immutableSnapshot(parsed.instances);
            storeMeta = parsed;
            installStorageListener();
            return;
        }
    } catch {
        // fall through to the preserved v2 migration source
    }

    let migrated: IndicatorInstance[] = [];
    try {
        const rawV2 = storage?.getItem(LEGACY_V2_STORE_KEY);
        if (rawV2) {
            migrated = normalizeIndicatorInstances(JSON.parse(rawV2), 'v2');
        }
    } catch {
        // fall through to the oldest set-based storage
    }
    if (migrated.length === 0) migrated = migrateLegacy();
    instanceSnapshot = immutableSnapshot(migrated);
    installStorageListener();
    if (migrated.length > 0) {
        const envelope: IndicatorStoreEnvelope = {
            schemaVersion: 3,
            revision: 1,
            updatedAt: Date.now(),
            writerId: STORE_WRITER_ID,
            instances: cloneInstances(instanceSnapshot),
        };
        storeMeta = envelope;
        persistEnvelope(envelope);
    }
}

export function getInstancesSnapshot(): readonly IndicatorInstance[] {
    initializeStore();
    return instanceSnapshot ?? Object.freeze([]);
}

export function loadInstances(): IndicatorInstance[] {
    return cloneInstances(getInstancesSnapshot());
}

export function subscribeInstances(fn: () => void): () => void {
    initializeStore();
    instanceListeners.add(fn);
    return () => instanceListeners.delete(fn);
}

export function getIndicatorPersistenceStatus(): IndicatorPersistenceStatus {
    initializeStore();
    return persistenceStatus;
}

export function subscribeIndicatorPersistence(
    fn: () => void,
): () => void {
    initializeStore();
    persistenceListeners.add(fn);
    return () => persistenceListeners.delete(fn);
}

export function updateInstances(
    updater: (
        current: readonly IndicatorInstance[],
    ) => readonly IndicatorInstance[],
): readonly IndicatorInstance[] {
    const current = getInstancesSnapshot();
    const normalized = normalizeIndicatorInstances(updater(current), 'v3');
    if (JSON.stringify(normalized) === JSON.stringify(current)) return current;

    // Memory first: React subscribers immediately observe this immutable
    // snapshot even when persistence is unavailable or quota constrained.
    instanceSnapshot = immutableSnapshot(normalized);
    storeMeta = {
        revision: storeMeta.revision + 1,
        updatedAt: Date.now(),
        writerId: STORE_WRITER_ID,
    };
    notifyInstances();
    persistEnvelope({
        schemaVersion: 3,
        ...storeMeta,
        instances: cloneInstances(instanceSnapshot),
    });
    return instanceSnapshot;
}

export function saveInstances(list: readonly IndicatorInstance[]) {
    updateInstances(() => list);
}

export function applyIndicatorStorageValue(raw: string): boolean {
    initializeStore();
    const incoming = parseV3Envelope(raw);
    if (!incoming || compareStoreMeta(incoming, storeMeta) <= 0) return false;
    instanceSnapshot = immutableSnapshot(incoming.instances);
    storeMeta = {
        revision: incoming.revision,
        updatedAt: incoming.updatedAt,
        writerId: incoming.writerId,
    };
    setPersistenceStatus({ state: 'saved' });
    notifyInstances();
    return true;
}

export function resetIndicatorStoreForTests() {
    instanceSnapshot = undefined;
    storeStorage = undefined;
    storeMeta = { revision: 0, updatedAt: 0, writerId: '' };
    persistenceStatus = { state: 'saved' };
    instanceListeners.clear();
    persistenceListeners.clear();
}

// ---- favorites（指標選擇器的星號收藏）----

const FAV_KEY = 'sj-pro-ind-favs';

export function loadFavorites(): Set<string> {
    try {
        const raw = localStorage.getItem(FAV_KEY);
        if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
        // default empty
    }
    return new Set();
}

export function saveFavorites(favs: Set<string>) {
    try {
        localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
    } catch {
        // keep in-memory
    }
}
