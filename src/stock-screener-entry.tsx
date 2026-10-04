import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import type { Root } from 'react-dom/client';
import { StockScreenerPanel } from './components/stock-screener-panel';
import { addStockToScreenerLists } from './lib/stock-screener-list-sync';
import {
    startScreenerBridgeClient,
    type ScreenerBridgeClientState,
} from './lib/stock-screener-window';
import type { UniverseStock } from './lib/stock-screener-domain';
import { initTheme } from './lib/theme-store';
import * as styles from './stock-screener-entry.css';

const disconnectedState: ScreenerBridgeClientState = {
    connected: false,
    targets: [],
    targetRevision: '',
};

function StockScreenerPage() {
    const sourceWindowId = new URLSearchParams(window.location.search).get('sourceWindowId')?.trim() ?? '';
    const [bridgeState, setBridgeState] = useState(disconnectedState);
    const clientRef = useRef<ReturnType<typeof startScreenerBridgeClient> | null>(null);

    useEffect(() => {
        if (!sourceWindowId || sourceWindowId.length > 256) {
            setBridgeState(disconnectedState);
            return;
        }
        const client = startScreenerBridgeClient({ sourceWindowId, onState: setBridgeState });
        clientRef.current = client;
        return () => {
            client.close();
            if (clientRef.current === client) clientRef.current = null;
        };
    }, [sourceWindowId]);

    const pick = useCallback((stock: UniverseStock, targetId: string) => {
        const client = clientRef.current;
        return client
            ? client.pick(stock, targetId)
            : Promise.reject(new Error('尚未連接主交易頁'));
    }, []);
    const openChart = useCallback(() => {
        const client = clientRef.current;
        return client
            ? client.openChart()
            : Promise.reject(new Error('尚未連接主交易頁'));
    }, []);

    return (
        <main className={styles.page} data-testid='stock-screener-page'>
            <header className={styles.header}>
                <div>
                    <h1>選股</h1>
                    <p>收盤後全市場篩選</p>
                </div>
                <span role='status' className={bridgeState.connected ? styles.connected : styles.disconnected}>
                    {bridgeState.connected ? '已連接主交易頁' : '尚未連接主交易頁'}
                </span>
            </header>
            <section className={styles.panel}>
                <StockScreenerPanel
                    targets={bridgeState.targets}
                    onPick={pick}
                    onOpenChart={openChart}
                    onTargetChange={() => clientRef.current?.cancel()}
                    onAddToWatchlist={addStockToScreenerLists}
                    chartConnectionMessage={bridgeState.connected
                        ? '目前沒有未鎖定圖表，請在主交易頁解鎖圖表，或新增日 K 圖。'
                        : '尚未連接主交易頁；篩選與加入清單仍可使用。請從主交易頁「版面」選單中的「選股篩選」開啟此頁以連動 K 線。'}
                />
            </section>
        </main>
    );
}

export function renderStockScreener(root: Root) {
    initTheme();
    root.render(
        <StrictMode>
            <StockScreenerPage />
        </StrictMode>,
    );
}
