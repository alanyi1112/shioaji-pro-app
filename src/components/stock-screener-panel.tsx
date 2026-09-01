import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CRITERIA, validateCriteria, type Criteria, type HolderMode, type ReasonCode, type UniverseStock } from '../lib/stock-screener-domain';
import { screenerSearchV3, type ScreenerQuery, type ScreenerQueryV3, type ScreenerResponseV3 } from '../lib/stock-screener-api';
import {
    criteriaFingerprintV3, DEFAULT_CRITERIA_V3, isV3Preference, validateCriteriaV3,
    type BollReversalMode, type FractalAlgorithm, type FractalDirection, type TechnicalUnknownReason,
} from '../lib/stock-screener-technical-patterns';
import * as styles from './stock-screener-panel.css';

const PREFS = 'sj-pro-stock-screener-v3';
const V2_PREFS = 'sj-pro-stock-screener-v2';
const V1_PREFS = 'sj-pro-stock-screener-v1';
const INITIAL_QUERY: ScreenerQueryV3 = { criteria: DEFAULT_CRITERIA_V3, sort: 'code', direction: 'asc', resultState: 'pass' };
const reasonLabels: Record<ReasonCode, string> = {
    none: '', period_pending: '比較期尚未備齊', missing_current: '缺本期', missing_previous: '缺前期',
    date_mismatch: '期別不符', incompatible_source: '來源口徑不一致', invalid_volume: '成交量無效',
    zero_previous_volume: '前日成交量為零', incomplete_tdcc: '17 級資料不齊', invalid_tdcc: '持股合計驗證未通過',
    missing_turnover: '缺當日成交值', invalid_turnover: '成交值來源或單位無效', history_pending: '所需 TDCC 歷史尚在補足',
};
const states = { ready: '資料已備齊', partial: '部分商品無法判定', pending: '等待完整比較資料', stale: '資料已過期，以下為保留快照', unavailable: '本機資料服務無法使用' };
const statusReasons: Record<string, string> = {
    schema_pending: '選股資料庫尚未初始化；不會以自選清單代替全市場。',
    bootstrap_pending: '尚未發布全市場選股快照。',
    period_pending: '啟用條件所需的相鄰兩日或兩週資料尚未備齊。',
    source_not_published: '等待官方新一期資料；以下保留原快照的真實比較日期。',
    snapshot_version_pending: '等待 v2 全市場快照；不會以 v1 結果套用新條件。',
    v3_preparation_pending: '技術型態所需 60 個交易日全市場 OHLC 尚在背景補足；不會以 v2 資料套用 v3 公式。',
};
const technicalReasonLabels: Record<TechnicalUnknownReason, string> = {
    missing_ohlcv: '缺少相鄰交易日 OHLC', invalid_ohlcv: 'OHLC 驗證未通過', insufficient_history: '上市日數或有效歷史不足',
    non_adjacent_sessions: '官方交易日期序不相鄰', containment_direction_unknown: '包含關係方向無法唯一判定',
};
const holderModeLabels: Record<HolderMode, string> = {
    'weekly-increase': '單週增加', 'decrease-to-increase': '持股比例由減轉增', 'increase-to-decrease': '持股比例由增轉減',
};
const validV2Sort = (value: unknown): value is ScreenerQuery['sort'] => ['code', 'volumeMultiple', 'turnover', 'holderChange', 'holderStreak'].includes(String(value));
function migrateV1Criteria(value: unknown): Criteria | null {
    if (!value || typeof value !== 'object') return null;
    const old = value as { mode?: unknown; volume?: { enabled?: unknown; threshold?: unknown }; holder?: { enabled?: unknown; threshold?: unknown } };
    const criteria: Criteria = { mode: old.mode as Criteria['mode'],
        volume: { ...DEFAULT_CRITERIA.volume, enabled: old.volume?.enabled as boolean, threshold: old.volume?.threshold as string },
        holder: { ...DEFAULT_CRITERIA.holder, enabled: old.holder?.enabled as boolean, threshold: old.holder?.threshold as string } };
    return validateCriteria(criteria) ? criteria : null;
}
function toV3(query: ScreenerQuery): ScreenerQueryV3 {
    return { ...query, criteria: { ...query.criteria,
        volume: { ...query.criteria.volume, turnover: { ...query.criteria.volume.turnover } },
        holder: { ...query.criteria.holder, turnover: { ...query.criteria.holder.turnover } },
        fractal: { ...DEFAULT_CRITERIA_V3.fractal }, bollReversal: { ...DEFAULT_CRITERIA_V3.bollReversal } } };
}
function loadPreferences(): ScreenerQueryV3 {
    try {
        const saved = JSON.parse(localStorage.getItem(PREFS) ?? 'null');
        if (isV3Preference(saved)) {
            return { criteria: saved.query.criteria, sort: saved.query.sort, direction: saved.query.direction, resultState: saved.query.resultState };
        }
        const v2 = JSON.parse(localStorage.getItem(V2_PREFS) ?? 'null');
        if (v2?.version === 2 && validateCriteria(v2.query?.criteria) && validV2Sort(v2.query?.sort)
            && ['asc', 'desc'].includes(v2.query.direction) && ['pass', 'unknown', 'fail'].includes(v2.query.resultState)) {
            const query = toV3({ criteria: v2.query.criteria, sort: v2.query.sort, direction: v2.query.direction, resultState: v2.query.resultState });
            try { localStorage.setItem(PREFS, JSON.stringify({ version: 3, query })); } catch { /* Migration remains usable in memory. */ }
            return query;
        }
        const v1 = JSON.parse(localStorage.getItem(V1_PREFS) ?? 'null');
        const migrated = v1?.version === 1 ? migrateV1Criteria(v1.query?.criteria) : null;
        if (migrated && validV2Sort(v1.query?.sort) && ['asc', 'desc'].includes(v1.query.direction)
            && ['pass', 'unknown', 'fail'].includes(v1.query.resultState)) {
            const query = toV3({ criteria: migrated, sort: v1.query.sort, direction: v1.query.direction, resultState: v1.query.resultState });
            try { localStorage.setItem(PREFS, JSON.stringify({ version: 3, query })); } catch { /* Migration remains usable in memory. */ }
            return query;
        }
    } catch { /* Device-local preferences never prevent opening the panel. */ }
    return INITIAL_QUERY;
}
const fingerprint = (query: ScreenerQueryV3) => validateCriteriaV3(query.criteria)
    ? `${criteriaFingerprintV3(query.criteria)}|${query.sort}|${query.direction}|${query.resultState}` : 'invalid';
