import type { ForeignReversalCriteria, TrustReversalCriteria } from '../lib/stock-screener-v6';
import type { CriteriaV7, VolumeConfirmationCriteria } from '../lib/stock-screener-v7';
import type { HolderMode } from '../lib/stock-screener-domain';
import type { BollReversalMode, FractalAlgorithm, FractalDirection } from '../lib/stock-screener-technical-patterns';
import type { DivergenceDirection, DivergenceSource, MaMode } from '../lib/stock-screener-v4';
import {
    STOCK_SCREENER_CONDITIONS, STOCK_SCREENER_CONDITION_GROUPS,
    isStockScreenerConditionEnabled, setStockScreenerConditionEnabled,
    stockScreenerConditionGroup, stockScreenerConditionSummary,
    type StockScreenerConditionId,
    type ScreenerUICriteria,
} from '../lib/stock-screener-condition-ui';
import * as styles from './stock-screener-panel.css';
import { DEFAULT_BOLLINGER_SQUEEZE } from '../lib/stock-screener-v8';
import { StockScreenerBollingerEditor } from './stock-screener-bollinger-editor';

const enableLabels: Record<StockScreenerConditionId, string> = {
    volume: '啟用成交量條件',
    holder: '啟用千張大戶條件',
    fractal: '啟用 K 棒分型',
    bollReversal: '啟用布林通道反轉 K',
    ma: '啟用均線糾結與交叉',
    divergence: '啟用價與指標背離',
    bollPosition: '啟用布林通道位置',
    bollSqueezeStages: '啟用布林壓縮與突破',
    rsiCross: '啟用 RSI 極值區交叉',
    kdCross: '啟用 KD 極值區交叉',
    macdSignal: '啟用 MACD 零軸與交叉',
    largeHolderTrend: '啟用千張大戶比例趨勢',
    largeHolderConcentration: '啟用大戶人數減少且持股增加',
    retailHolderDecline: '啟用十張以下散戶比例下降',
    trustOwnership: '啟用投信買超占股本',
    priceMargin: '啟用價漲融資不增',
    shortMarginRatio: '啟用券資比',
    closeHigh: '啟用收盤價新高',
    closeSmaBreakout: '啟用收盤價突破均線',
    foreignReversal: '啟用外資連賣後轉買與爆量換手',
    trustReversal: '啟用投信連賣後轉買與爆量換手',
};

interface Props {
    criteria: ScreenerUICriteria;
    activeCondition: StockScreenerConditionId;
    onActiveConditionChange: (condition: StockScreenerConditionId) => void;
    onChange: (criteria: ScreenerUICriteria) => void;
}

