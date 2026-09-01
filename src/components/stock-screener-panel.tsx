import { useEffect, useRef, useState } from 'react';
import { criteriaFingerprint, DEFAULT_CRITERIA, validateCriteria, type Criteria, type HolderMode, type ReasonCode, type UniverseStock } from '../lib/stock-screener-domain';
import { screenerSearch, type ScreenerQuery, type ScreenerResponse } from '../lib/stock-screener-api';
import * as styles from './stock-screener-panel.css';

const PREFS = 'sj-pro-stock-screener-v2';
const LEGACY_PREFS = 'sj-pro-stock-screener-v1';
const INITIAL_QUERY: ScreenerQuery = { criteria: DEFAULT_CRITERIA, sort: 'code', direction: 'asc', resultState: 'pass' };
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
};
const holderModeLabels: Record<HolderMode, string> = {
    'weekly-increase': '單週增加', 'decrease-to-increase': '持股比例由減轉增', 'increase-to-decrease': '持股比例由增轉減',
};
const validSort = (value: unknown): value is ScreenerQuery['sort'] => ['code', 'volumeMultiple', 'turnover', 'holderChange', 'holderStreak'].includes(String(value));
function migrateV1Criteria(value: unknown): Criteria | null {
    if (!value || typeof value !== 'object') return null;
    const old = value as { mode?: unknown; volume?: { enabled?: unknown; threshold?: unknown }; holder?: { enabled?: unknown; threshold?: unknown } };
    const criteria: Criteria = { mode: old.mode as Criteria['mode'],
        volume: { ...DEFAULT_CRITERIA.volume, enabled: old.volume?.enabled as boolean, threshold: old.volume?.threshold as string },
        holder: { ...DEFAULT_CRITERIA.holder, enabled: old.holder?.enabled as boolean, threshold: old.holder?.threshold as string } };
    return validateCriteria(criteria) ? criteria : null;
}
function loadPreferences(): ScreenerQuery {
    try {
        const saved = JSON.parse(localStorage.getItem(PREFS) ?? 'null');
        if (saved?.version === 2 && validateCriteria(saved.query?.criteria)
            && validSort(saved.query.sort)
            && ['asc', 'desc'].includes(saved.query.direction) && ['pass', 'unknown', 'fail'].includes(saved.query.resultState)) {
            return { criteria: saved.query.criteria, sort: saved.query.sort, direction: saved.query.direction, resultState: saved.query.resultState };
        }
        const legacy = JSON.parse(localStorage.getItem(LEGACY_PREFS) ?? 'null');
        const migrated = legacy?.version === 1 ? migrateV1Criteria(legacy.query?.criteria) : null;
        if (migrated && validSort(legacy.query?.sort) && ['asc', 'desc'].includes(legacy.query.direction)
            && ['pass', 'unknown', 'fail'].includes(legacy.query.resultState)) {
            const query = { criteria: migrated, sort: legacy.query.sort, direction: legacy.query.direction, resultState: legacy.query.resultState } as ScreenerQuery;
            try { localStorage.setItem(PREFS, JSON.stringify({ version: 2, query })); } catch { /* Migration remains usable in memory. */ }
            return query;
        }
    } catch { /* Device-local preferences never prevent opening the panel. */ }
    return INITIAL_QUERY;
}
const fingerprint = (query: ScreenerQuery) => validateCriteria(query.criteria)
    ? `${criteriaFingerprint(query.criteria)}|${query.sort}|${query.direction}|${query.resultState}` : 'invalid';
const shares = (value: string | null) => value === null ? '—' : `${value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} 股`;

export interface StockScreenerPanelProps {
    targets: { id: string; label: string }[];
    onPick: (stock: UniverseStock, targetId: string) => Promise<boolean>;
    onOpenChart: () => string | undefined;
    onTargetChange: () => void;
}

