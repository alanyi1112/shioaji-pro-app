import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MoneyFlowPoint, MoneyFlowSnapshot } from '../lib/tick-tape-money-flow';
import type { TapeCoverageState } from '../lib/tick-tape-source-verification';
import type { LargeTradeSettings } from '../lib/tick-tape-session';
import { fmtInt } from '../lib/utils/format';
import * as styles from './tick-tape.css';

const ROW_HEIGHT = 28;
const CHART_WIDTH = 360;
const CHART_HEIGHT = 150;
const MARGIN = { top: 10, right: 10, bottom: 22, left: 54 };

function formatMillions(value: number): string {
    return new Intl.NumberFormat('zh-TW', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value / 1_000_000);
}

function valueClass(value: number) {
    return value > 0
        ? styles.moneyPositive
        : value < 0 ? styles.moneyNegative : styles.moneyZero;
}

function linePath(
    points: readonly MoneyFlowPoint[],
    value: (point: MoneyFlowPoint) => number,
    x: (minuteIndex: number) => number,
    y: (amount: number) => number,
) {
    return points.map((point, index) => `${index ? 'L' : 'M'}${x(point.minuteIndex).toFixed(2)},${y(value(point)).toFixed(2)}`).join(' ');
}

function MoneyFlowChart({ snapshot }: { snapshot: MoneyFlowSnapshot }) {
    const chart = useRef<SVGSVGElement>(null);
    const [size, setSize] = useState({ width: CHART_WIDTH, height: CHART_HEIGHT });
    useEffect(() => {
        const element = chart.current;
        if (!element) return;
        const update = () => {
            const bounds = element.getBoundingClientRect();
            if (bounds.width > 0 && bounds.height > 0) {
                setSize({ width: Math.round(bounds.width), height: Math.round(bounds.height) });
            }
        };
        const observer = new ResizeObserver(update);
        observer.observe(element);
        update();
        return () => observer.disconnect();
    }, []);
    const chartWidth = size.width;
    const chartHeight = size.height;
    const values = snapshot.points.flatMap((point) => [
        point.overallNetTwd,
        point.largeNetTwd,
        point.nonLargeNetTwd,
    ]);
    const rawMin = Math.min(0, ...values);
    const rawMax = Math.max(0, ...values);
    const rawSpan = rawMax - rawMin;
    const fallback = rawSpan === 0 ? 1_000_000 : rawSpan;
    const yMin = rawMin - fallback * 0.06;
    const yMax = rawMax + fallback * 0.06;
    const xMin = 9 * 60;
    const xMax = Math.max(13 * 60 + 30, snapshot.points.at(-1)?.minuteIndex ?? xMin + 1);
    const plotWidth = chartWidth - MARGIN.left - MARGIN.right;
    const plotHeight = chartHeight - MARGIN.top - MARGIN.bottom;
    const x = (minuteIndex: number) => MARGIN.left + (minuteIndex - xMin) / (xMax - xMin) * plotWidth;
    const y = (amount: number) => MARGIN.top + (yMax - amount) / (yMax - yMin) * plotHeight;
    const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (yMax - yMin) * index / 4);
    const xTicks = [9, 10, 11, 12, 13].map((hour) => hour * 60).filter((minute) => minute <= xMax);
    const series = [
        { key: 'overall', label: '整體', css: styles.moneyOverallLine, value: (point: MoneyFlowPoint) => point.overallNetTwd },
        { key: 'large', label: '大單', css: styles.moneyLargeLine, value: (point: MoneyFlowPoint) => point.largeNetTwd },
        { key: 'non-large', label: '非大單', css: styles.moneyNonLargeLine, value: (point: MoneyFlowPoint) => point.nonLargeNetTwd },
    ];
    return <div className={styles.moneyChartBlock}>
        <svg
            ref={chart}
            className={styles.moneyChart}
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role='img'
            aria-label={snapshot.points.length ? `即時資金流向，共 ${snapshot.points.length} 個成交分鐘` : '即時資金流向尚無成交資料'}
            data-y-min={yMin}
            data-y-max={yMax}
            data-x-min={xMin}
            data-x-max={xMax}
        >
            {yTicks.map((tick) => <g key={tick}>
                <line className={styles.moneyGridLine} x1={MARGIN.left} x2={chartWidth - MARGIN.right} y1={y(tick)} y2={y(tick)} />
                <text className={styles.moneyAxisLabel} x={MARGIN.left - 5} y={y(tick) + 3} textAnchor='end'>{formatMillions(tick)}</text>
            </g>)}
            {xTicks.map((tick) => <g key={tick}>
                <line className={styles.moneyGridLine} x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={chartHeight - MARGIN.bottom} />
                <text className={styles.moneyAxisLabel} x={x(tick)} y={chartHeight - 5} textAnchor='middle'>{String(Math.floor(tick / 60)).padStart(2, '0')}</text>
            </g>)}
            <line data-money-zero-axis='true' className={styles.moneyZeroAxis} x1={MARGIN.left} x2={chartWidth - MARGIN.right} y1={y(0)} y2={y(0)} />
            {snapshot.points.length > 0 && series.map((item) => <path
                key={item.key}
                data-money-series={item.key}
                className={item.css}
                d={linePath(snapshot.points, item.value, x, y)}
            />)}
            {snapshot.points.length === 1 && series.map((item) => <circle
                key={`${item.key}-point`}
                className={item.css}
                cx={x(snapshot.points[0]!.minuteIndex)}
                cy={y(item.value(snapshot.points[0]!))}
                r='2'
            />)}
        </svg>
        <div className={styles.moneyLegend} aria-hidden='true'>
            <span className={styles.moneyLegendItem}><i className={styles.moneyOverallSwatch} />整體</span>
            <span className={styles.moneyLegendItem}><i className={styles.moneyLargeSwatch} />大單</span>
            <span className={styles.moneyLegendItem}><i className={styles.moneyNonLargeSwatch} />非大單</span>
            <span className={styles.moneyUnit}>單位：百萬元</span>
        </div>
    </div>;
}

