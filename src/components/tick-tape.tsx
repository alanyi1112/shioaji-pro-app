// src/components/tick-tape.tsx — time & sales feed.
// Preloads today's recent history ticks, then streams live deals on top.
// Times show full microsecond precision (HH:MM:SS.ffffff).
// Large trades use a fixed notional floor plus a rolling P70 threshold.

import { memo, useEffect, useRef, useState } from 'react';
import { fetchLastTicks } from '../lib/shioaji';
import { onAnyTick } from '../lib/stream';
import type { ContractBase } from '../lib/types/contract';
import type { SseTick } from '../lib/types/market';
import type { HistoryTicks } from '../lib/types/tick';
import {
    LARGE_TRADE_WARMUP_SIZE,
    createTickTapeLargeTradeState,
    historyTickTapeInputs,
    ingestTickTapeEvent,
    liveTickTapeInput,
    replayTickTapeEvents,
    type TickTapeEventInput,
    type TickTapeRow,
} from '../lib/tick-tape-large-trade';
import { fmtContractPrice, fmtInt } from '../lib/utils/format';
import { dateStrOffset } from '../lib/utils/kbars';
import * as panel from './panel.css';
import * as styles from './tick-tape.css';

const MAX_ROWS = 120;

// futures night-session ticks are filed under the NEXT trading date —
// try tomorrow first for FUT/OPT, fall back to today.
async function loadHistory(
    contract: ContractBase,
    count: number,
): Promise<HistoryTicks> {
    const isFop =
        contract.security_type === 'FUT' || contract.security_type === 'OPT';
    if (isFop) {
        try {
            const next = await fetchLastTicks(
                contract,
                count,
                dateStrOffset(-1),
            );
            if (next.datetime.length > 0) return next;
        } catch {
            // fall back to today
        }
    }
    return fetchLastTicks(contract, count);
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
        <div className={row.isLarge ? styles.tapeRowBig : styles.tapeRow}>
            <span className={styles.time}>{row.time}</span>
            <span
                className={panel.dirText[dir]}
                style={{ textAlign: 'right' }}
            >
                {fmtContractPrice(contract, row.close)}
            </span>
            <span className={row.isLarge ? styles.volBig : styles.vol}>
                {fmtInt(row.volume)}
            </span>
        </div>
    );
});

function formatThreshold(value: number | null): string {
    if (value === null) return '至少 40 萬元';
    if (value >= 10_000) {
        const units = value / 10_000;
        return `${new Intl.NumberFormat('zh-TW', {
            maximumFractionDigits: units >= 100 ? 0 : 1,
        }).format(units)} 萬元`;
    }
    return `${fmtInt(value)} 元`;
}

export function TickTape({
    contract,
    historyLoader = loadHistory,
    tickSubscriber = onAnyTick,
}: {
    contract: ContractBase;
    historyLoader?: typeof loadHistory;
    tickSubscriber?: (listener: (tick: SseTick) => void) => () => void;
}) {
    const generationRef = useRef(0);
    const [model, setModel] = useState(() =>
        createTickTapeLargeTradeState(contract, 1),
    );
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'all' | 'large'>('all');

    // history preload, then live stream on top
    useEffect(() => {
        let cancelled = false;
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        let historySettled = false;
        const pendingLive: TickTapeEventInput[] = [];
        setModel(createTickTapeLargeTradeState(contract, generation));
        setTab('all');
        setLoading(true);

        historyLoader(contract, MAX_ROWS)
            .then((h) => {
                if (cancelled) return;
                historySettled = true;
                setModel(replayTickTapeEvents(
                    contract,
                    generation,
                    [...historyTickTapeInputs(contract, h, generation), ...pendingLive],
                ));
            })
            .catch(() => {
                historySettled = true;
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        const off = tickSubscriber((tick) => {
            if (tick.code !== contract.code) return;
            const input = liveTickTapeInput(contract, tick, generation);
            if (!historySettled) pendingLive.push(input);
            setModel((current) => ingestTickTapeEvent(current, input));
        });
        return () => {
            cancelled = true;
            off();
        };
    }, [contract, historyLoader, tickSubscriber]);

    const supported = contract.security_type === 'STK'
        && (contract.exchange === 'TSE' || contract.exchange === 'OTC');
    const rows = tab === 'large' ? model.largeRows : model.rows;

    return (
        <div className={panel.panelBody}>
            <div className={styles.toolbar} role='tablist' aria-label='成交明細篩選'>
                <button
                    className={tab === 'all' ? styles.tabActive : styles.tab}
                    role='tab'
                    aria-selected={tab === 'all'}
                    onClick={() => setTab('all')}
                >
                    全部
                </button>
                <button
                    className={tab === 'large' ? styles.tabActive : styles.tab}
                    role='tab'
                    aria-selected={tab === 'large'}
                    onClick={() => setTab('large')}
                >
                    大單 {model.largeRows.length}
                </button>
            </div>
            {tab === 'large' && (
                <div className={styles.ruleBox}>
                    {supported ? (
                        <>
                            <span>大單條件：單筆成交金額 ≥ {formatThreshold(model.currentThresholdTwd)}</span>
                            <span>門檻＝40 萬元、5 張價值、近 120 筆 P70 三者取高</span>
                            {model.sampleAmounts.length < LARGE_TRADE_WARMUP_SIZE && (
                                <span className={styles.warmup}>
                                    動態門檻暖機中 {model.sampleAmounts.length}/{LARGE_TRADE_WARMUP_SIZE}
                                </span>
                            )}
                        </>
                    ) : (
                        <span>目前商品不適用台股大單分類</span>
                    )}
                </div>
            )}
            <div className={styles.tape}>
                {rows.length === 0 && (
                    <span
                        className={styles.tapeRow}
                        style={{ justifyItems: 'center' }}
                    >
                        <span />
                        <span className={styles.time}>
                            {loading
                                ? '載入歷史成交…'
                                : tab === 'large'
                                  ? '目前尚無符合條件的大單'
                                  : '今日尚無成交'}
                        </span>
                        <span />
                    </span>
                )}
                {rows.map((t) => (
                    <TapeRowView
                        key={t.tradeKey}
                        row={t}
                        contract={contract}
                    />
                ))}
            </div>
        </div>
    );
}
