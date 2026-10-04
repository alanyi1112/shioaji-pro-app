// src/components/debug-panel.tsx — 診斷面板: connection/runtime internals
// for figuring out "why is nothing updating" without opening devtools.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoll } from '../hooks/use-poll';
import { useStreamStatus } from '../hooks/use-stream';
import { getApiBase } from '../lib/runtime';
import { fetchHealth, fetchInfo } from '../lib/shioaji';
import {
    getLastHeartbeat,
    getMarketStreamDiagnostics,
    interruptMarketStreamForAcceptance,
    silenceMarketStreamForWatchdogAcceptance,
    getSubscriptionCount,
    onAnyTick,
    onOrderEvent,
    watchMarketStreamTicks,
} from '../lib/stream';
import type { SharedStreamDiagnostics } from '../lib/shared-event-source';
import { readHistoryBudgetAudit } from '../lib/tick-tape-repository';
import { analyticsEnabled } from '../lib/analytics';
import { useTier } from '../lib/features';
import type { OrderEventReport } from '../lib/order-report';
import { appVersion } from '../lib/tauri';
import * as dockStyles from './bottom-dock.css';
import * as styles from './debug-panel.css';

const STATUS_LABEL = { live: 'LIVE', connecting: 'SYNC', down: 'LOST' };

