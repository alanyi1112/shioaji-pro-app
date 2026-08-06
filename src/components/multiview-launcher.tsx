import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    probeMultiView,
    resolveMultiViewUrl,
    type MultiViewLaunchStatus,
} from '../lib/multiview-window';
import * as styles from './multiview-launcher.css';

const COPY = {
    ready: {
        title: 'MultiView 已可使用',
        detail: '本機服務與 Shioaji simulation 已就緒，即將開啟多圖看盤。',
    },
    fallback: {
        title: '目前使用延遲行情',
        detail: 'MultiView 正常，但 Shioaji business session 暫時離線；可先使用 Yahoo 延遲來源。',
    },
    degraded: {
        title: 'MultiView 可用，盤後資料需檢查',
        detail: 'simulation 行情已就緒，但盤後資料健康狀態異常；進入後請查看資料來源狀態。',
    },
    offline: {
        title: '僅允許 simulation',
        detail: '目前 Shioaji 不是可驗證的 simulation session，MultiView 已保持 fail closed。',
    },
    unavailable: {
        title: 'MultiView 尚未啟動',
        detail: '無法連線到 127.0.0.1:5174。請啟動本機 runtime 後重新檢查。',
    },
} as const;

export function MultiViewLauncher() {
    const targetUrl = useMemo(
        () =>
            resolveMultiViewUrl(
                new URLSearchParams(window.location.search).get('target') ??
                    undefined,
            ),
        [],
    );
    const [status, setStatus] = useState<MultiViewLaunchStatus | null>(null);
    const [checking, setChecking] = useState(false);

    const check = useCallback(async () => {
        setChecking(true);
        const next = await probeMultiView(targetUrl);
        setStatus(next);
        setChecking(false);
        if (next.code === 'ready') {
            window.setTimeout(() => window.location.replace(next.targetUrl), 450);
        }
    }, [targetUrl]);

    useEffect(() => {
        void check();
    }, [check]);

    const state = status?.code ?? 'unavailable';
    const copy = checking
        ? { title: '檢查 MultiView…', detail: '正在確認 5174、simulation 與盤後資料狀態。' }
        : COPY[state];

    return (
        <main className={styles.page}>
            <section className={styles.card} aria-live='polite'>
                <span className={styles.eyebrow}>Shioaji Pro · 本機服務</span>
                <h1 className={styles.title}>{copy.title}</h1>
                <p className={styles.detail}>{copy.detail}</p>
                <dl className={styles.statusGrid}>
                    <div>
                        <dt>MultiView 5174</dt>
                        <dd>{status?.multiview ?? '檢查中'}</dd>
                    </div>
                    <div>
                        <dt>Shioaji</dt>
                        <dd>{status?.shioaji ?? '檢查中'}</dd>
                    </div>
                    <div>
                        <dt>盤後資料</dt>
                        <dd>{status?.afterHours ?? '檢查中'}</dd>
                    </div>
                </dl>
                {status?.reasonCode && (
                    <p className={styles.reason}>狀態碼：{status.reasonCode}</p>
                )}
                <div className={styles.actions}>
                    <button type='button' onClick={() => void check()} disabled={checking}>
                        {checking ? '檢查中…' : '重新檢查'}
                    </button>
                    {status?.multiview === 'available' && status.code !== 'offline' && (
                        <button type='button' onClick={() => window.location.assign(targetUrl)}>
                            開啟 MultiView
                        </button>
                    )}
                </div>
                {status?.code === 'unavailable' && (
                    <p className={styles.help}>
                        本機操作：在 RealTimeStock 專案執行
                        <code> ./scripts/realtimestock-runtime restart simulation</code>
                    </p>
                )}
                {status?.code === 'fallback' && (
                    <p className={styles.help}>
                        可先開啟 MultiView 使用 Yahoo 延遲行情，或重新啟動 simulation 後再檢查。
                    </p>
                )}
            </section>
        </main>
    );
}