export function StockScreenerConditionAccordion({ criteria, activeCondition, onActiveConditionChange, onChange }: Props) {
    const activeGroup = stockScreenerConditionGroup(activeCondition);
    const update = <K extends keyof CriteriaV7>(key: K, value: CriteriaV7[K]) => onChange({ ...criteria, [key]: value });
    const chooseGroup = (group: typeof STOCK_SCREENER_CONDITION_GROUPS[number]['id']) => {
        const conditions = STOCK_SCREENER_CONDITIONS.filter((condition) => condition.group === group);
        onActiveConditionChange(conditions.find(({ id }) => isStockScreenerConditionEnabled(criteria, id))?.id ?? conditions[0]!.id);
    };
    const enable = (id: StockScreenerConditionId, enabled: boolean) => {
        onChange(setStockScreenerConditionEnabled(criteria, id, enabled));
        if (enabled) onActiveConditionChange(id);
    };
    const reversalEditor = (key: 'foreignReversal' | 'trustReversal') => {
        const value = criteria[key];
        const set = (next: ForeignReversalCriteria | TrustReversalCriteria) => update(key, next as CriteriaV7[typeof key]);
        return <>
            <label>前期連賣 <input aria-label={`${key === 'foreignReversal' ? '外資' : '投信'}前期連續賣超日數`} type='number' min='1' max='10' step='1'
                value={value.sellStreakDays} onChange={(event) => set({ ...value, sellStreakDays: Number(event.target.value) })} /> 日</label>
            <label>今日淨買超 &gt; <input aria-label={`${key === 'foreignReversal' ? '外資' : '投信'}今日最低買超張數`} type='number' min='1' max='99999999' step='1'
                value={value.todayNetBuyMinimumLots} onChange={(event) => set({ ...value, todayNetBuyMinimumLots: event.target.value })} /> 張</label>
            {key === 'trustReversal' && <>
                <label>回補強度 ≥ <input aria-label='投信最低回補強度百分比' type='number' min='0' max='10000' step='0.01'
                    value={criteria.trustReversal.minimumRecoveryPct} onChange={(event) => update('trustReversal', { ...criteria.trustReversal, minimumRecoveryPct: event.target.value })} /> %</label>
                <label>成交參與率 &gt; <input aria-label='投信最低成交參與率百分比' type='number' min='0' max='100' step='0.01'
                    value={criteria.trustReversal.minimumParticipationPct} onChange={(event) => update('trustReversal', { ...criteria.trustReversal, minimumParticipationPct: event.target.value })} /> %</label>
                <label>成交參與率 &lt; <input aria-label='投信最高成交參與率百分比' type='number' min='0' max='100' step='0.01'
                    value={criteria.trustReversal.maximumParticipationPct} onChange={(event) => update('trustReversal', { ...criteria.trustReversal, maximumParticipationPct: event.target.value })} /> %</label>
                <span className={styles.note}>成交參與率＝今日投信淨買超 ÷ 今日成交量；這是當日流量占比，不是投信持股比例。</span>
            </>}
            <label>今日週轉率 &gt; <input aria-label={`${key === 'foreignReversal' ? '外資' : '投信'}最低週轉率百分比`} type='number' min='0.01' max='1000' step='0.01'
                value={value.minimumTurnoverPct} onChange={(event) => set({ ...value, minimumTurnoverPct: event.target.value })} /> %</label>
            <label>前 <input aria-label={`${key === 'foreignReversal' ? '外資' : '投信'}比較交易日數`} type='number' min='2' max='20' step='1'
                value={value.comparisonDays} onChange={(event) => set({ ...value, comparisonDays: Number(event.target.value) })} /> 日平均的
                <input aria-label={`${key === 'foreignReversal' ? '外資' : '投信'}週轉率倍數`} type='number' min='0.01' max='100' step='0.01'
                    value={value.turnoverMultiple} onChange={(event) => set({ ...value, turnoverMultiple: event.target.value })} /> 倍</label>
            <label>收盤高於 MA <input aria-label={`${key === 'foreignReversal' ? '外資' : '投信'}均線期間`} type='number' min='2' max='60' step='1'
                value={value.maPeriod} onChange={(event) => set({ ...value, maPeriod: Number(event.target.value) })} /> 日</label>
            <label>前 <input aria-label={`${key === 'foreignReversal' ? '外資' : '投信'}流動性交易日數`} type='number' min='5' max='60' step='1'
                value={value.liquidityDays} onChange={(event) => set({ ...value, liquidityDays: Number(event.target.value) })} /> 日均量 ≥
                <input aria-label={`${key === 'foreignReversal' ? '外資' : '投信'}最低平均成交量張數`} type='number' min='0' max='99999999' step='1'
                    value={value.minimumAverageVolumeLots} onChange={(event) => set({ ...value, minimumAverageVolumeLots: event.target.value })} /> 張</label>
            <span className={styles.note}>週轉率與成交量基準都排除今日；MA 包含今日。各子條件固定 AND。</span>
        </>;
    };
    const volumeEditor = (key: 'bollPosition' | 'rsiCross' | 'kdCross' | 'macdSignal') => {
        const branch = criteria[key];
        const value = branch.volumeConfirmation;
        const set = (next: VolumeConfirmationCriteria) => update(key, { ...branch, volumeConfirmation: next } as CriteriaV7[typeof key]);
        return <details className={styles.settingsDetails}>
            <summary>量能確認 · {value.enabled ? `${value.baselineDays} 日 ${value.ratio} 倍` : '未啟用'}</summary>
            <label><input type='checkbox' aria-label={`${key}啟用量能確認`} checked={value.enabled}
                onChange={(event) => set({ ...value, enabled: event.target.checked })} /> 啟用量能確認（條件內固定 AND）</label>
            <label>前 <input type='number' min='5' max='60' step='1' aria-label={`${key}量能基準交易日數`}
                disabled={!value.enabled} value={value.baselineDays}
                onChange={(event) => set({ ...value, baselineDays: Number(event.target.value) })} /> 日平均量的
                <input type='number' min='1' max='10' step='0.01' aria-label={`${key}量能倍數`}
                    disabled={!value.enabled} value={value.ratio} onChange={(event) => set({ ...value, ratio: event.target.value })} /> 倍</label>
            <label><input type='checkbox' aria-label={`${key}啟用平均量下限`} disabled={!value.enabled}
                checked={value.enabled && value.minimumAverageVolumeEnabled}
                onChange={(event) => set({ ...value, minimumAverageVolumeEnabled: event.target.checked })} /> 平均量至少
                <input type='number' min='0' max='9999999999' step='1' aria-label={`${key}平均量下限張數`}
                    disabled={!value.enabled || !value.minimumAverageVolumeEnabled} value={value.minimumAverageVolumeLots}
                    onChange={(event) => set({ ...value, minimumAverageVolumeLots: event.target.value })} /> 張</label>
            <span className={styles.note}>基準只取 D 以前的完整官方交易日，不含當日；內部以股計算，畫面才換算為張。</span>
        </details>;
    };

    const editor = (id: StockScreenerConditionId) => {
        if (id === 'bollSqueezeStages') return <StockScreenerBollingerEditor value={criteria.bollSqueezeStages ?? DEFAULT_BOLLINGER_SQUEEZE}
            onChange={bollSqueezeStages => onChange({ ...criteria, bollSqueezeStages })} />;
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
            case 'bollPosition': return <>
                <label>位置 <select aria-label='布林通道位置模式' value={criteria.bollPosition.mode}
                    onChange={(event) => update('bollPosition', { ...criteria.bollPosition, mode: event.target.value as CriteriaV7['bollPosition']['mode'] })}>
                    <option value='upper-outside'>收盤價在上軌外</option><option value='lower-outside'>收盤價在下軌外</option>
                    <option value='middle-near'>收盤價在中軌附近</option>
                </select></label>
                {criteria.bollPosition.mode === 'middle-near' && <>
                    <label>附近 ≤ 通道寬度的 <input aria-label='布林中軌附近容許百分比' type='number' min='1' max='25' step='0.01'
                        value={criteria.bollPosition.tolerancePercent}
                        onChange={(event) => update('bollPosition', { ...criteria.bollPosition, tolerancePercent: event.target.value })} /> %</label>
                    <label>中軌方向 <select aria-label='布林中軌方向' value={criteria.bollPosition.middleTrend}
                        onChange={(event) => update('bollPosition', { ...criteria.bollPosition, middleTrend: event.target.value as CriteriaV7['bollPosition']['middleTrend'] })}>
                        <option value='any'>不限</option><option value='rising'>上升</option><option value='falling'>下降</option>
                    </select></label>
                </>}
                <span className={styles.note}>固定 BOLL(20,2)；上／下軌外採嚴格穿越，中軌附近預設為通道寬度的 10%。</span>
                {volumeEditor('bollPosition')}
            </>;
            case 'rsiCross':
            case 'kdCross': {
                const key = id;
                const value = criteria[key];
                const label = key === 'rsiCross' ? 'RSI5／RSI10' : 'KD(9,3,3) K／D';
                return <>
                    <label>訊號 <select aria-label={`${key === 'rsiCross' ? 'RSI' : 'KD'}交叉模式`} value={value.mode}
                        onChange={(event) => update(key, { ...value, mode: event.target.value as CriteriaV7[typeof key]['mode'] })}>
                        <option value='low-golden-cross'>低檔黃金交叉</option><option value='high-death-cross'>高檔死亡交叉</option>
                    </select></label>
                    {value.mode === 'low-golden-cross'
                        ? <label>低檔 ≤ <input aria-label={`${key === 'rsiCross' ? 'RSI' : 'KD'}低檔門檻`} type='number' min='5' max='50' step='0.01'
                            value={value.lowThreshold} onChange={(event) => update(key, { ...value, lowThreshold: event.target.value })} /></label>
                        : <label>高檔 ≥ <input aria-label={`${key === 'rsiCross' ? 'RSI' : 'KD'}高檔門檻`} type='number' min='50' max='95' step='0.01'
                            value={value.highThreshold} onChange={(event) => update(key, { ...value, highThreshold: event.target.value })} /></label>}
                    <span className={styles.note}>{label} 使用相鄰完成交易日 P／D；兩線需在 P 或 D 同時位於指定極值區。</span>
                    {volumeEditor(key)}
                </>;
            }
            case 'macdSignal': return <>
                <label>訊號 <select aria-label='MACD 訊號模式' value={criteria.macdSignal.mode}
                    onChange={(event) => update('macdSignal', { ...criteria.macdSignal, mode: event.target.value as CriteriaV7['macdSignal']['mode'] })}>
                    <option value='approach-zero-below'>DIF 從下方接近零軸</option><option value='approach-zero-above'>DIF 從上方接近零軸</option>
                    <option value='cross-zero-up'>DIF 向上穿越零軸</option><option value='cross-zero-down'>DIF 向下穿越零軸</option>
                    <option value='below-zero-golden-cross'>零軸下黃金交叉</option><option value='below-zero-death-cross'>零軸下死亡交叉</option>
                    <option value='above-zero-golden-cross'>零軸上黃金交叉</option><option value='above-zero-death-cross'>零軸上死亡交叉</option>
                    <option value='any-golden-cross'>任意位置黃金交叉</option><option value='any-death-cross'>任意位置死亡交叉</option>
                </select></label>
                {criteria.macdSignal.mode.startsWith('approach-zero-') && <label>距零軸 ≤ 收盤價的
                    <input aria-label='MACD 接近零軸百分比' type='number' min='0.01' max='5' step='0.01'
                        value={criteria.macdSignal.approachThresholdPct}
                        onChange={(event) => update('macdSignal', { ...criteria.macdSignal, approachThresholdPct: event.target.value })} /> %</label>}
                <span className={styles.note}>固定 MACD(12,26,9)；接近零軸需 P2→P→D 連續兩段嚴格靠近且未提前穿越。</span>
                {volumeEditor('macdSignal')}
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
            case 'foreignReversal': return reversalEditor('foreignReversal');
            case 'trustReversal': return reversalEditor('trustReversal');
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
                        const active = condition.id === activeCondition && (condition.id !== 'bollSqueezeStages' || criteria.bollSqueezeStages?.enabled === true);
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
