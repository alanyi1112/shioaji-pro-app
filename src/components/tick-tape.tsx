// Full-session tape. DOM rows are windowed; stored trades are never trimmed to the viewport.
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { fetchLastTicks } from '../lib/shioaji';
import { onAnyTick } from '../lib/stream';
import type { ContractBase } from '../lib/types/contract';
import type { SseTick } from '../lib/types/market';
import type { HistoryTicks } from '../lib/types/tick';
import type { TickTapeRow } from '../lib/tick-tape-large-trade';
import { DEFAULT_LARGE_TRADE_SETTINGS, readLargeTradeSettings, saveLargeTradeSettings, validateLargeTradeSettings, onLargeTradeSettings, type LargeTradeSettings } from '../lib/tick-tape-session';
import { useTickTapeSession } from '../lib/use-tick-tape-session';
import { fmtContractPrice, fmtInt } from '../lib/utils/format';
import { dateStrOffset } from '../lib/utils/kbars';
import * as panel from './panel.css';
import * as styles from './tick-tape.css';

async function loadFuturesHistory(contract: ContractBase, _count: number): Promise<HistoryTicks> {
    try {
        const next = await fetchLastTicks(contract, 120, dateStrOffset(-1));
        if (next.datetime.length) return next;
    } catch { /* Preserve night-session fallback. */ }
    return fetchLastTicks(contract, 120);
}
const TapeRowView = memo(function TapeRowView({
    row,
    contract,
}: {
    row: TickTapeRow;
    contract: ContractBase;
}) {
    const dir = row.tickType === 1 ? 'up' : row.tickType === 2 ? 'down' : 'flat';
    return (
        <div data-tape-row={row.tradeKey} className={row.isLarge ? styles.tapeRowBig : styles.tapeRow}>
            <span className={styles.time}>{row.time}</span>
            <span
                className={panel.dirText[dir]}
                style={{ textAlign: 'right' }}
            >
                {fmtContractPrice(contract, row.close)}
            </span>
            <span className={row.isLarge ? `${styles.volBig} ${panel.dirText[dir]}` : styles.vol}>
                {fmtInt(row.volume)}
            </span>
        </div>
    );
});

