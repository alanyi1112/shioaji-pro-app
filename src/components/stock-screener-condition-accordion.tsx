import type { CriteriaV5 } from '../lib/stock-screener-v5';
import type { HolderMode } from '../lib/stock-screener-domain';
import type { BollReversalMode, FractalAlgorithm, FractalDirection } from '../lib/stock-screener-technical-patterns';
import type { DivergenceDirection, DivergenceSource, MaMode } from '../lib/stock-screener-v4';
import {
    STOCK_SCREENER_CONDITIONS, STOCK_SCREENER_CONDITION_GROUPS,
    isStockScreenerConditionEnabled, setStockScreenerConditionEnabled,
    stockScreenerConditionGroup, stockScreenerConditionSummary,
    type StockScreenerConditionId,
} from '../lib/stock-screener-condition-ui';
import * as styles from './stock-screener-panel.css';

const enableLabels: Record<StockScreenerConditionId, string> = {
    volume: '啟用成交量條件',
    holder: '啟用千張大戶條件',
    fractal: '啟用 K 棒分型',
    bollReversal: '啟用布林通道反轉 K',
    ma: '啟用均線糾結與交叉',
    divergence: '啟用價與指標背離',
    largeHolderTrend: '啟用千張大戶比例趨勢',
    largeHolderConcentration: '啟用大戶人數減少且持股增加',
    retailHolderDecline: '啟用十張以下散戶比例下降',
    trustOwnership: '啟用投信買超占股本',
    priceMargin: '啟用價漲融資不增',
    shortMarginRatio: '啟用券資比',
    closeHigh: '啟用收盤價新高',
    closeSmaBreakout: '啟用收盤價突破均線',
};

interface Props {
    criteria: CriteriaV5;
    activeCondition: StockScreenerConditionId;
    onActiveConditionChange: (condition: StockScreenerConditionId) => void;
    onChange: (criteria: CriteriaV5) => void;
}