const shares = (value: string | null) => value === null ? '—' : `${value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} 股`;

export interface StockScreenerPanelProps {
    targets: { id: string; label: string }[];
    onPick: (stock: UniverseStock, targetId: string) => Promise<boolean>;
    onOpenChart: () => string | undefined;
    onTargetChange: () => void;
}

export function StockScreenerPanel({ targets, onPick, onOpenChart, onTargetChange }: StockScreenerPanelProps) {
    const [draft, setDraft] = useState(loadPreferences);
    const [applied, setApplied] = useState<ScreenerQueryV3 | null>(null);
    const [response, setResponse] = useState<ScreenerResponseV3 | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [storageError, setStorageError] = useState(false);
    const [targetId, setTargetId] = useState('');
    const [selectionMessage, setSelectionMessage] = useState('');
    const [cursors, setCursors] = useState<string[]>(['']);
    const [page, setPage] = useState(0);
    const generation = useRef(0);
    const pickingGeneration = useRef(0);
    const controller = useRef<AbortController | null>(null);
    const effectiveTarget = targets.some((target) => target.id === targetId) ? targetId : targets.length === 1 ? targets[0]!.id : '';
    const valid = validateCriteriaV3(draft.criteria);
    const dirty = applied !== null && fingerprint(draft) !== fingerprint(applied);

    useEffect(() => () => { generation.current++; pickingGeneration.current++; controller.current?.abort(); }, []);
    useEffect(() => {
        // No saved results are trusted after reload; this is a read-only status check.
        const abort = new AbortController();
        const ticket = ++generation.current;
        const timer = setTimeout(() => abort.abort(), 10000);
        fetch('/api/stock-screener/status?version=3', { signal: abort.signal, credentials: 'same-origin' })
            .then(async (res) => { if (!res.ok) throw new Error(); return res.json() as Promise<ScreenerResponseV3>; })
            .then((result) => { if (generation.current === ticket && result.version === 3) setResponse(result); })
            .catch(() => { if (generation.current === ticket) setError(abort.signal.aborted ? '本機選股資料服務查詢逾時' : '無法連線本機選股資料服務'); })
            .finally(() => clearTimeout(timer));
        return () => { abort.abort(); clearTimeout(timer); };
    }, []);

    async function run(query: ScreenerQueryV3, cursor = '', nextPage = 0) {
        if (!validateCriteriaV3(query.criteria)) return;
        const ticket = ++generation.current;
        controller.current?.abort();
        const abort = new AbortController(); controller.current = abort;
        const timer = setTimeout(() => abort.abort(), 12000);
        setBusy(true); setError('');
        try {
            const res = await fetch(`/api/stock-screener/results?${screenerSearchV3({ ...query, cursor: cursor || undefined })}`, { signal: abort.signal, credentials: 'same-origin' });
            const result = await res.json();
            if (!res.ok || result.version !== 3) throw new Error(['snapshot_expired','snapshot_version_expired'].includes(result.reason) ? '快照已更新，請重新開始篩選' : '本機資料服務無法使用，請稍後重試');
            if (ticket !== generation.current) return;
            setResponse(result); setApplied(query); setPage(nextPage);
            if (!cursor) setCursors(['']);
            else setCursors((old) => [...old.slice(0, nextPage), cursor]);
            try { localStorage.setItem(PREFS, JSON.stringify({ version: 3, query: { ...query, cursor: undefined } })); setStorageError(false); }
            catch { setStorageError(true); }
        } catch (e) {
            if (ticket === generation.current) setError(abort.signal.aborted ? '查詢逾時，請稍後重試' : (e instanceof Error ? e.message : '查詢失敗'));
        } finally { clearTimeout(timer); if (ticket === generation.current) setBusy(false); }
    }
    async function pick(stock: UniverseStock) {
        const ticket = ++pickingGeneration.current;
        setSelectionMessage('正在解析圖表商品…');
        try { const success = await onPick(stock, effectiveTarget); if (ticket === pickingGeneration.current) setSelectionMessage(success ? `已在指定 K 線圖開啟 ${stock.code} ${stock.name}` : '圖表選擇已取消'); }
        catch (e) { if (ticket === pickingGeneration.current) setSelectionMessage(e instanceof Error ? e.message : '開啟圖表失敗'); }
    }
    const rows = applied ? response?.rows ?? [] : [];
    const counts = applied ? response?.counts : null;
    return <div className={styles.root} data-testid='stock-screener-panel'>
        <p className={styles.note}>收盤後選股 · 全部上市／上櫃普通股（不限定自選清單）</p>
        <details className={styles.note}><summary>範圍與排除商品</summary>排除 ETF、ETN、權證、特別股、TDR、興櫃及海外股票；停牌但未下市櫃的普通股仍列入母體，缺比較資料時標示無法判定。</details>
        <form onSubmit={(event) => { event.preventDefault(); void run(draft); }}>
            <div className={styles.condition}>
                <label><input type='checkbox' checked={draft.criteria.volume.enabled} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, volume: { ...draft.criteria.volume, enabled: e.target.checked } } })} /> 成交量 ≥ 前一交易日</label>
                <input aria-label='成交量倍數' type='number' min='0.01' max='1000' step='0.01' value={draft.criteria.volume.threshold} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, volume: { ...draft.criteria.volume, threshold: e.target.value } } })} /> 倍
                <label><input type='checkbox' aria-label='成交量條件啟用最低成交值' checked={draft.criteria.volume.turnover.enabled} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, volume: { ...draft.criteria.volume, turnover: { ...draft.criteria.volume.turnover, enabled: e.target.checked } } } })} /> 最低成交值</label>
                <input aria-label='成交量條件最低成交值（萬）' type='number' min='0.01' max='10000000' step='0.01' disabled={!draft.criteria.volume.turnover.enabled} value={draft.criteria.volume.turnover.minimumWan} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, volume: { ...draft.criteria.volume, turnover: { ...draft.criteria.volume.turnover, minimumWan: e.target.value } } } })} /> 萬
            </div>
            <div className={styles.condition}>
                <label><input type='checkbox' checked={draft.criteria.holder.enabled} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, holder: { ...draft.criteria.holder, enabled: e.target.checked } } })} /> 千張大戶</label>
                <select aria-label='大戶持股模式' value={draft.criteria.holder.mode} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, holder: { ...draft.criteria.holder, mode: e.target.value as HolderMode } } })}>
                    <option value='weekly-increase'>單週增加</option><option value='decrease-to-increase'>持股比例由減轉增</option><option value='increase-to-decrease'>持股比例由增轉減</option>
                </select>
                {draft.criteria.holder.mode !== 'weekly-increase' && <><input aria-label='反轉前連續週數' type='number' min='1' max='4' step='1' value={draft.criteria.holder.streakWeeks} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, holder: { ...draft.criteria.holder, streakWeeks: Number(e.target.value) } } })} /> 週後反轉</>}
                <span>{draft.criteria.holder.mode === 'increase-to-decrease' ? '週減 ≥' : '週增 ≥'}</span>
                <input aria-label='大戶週增百分點' type='number' min='0.01' max='100' step='0.01' value={draft.criteria.holder.threshold} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, holder: { ...draft.criteria.holder, threshold: e.target.value } } })} /> 百分點
                <label><input type='checkbox' aria-label='大戶條件啟用最低成交值' checked={draft.criteria.holder.turnover.enabled} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, holder: { ...draft.criteria.holder, turnover: { ...draft.criteria.holder.turnover, enabled: e.target.checked } } } })} /> 最低成交值</label>
                <input aria-label='大戶條件最低成交值（萬）' type='number' min='0.01' max='10000000' step='0.01' disabled={!draft.criteria.holder.turnover.enabled} value={draft.criteria.holder.turnover.minimumWan} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, holder: { ...draft.criteria.holder, turnover: { ...draft.criteria.holder.turnover, minimumWan: e.target.value } } } })} /> 萬
            </div>
            <fieldset className={styles.conditionCard}>
                <legend><label><input aria-label='啟用 K 棒分型' type='checkbox' checked={draft.criteria.fractal.enabled} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, fractal: { ...draft.criteria.fractal, enabled: e.target.checked } } })} /> K 棒分型</label></legend>
                <label>算法 <select aria-label='分型算法' disabled={!draft.criteria.fractal.enabled} value={draft.criteria.fractal.algorithm} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, fractal: { ...draft.criteria.fractal, algorithm: e.target.value as FractalAlgorithm } } })}>
                    <option value='raw-three'>原始三 K</option><option value='chan-containment'>纏論包含處理</option><option value='any'>任一算法</option>
                </select></label>
                <label>方向 <select aria-label='分型方向' disabled={!draft.criteria.fractal.enabled} value={draft.criteria.fractal.direction} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, fractal: { ...draft.criteria.fractal, direction: e.target.value as FractalDirection } } })}>
                    <option value='bottom'>底分型</option><option value='top'>頂分型</option><option value='any'>任一方向</option>
                </select></label>
                <span className={styles.note}>中心 K 棒需等右側完整交易日確認；確認日不是中心日。</span>
            </fieldset>
            <fieldset className={styles.conditionCard}>
                <legend><label><input aria-label='啟用布林通道反轉 K' type='checkbox' checked={draft.criteria.bollReversal.enabled} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, bollReversal: { ...draft.criteria.bollReversal, enabled: e.target.checked } } })} /> 布林通道反轉 K</label></legend>
                <label>型態 <select aria-label='布林反轉型態' disabled={!draft.criteria.bollReversal.enabled} value={draft.criteria.bollReversal.mode} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, bollReversal: { ...draft.criteria.bollReversal, mode: e.target.value as BollReversalMode } } })}>
                    <option value='lower-bullish'>下軌陽 K＋下影</option><option value='upper-bearish'>上軌陰 K＋上影</option><option value='any'>任一型態</option>
                </select></label>
                <span className={styles.note}>固定 BOLL(20,2)：前一交易日收盤仍在通道內，最新日首次嚴格穿越。</span>
            </fieldset>
            <div className={styles.controls}>
                <select aria-label='條件組合' value={draft.criteria.mode} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, mode: e.target.value as 'all' | 'any' } })}><option value='all'>全部符合（AND）</option><option value='any'>任一符合（OR）</option></select>
                <select aria-label='結果種類' value={draft.resultState} onChange={(e) => setDraft({ ...draft, resultState: e.target.value as ScreenerQueryV3['resultState'] })}><option value='pass'>符合條件</option><option value='unknown'>無法判定</option><option value='fail'>不符合</option></select>
                <select aria-label='選股排序' value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value as ScreenerQueryV3['sort'] })}><option value='code'>股票代碼</option><option value='volumeMultiple'>成交量倍數</option><option value='turnover'>成交值</option><option value='holderChange'>最新持股變化</option><option value='holderStreak'>反轉前週數</option><option value='confirmationDate'>型態確認日</option><option value='algorithm'>分型算法</option><option value='direction'>型態方向</option><option value='outsideDistance'>通道外距離</option></select>
                <select aria-label='排序方向' value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as 'asc' | 'desc' })}><option value='asc'>由小到大</option><option value='desc'>由大到小</option></select>
                <button type='submit' disabled={!valid || busy}>{busy ? '篩選中…' : '開始篩選'}</button>
            </div>
            {!valid && <p role='alert'>至少啟用一項條件；倍數 0.01–1000、百分點 0.01–100、成交值 0.01–10,000,000 萬，最多兩位小數；反轉週數為 1–4。</p>}
            {dirty && <p role='status'>條件尚未套用；下方仍是上次篩選結果。</p>}
        </form>
        <div className={styles.status} role='status' aria-live='polite'>
            {error || (response ? states[response.state] : '尚未查詢資料')}
            {applied && <div>已套用：{[applied.criteria.volume.enabled ? `成交量 ≥ ${applied.criteria.volume.threshold} 倍${applied.criteria.volume.turnover.enabled ? `且成交值 ≥ ${applied.criteria.volume.turnover.minimumWan} 萬` : ''}` : '', applied.criteria.holder.enabled ? `${holderModeLabels[applied.criteria.holder.mode]}${applied.criteria.holder.mode === 'weekly-increase' ? '' : `（前 ${applied.criteria.holder.streakWeeks} 週）`} ≥ ${applied.criteria.holder.threshold} 百分點${applied.criteria.holder.turnover.enabled ? `且成交值 ≥ ${applied.criteria.holder.turnover.minimumWan} 萬` : ''}` : '', applied.criteria.fractal.enabled ? `K 棒分型（${applied.criteria.fractal.algorithm === 'raw-three' ? '原始三 K' : applied.criteria.fractal.algorithm === 'chan-containment' ? '纏論包含處理' : '任一算法'}／${applied.criteria.fractal.direction === 'bottom' ? '底' : applied.criteria.fractal.direction === 'top' ? '頂' : '任一方向'}）` : '', applied.criteria.bollReversal.enabled ? `布林反轉 K（${applied.criteria.bollReversal.mode === 'lower-bullish' ? '下軌陽 K＋下影' : applied.criteria.bollReversal.mode === 'upper-bearish' ? '上軌陰 K＋上影' : '任一型態'}）` : ''].filter(Boolean).join(applied.criteria.mode === 'all' ? ' 且 ' : ' 或 ')}</div>}
            {response && statusReasons[response.reason] && <div>{statusReasons[response.reason]}</div>}
            {response?.preparation && <div>OHLC 準備：{response.preparation.processed}/{response.preparation.target} · 剩餘 {response.preparation.remaining} · 失敗 {response.preparation.failed} · 逾期 {response.preparation.overdue}</div>}
            {response?.anchors.daily && <div>日量：{response.anchors.daily.previous} → {response.anchors.daily.current}</div>}
            {response?.anchors.weekly && <div>持股：{response.anchors.weekly.previous} → {response.anchors.weekly.current}</div>}
            {!!response?.anchors.weeklyPeriods?.length && <div>TDCC 歷史窗：{response.anchors.weeklyPeriods.join('、')}</div>}
            {response?.technicalAnchors && <div>技術型態：{response.technicalAnchors.sessions[0]} → {response.technicalAnchors.through}（{response.technicalAnchors.sessions.length} 個交易日）</div>}
            {response && !response.anchors.daily && <div>日量比較期：未提供</div>}
            {response && !response.anchors.weekly && <div>持股比較期：未提供</div>}
            {response?.createdAt && <div>快照建置：{new Date(response.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</div>}
            {counts && <>
                <div>母體 {counts.total} · 符合 {counts.matched} · 不符合 {counts.notMatched} · 無法判定 {counts.unknown}</div>
                <div>可判定 {counts.evaluated} 檔（符合＋不符合）</div>
                <div>欄位缺漏（可重疊）：日量 {counts.missingByCondition['volume-multiple']} · 持股 {counts.missingByCondition['large-holder-weekly-pp']} · 分型 {counts.missingByCondition.fractal} · 布林 {counts.missingByCondition['boll-reversal']}</div>
                {response?.byMarket && <div>上市 {response.byMarket.TWSE.total} · 上櫃 {response.byMarket.TPEx.total}</div>}
            </>}
            {storageError && <div>瀏覽器無法保存偏好；本次結果不受影響。</div>}
        </div>
        <div className={styles.controls}>
            <label>目標 K 線圖 <select aria-label='目標 K 線圖' value={effectiveTarget} onChange={(e) => { pickingGeneration.current++; onTargetChange(); setTargetId(e.target.value); setSelectionMessage(''); }}>
                <option value=''>請選擇圖表</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
            </select></label>
            <button type='button' onClick={() => { const id = onOpenChart(); if (id) setTargetId(id); }}>新增日 K 圖</button>
        </div>
        {!targets.length && <p className={styles.note}>目前沒有未鎖定圖表，請新增日 K 圖，或解鎖既有圖表。</p>}
        {selectionMessage && <p role='status'>{selectionMessage}</p>}
        <div className={styles.results} aria-label='選股結果'>
            {rows.map((row) => <div className={styles.row} key={row.symbol}>
                <button type='button' className={styles.rowAction} disabled={!effectiveTarget} onClick={() => void pick(row)}>
                <strong>{row.code} {row.name} · {row.market === 'TWSE' ? '上市' : '上櫃'}</strong>
                {applied?.criteria.volume.enabled && <span>日量 {shares(row.volume.previous)} → {shares(row.volume.current)} · {row.volume.multiple === null ? reasonLabels[row.volume.reason ?? 'period_pending'] : `${row.volume.multiple.toFixed(4)} 倍`}</span>}
                {applied?.criteria.volume.turnover.enabled && <span>成交值 {row.volume.turnover.wan === null ? reasonLabels[row.volume.turnover.reason ?? 'missing_turnover'] : `${row.volume.turnover.wan} 萬`} · {row.volume.turnover.date ?? '日期未提供'}</span>}
                {applied?.criteria.holder.enabled && <span>{holderModeLabels[row.holder.mode]} · {row.holder.changePp === null ? reasonLabels[row.holder.reason ?? 'history_pending'] : `${row.holder.changePp >= 0 ? '+' : ''}${row.holder.changePp.toFixed(2)} 百分點`}{row.holder.streakWeeks ? ` · 前 ${row.holder.streakWeeks} 週` : ''}</span>}
                {applied?.criteria.holder.enabled && row.holder.series.length > 0 && <span>持股歷史 {row.holder.series.map((point) => `${point.date} ${point.ratio}%`).join(' → ')}</span>}
                {applied?.criteria.holder.turnover.enabled && <span>成交值 {row.holder.turnover.wan === null ? reasonLabels[row.holder.turnover.reason ?? 'missing_turnover'] : `${row.holder.turnover.wan} 萬`} · {row.holder.turnover.date ?? '日期未提供'}</span>}
                {applied?.criteria.fractal.enabled && row.technical.fractal && <span>分型：{row.technical.fractal.verdict === 'unknown'
                    ? technicalReasonLabels[row.technical.fractal.reason as TechnicalUnknownReason]
                    : row.technical.fractal.evidence ? `${row.technical.fractal.evidence.algorithm === 'raw-three' ? '原始三 K' : '纏論包含處理'} · ${row.technical.fractal.evidence.direction === 'bottom' ? '底分型' : '頂分型'} · 中心 ${row.technical.fractal.evidence.centerDate} · 確認 ${row.technical.fractal.evidence.confirmationDate}` : '不符合'}</span>}
                {applied?.criteria.bollReversal.enabled && row.technical.bollReversal && <span>布林反轉：{row.technical.bollReversal.verdict === 'unknown'
                    ? technicalReasonLabels[row.technical.bollReversal.reason as TechnicalUnknownReason]
                    : row.technical.bollReversal.evidence ? `${row.technical.bollReversal.evidence.mode === 'lower-bullish' ? '下軌陽 K＋下影' : '上軌陰 K＋上影'} · ${row.technical.bollReversal.evidence.current.sessionDate} · 通道外距離 ${row.technical.bollReversal.evidence.outsideDistance}` : '不符合'}</span>}
                <span className={styles.note}>{row.sources.join('、')}</span>
                </button>
                {applied?.criteria.fractal.enabled && row.technical.fractal?.evidence?.normalizedBars && <details><summary>分型日期映射</summary>{row.technical.fractal.evidence.normalizedBars.map((bar) => <span key={`${bar.rawFrom}-${bar.rawTo}`}>{bar.low}–{bar.high}：{bar.rawDates.join('、')}</span>)}</details>}
                {applied?.criteria.bollReversal.enabled && row.technical.bollReversal?.evidence && <details><summary>P／D OHLC 與 BOLL 證據</summary>
                    {([['P', row.technical.bollReversal.evidence.previous], ['D', row.technical.bollReversal.evidence.current]] as const).map(([label, point]) => <span key={label}>{label} {point.sessionDate} O {point.open} H {point.high} L {point.low} C {point.close} · upper {point.upper} / mid {point.middle} / lower {point.lower}</span>)}
                    <span>下影 {row.technical.bollReversal.evidence.lowerShadow ? '是' : '否'} · 上影 {row.technical.bollReversal.evidence.upperShadow ? '是' : '否'}</span></details>}
            </div>)}
            {applied && !busy && !error && ['ready','partial'].includes(response?.state ?? '') && !rows.length && <p>此結果種類沒有商品。{response?.state === 'partial' ? '仍有欄位缺漏，請查看資料不足說明。' : ''}</p>}
        </div>
        {applied && <div className={styles.controls}>
            <button type='button' disabled={page === 0 || busy || dirty} onClick={() => void run(applied, cursors[page - 1], page - 1)}>上一頁</button>
            <span>第 {page + 1} 頁</span>
            <button type='button' disabled={!response?.nextCursor || busy || dirty} onClick={() => void run(applied, response?.nextCursor ?? '', page + 1)}>下一頁</button>
        </div>}
        <p className={styles.note}>千張大戶為 TDCC 第 15 級（1,000,001 股以上）；持股比例由減轉增／由增轉減不代表確定買進、賣出或特定投資人身分。技術型態只使用官方未還原日 OHLC，分型需右側完整 K 棒確認，BOLL 固定為 20 期、2 倍母體標準差。成交量單位為股，成交值輸入單位為萬、內部以新臺幣整數元比較。點選只更換指定圖表，不加入自選清單、不變更下單商品。</p>
        <p className={styles.note}>來源：<a href='https://openapi.twse.com.tw/' target='_blank' rel='noopener noreferrer'>臺灣證券交易所</a>、<a href='https://www.tpex.org.tw/openapi/' target='_blank' rel='noopener noreferrer'>證券櫃檯買賣中心</a>、<a href='https://data.gov.tw/en/datasets/11452' target='_blank' rel='noopener noreferrer'>臺灣集中保管結算所</a>。僅供資料篩選。</p>
    </div>;
}
