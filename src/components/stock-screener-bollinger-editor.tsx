import { BOLLINGER_STAGES, bollingerRequiredHistory, type BollingerSqueezeCriteria } from '../lib/stock-screener-v8';
import * as styles from './stock-screener-panel.css';
export const bollingerStageLabels = { compressing: '正在壓縮', preparing: '準備突破', breakout: '今日正式突破', unknown: '無法判定', notMatched: '未符合' };
const fields: Array<{ key: Exclude<keyof BollingerSqueezeCriteria, 'enabled' | 'stages'>; label: string; unit: string; min: number; max: number; step?: string; advanced?: boolean }> = [
    { key: 'lookbackDays', label: '帶寬基準回看', unit: '日（不含判定日）', min: 60, max: 250 },
    { key: 'percentile', label: '帶寬百分位', unit: '%', min: 5, max: 50, step: '.1' },
    { key: 'minimumPrice', label: '最低收盤價', unit: '元', min: .01, max: 1000000, step: '.01' },
    { key: 'minimumAverageTurnoverNtd', label: '最低平均成交金額', unit: 'TWD（實際金額）', min: 0, max: 1000000000000 },
    { key: 'preparingThreshold', label: '準備突破 b 門檻', unit: '（0–1）', min: 0, max: 1, step: '.01' },
    { key: 'breakoutVolumeRatio', label: '突破放量倍數', unit: '倍（均量不含今日）', min: .000001, max: 10, step: '.000001' },
    { key: 'turnoverDays', label: '成交金額平均', unit: '日（含判定日）', min: 1, max: 250, advanced: true },
    { key: 'fastMaDays', label: '短均線', unit: '日', min: 1, max: 250, advanced: true },
    { key: 'slowMaDays', label: '長均線', unit: '日', min: 1, max: 250, advanced: true },
    { key: 'trendLag', label: '長均線斜率比較', unit: '日前', min: 1, max: 20, advanced: true },
    { key: 'momentumDays', label: '正動能比較', unit: '日前', min: 1, max: 250, advanced: true },
    { key: 'bbwLag', label: '帶寬收縮比較', unit: '日前', min: 1, max: 20, advanced: true },
    { key: 'bbwShortDays', label: '帶寬短平均', unit: '日', min: 1, max: 250, advanced: true },
    { key: 'bbwLongDays', label: '帶寬長平均', unit: '日', min: 1, max: 250, advanced: true },
    { key: 'bMinimum', label: '壓縮 b 下限', unit: '（小於準備門檻）', min: 0, max: 1, step: '.01', advanced: true },
    { key: 'volumeShortDays', label: '候選短均量', unit: '日（含判定日）', min: 1, max: 250, advanced: true },
    { key: 'volumeLongDays', label: '候選長均量', unit: '日（含判定日）', min: 1, max: 250, advanced: true },
    { key: 'contractionRatio', label: '候選量縮倍數', unit: '倍', min: .000001, max: 10, step: '.000001', advanced: true },
    { key: 'setupDays', label: '近期壓縮有效期', unit: '日（不含今日）', min: 1, max: 20, advanced: true },
    { key: 'breakoutVolumeDays', label: '突破均量基準', unit: '日（不含今日）', min: 1, max: 250, advanced: true },
];
export function StockScreenerBollingerEditor({ value, onChange }: { value: BollingerSqueezeCriteria; onChange: (v: BollingerSqueezeCriteria) => void }) {
    const field = (f: typeof fields[number]) => <label key={f.key}>{f.label}
        <input aria-label={f.label} type='number' min={f.min} max={f.max} step={f.step ?? '1'} value={value[f.key]}
            onChange={e => onChange({ ...value, [f.key]: typeof value[f.key] === 'string' ? e.target.value : Number(e.target.value) })} /> {f.unit}</label>;
    return <>
        <div className={styles.controls} aria-label='布林三階段選擇'>{BOLLINGER_STAGES.map(stage => <label key={stage}>
            <input type='checkbox' checked={value.stages.includes(stage)} onChange={e => onChange({ ...value,
                stages: e.target.checked ? [...value.stages, stage] : value.stages.filter(s => s !== stage) })} />{bollingerStageLabels[stage]}</label>)}</div>
        {fields.filter(f => !f.advanced).map(field)}
        <details className={styles.settingsDetails}><summary>布林進階參數與公式</summary><div className={styles.controls}>
            {fields.filter(f => f.advanced).map(field)}</div>
            <p className={styles.note}>固定 BOLL(20,2)、未還原價格。策略內部固定 AND；正式突破要求前期壓縮、首次收盤上破與放量，不要求突破日仍量縮。準備突破不是預測或報酬保證。</p></details>
        <p className={styles.note}>所需 {Math.max(160, bollingerRequiredHistory(value))} 個官方交易日；調整草稿不會下載資料或改每日策略。</p>
    </>;
}
