import type { CandlestickResponse } from '../lib/stock-screener-candlestick-api';
import type { UniverseStock } from '../lib/stock-screener-domain';
import { CANDLESTICK_CATALOG } from '../lib/stock-screener-candlestick-catalog';
import { canonicalPriceUnits } from '../lib/stock-screener-ohlcv';
import * as styles from './stock-screener-panel.css';
const reasons: Record<string, string> = { v9_schema_pending: '五型態資料表尚未準備，舊版布林仍可使用。',
    v9_preparation_pending: '背景尚未發布完整 OHLC 短窗。', full_ohlcv_source_pending: '必要交易日完整 OHLC 來源尚未備齊。',
    calendar_authority_pending: '官方交易日與臨時休市證據尚待驗證。', new_session_pending: '新資料日尚未準備；以下為保留舊快照，禁止操作。',
    same_session_legacy_pending: '舊條件缺同日同母體資料，保留無法判定。', same_session_bollinger_pending: '布林條件缺同日同母體底稿，保留無法判定。' };
export const candlestickVerdictLabel = { pass: '符合', fail: '不符合', unknown: '無法判定' };
export function StockScreenerCandlestickResults({ response: r, onPick, onAdd, targetAvailable, statuses }: {
    response: CandlestickResponse; onPick: (stock: UniverseStock) => void; onAdd: (stock: UniverseStock) => void;
    targetAvailable: boolean; statuses: Record<string, { status: string; message: string }>;
}) {
    const available = r.state === 'ready' && r.canUseResults;
    return <section className={styles.results} aria-label='K 線反轉結果'>
        <div className={styles.status} role='status'><strong>五型態 · {available ? '完整日查詢完成' : r.state === 'stale' ? '資料已過期' : '等待完整資料'}</strong>
            <div>有效資料日 {r.effectiveSessionDate ?? '尚無'} · 預期 {r.expectedSessionDate ?? '未確認'}</div>
            {[r.reason, r.preparation?.reason, r.legacyJoin?.reason, r.bollingerJoin?.reason].filter(s => s && s !== 'none').map((s, i) => <div key={i} className={styles.criticalStatus}>{reasons[s!] ?? `資料狀態：${s}`}</div>)}
            <p>未還原價格；來源未提供完整除權息事件證據。已知不可比窗口標示無法判定，不代表所有價格事件均已排除。</p>
            {r.counts && <div>母體 {r.counts.total} · 符合 {r.counts.pass} · 不符合 {r.counts.fail} · 無法判定 {r.counts.unknown}</div>}
            {r.counts && !r.rows.length && <div>本頁結果為 0；不放寬條件或製造案例。</div>}
        </div>
        {r.sourceEvidence != null && <details><summary>來源、公式與快照證據</summary><pre>{JSON.stringify({ snapshotId: r.snapshotId, formula: r.formulaVersion, catalog: r.catalogVersion,
            mapping: r.sourceMappingVersion, calendarHash: r.calendarHash, rowsHash: r.rowsHash, sourceEvidence: r.sourceEvidence }, null, 2)}</pre></details>}
        {r.rows.map(row => {
            const stock: UniverseStock = { symbol: row.symbol, code: row.code, name: row.name, market: row.market, kind: 'ordinary' };
            return <article key={row.symbol} className={styles.row}>
                <div className={styles.rowTop}><button type='button' className={styles.rowAction} disabled={!targetAvailable || !available}
                    onClick={() => onPick(stock)} aria-label={`在指定 K 線圖開啟 ${row.code} ${row.name}`}>
                    <strong>{row.code} {row.name} · {candlestickVerdictLabel[row.verdict]}</strong>
                    <span>{r.effectiveSessionDate} · {row.market}</span>
                    {row.outcome.hits.map(hit => <strong key={hit.pattern} data-candlestick-direction={hit.direction}
                        className={styles.candlestickDirection[hit.direction]}>
                        {CANDLESTICK_CATALOG[hit.subtype ?? hit.pattern].name} · {hit.direction === 'bullish' ? '看多（紅陽）' : '看空（綠陰）'}
                        {hit.subtype === 'morning-doji-star' ? ' · 外部反轉率參考 76%（非本功能勝率）' : ''}
                    </strong>)}
                </button><button type='button' className={styles.addButton} disabled={!available || ['pending', 'complete'].includes(statuses[row.symbol]?.status ?? '')} onClick={() => onAdd(stock)}>
                    {statuses[row.symbol]?.status === 'complete' ? '已加入' : statuses[row.symbol]?.status === 'pending' ? '加入中…' : ['failed', 'partial'].includes(statuses[row.symbol]?.status ?? '') ? '重試加入' : '加入清單'}</button></div>
                {statuses[row.symbol] && <p role='status' className={styles.addStatus}>{statuses[row.symbol]!.message}</p>}
                <details><summary>五型態逐棒與條件證據（唯讀）</summary>
                    {row.outcome.matches.map(m => <div key={m.pattern}>
                        <strong>{CANDLESTICK_CATALOG[m.subtype ?? m.pattern].name} · {candlestickVerdictLabel[m.verdict]}</strong>
                        <p>{m.mode === 'pattern-complete' ? '形態成立' : '次日突破確認'} · 形成 {m.formationDates.join(' → ')} · 確認 {m.confirmationDate ?? '不要求'}</p>
                        {m.bars.map(b => { const open = canonicalPriceUnits(b.open)!; const close = canonicalPriceUnits(b.close)!;
                            return <p key={b.sessionDate} data-candlestick-direction={close > open ? 'bullish' : close < open ? 'bearish' : 'doji'} className={close > open ? styles.candlestickDirection.bullish : close < open ? styles.candlestickDirection.bearish : undefined}>
                                {b.sessionDate} · {close > open ? '陽線（紅）' : close < open ? '陰線（綠）' : '十字（開收相等）'} · 開 {b.open} 高 {b.high} 低 {b.low} 收 {b.close}</p>; })}
                        <pre>{JSON.stringify(m.checks, null, 2)}</pre>
                    </div>)}
                    <details><summary>完整前期窗與 hash 原值</summary><pre>{JSON.stringify(row.history, null, 2)}</pre></details>
                    {row.legacyEvidence != null && <pre>{JSON.stringify(row.legacyEvidence, null, 2)}</pre>}
                    {row.bollingerEvidence != null && <pre>{JSON.stringify(row.bollingerEvidence, null, 2)}</pre>}
                </details>
            </article>;
        })}
    </section>;
}