function coverageLabel(coverageState: TapeCoverageState) {
    if (coverageState === 'verified') return '截至目前已核實';
    if (coverageState === 'confirmed_empty') return '當日已確認無成交';
    if (coverageState === 'loading') return '正在載入成交資料…';
    if (coverageState === 'failed') return '成交資料載入失敗';
    return '部分資料：以下統計只代表已載入範圍';
}

export function TickTapeMoneyFlow({
    snapshot,
    coverageState,
    status,
    loadedRange,
    recomputing,
    settings,
}: {
    snapshot: MoneyFlowSnapshot;
    coverageState: TapeCoverageState;
    status: string;
    loadedRange: string | null;
    recomputing: boolean;
    settings: LargeTradeSettings;
}) {
    const viewport = useRef<HTMLDivElement>(null);
    const previousCount = useRef(snapshot.points.length);
    const [scrollTop, setScrollTop] = useState(0);
    const [height, setHeight] = useState(300);
    useEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setHeight(element.clientHeight || 300));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useLayoutEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const oldCount = previousCount.current;
        if (element.scrollTop > 0 && snapshot.points.length > oldCount) {
            element.scrollTop += (snapshot.points.length - oldCount) * ROW_HEIGHT;
            setScrollTop(element.scrollTop);
        }
        previousCount.current = snapshot.points.length;
    }, [snapshot.points.length]);
    const count = snapshot.points.length;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
    const end = Math.min(count, start + Math.ceil(height / ROW_HEIGHT) + 8);
    const rows = [];
    for (let position = start; position < end; position += 1) {
        const point = snapshot.points[count - 1 - position]!;
        rows.push(<div
            key={point.minute}
            data-money-flow-row={point.minute}
            className={styles.moneyTableRow}
            style={{ top: position * ROW_HEIGHT }}
        >
            <span>{point.minute}</span>
            <span className={`${styles.moneyNumber} ${valueClass(point.overallNetTwd)}`}>{formatMillions(point.overallNetTwd)}</span>
            <span className={`${styles.moneyNumber} ${valueClass(point.largeNetTwd)}`}>{formatMillions(point.largeNetTwd)}</span>
            <span className={`${styles.moneyNumber} ${valueClass(point.nonLargeNetTwd)}`}>{formatMillions(point.nonLargeNetTwd)}</span>
        </div>);
    }
    const coverage = coverageLabel(coverageState);
    return <div className={styles.moneyBody} data-money-flow='true'>
        <div className={styles.moneyExplanation}>
            <span>主動買賣成交淨額；整體 = 大單 + 非大單</span>
            <span>未知方向 {fmtInt(snapshot.unknownDirectionCount)} 筆／{formatMillions(snapshot.unknownDirectionAmountTwd)} 百萬元，未納入淨額</span>
            <span>大單：金額 ≥ {formatMillions(settings.amount)} 百萬元 {settings.operator === 'AND' ? '且' : '或'} 張數 ≥ {settings.lots} 張 {settings.operator === 'AND' ? '且' : '或'} 前 {settings.sampleSize} 筆 P{settings.percentile}；開盤瞬間與 13:25 起歸入非大單</span>
        </div>
        {snapshot.unknownDirectionCount > 0 && <details className={styles.moneyUnknownDetails}>
            <summary>未知方向成交資料：{fmtInt(snapshot.unknownDirectionCount)} 筆（顯示最近 {snapshot.unknownTrades.length} 筆）</summary>
            <ol className={styles.moneyUnknownList}>
                {[...snapshot.unknownTrades].reverse().map((trade, index) => <li key={`${trade.tradeDate}-${trade.time}-${index}`}>
                    {trade.tradeDate} {trade.time} · 價 {trade.close.toLocaleString('zh-TW')} · 量 {fmtInt(trade.volume)} 張 ·
                    方向碼 {trade.tickType} · 金額 {fmtInt(trade.tradeAmountTwd)} 元 · {trade.source === 'live' ? '即時' : '歷史'}
                </li>)}
            </ol>
        </details>}
        <div role='status' className={styles.distributionStatus} data-coverage-state={coverageState}>
            <span className={styles.distributionCoverageHeadline}>{coverage}</span>
            <span>{status}</span>
            {loadedRange && <span>{loadedRange}</span>}
            {recomputing && <span>大單設定重新計算中，暫時顯示上一版結果…</span>}
        </div>
        <MoneyFlowChart snapshot={snapshot} />
        <div className={styles.moneyActions}>
            <button className={styles.tab} type='button' onClick={() => viewport.current?.scrollTo({ top: 0 })}>回到最新</button>
            <span className={styles.moneyActionText}>{coverage}</span>
            <span className={styles.moneyActionText}>{count} 個成交分鐘</span>
        </div>
        <div ref={viewport} className={styles.moneyViewport} tabIndex={0} aria-label='資金流向分鐘表' onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
            <div className={styles.moneyTableHeader} aria-hidden='true'>
                <span>時間</span><span className={styles.moneyHeaderNumber}>整體淨額</span><span className={styles.moneyHeaderNumber}>大單淨額</span><span className={styles.moneyHeaderNumber}>非大單淨額</span>
            </div>
            {count === 0 && <div className={styles.distributionEmpty}>{coverage}</div>}
            <div className={styles.moneyRows} style={{ height: count * ROW_HEIGHT }}>{rows}</div>
        </div>
    </div>;
}