export function DebugPanel() {
    const stream = useStreamStatus();
    const [, tick] = useState(0);
    // ticks/sec over a sliding 5s window
    const tickTimes = useRef<number[]>([]);
    const [events, setEvents] = useState<
        { ts: number; data: OrderEventReport }[]
    >([]);
    const [ver, setVer] = useState('');
    const [diagnostics, setDiagnostics] = useState<SharedStreamDiagnostics | null>(null);
    const [diagnosticsMessage, setDiagnosticsMessage] = useState('尚未擷取；不會額外建立 SSE 連線');
    const [watchCode, setWatchCode] = useState('');
    const [historyAudit, setHistoryAudit] = useState<{ count: number; events: { at: number; queryType: string; reason: string }[] } | null>(null);

    const captureDiagnostics = async () => {
        const snapshot = await getMarketStreamDiagnostics();
        setDiagnostics(snapshot);
        setDiagnosticsMessage(snapshot ? '來自此頁既有 SharedWorker port' : '共用串流未連線，或此瀏覽器使用 EventSource fallback；無法量測 refcount');
    };

    const startTickWatch = async () => {
        const code = watchCode.trim().toUpperCase();
        if (code && !/^[A-Z0-9]{1,10}$/.test(code)) {
            setDiagnosticsMessage('商品代碼格式不正確');
            return;
        }
        const ok = await watchMarketStreamTicks(code);
        setDiagnosticsMessage(ok
            ? (code ? `已暫時觀察 ${code}，最多 5 分鐘／32 筆；再次擷取可查看` : '已停止逐筆觀察')
            : '無法啟用：共用串流未連線或目前使用 fallback');
        if (ok) await captureDiagnostics();
    };

    const interruptStream = async () => {
        const accepted = await interruptMarketStreamForAcceptance(info?.simulation === true);
        await captureDiagnostics();
        setDiagnosticsMessage(accepted
            ? '驗收中：共用成交 SSE 已短暫中斷，15 秒後自動接回；同瀏覽器看盤頁會暫時顯示斷線'
            : '未執行中斷：僅限本機開發模擬環境、已連線且最多三次');
    };

    const silenceStream = async () => {
        const accepted = await silenceMarketStreamForWatchdogAcceptance(info?.simulation === true);
        await captureDiagnostics();
        setDiagnosticsMessage(accepted
            ? '驗收中：成交來源維持開啟但暫停事件轉發；約 60 秒後應由 watchdog 自行重連，75 秒後保險解除'
            : '未執行靜默演練：僅限本機開發模擬環境、最近 10 秒有事件且每個 worker 最多一次');
    };

    useEffect(() => {
        appVersion().then(setVer);
    }, []);

    useEffect(() => {
        const offTick = onAnyTick(() => {
            tickTimes.current.push(Date.now());
        });
        const offEv = onOrderEvent((data) => {
            setEvents((prev) => [...prev.slice(-4), { ts: Date.now(), data }]);
        });
        const t = setInterval(() => {
            const cutoff = Date.now() - 5000;
            tickTimes.current = tickTimes.current.filter(
                (ts) => ts > cutoff,
            );
            tick((v) => v + 1); // refresh heartbeat age + rate display
        }, 1000);
        return () => {
            offTick();
            offEv();
            clearInterval(t);
        };
    }, []);

    const { data: health } = usePoll(
        useCallback(() => fetchHealth().catch(() => null), []),
        15000,
    );
    const { data: info } = usePoll(
        useCallback(() => fetchInfo().catch(() => null), []),
        60000,
    );

    const tier = useTier();
    const hb = getLastHeartbeat();
    const hbAge = hb ? Math.round((Date.now() - hb) / 1000) : null;
    const rate = (tickTimes.current.length / 5).toFixed(1);
    const tokenSeconds = health?.token_expires_in_seconds;
    const contractCount = health?.contract_count;

    const rows: { label: string; value: string; warn?: boolean }[] = [
        { label: 'App 版本', value: ver ? `v${ver}` : '—' },
        { label: '方案', value: tier === 'vip' ? 'VIP' : 'Free' },
        {
            label: 'GA 即時',
            value: analyticsEnabled() ? '已啟用' : '未設定',
        },
        {
            label: 'SSE 行情流',
            value: STATUS_LABEL[stream],
            warn: stream !== 'live',
        },
        {
            label: '心跳',
            value: hbAge === null ? '—' : `${hbAge}s 前`,
            warn: hbAge !== null && hbAge > 15,
        },
        { label: '行情速率', value: `${rate} 筆/秒` },
        { label: '訂閱數', value: String(getSubscriptionCount()) },
        { label: 'API Base', value: getApiBase() || '(同源)' },
        {
            label: '伺服器版本',
            value: info ? `${info.version}${info.simulation ? '（模擬）' : '（⚠ 正式）'}` : '—',
        },
        {
            label: 'Token 有效',
            value: typeof tokenSeconds === 'number'
                ? `${Math.round(tokenSeconds / 3600)}h`
                : '—',
            warn: typeof tokenSeconds === 'number' && tokenSeconds < 3600,
        },
        {
            label: '合約數',
            value:
                typeof contractCount === 'number'
                    ? contractCount.toLocaleString()
                    : '—',
        },
    ];

    return (
        <div className={styles.wrap}>
            <div className={styles.grid}>
                {rows.map((r) => (
                    <div key={r.label} className={styles.row}>
                        <span className={styles.label}>{r.label}</span>
                        <span
                            className={r.warn ? styles.valueWarn : styles.value}
                        >
                            {r.value}
                        </span>
                    </div>
                ))}
            </div>
            <span className={styles.sectionTitle}>共用行情串流（唯讀）</span>
            <div className={styles.diagnosticControls}>
                <button className={styles.diagnosticButton} type="button" onClick={() => void captureDiagnostics()}>擷取狀態</button>
                <input className={styles.diagnosticInput} aria-label="觀察商品代碼" placeholder="商品代碼" value={watchCode}
                    onChange={(event) => setWatchCode(event.target.value)} />
                <button className={styles.diagnosticButton} type="button" onClick={() => void startTickWatch()}>觀察 5 分鐘</button>
                <button className={styles.diagnosticButton} type="button" onClick={() => {
                    setWatchCode('');
                    void watchMarketStreamTicks('').then((ok) => {
                        setDiagnosticsMessage(ok ? '已停止逐筆觀察' : '共用串流未連線或目前使用 fallback');
                        if (ok) void captureDiagnostics();
                    });
                }}>停止觀察</button>
            </div>
            <span className={styles.label}>{diagnosticsMessage}</span>
            {import.meta.env.DEV && info?.simulation === true && <div className={styles.diagnosticControls}>
                <span className={styles.sectionTitle}>本機模擬驗收：短暫中斷共用成交 SSE</span>
                <button className={styles.diagnosticButton} type="button" onClick={() => void interruptStream()}>中斷 15 秒後自動接回</button>
                <button className={styles.diagnosticButton} type="button" onClick={() => void silenceStream()}>演練 60 秒無事件</button>
                <button className={styles.diagnosticButton} type="button" onClick={() => {
                    void readHistoryBudgetAudit().then(setHistoryAudit, () => setDiagnosticsMessage('無法讀取本頁成交查詢預算收據'));
                }}>讀取成交查詢收據</button>
            </div>}
            {historyAudit && <pre className={styles.eventDump}>{JSON.stringify({
                count: historyAudit.count, events: historyAudit.events.slice(-12),
            }, null, 2)}</pre>}
            {diagnostics && <button className={styles.diagnosticButton} type="button" onClick={() => {
                if (!navigator.clipboard?.writeText) {
                    setDiagnosticsMessage('瀏覽器未提供剪貼簿；可手動複製下方 JSON');
                    return;
                }
                void navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)).then(
                    () => setDiagnosticsMessage('已複製本次唯讀診斷快照'),
                    () => setDiagnosticsMessage('無法複製；可手動複製下方 JSON'),
                );
            }}>複製快照</button>}
            {diagnostics && <pre className={styles.eventDump}>{JSON.stringify(diagnostics, null, 2)}</pre>}
            <span className={styles.sectionTitle}>最近 order_event</span>
            {events.length === 0 && (
                <span className={dockStyles.emptyState}>尚無事件</span>
            )}
            {[...events].reverse().map((e) => (
                <pre key={e.ts} className={styles.eventDump}>
                    {new Date(e.ts).toLocaleTimeString('en-GB')}{' '}
                    {JSON.stringify(e.data.raw ?? e.data).slice(0, 220)}
                </pre>
            ))}
        </div>
    );
}