export function StockScreenerConditionAccordion({ criteria, activeCondition, onActiveConditionChange, onChange }: Props) {
    const activeGroup = stockScreenerConditionGroup(activeCondition);
    const update = <K extends keyof CriteriaV5>(key: K, value: CriteriaV5[K]) => onChange({ ...criteria, [key]: value });
    const chooseGroup = (group: typeof STOCK_SCREENER_CONDITION_GROUPS[number]['id']) => {
        const conditions = STOCK_SCREENER_CONDITIONS.filter((condition) => condition.group === group);
        onActiveConditionChange(conditions.find(({ id }) => isStockScreenerConditionEnabled(criteria, id))?.id ?? conditions[0]!.id);
    };
    const enable = (id: StockScreenerConditionId, enabled: boolean) => {
        onChange(setStockScreenerConditionEnabled(criteria, id, enabled));
        if (enabled) onActiveConditionChange(id);
    };

    const editor = (id: StockScreenerConditionId) => {
        switch (id) {
            case 'volume': return <>
                <input aria-label='成交量倍數' type='number' min='0.01' max='1000' step='0.01' value={criteria.volume.threshold}
                    onChange={(event) => update('volume', { ...criteria.volume, threshold: event.target.value })} /> 倍
                <label><input type='checkbox' aria-label='成交量條件啟用最低成交值' disabled={!criteria.volume.enabled}
                    checked={criteria.volume.enabled && criteria.volume.turnover.enabled}
                    onChange={(event) => update('volume', { ...criteria.volume, turnover: { ...criteria.volume.turnover, enabled: event.target.checked } })} /> 最低成交值</label>
                <input aria-label='成交量條件最低成交值（萬）' type='number' min='0.01' max='10000000' step='0.01'
                    disabled={!criteria.volume.enabled || !criteria.volume.turnover.enabled} value={criteria.volume.turnover.minimumWan}
                    onChange={(event) => update('volume', { ...criteria.volume, turnover: { ...criteria.volume.turnover, minimumWan: event.target.value } })} /> 萬
            </>;
            case 'holder': return <>
                <select aria-label='大戶持股模式' value={criteria.holder.mode}
                    onChange={(event) => update('holder', { ...criteria.holder, mode: event.target.value as HolderMode })}>
                    <option value='weekly-increase'>單週增加</option><option value='decrease-to-increase'>持股比例由減轉增</option><option value='increase-to-decrease'>持股比例由增轉減</option>
                </select>
                {criteria.holder.mode !== 'weekly-increase' && <><input aria-label='反轉前連續週數' type='number' min='1' max='4' step='1' value={criteria.holder.streakWeeks}
                    onChange={(event) => update('holder', { ...criteria.holder, streakWeeks: Number(event.target.value) })} /> 週後反轉</>}
                <span>{criteria.holder.mode === 'increase-to-decrease' ? '週減 ≥' : '週增 ≥'}</span>
                <input aria-label='大戶週增百分點' type='number' min='0.01' max='100' step='0.01' value={criteria.holder.threshold}
                    onChange={(event) => update('holder', { ...criteria.holder, threshold: event.target.value })} /> 百分點
                <label><input type='checkbox' aria-label='大戶條件啟用最低成交值' disabled={!criteria.holder.enabled}
                    checked={criteria.holder.enabled && criteria.holder.turnover.enabled}
                    onChange={(event) => update('holder', { ...criteria.holder, turnover: { ...criteria.holder.turnover, enabled: event.target.checked } })} /> 最低成交值</label>
                <input aria-label='大戶條件最低成交值（萬）' type='number' min='0.01' max='10000000' step='0.01'
                    disabled={!criteria.holder.enabled || !criteria.holder.turnover.enabled} value={criteria.holder.turnover.minimumWan}
                    onChange={(event) => update('holder', { ...criteria.holder, turnover: { ...criteria.holder.turnover, minimumWan: event.target.value } })} /> 萬
            </>;
            case 'fractal': return <>
                <label>算法 <select aria-label='分型算法' disabled={!criteria.fractal.enabled} value={criteria.fractal.algorithm}
                    onChange={(event) => update('fractal', { ...criteria.fractal, algorithm: event.target.value as FractalAlgorithm })}>
                    <option value='raw-three'>原始三 K</option><option value='chan-containment'>纏論包含處理</option><option value='any'>任一算法</option>
                </select></label>
                <label>方向 <select aria-label='分型方向' disabled={!criteria.fractal.enabled} value={criteria.fractal.direction}
                    onChange={(event) => update('fractal', { ...criteria.fractal, direction: event.target.value as FractalDirection })}>
                    <option value='bottom'>底分型</option><option value='top'>頂分型</option><option value='any'>任一方向</option>
                </select></label>
                <span className={styles.note}>中心 K 棒需等右側完整交易日確認；確認日不是中心日。</span>
            </>;
            case 'bollReversal': return <>
                <label>型態 <select aria-label='布林反轉型態' disabled={!criteria.bollReversal.enabled} value={criteria.bollReversal.mode}
                    onChange={(event) => update('bollReversal', { ...criteria.bollReversal, mode: event.target.value as BollReversalMode })}>
                    <option value='lower-bullish'>下軌陽 K＋下影</option><option value='upper-bearish'>上軌陰 K＋上影</option><option value='any'>任一型態</option>
                </select></label>
                <span className={styles.note}>固定 BOLL(20,2)：前一交易日收盤仍在通道內，最新日首次嚴格穿越。</span>
            </>;
            case 'ma': return <>
                <label>型態 <select aria-label='均線型態' disabled={!criteria.ma.enabled} value={criteria.ma.mode}
                    onChange={(event) => update('ma', { ...criteria.ma, mode: event.target.value as MaMode })}>
                    <option value='bullish-preparation'>多頭準備突破</option><option value='golden-cross'>黃金交叉</option>
                    <option value='bearish-preparation'>空頭準備跌破</option><option value='death-cross'>死亡交叉</option>
                    <option value='any-bullish'>任一多頭訊號</option><option value='any-bearish'>任一空頭訊號</option>
                </select></label>
                <label>連續 <input aria-label='均線糾結交易日數' type='number' min='2' max='10' step='1' disabled={!criteria.ma.enabled}
                    value={criteria.ma.compressionDays} onChange={(event) => update('ma', { ...criteria.ma, compressionDays: Number(event.target.value) })} /> 個交易日</label>
                <label>最大 spread <input aria-label='均線糾結最大寬度百分比' type='number' min='0.1' max='5' step='0.01' disabled={!criteria.ma.enabled}
                    value={criteria.ma.maxSpreadPct} onChange={(event) => update('ma', { ...criteria.ma, maxSpreadPct: event.target.value })} /> %</label>
                <span className={styles.note}>SMA5／10／20 使用官方未還原收盤價；交叉模式的糾結窗結束於前一交易日 P。</span>
            </>;
            case 'divergence': return <>
                <label>指標 <select aria-label='背離指標來源' disabled={!criteria.divergence.enabled} value={criteria.divergence.source}
                    onChange={(event) => update('divergence', { ...criteria.divergence, source: event.target.value as DivergenceSource })}>
                    <option value='obv'>OBV</option><option value='rsi5'>RSI5</option><option value='rsi10'>RSI10</option>
                    <option value='kd-k'>KD-K(9,3,3)</option><option value='macd-line'>MACD line</option><option value='macd-histogram'>MACD 能量柱</option>
                </select></label>
                <label>方向 <select aria-label='背離方向' disabled={!criteria.divergence.enabled} value={criteria.divergence.direction}
                    onChange={(event) => update('divergence', { ...criteria.divergence, direction: event.target.value as DivergenceDirection })}>
                    <option value='bullish'>底背離</option><option value='bearish'>頂背離</option><option value='any'>任一方向</option>
                </select></label>
                <label><input aria-label='MACD 能量柱要求中間穿越零軸' type='checkbox'
                    disabled={!criteria.divergence.enabled || criteria.divergence.source !== 'macd-histogram'}
                    checked={criteria.divergence.enabled && criteria.divergence.source === 'macd-histogram' && criteria.divergence.requireZeroReset}
                    onChange={(event) => update('divergence', { ...criteria.divergence, requireZeroReset: event.target.checked })} /> 兩 pivot 之間需穿越零軸</label>
                <span className={styles.note}>只判定一般型背離；price pivot 左右各 2 根確認、間距 5–30 個交易日，最新 pivot 距 D 最多 3 日且價差至少 1%。</span>
            </>;
            case 'largeHolderTrend': return <>
                <label>比例 <input aria-label='千張大戶最低比例' type='number' min='0' max='100' step='0.01' disabled={!criteria.largeHolderTrend.enabled}
                    value={criteria.largeHolderTrend.minimumRatioPct} onChange={(event) => update('largeHolderTrend', { ...criteria.largeHolderTrend, minimumRatioPct: event.target.value })} />–
                    <input aria-label='千張大戶最高比例' type='number' min='0' max='100' step='0.01' disabled={!criteria.largeHolderTrend.enabled}
                    value={criteria.largeHolderTrend.maximumRatioPct} onChange={(event) => update('largeHolderTrend', { ...criteria.largeHolderTrend, maximumRatioPct: event.target.value })} /> %</label>
                <label>連續 <input aria-label='千張大戶上升週數' type='number' min='1' max='12' step='1' disabled={!criteria.largeHolderTrend.enabled}
                    value={criteria.largeHolderTrend.weeks} onChange={(event) => update('largeHolderTrend', { ...criteria.largeHolderTrend, weeks: Number(event.target.value) })} /> 週</label>
                <label>每週增幅 &gt; <input aria-label='千張大戶最低週增百分點' type='number' min='0' max='100' step='0.01' disabled={!criteria.largeHolderTrend.enabled}
                    value={criteria.largeHolderTrend.minimumIncreasePp} onChange={(event) => update('largeHolderTrend', { ...criteria.largeHolderTrend, minimumIncreasePp: event.target.value })} /> 百分點</label>
                <span className={styles.note}>固定使用 TDCC 第 15 級（1,000,001 股以上）。</span>
            </>;
            case 'largeHolderConcentration': return <label>連續 <input aria-label='大戶集中週數' type='number' min='1' max='12' step='1' disabled={!criteria.largeHolderConcentration.enabled}
                value={criteria.largeHolderConcentration.weeks} onChange={(event) => update('largeHolderConcentration', { ...criteria.largeHolderConcentration, weeks: Number(event.target.value) })} /> 週</label>;
            case 'retailHolderDecline': return <>
                <label>連續 <input aria-label='散戶比例下降週數' type='number' min='1' max='12' step='1' disabled={!criteria.retailHolderDecline.enabled}
                    value={criteria.retailHolderDecline.weeks} onChange={(event) => update('retailHolderDecline', { ...criteria.retailHolderDecline, weeks: Number(event.target.value) })} /> 週</label>
                <span className={styles.note}>固定加總 TDCC 第 1–3 級。</span>
            </>;
            case 'trustOwnership': return <>
                <label>近 <input aria-label='投信買超交易日數' type='number' min='5' max='10' step='1' disabled={!criteria.trustOwnership.enabled}
                    value={criteria.trustOwnership.days} onChange={(event) => update('trustOwnership', { ...criteria.trustOwnership, days: Number(event.target.value) })} /> 日</label>
                <label>至少 <input aria-label='投信買超占股本最低百分比' type='number' min='0' max='1000' step='0.01' disabled={!criteria.trustOwnership.enabled}
                    value={criteria.trustOwnership.minimumPct} onChange={(event) => update('trustOwnership', { ...criteria.trustOwnership, minimumPct: event.target.value })} /> %</label>
            </>;
            case 'priceMargin': return <label>比較 <input aria-label='價漲融資比較交易日數' type='number' min='1' max='20' step='1' disabled={!criteria.priceMargin.enabled}
                value={criteria.priceMargin.days} onChange={(event) => update('priceMargin', { ...criteria.priceMargin, days: Number(event.target.value) })} /> 個交易日前</label>;
            case 'shortMarginRatio': return <label>至少 <input aria-label='券資比最低百分比' type='number' min='0.01' max='1000' step='0.01' disabled={!criteria.shortMarginRatio.enabled}
                value={criteria.shortMarginRatio.minimumPct} onChange={(event) => update('shortMarginRatio', { ...criteria.shortMarginRatio, minimumPct: event.target.value })} /> %</label>;
            case 'closeHigh': return <label>近 <input aria-label='收盤價新高交易日數' type='number' min='2' max='120' step='1' disabled={!criteria.closeHigh.enabled}
                value={criteria.closeHigh.days} onChange={(event) => update('closeHigh', { ...criteria.closeHigh, days: Number(event.target.value) })} /> 日</label>;
            case 'closeSmaBreakout': return <label>週期 <select aria-label='收盤價突破均線週期' disabled={!criteria.closeSmaBreakout.enabled} value={criteria.closeSmaBreakout.period}
                onChange={(event) => update('closeSmaBreakout', { ...criteria.closeSmaBreakout, period: Number(event.target.value) as 5 | 10 | 20 | 60 })}>
                <option value='5'>SMA5</option><option value='10'>SMA10</option><option value='20'>SMA20</option><option value='60'>SMA60</option>
            </select></label>;
        }
    };

    return <div className={styles.conditionGroups} aria-label='選股條件'>
        {STOCK_SCREENER_CONDITION_GROUPS.map((group) => {
            const conditions = STOCK_SCREENER_CONDITIONS.filter((condition) => condition.group === group.id);
            const enabledCount = conditions.filter(({ id }) => isStockScreenerConditionEnabled(criteria, id)).length;
            const expanded = activeGroup === group.id;
            return <section className={styles.conditionGroup} key={group.id}>
                <button type='button' className={styles.groupToggle} aria-expanded={expanded} aria-controls={`screener-condition-group-${group.id}`}
                    onClick={() => chooseGroup(group.id)}>
                    <span>{expanded ? '▼' : '▶'} {group.label}</span><span>{enabledCount} / {conditions.length}</span>
                </button>
                {expanded && <div id={`screener-condition-group-${group.id}`} className={styles.conditionList}>
                    {conditions.map((condition) => {
                        const active = condition.id === activeCondition;
                        const enabled = isStockScreenerConditionEnabled(criteria, condition.id);
                        return <div className={styles.conditionItem} key={condition.id} data-condition-id={condition.id}>
                            <div className={styles.conditionSummary}>
                                <label className={styles.conditionEnable}><input type='checkbox' aria-label={enableLabels[condition.id]}
                                    checked={enabled} onChange={(event) => enable(condition.id, event.target.checked)} />
                                    <span className={styles.conditionState}>{enabled ? '已啟用' : '未啟用'}</span></label>
                                <button type='button' className={styles.conditionToggle} aria-expanded={active}
                                    aria-controls={`screener-condition-${condition.id}`} aria-label={`設定${condition.label}`}
                                    onClick={() => onActiveConditionChange(condition.id)}>
                                    <span className={styles.conditionTitle}>{active ? '▼' : '▶'} {condition.label}</span>
                                    <span className={styles.conditionValue}>{stockScreenerConditionSummary(criteria, condition.id)}</span>
                                </button>
                            </div>
                            {active && <fieldset id={`screener-condition-${condition.id}`} className={styles.conditionCard} aria-label={`${condition.label}設定`}>
                                {editor(condition.id)}
                            </fieldset>}
                        </div>;
                    })}
                </div>}
            </section>;
        })}
    </div>;
}
