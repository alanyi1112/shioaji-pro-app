import { CANDLESTICK_PATTERNS, type CandlestickReversalCriteria } from '../lib/stock-screener-v9';
import { CANDLESTICK_CATALOG, CANDLESTICK_STATISTICS_NOTICE, PIERCING_TAIWAN_STUDY } from '../lib/stock-screener-candlestick-catalog';
import * as styles from './stock-screener-panel.css';

export const candlestickDefinitions = {
    'three-white-soldiers': '前期下跌；三根長陽、逐根收高；第二、三根開盤嚴格在前棒實體內，每根收盤接近高點。',
    'bearish-engulfing': '前期上漲；先陽後陰；第二根開盤高於第一根收盤、收盤低於第一根開盤，嚴格包覆實體而非影線。',
    'morning-star': '前期下跌；長陰、小實體、長陽；第三根收盤嚴格超過首根實體回補位置，50% 即 2×第三根收盤 > 首根開盤＋收盤。只有最高價越過不算。',
    'three-black-crows': '前期上漲；三根長陰，逐根收盤與最低價下降；第二、三根開盤嚴格在前棒實體內，每根收盤接近低點。首根限制為額外過濾。',
    piercing: '前期下跌；先陰後陽；第二根開盤不高於首根收盤，收盤嚴格超過實體回補位置且低於首根開盤。50% 即 2×第二根收盤 > 首根開盤＋收盤；不是看多吞噬。',
};
export function StockScreenerCandlestickEditor({ value: c, onChange }: { value: CandlestickReversalCriteria; onChange: (c: CandlestickReversalCriteria) => void }) {
    const set = <K extends keyof CandlestickReversalCriteria>(key: K, value: CandlestickReversalCriteria[K]) => onChange({ ...c, [key]: value });
    const num = (key: keyof CandlestickReversalCriteria, label: string, min: number, max: number, unit: string, integer = false) =>
        <label>{label} <input aria-label={label} type='number' min={min} max={max} step={integer ? '1' : '0.01'} value={String(c[key])}
            onChange={e => onChange({ ...c, [key]: integer ? Number(e.target.value) : e.target.value })} /> {unit}</label>;
    const long = c.patterns.some(p => ['three-white-soldiers', 'morning-star', 'three-black-crows'].includes(p)) || c.patterns.includes('piercing') && c.piercingRequireLongFirstBody;
    return <>
        <p className={styles.note}>五型態任一成立（OR）；型態內的趨勢、形狀、量能與位置固定 AND。台灣紅陽／綠陰，以收盤對開盤判定，不依昨收漲跌。</p>
        <div className={styles.dailyStageButtons} aria-label='反轉型態複選'>{CANDLESTICK_PATTERNS.map(p => <button type='button' key={p} aria-pressed={c.patterns.includes(p)}
            onClick={() => set('patterns', CANDLESTICK_PATTERNS.filter(x => x === p ? !c.patterns.includes(x) : c.patterns.includes(x)))}>
            {CANDLESTICK_CATALOG[p].name} · {CANDLESTICK_CATALOG[p].direction === 'bullish' ? '看多' : '看空'}</button>)}</div>
        {c.enabled && !c.patterns.length && <p role='alert'>請至少選擇一種反轉型態；不會清除上次結果。</p>}
        <label>判定時點 <select aria-label='反轉判定時點' value={c.mode} onChange={e => set('mode', e.target.value as typeof c.mode)}>
            <option value='pattern-complete'>最新完整日形態成立</option><option value='next-session-breakout'>次日收盤突破確認</option></select></label>
        <details className={styles.settingsDetails}><summary>數值與型態設定（可調工程預設）</summary>
            <p className={styles.note}>以下數值不是影片統計參數。趨勢及實體參考窗均排除型態；OLS 斜率與首末收盤變動需同方向，0% 仍不接受橫盤。</p>
            {num('trendDays', '前期趨勢交易日數', 3, 60, '日', true)}
            {num('minTrendChangePct', '最低趨勢變動幅度', 0, 20, '%（嚴格大於）')}
            {long && <>{num('longBodyMinPct', '長實體占振幅', 50, 90, '%（≥）')}
                {num('bodyReferenceDays', '實體中位數參考交易日數', 5, 60, '日', true)}
                {num('longBodyMedianRatio', '長實體中位數倍數', .5, 3, '倍（≥）')}</>}
            {c.patterns.some(p => ['three-white-soldiers', 'three-black-crows'].includes(p)) && num('nearExtremeMaxPct', '收盤離高低點上限', 0, 30, '% 振幅（≤）')}
            {c.patterns.includes('morning-star') && <>
                {num('smallBodyMaxPct', '晨星小實體占振幅上限', 0, 40, '%（≤）')}
                {num('morningRecoveryPct', '晨星首根實體回補比例', 50, 100, '%（收盤嚴格超過）')}
                <label><input type='checkbox' checked={c.includeMorningDoji} onChange={e => set('includeMorningDoji', e.target.checked)} />包含精確十字晨星（第二根開盤＝收盤）</label>
                <label>晨星跳空模式 <select aria-label='晨星跳空模式' value={c.morningGapMode} onChange={e => set('morningGapMode', e.target.value as typeof c.morningGapMode)}>
                    <option value='strict-body-gap'>嚴格實體跳空</option><option value='no-gap-required'>不強制跳空（變體）</option></select></label></>}
            {c.patterns.includes('three-black-crows') && <label><input type='checkbox' checked={c.firstCrowOpenWithinPriorBody} onChange={e => set('firstCrowOpenWithinPriorBody', e.target.checked)} />烏鴉首根開盤也在前棒實體內（額外限制）</label>}
            {c.patterns.includes('piercing') && <>
                {num('piercingRecoveryPct', '刺透首根實體回補比例', 50, 99.99, '%（收盤嚴格超過）')}
                <label>刺透開盤模式 <select aria-label='刺透開盤模式' value={c.piercingOpenMode} onChange={e => set('piercingOpenMode', e.target.value as typeof c.piercingOpenMode)}>
                    <option value='research-close'>不高於首根收盤（研究開收關係）</option><option value='below-prior-low'>低於首根最低價（嚴格跳空變體）</option></select></label>
                <label><input type='checkbox' checked={c.piercingRequireLongFirstBody} onChange={e => set('piercingRequireLongFirstBody', e.target.checked)} />刺透首棒須為長實體（額外過濾）</label></>}
        </details>
        <details className={styles.settingsDetails}><summary>配合條件 · 量能與位置</summary>
            <label><input type='checkbox' checked={c.volume.enabled} onChange={e => set('volume', { ...c.volume, enabled: e.target.checked })} />量能確認（型態內 AND）</label>
            {c.volume.enabled && <>
                <label>量能基準交易日數 <input aria-label='反轉量能基準交易日數' type='number' min='5' max='60' value={c.volume.baselineDays} onChange={e => set('volume', { ...c.volume, baselineDays: Number(e.target.value) })} />日（排除判定日）</label>
                <label>當日量至少 <input aria-label='反轉量能倍數' type='number' min='1' max='10' step='0.01' value={c.volume.ratio} onChange={e => set('volume', { ...c.volume, ratio: e.target.value })} />倍前期均量</label>
                <label><input type='checkbox' checked={c.volume.minimumAverageVolumeEnabled} onChange={e => set('volume', { ...c.volume, minimumAverageVolumeEnabled: e.target.checked })} />最低平均量</label>
                {c.volume.minimumAverageVolumeEnabled && <label>平均量至少 <input aria-label='反轉最低平均量張數' type='number' min='0' max='9999999999' value={c.volume.minimumAverageVolumeLots} onChange={e => set('volume', { ...c.volume, minimumAverageVolumeLots: e.target.value })} />張（1 張＝1,000 股）</label>}
            </>}
            <label><input type='checkbox' checked={c.position.enabled} onChange={e => set('position', { ...c.position, enabled: e.target.checked })} />支撐／壓力位置（型態內 AND）</label>
            {c.position.enabled && <>
                <label>位置參考交易日數 <input aria-label='反轉位置參考交易日數' type='number' min='5' max='60' value={c.position.baselineDays} onChange={e => set('position', { ...c.position, baselineDays: Number(e.target.value) })} />日（排除型態）</label>
                <label>距離上限 <input aria-label='反轉位置容許百分比' type='number' min='0.1' max='10' step='0.01' value={c.position.tolerancePct} onChange={e => set('position', { ...c.position, tolerancePct: e.target.value })} />%</label></>}
            <p className={styles.note}>多頭用前期最低 low 支撐，空頭用最高 high 壓力；缺資料或零均量為無法判定，不補假棒。量能與位置是額外過濾，不代表勝率提高或交易建議。</p>
        </details>
        <details className={styles.settingsDetails}><summary>型態條件</summary>{c.patterns.map(p => <p key={p}><strong>{CANDLESTICK_CATALOG[p].name}</strong>：{candlestickDefinitions[p]}</p>)}
            <p>形態成立只描述最新完整日；次日確認固定以前一交易日結束型態，判定日收盤嚴格突破全部型態高／低點，碰線不算。不搜尋更早日期。</p></details>
        <details className={styles.settingsDetails}><summary>統計與來源（外部研究參考）</summary>
            <p>{CANDLESTICK_STATISTICS_NOTICE}</p>
            {Object.entries(CANDLESTICK_CATALOG).map(([key, v]) => <p key={key}><a href={v.source} target='_blank' rel='noreferrer'>{v.name}</a> · 反轉率 {v.reversalPct}%{v.reversalRank ? ` · 原研究反轉率排名 ${v.reversalRank}` : ' · 非影片四強，刺透彩蛋'}{'overallPerformanceRank' in v ? ` · 綜合表現第 ${v.overallPerformanceRank}（不同指標）` : ''}</p>)}
            <p>刺透台股研究：扣除成本後平均交易報酬 {PIERCING_TAIWAN_STUDY.meanTradeProfitAfterCostPct}%；原研究獲利比例 {PIERCING_TAIWAN_STUDY.profitableTradesPct}%，僅 {PIERCING_TAIWAN_STUDY.trades} 筆。</p>
            <p>{PIERCING_TAIWAN_STUDY.universe} · {PIERCING_TAIWAN_STUDY.from}～{PIERCING_TAIWAN_STUDY.through} · 每次完整交易成本 {PIERCING_TAIWAN_STUDY.roundTripCostPct}%。{PIERCING_TAIWAN_STUDY.strategy}</p>
            <p>{PIERCING_TAIWAN_STUDY.trendDifference} 額外過濾／變體不繼承原研究百分比。</p>
            <a href={PIERCING_TAIWAN_STUDY.source} target='_blank' rel='noreferrer'>Lu／Shiu／Liu（2012）原文 Table 1</a>
        </details>
    </>;
}
