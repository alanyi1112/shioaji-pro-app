import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { DismissiblePopover } from './dismissible-popover';
import * as headerStyles from './hud-header.css';
import * as styles from './special-market-closures-settings.css';
import { readSpecialMarketClosures, saveSpecialMarketClosure, taipeiTradeDate, readCalendarDataCheck,
    type SpecialMarketClosuresView } from '../lib/intraday-monitor-api';

type CalendarTab = 'closures' | 'checks';
const checkLabels: Record<string, string> = {
    complete: '排定時段資料齊全', partial: '發現可能缺漏', unknown: '無法判定', pending: '尚未到發布時間',
    conflict: '資料與日曆衝突', not_expected: '休市日，不預期有日資料', available: '現有資料已驗證', missing: '已到期但缺資料',
};
const marketLabel = (markets: string[]) => markets.map(m => m === 'TSE' ? '上市' : '上櫃').join('／');

export function MarketCalendarMenu() {
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (open) wrap.current?.querySelector<HTMLButtonElement>('[aria-label="關閉交易日曆"]')?.focus();
    }, [open]);
    function close() { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
    return <div ref={wrap} className={headerStyles.settingsWrap}>
        <button ref={trigger} type='button' className={headerStyles.resetBtn}
            aria-haspopup='dialog' aria-expanded={open} onClick={() => setOpen(value => !value)}>交易日曆</button>
        {open && <DismissiblePopover className={styles.dialog} label='交易日曆'
            triggerSelector='button[aria-haspopup="dialog"]' onClose={() => setOpen(false)}>
            <SpecialMarketClosuresSettings onClose={close}/>
        </DismissiblePopover>}
    </div>;
}