export function StockScreenerPanel({ targets, onPick, onOpenChart, onTargetChange }: StockScreenerPanelProps) {
    const [draft, setDraft] = useState(loadPreferences);
    const [applied, setApplied] = useState<ScreenerQuery | null>(null);
    const [response, setResponse] = useState<ScreenerResponse | null>(null);
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
    const valid = validateCriteria(draft.criteria);
    const dirty = applied !== null && fingerprint(draft) !== fingerprint(applied);

    useEffect(() => () => { generation.current++; pickingGeneration.current++; controller.current?.abort(); }, []);
    useEffect(() => {
        // No saved results are trusted after reload; this is a read-only status check.
        const abort = new AbortController();
        const ticket = ++generation.current;
        const timer = setTimeout(() => abort.abort(), 10000);
        fetch('/api/stock-screener/status', { signal: abort.signal, credentials: 'same-origin' })
            .then(async (res) => { if (!res.ok) throw new Error(); return res.json() as Promise<ScreenerResponse>; })
            .then((result) => { if (generation.current === ticket && result.version === 2) setResponse(result); })
            .catch(() => { if (generation.current === ticket) setError(abort.signal.aborted ? '本機選股資料服務查詢逾時' : '無法連線本機選股資料服務'); })
            .finally(() => clearTimeout(timer));
        return () => { abort.abort(); clearTimeout(timer); };
    }, []);

    async function run(query: ScreenerQuery, cursor = '', nextPage = 0) {
        if (!validateCriteria(query.criteria)) return;
        const ticket = ++generation.current;
        controller.current?.abort();
        const abort = new AbortController(); controller.current = abort;
        const timer = setTimeout(() => abort.abort(), 12000);
        setBusy(true); setError('');
        try {
            const res = await fetch(`/api/stock-screener/results?${screenerSearch({ ...query, cursor: cursor || undefined })}`, { signal: abort.signal, credentials: 'same-origin' });
            const result = await res.json();
            if (!res.ok || result.version !== 2) throw new Error(['snapshot_expired','snapshot_version_expired'].includes(result.reason) ? '快照已更新，請重新開始篩選' : '本機資料服務無法使用，請稍後重試');
            if (ticket !== generation.current) return;
            setResponse(result); setApplied(query); setPage(nextPage);
            if (!cursor) setCursors(['']);
            else setCursors((old) => [...old.slice(0, nextPage), cursor]);
            try { localStorage.setItem(PREFS, JSON.stringify({ version: 2, query: { ...query, cursor: undefined } })); setStorageError(false); }
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
            <div className={styles.controls}>
                <select aria-label='條件組合' value={draft.criteria.mode} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, mode: e.target.value as 'all' | 'any' } })}><option value='all'>全部符合（AND）</option><option value='any'>任一符合（OR）</option></select>
                <select aria-label='結果種類' value={draft.resultState} onChange={(e) => setDraft({ ...draft, resultState: e.target.value as ScreenerQuery['resultState'] })}><option value='pass'>符合條件</option><option value='unknown'>無法判定</option><option value='fail'>不符合</option></select>
                <select aria-label='選股排序' value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value as ScreenerQuery['sort'] })}><option value='code'>股票代碼</option><option value='volumeMultiple'>成交量倍數</option><option value='turnover'>成交值</option><option value='holderChange'>最新持股變化</option><option value='holderStreak'>反轉前週數</option></select>
                <select aria-label='排序方向' value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as 'asc' | 'desc' })}><option value='asc'>由小到大</option><option value='desc'>由大到小</option></select>
                <button type='submit' disabled={!valid || busy}>{busy ? '篩選中…' : '開始篩選'}</button>
            </div>
            {!valid && <p role='alert'>至少啟用一項條件；倍數 0.01–1000、百分點 0.01–100、成交值 0.01–10,000,000 萬，最多兩位小數；反轉週數為 1–4。</p>}
            {dirty && <p role='status'>條件尚未套用；下方仍是上次篩選結果。</p>}
        </form>
        <div className={styles.status} role='status' aria-live='polite'>
            {error || (response ? states[response.state] : '尚未查詢資料')}
            {applied && <div>已套用：{[applied.criteria.volume.enabled ? `成交量 ≥ ${applied.criteria.volume.threshold} 倍${applied.criteria.volume.turnover.enabled ? `且成交值 ≥ ${applied.criteria.volume.turnover.minimumWan} 萬` : ''}` : '', applied.criteria.holder.enabled ? `${holderModeLabels[applied.criteria.holder.mode]}${applied.criteria.holder.mode === 'weekly-increase' ? '' : `（前 ${applied.criteria.holder.streakWeeks} 週）`} ≥ ${applied.criteria.holder.threshold} 百分點${applied.criteria.holder.turnover.enabled ? `且成交值 ≥ ${applied.criteria.holder.turnover.minimumWan} 萬` : ''}` : ''].filter(Boolean).join(applied.criteria.mode === 'all' ? ' 且 ' : ' 或 ')}</div>}
            {response && statusReasons[response.reason] && <div>{statusReasons[response.reason]}</div>}
            {response?.anchors.daily && <div>日量：{response.anchors.daily.previous} → {response.anchors.daily.current}</div>}
            {response?.anchors.weekly && <div>持股：{response.anchors.weekly.previous} → {response.anchors.weekly.current}</div>}
            {!!response?.anchors.weeklyPeriods?.length && <div>TDCC 歷史窗：{response.anchors.weeklyPeriods.join('、')}</div>}
            {response && !response.anchors.daily && <div>日量比較期：未提供</div>}
            {response && !response.anchors.weekly && <div>持股比較期：未提供</div>}
            {response?.createdAt && <div>快照建置：{new Date(response.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</div>}
            {counts && <>
                <div>母體 {counts.total} · 符合 {counts.matched} · 不符合 {counts.notMatched} · 無法判定 {counts.unknown}</div>
                <div>可判定 {counts.evaluated} 檔（符合＋不符合）</div>
                <div>欄位缺漏（可重疊）：日量 {counts.missingByCondition['volume-multiple']} · 持股 {counts.missingByCondition['large-holder-weekly-pp']}</div>
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
            {rows.map((row) => <button type='button' className={styles.row} key={row.symbol} disabled={!effectiveTarget} onClick={() => void pick(row)}>
                <strong>{row.code} {row.name} · {row.market === 'TWSE' ? '上市' : '上櫃'}</strong>
                {applied?.criteria.volume.enabled && <span>日量 {shares(row.volume.previous)} → {shares(row.volume.current)} · {row.volume.multiple === null ? reasonLabels[row.volume.reason ?? 'period_pending'] : `${row.volume.multiple.toFixed(4)} 倍`}</span>}
                {applied?.criteria.volume.turnover.enabled && <span>成交值 {row.volume.turnover.wan === null ? reasonLabels[row.volume.turnover.reason ?? 'missing_turnover'] : `${row.volume.turnover.wan} 萬`} · {row.volume.turnover.date ?? '日期未提供'}</span>}
                {applied?.criteria.holder.enabled && <span>{holderModeLabels[row.holder.mode]} · {row.holder.changePp === null ? reasonLabels[row.holder.reason ?? 'history_pending'] : `${row.holder.changePp >= 0 ? '+' : ''}${row.holder.changePp.toFixed(2)} 百分點`}{row.holder.streakWeeks ? ` · 前 ${row.holder.streakWeeks} 週` : ''}</span>}
                {applied?.criteria.holder.enabled && row.holder.series.length > 0 && <span>持股歷史 {row.holder.series.map((point) => `${point.date} ${point.ratio}%`).join(' → ')}</span>}
                {applied?.criteria.holder.turnover.enabled && <span>成交值 {row.holder.turnover.wan === null ? reasonLabels[row.holder.turnover.reason ?? 'missing_turnover'] : `${row.holder.turnover.wan} 萬`} · {row.holder.turnover.date ?? '日期未提供'}</span>}
                <span className={styles.note}>{row.sources.join('、')}</span>
            </button>)}
            {applied && !busy && !error && ['ready','partial'].includes(response?.state ?? '') && !rows.length && <p>此結果種類沒有商品。{response?.state === 'partial' ? '仍有欄位缺漏，請查看資料不足說明。' : ''}</p>}
        </div>
        {applied && <div className={styles.controls}>
            <button type='button' disabled={page === 0 || busy || dirty} onClick={() => void run(applied, cursors[page - 1], page - 1)}>上一頁</button>
            <span>第 {page + 1} 頁</span>
            <button type='button' disabled={!response?.nextCursor || busy || dirty} onClick={() => void run(applied, response?.nextCursor ?? '', page + 1)}>下一頁</button>
        </div>}
        <p className={styles.note}>千張大戶為 TDCC 第 15 級（1,000,001 股以上）；持股比例由減轉增／由增轉減不代表確定買進、賣出或特定投資人身分。成交量單位為股，成交值輸入單位為萬、內部以新臺幣整數元比較。點選只更換指定圖表，不加入自選清單、不變更下單商品。</p>
        <p className={styles.note}>來源：<a href='https://openapi.twse.com.tw/' target='_blank' rel='noopener noreferrer'>臺灣證券交易所</a>、<a href='https://www.tpex.org.tw/openapi/' target='_blank' rel='noopener noreferrer'>證券櫃檯買賣中心</a>、<a href='https://data.gov.tw/en/datasets/11452' target='_blank' rel='noopener noreferrer'>臺灣集中保管結算所</a>。僅供資料篩選。</p>
    </div>;
}
