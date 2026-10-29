import type { DailyLevel, DailyLevelSnapshot } from '../lib/daily-indicator-levels';
import { fmtPrice } from '../lib/utils/format';
import * as styles from './daily-level-readout.css';

export function DailyLevelReadout({ snapshot, levels, loading, outside, diagnostics }: {
    snapshot: DailyLevelSnapshot; levels: readonly DailyLevel[]; loading: boolean;
    outside?: (value: number) => boolean;
    diagnostics?: { historyRequests: number; canonicalPayloadBytes: number; loadDurationMs: number; retainedDailyBars: number };
}) {
    const date = snapshot.bars.at(-1)?.time;
    const tradeDate = date === undefined ? '—' : new Date(date * 1000).toISOString().slice(0, 10);
    const asOf = snapshot.asOf === null ? '—' : new Date(snapshot.asOf * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const phase = snapshot.phase === 'forming' ? '盤中暫估' : snapshot.phase === 'closed' ? '已收盤' : '完成狀態未知';
    const state = loading ? '載入中' : snapshot.state === 'stale' ? '舊值・更新失敗' : snapshot.state === 'unavailable' ? '資料不可用' : '';
    return <details className={styles.details} data-daily-level-readout data-daily-level-generation={snapshot.generation}
        data-daily-level-history-requests={diagnostics?.historyRequests} data-daily-level-retained-bars={diagnostics?.retainedDailyBars}>
        <summary className={styles.summary}>{tradeDate}・{phase}{state ? `・${state}` : ''}</summary>
        <div className={styles.popover}>
            <div>來源更新：{asOf}</div>
            {snapshot.reason && <div>原因：{snapshot.reason}</div>}
            {levels.filter(l => l.style.visible).map(l => <div key={l.key} data-daily-level={l.key} data-price={l.value ?? ''} data-status={l.status} style={{ color: l.style.color, marginTop: 4 }}>
                {l.label} {l.value === null ? l.status === 'insufficient' ? `資料不足：需${l.required}日／已有${l.available}日` : '—（不可用）' : `${fmtPrice(l.value)}${l.status === 'stale' ? '（舊值）' : ''}${outside?.(l.value) ? '（視窗外）' : ''}`}
            </div>)}
        </div>
    </details>;
}