export function SpecialMarketClosuresSettings({ onClose }: { onClose?: () => void } = {}) {
    const id = useId();
    const tabs = useRef<HTMLDivElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const [tab, setTab] = useState<CalendarTab>('closures');
    const [state, setState] = useState<SpecialMarketClosuresView | null>(null);
    const [date, setDate] = useState(taipeiTradeDate());
    const [reason, setReason] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [action, setAction] = useState<'close' | 'revoke'>('close');
    const [market, setMarket] = useState<'both' | 'TSE' | 'OTC'>('both');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [symbol, setSymbol] = useState('2330.TW');
    const [from, setFrom] = useState(taipeiTradeDate());
    const [through, setThrough] = useState(taipeiTradeDate());
    const [dataset, setDataset] = useState('candles');
    const [interval, setInterval] = useState('1d');
    const [check, setCheck] = useState<Awaited<ReturnType<typeof readCalendarDataCheck>> | null>(null);
    const [checkError, setCheckError] = useState('');
    const markets: ('TSE' | 'OTC')[] = market === 'both' ? ['TSE', 'OTC'] : [market];
    async function inspect() {
        setBusy(true); setCheck(null); setCheckError('');
        try { setCheck(await readCalendarDataCheck({ symbol: symbol.trim().toUpperCase(), from,
            through: dataset === 'candles' ? through : from, dataset, interval })); }
        catch { setCheckError('暫時無法檢查，請稍後重試。未下載或修改資料。'); }
        finally { setBusy(false); }
    }
    async function reload() {
        setBusy(true); setCheck(null);
        try { setState(await readSpecialMarketClosures()); setMessage('已讀取本機設定。'); }
        catch { setState(null); setMessage('設定讀取失敗，請重試。讀取成功前無法修改。'); }
        finally { setBusy(false); }
    }
    async function save(action: 'close' | 'revoke', target = date) {
        if (!state) return;
        setBusy(true);
        try {
            setState(await saveSpecialMarketClosure({ action, date: target, reason: reason.trim(),
                expectedRevision: state.revision, confirmed, markets }));
            setConfirmed(false); setCheck(null);
            setMessage('已保存設定。未補抓資料、補跑或恢復排程。');
        } catch {
            setState(null); setConfirmed(false);
            setMessage('未能確認保存成功，設定可能已變更。請重新讀取後核對。');
        } finally { setBusy(false); }
    }
    function selectTab(next: CalendarTab) { setTab(next); body.current?.scrollTo({ top: 0 }); }
    return <section className={styles.root} aria-label='特殊休市日設定' aria-busy={busy}>
        <header className={styles.header}>
            <div><h2 className={styles.heading}>交易日曆</h2>
                <p className={styles.description}>管理特殊休市，檢查本機既有資料。</p></div>
            {onClose && <button type='button' className={styles.closeButton} aria-label='關閉交易日曆' onClick={onClose}><X size={18}/></button>}
        </header>
        <div ref={tabs} className={styles.tabs} role='tablist' aria-label='日曆功能'>
            {([['closures', '特殊休市'], ['checks', '資料檢查']] as const).map(([key, label], index) =>
                <button key={key} type='button' role='tab' id={`${id}-${key}-tab`} aria-selected={tab === key}
                    aria-controls={`${id}-${key}-panel`} tabIndex={tab === key ? 0 : -1} className={styles.tab}
                    onClick={() => selectTab(key)} onKeyDown={event => {
                        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                        event.preventDefault();
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
                        selectTab(next === 0 ? 'closures' : 'checks');
                        tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
                    }}>{label}</button>)}
        </div>
        <div ref={body} className={styles.body}>
            <div role='tabpanel' id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`} className={styles.stack}>
                <p className={styles.notice}>{tab === 'closures'
                    ? '人工設定，非官方即時公告；臨時休市需由您確認並新增。'
                    : '只檢查本機已存資料，不會下載、補抓或修改資料。'}</p>
                <div className={styles.toolbar}>
                    <span className={styles.note}>{state ? `版本 ${state.revision} · 台北今日 ${state.today}` : '尚未讀取本機設定'}</span>
                    <button type='button' className={state ? styles.button : styles.primaryButton} disabled={busy}
                        onClick={() => void reload()}>讀取特殊休市設定</button>
                </div>
                {!state && <p className={styles.empty}>先讀取設定，再{tab === 'closures' ? '新增或撤銷特殊休市日' : '檢查現有資料'}。</p>}
                {state && tab === 'closures' && <>
                    <section className={styles.section} aria-label='休市設定表單'>
                        <h3 className={styles.sectionTitle}>{action === 'close' ? '新增／補登休市' : '撤銷／更正休市'}</h3>
                        <div className={styles.grid}>
                            <label className={styles.field}>特殊休市日期<input className={styles.input} aria-label='特殊休市日期' type='date' min='2000-01-01'
                                disabled={busy} value={date} onChange={e => { setDate(e.target.value); setAction('close'); setConfirmed(false); }}/></label>
                            <label className={styles.field}>適用市場<select className={styles.input} aria-label='適用市場' disabled={busy} value={market}
                                onChange={e => { setMarket(e.target.value as typeof market); setConfirmed(false); }}>
                                <option value='both'>上市＋上櫃</option><option value='TSE'>僅上市</option><option value='OTC'>僅上櫃</option></select></label>
                        </div>
                        <label className={styles.field}>休市／撤銷原因<input className={styles.input} aria-label='休市原因' maxLength={200}
                            placeholder='例如：颱風停止交易，依交易所公告' disabled={busy} value={reason}
                            onChange={e => { setReason(e.target.value); setConfirmed(false); }}/></label>
                        <p className={styles.note}>本次{action === 'close' ? '設定' : '撤銷'}：{date} · {marketLabel(markets)}全日</p>
                        <label className={styles.confirmation}><input type='checkbox' checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/>
                            我已核對日期、原因及市場，確認{action === 'close' ? '設定為全日休市' : '撤銷此休市設定'}。</label>
                        <p className={styles.note}>保存只更新日曆，不會補抓資料、補跑或恢復停用排程。</p>
                        {action === 'revoke' && date === state.today && <p className={styles.notice}>撤銷今日休市後，即時工作仍維持阻擋，不會自動重新開市。</p>}
                        <div className={styles.actions}>
                            <button type='button' className={styles.primaryButton} disabled={busy || !confirmed || !reason.trim() || !date}
                                onClick={() => void save(action)}>{action === 'close' ? '確認新增特殊休市日' : '確認撤銷／更正休市日'}</button>
                            {action === 'revoke' && <button type='button' className={styles.button} disabled={busy}
                                onClick={() => { setAction('close'); setReason(''); setConfirmed(false); }}>取消撤銷</button>}
                        </div>
                    </section>
                    <section className={styles.section} aria-label='已設定休市日'>
                        <h3 className={styles.sectionTitle}>已設定休市日 <span className={styles.note}>({state.entries.length})</span></h3>
                        <ul className={styles.entryList}>{state.entries.map(entry => <li className={styles.entry} key={`${entry.date}/${entry.markets?.join(',')}/${entry.revision}`}>
                            <div className={styles.entryContent}><div className={styles.entryDate}>{entry.date} · {marketLabel(entry.markets ?? ['TSE', 'OTC'])}</div>
                                <p className={styles.entryReason}>{entry.reason}</p><span className={styles.note}>使用者設定</span></div>
                            <button type='button' className={styles.button} disabled={busy} aria-label={`選擇撤銷 ${entry.date}`}
                                onClick={() => { setDate(entry.date); setMarket(entry.markets?.length === 1 ? (entry.markets[0] ?? 'both') : 'both'); setAction('revoke'); setReason(''); setConfirmed(false); body.current?.scrollTo({ top: 0 }); }}>撤銷／更正</button>
                        </li>)}</ul>
                        {!state.entries.length && <p className={styles.empty}>尚未設定特殊休市日。</p>}
                        {!!state.liveHolds?.length && <p role='note' className={styles.notice}>今日撤銷後，即時工作仍維持阻擋；排程不會自行恢復。</p>}
                    </section>
                </>}
                {state && tab === 'checks' && <section className={styles.section} aria-label='現有資料唯讀檢查'>
                    <h3 className={styles.sectionTitle}>檢查範圍</h3>
                    <div className={styles.grid}>
                        <label className={styles.field}>檢查商品<input className={styles.input} aria-label='檢查商品' value={symbol} disabled={busy}
                            onChange={e => { setSymbol(e.target.value); setCheck(null); }}/></label>
                        <label className={styles.field}>檢查資料<select className={styles.input} aria-label='檢查資料' value={dataset} disabled={busy}
                            onChange={e => { setDataset(e.target.value); setCheck(null); }}>
                            <option value='candles'>K 棒</option><option value='institutional-flow'>法人日資料</option>
                            <option value='margin-short'>資券日資料</option><option value='tdcc-weekly'>TDCC 週資料</option></select></label>
                        <label className={styles.field}>{dataset === 'candles' ? '檢查起日' : '資料日期'}<input className={styles.input} type='date' aria-label='檢查起日' value={from} disabled={busy}
                            onChange={e => { setFrom(e.target.value); setCheck(null); }}/></label>
                        {dataset === 'candles' && <><label className={styles.field}>檢查迄日<input className={styles.input} type='date' aria-label='檢查迄日' value={through} disabled={busy}
                            onChange={e => { setThrough(e.target.value); setCheck(null); }}/></label>
                            <label className={styles.field}>檢查週期<select className={styles.input} aria-label='檢查週期' value={interval} disabled={busy}
                                onChange={e => { setInterval(e.target.value); setCheck(null); }}>
                                {(['1d', '1m', '5m', '15m', '1h'] as const).map((i, n) => <option key={i} value={i}>{['日 K', '1 分 K', '5 分 K', '15 分 K', '60 分 K'][n]}</option>)}</select></label></>}
                    </div>
                    <div className={styles.actions}><button type='button' className={styles.primaryButton} disabled={busy} onClick={() => void inspect()}>唯讀檢查現有資料</button></div>
                    <p className={styles.note}>僅限本機現有資料。來源不足或未驗證時會顯示「無法判定」。</p>
                    {check && <output aria-label='日曆資料檢查結果' className={styles.result}>
                        <strong>{checkLabels[check.status] ?? '無法判定'}</strong>
                        <span>缺漏 {check.missing?.length ?? '—'} · 休市排除 {check.excluded?.length ?? '—'} · 衝突 {check.conflicts?.length ?? '—'}</span>
                        {check.status === 'partial' && <span>缺漏尚未排除停牌或上市前等情形，請另行核對。</span>}
                        {check.status === 'complete' && <span>僅此範圍的排定時段齊全，不代表所有來源均已驗證。</span>}
                        <details className={styles.disclosure}><summary>檢查明細</summary><dl className={styles.resultDetails}>
                            <dt>判定代碼</dt><dd>{check.reason ?? '—'}</dd><dt>日曆版本</dt><dd>{check.calendarVersion}</dd>
                            <dt>核對時間</dt><dd>{check.observedAt}</dd><dt>缺漏</dt><dd>{check.missing?.join('、') || '—'}</dd>
                            <dt>休市排除</dt><dd>{check.excluded?.join('、') || '—'}</dd><dt>衝突</dt><dd>{check.conflicts?.join('、') || '—'}</dd>
                            <dt>外部請求</dt><dd>{check.externalRequests}</dd><dt>資料寫入</dt><dd>{check.changedDb ? '是' : '否'}</dd>
                        </dl></details>
                    </output>}
                    {checkError && <p role='alert' className={styles.notice}>{checkError}</p>}
                </section>}
                <details className={styles.disclosure}><summary>{tab === 'closures' ? '設定影響與限制' : '檢查範圍與限制'}</summary>
                    {tab === 'closures' ? <ul>
                        <li>供本機 K 棒、籌碼資料檢查及量比監控共用，不影響雲端站台。</li>
                        <li>休市日不列為預期日資料缺漏；TDCC 週資料仍按期別檢查。有成交資料卻設定休市時，會顯示衝突。</li>
                        <li>可補登歷史或撤銷設定；既有資料與歷程保留，不會刪除或改寫舊收據。</li>
                        <li>今日撤銷仍保留即時工作阻擋，既有進行中請求無法追回；保存不代表全日零請求或所有排程已驗證生效。</li>
                    </ul> : <ul>
                        <li>僅檢查本機 MultiView 已存資料，不代表所有來源或全市場完整。</li>
                        <li>分 K 未存入本機、週報缺少期別或年度日曆過期時，可能無法判定。</li>
                        <li>修改條件後需再次按下檢查，不會自動查詢或沿用舊結果。</li>
                    </ul>}
                </details>
            </div>
        </div>
        {message && <div className={styles.footer} role='status' aria-live='polite'>{message}</div>}
    </section>;
}