const fields: { key: Exclude<keyof LargeTradeSettings, 'operator'>; label: string; step: string }[] = [
    { key: 'amount', label: '單筆成交金額門檻（萬元）', step: '0.000001' },
    { key: 'lots', label: '單筆成交張數門檻（張）', step: '0.001' },
    { key: 'sampleSize', label: '動態門檻取樣筆數', step: '1' },
    { key: 'percentile', label: '動態百分位數（P）', step: '1' },
    { key: 'warmup', label: '動態門檻暖機筆數', step: '1' },
];
function SettingsForm({ close }: { close: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => { dialog.current?.showModal(); }, []);
    const finish = () => { dialog.current?.close(); close(); };
    const [draft, setDraft] = useState(readLargeTradeSettings);
    const [error, setError] = useState('');
    useEffect(() => onLargeTradeSettings(() => setDraft(readLargeTradeSettings())), []);
    return <dialog ref={dialog} className={styles.settingsDialog} aria-label='大單條件設定' onCancel={finish}><form className={styles.settings} onSubmit={event => {
        event.preventDefault();
        const invalid = validateLargeTradeSettings(draft);
        if (invalid) { setError(invalid); return; }
        try { saveLargeTradeSettings(draft); finish(); }
        catch { setError('設定無法儲存，請確認瀏覽器儲存空間'); }
    }}>
        <strong>大單條件設定</strong>
        {fields.map(field => <label className={styles.settingField} key={field.key}>{field.label}<input className={styles.settingInput} type='number' required step={field.step}
            value={Number.isNaN(draft[field.key]) ? '' : field.key === 'amount' ? draft.amount / 10000 : draft[field.key]}
            onChange={event => setDraft({ ...draft, [field.key]: field.key === 'amount' ? Math.round(event.target.valueAsNumber * 1_000_000) / 100 : event.target.valueAsNumber })} /></label>)}
        <label className={styles.settingField}>整組條件<select className={styles.settingInput} value={draft.operator} onChange={event => setDraft({ ...draft, operator: event.target.value as 'AND' | 'OR' })}>
            <option value='AND'>且（全部符合）</option><option value='OR'>或（任一符合）</option>
        </select></label>
        {error && <div role='alert'>{error}</div>}
        <div><button className={styles.tab} type='submit'>套用</button>{' '}
            <button className={styles.tab} type='button' onClick={() => { setDraft({ ...DEFAULT_LARGE_TRADE_SETTINGS }); setError(''); }}>恢復預設</button>{' '}
            <button className={styles.tab} type='button' onClick={finish}>取消</button></div>
    </form></dialog>;
}
function TapeInfoDialog({ children, close }: { children: ReactNode; close: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => { dialog.current?.showModal(); }, []);
    const finish = () => { dialog.current?.close(); close(); };
    return <dialog ref={dialog} className={styles.settingsDialog} aria-label='成交明細資訊' onCancel={finish}>
        <div className={styles.settings}>
            <strong>成交明細資訊</strong>
            {children}
            <button className={styles.tab} onClick={finish}>關閉</button>
        </div>
    </dialog>;
}
const ROW_HEIGHT = 24;
export function TickTape({ contract, historyLoader, tickSubscriber = onAnyTick }: {
    contract: ContractBase;
    historyLoader?: (contract: ContractBase, count: number) => Promise<HistoryTicks>;
    tickSubscriber?: (listener: (tick: SseTick) => void) => () => void;
}) {
    const fop = contract.security_type === 'FUT' || contract.security_type === 'OPT';
    const { result, status, coverageState, recomputing } = useTickTapeSession(contract, historyLoader ?? (fop ? loadFuturesHistory : undefined), tickSubscriber);
    const [tab, setTab] = useState<'all' | 'large'>('all');
    const [infoOpen, setInfoOpen] = useState(false);
    const infoButton = useRef<HTMLButtonElement>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const settingsButton = useRef<HTMLButtonElement>(null);
    const viewport = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [height, setHeight] = useState(400);
    const count = tab === 'all' ? result.rows.length : result.largeIndices.length;
    const previous = useRef({ count, tab, contract, revision: result.configRevision });
    const settings = JSON.parse(result.configRevision) as LargeTradeSettings;
    useEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setHeight(element.clientHeight || 400));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useLayoutEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const old = previous.current;
        if (old.tab !== tab || old.contract !== contract || old.revision !== result.configRevision) element.scrollTop = 0;
        else if (element.scrollTop > 0 && count > old.count) element.scrollTop += (count - old.count) * ROW_HEIGHT;
        setScrollTop(element.scrollTop);
        previous.current = { count, tab, contract, revision: result.configRevision };
    }, [count, tab, contract, result.configRevision]);
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
    const end = Math.min(count, start + Math.ceil(height / ROW_HEIGHT) + 10);
    const visible = [];
    for (let position = start; position < end; position++) {
        const index = tab === 'all' ? count - 1 - position : result.largeIndices[count - 1 - position]!;
        const row = result.rows[index]!;
        visible.push(<TapeRowView key={row.tradeKey} row={row} contract={contract} />);
    }
    const supported = contract.security_type === 'STK' && ['TSE', 'OTC'].includes(contract.exchange ?? '');
    const closeSettings = () => { setSettingsOpen(false); settingsButton.current?.focus(); };
    return <div className={styles.body}>
        <div className={styles.toolbar}>
            <div role='tablist' aria-label='成交明細篩選'>
                <button className={tab === 'all' ? styles.tabActive : styles.tab} role='tab' aria-selected={tab === 'all'} onClick={() => setTab('all')}>全部 {result.rows.length}</button>{' '}
                <button className={tab === 'large' ? styles.tabActive : styles.tab} role='tab' aria-selected={tab === 'large'} onClick={() => setTab('large')}>大單 {result.largeIndices.length}</button>
            </div>
            {supported && <button ref={settingsButton} className={styles.tab} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}>大單設定</button>}
            <button ref={infoButton} className={styles.infoButton} aria-label='成交明細資訊' aria-haspopup='dialog' aria-expanded={infoOpen} onClick={() => setInfoOpen(true)}>i</button>
        </div>
        {settingsOpen && <SettingsForm close={closeSettings} />}
        {infoOpen && <TapeInfoDialog close={() => { setInfoOpen(false); infoButton.current?.focus(); }}>
        <div role='status' className={styles.ruleBox}>
            <span>{fop ? '期貨／選擇權近期成交（最多 120 筆歷史）。' : ''}{status}</span>
            {result.rows.length > 0 && <span>{result.rows[0]!.tradeDate}　{result.rows[0]!.time} – {result.rows.at(-1)!.time}，已載入 {result.rows.length} 筆</span>}
            {recomputing && <span>重新計算中，暫時顯示上一版結果…</span>}
        </div>
        <div className={styles.ruleBox}>{supported ? <>
            <span>大單條件：金額 ≥ {new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 6 }).format(settings.amount / 10000)} 萬元 {settings.operator === 'AND' ? '且' : '或'} 張數 ≥ {settings.lots} 張 {settings.operator === 'AND' ? '且' : '或'} 前 {settings.sampleSize} 筆 P{settings.percentile}</span>
            <span>排除開盤瞬間、13:25 起、零股及試撮</span>
            {result.sampleCount < settings.warmup && <span className={styles.warmup}>動態門檻暖機中 {result.sampleCount}/{settings.warmup}（僅套用金額及張數條件）</span>}
        </> : <span>目前商品不適用台股大單分類</span>}</div>
        </TapeInfoDialog>}
        <div className={styles.toolbar}>
            <button className={styles.tab} onClick={() => viewport.current?.scrollTo({ top: 0 })}>回到最新</button>
            <button className={styles.tab} onClick={() => viewport.current?.scrollTo({ top: count * ROW_HEIGHT })}>當日最早</button>
        </div>
        <div ref={viewport} className={styles.viewport} tabIndex={0} aria-label='成交明細列表' onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
            {count === 0 && <div className={styles.ruleBox}>{tab === 'large'
                ? coverageState === 'confirmed_empty' ? '當日已確認無成交' : '目前尚無符合條件的大單'
                : coverageState === 'confirmed_empty' ? '當日已確認無成交'
                    : coverageState === 'failed' ? '成交資料載入失敗，請查看資訊'
                        : coverageState === 'loading' ? '正在載入成交資料…' : '尚未取得可顯示的成交'}</div>}
            <div className={styles.tape} style={{ height: count * ROW_HEIGHT, position: 'relative' }}>
                <div style={{ position: 'absolute', top: start * ROW_HEIGHT, left: 0, right: 0 }}>{visible}</div>
            </div>
        </div>
    </div>;
}
