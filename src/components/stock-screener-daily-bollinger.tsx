import { useEffect, useState } from 'react';
import { BOLLINGER_STAGES, validateCriteriaV8, type CriteriaV8 } from '../lib/stock-screener-v8';
import type { BollingerDailyProfileView } from '../lib/stock-screener-bollinger-api';
import { dailyBollingerCriteria } from '../lib/stock-screener-daily-bollinger-ui';
import { bollingerStageLabels } from './stock-screener-bollinger-editor';
import * as styles from './stock-screener-panel.css';

export function StockScreenerDailyBollinger({ profile, ready, busy, onSave }: {
    profile: BollingerDailyProfileView | null; ready: boolean; busy: boolean;
    onSave: (enabled: boolean, criteria?: CriteriaV8) => Promise<void>;
}) {
    const [draft, setDraft] = useState(() => dailyBollingerCriteria(profile));
    useEffect(() => { setDraft(dailyBollingerCriteria(profile)); }, [profile]);
    const c = draft.bollSqueezeStages;
    const changed = profile && JSON.stringify(draft) !== JSON.stringify(profile.criteria);
    return <details className={styles.settingsDetails} aria-label='每日布林策略設定'>
        <summary>每日布林策略 · {ready ? profile ? `${profile.enabled ? '已啟用' : '已停用'} · 已存 ${profile.criteria.bollSqueezeStages.stages.length}/3 項 · revision ${profile.revision}` : '尚未啟用 · 預設全選' : '設定載入中'}</summary>
        <p className={styles.note}>獨立於本頁手動選股草稿；每日收盤後依已儲存設定篩選。</p>
        <p className={styles.note}>官方交易日 14:00 起由背景排程檢查；當日價量、歷史與預算驗證通過才發布，不保證 14:00 整有結果。查看股票需在本頁啟用布林條件後按「開始篩選」。</p>
        <div className={styles.dailyStageButtons} role='group' aria-label='每日布林三階段選擇'>
            {BOLLINGER_STAGES.map(stage => <button type='button' key={stage} aria-pressed={c.stages.includes(stage)} disabled={!ready || busy}
                onClick={() => setDraft(current => ({ ...current, bollSqueezeStages: { ...current.bollSqueezeStages,
                    stages: BOLLINGER_STAGES.filter(s => s === stage ? !current.bollSqueezeStages.stages.includes(s) : current.bollSqueezeStages.stages.includes(s)) } }))}>
                {c.stages.includes(stage) ? '✓ ' : ''}{bollingerStageLabels[stage]}</button>)}
        </div>
        {!c.stages.length ? <p role='alert'>至少選取一個每日布林階段；如要全部關閉，請停用每日策略。</p>
            : changed ? <p className={styles.note} role='status'>每日階段尚未儲存；背景仍使用已存設定。</p> : null}
        <div className={styles.controls}>
            <button type='button' disabled={!ready || busy || !validateCriteriaV8(draft)} onClick={() => void onSave(true, draft)}>{busy ? '儲存中…' : '儲存每日策略'}</button>
            {profile?.enabled && <button type='button' disabled={!ready || busy} onClick={() => void onSave(false)}>停用每日布林策略</button>}
        </div>
        <details className={styles.settingsDetails}><summary>選股條件附註（三階段）</summary>
            <p className={styles.note}>固定 BOLL(20,2)、官方未還原日線；以下日數均為交易日。三階段各自判定，選取多項取其聯集；若另有其他條件，沿用已存 AND／OR。分類優先：今日正式突破 → 準備突破 → 正在壓縮。</p>
            <p className={styles.note}><strong>共通門檻：</strong>上市／上櫃普通股，收盤價 ≥ {c.minimumPrice} 元；{c.turnoverDays} 日平均成交金額 ≥ {Number(c.minimumAverageTurnoverNtd).toLocaleString('zh-TW')} 元（含判定日）；收盤 &gt; MA{c.fastMaDays} &gt; MA{c.slowMaDays}，MA{c.slowMaDays} ≥ {c.trendLag} 日前，收盤高於 {c.momentumDays} 日前。</p>
            <p className={styles.note}><strong>正在壓縮：</strong>BBW ≤ 前 {c.lookbackDays} 日帶寬第 {c.percentile} 百分位（不含判定日）；BBW 小於 {c.bbwLag} 日前、{c.bbwShortDays} 日平均帶寬 &lt; {c.bbwLongDays} 日平均帶寬；b 介於 {c.bMinimum} 與 1；{c.volumeShortDays} 日均量 &lt; {c.volumeLongDays} 日均量 × {c.contractionRatio}（均量含判定日）。未達準備門檻且無正式突破者列在此階段。</p>
            <p className={styles.note}><strong>準備突破：</strong>符合上述壓縮及共通門檻，且 b ≥ {c.preparingThreshold}，仍未正式突破；不是預測或報酬保證。</p>
            <p className={styles.note}><strong>今日正式突破：</strong>符合今日共通門檻；前 {c.setupDays} 日內至少一天符合壓縮與該日共通門檻（不含今日）；今日收盤 &gt; 今日上軌、前一日收盤 ≤ 前一日上軌；今日量 &gt; 前 {c.breakoutVolumeDays} 日均量 × {c.breakoutVolumeRatio}（不含今日）。突破當日不要求仍量縮。</p>
            <p className={styles.note}>BBW =（上軌 − 下軌）÷ 中軌；b =（收盤 − 下軌）÷（上軌 − 下軌）。缺少資料為「無法判定」，不補零。數值調整請在上方布林三階段條件編輯後，明確按「套用至每日自動篩選」。</p>
        </details>
    </details>;
}
