// src/components/scanner-panel.tsx — market movers leaderboard

import { useEffect, useMemo, useState } from 'react';
import { focusSector } from '../lib/sector-sync';
import { fetchScanner } from '../lib/shioaji';
import { quoteLimitState } from '../lib/limit-state';
import {
    scannerItemToSnapshot,
    type QuotePickHandler,
} from '../lib/quote-selection';
import {
    categoryOf,
    loadStockDetails,
    sectorLabel,
    type StockMeta,
} from '../lib/stock-index';
import type { ScannerItem, ScannerType } from '../lib/types/market';
import { fmtInt, fmtPct, fmtPrice } from '../lib/utils/format';
import * as panel from './panel.css';
import * as styles from './scanner-panel.css';

// NOTE: the server's `ascending` flag is inverted (sinotrade/shioaji#207):
// true → largest first. Encode the working values per mode here.
const MODES: { key: string; type: ScannerType; label: string; ascending: boolean }[] = [
    { key: 'gain', type: 'ChangePercentRank', label: '漲幅', ascending: true },
    { key: 'loss', type: 'ChangePercentRank', label: '跌幅', ascending: false },
    { key: 'vol', type: 'VolumeRank', label: '量', ascending: true },
    { key: 'amt', type: 'AmountRank', label: '額', ascending: true },
    { key: 'multi', type: 'ChangePercentRank', label: '複選', ascending: true },
];

// 複選 (issue #2): union three deep ranks, then intersect by thresholds —
// the top names are often untradeable, crossing conditions finds the rest.
// `short` flips the 漲幅 condition to 跌幅 so you can screen short candidates
// (跌幅 + 量 + 額), which the long-only version couldn't surface.
async function fetchMulti(
    minPct: number,
    minVolK: number,
    minAmtB: number,
    short: boolean,
): Promise<ScannerItem[]> {
    const [pct, vol, amt] = await Promise.allSettled([
        fetchScanner('ChangePercentRank', 100, !short),
        fetchScanner('VolumeRank', 100, true),
        fetchScanner('AmountRank', 100, true),
    ]);
    const byCode = new Map<string, ScannerItem>();
    for (const r of [pct, vol, amt]) {
        if (r.status !== 'fulfilled') continue;
        for (const it of r.value) {
            if (!byCode.has(it.code)) byCode.set(it.code, it);
        }
    }
    const out = [...byCode.values()].filter((it) => {
        const ref = it.close - it.change_price;
        const pctV = it.change_price && ref > 0 ? (it.change_price / ref) * 100 : 0;
        const pctOk = short ? pctV <= -minPct : pctV >= minPct;
        return (
            pctOk &&
            it.total_volume >= minVolK * 1000 &&
            it.total_amount >= minAmtB * 1e8
        );
    });
    out.sort((a, b) => {
        const refA = a.close - a.change_price;
        const refB = b.close - b.change_price;
        const pa = refA > 0 ? a.change_price / refA : 0;
        const pb = refB > 0 ? b.change_price / refB : 0;
        return short ? pa - pb : pb - pa; // 放空：跌最多在前
    });
    return out.slice(0, 30);
}

const MODE_KEY = 'sj-pro-scanner-mode';
const REFRESH_MS = 15000;

// 額 in 億 for readability
function fmtAmount(amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) return '';
    return `${(amount / 1e8).toFixed(1)}億`;
}

export function ScannerPanel({
    onPick,
}: {
    onPick: QuotePickHandler;
}) {
    const [modeKey, setModeKey] = useState(
        () => localStorage.getItem(MODE_KEY) ?? 'gain',
    );
    const [items, setItems] = useState<ScannerItem[]>([]);
    const [error, setError] = useState(false);
    const [reloadSeq, setReloadSeq] = useState(0);
    const [picked, setPicked] = useState<string | null>(null);
    // 複選 thresholds (persisted)
    const [minPct, setMinPct] = useState(
        () => Number(localStorage.getItem('sj-scan-minpct')) || 2,
    );
    const [minVolK, setMinVolK] = useState(
        () => Number(localStorage.getItem('sj-scan-minvol')) || 5,
    );
    const [minAmtB, setMinAmtB] = useState(
        () => Number(localStorage.getItem('sj-scan-minamt')) || 1,
    );
    const [multiShort, setMultiShort] = useState(
        () => localStorage.getItem('sj-scan-multishort') === '1',
    );
    const [index, setIndex] = useState<StockMeta[] | null>(null);
    const mode = MODES.find((m) => m.key === modeKey) ?? MODES[0]!;

    // Contract V2: fetch typed StockInfo only for the visible scanner rows.
    useEffect(() => {
        let alive = true;
        loadStockDetails(items.map((item) => item.code))
            .then((details) => {
                if (alive) setIndex(details);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [items]);
    const catByCode = useMemo(() => {
        const m = new Map<string, string>();
        for (const it of items) {
            const c = index ? categoryOf(index, it.code) : null;
            if (c) m.set(it.code, c);
        }
        return m;
    }, [items, index]);
    const metaByCode = useMemo(
        () => new Map((index ?? []).map((detail) => [detail.code, detail])),
        [index],
    );

    useEffect(() => {
        let cancelled = false;
        setError(false);
        const load = () =>
            (mode.key === 'multi'
                ? fetchMulti(minPct, minVolK, minAmtB, multiShort)
                : fetchScanner(mode.type, 20, mode.ascending)
            )
                .then((d) => {
                    if (cancelled) return;
                    setItems(d);
                    setError(false);
                })
                .catch(() => !cancelled && setError(true));
        load();
        const t = setInterval(load, REFRESH_MS);
        return () => {
            cancelled = true;
            clearInterval(t);
        };
    }, [mode, reloadSeq, minPct, minVolK, minAmtB, multiShort]);

    return (
        <>
            <div className={styles.switcher}>
                {MODES.map((m) => (
                    <button
                        key={m.key}
                        className={styles.sw[modeKey === m.key ? 'on' : 'off']}
                        onClick={() => {
                            setModeKey(m.key);
                            localStorage.setItem(MODE_KEY, m.key);
                        }}
                    >
                        {m.label}
                    </button>
                ))}
            </div>
            {mode.key === 'multi' && (
                <div className={styles.filterRow}>
                    <div className={styles.switcher} style={{ padding: 0 }}>
                        {(
                            [
                                ['做多', false],
                                ['放空', true],
                            ] as [string, boolean][]
                        ).map(([label, sh]) => (
                            <button
                                key={label}
                                className={
                                    styles.sw[multiShort === sh ? 'on' : 'off']
                                }
                                onClick={() => {
                                    setMultiShort(sh);
                                    localStorage.setItem(
                                        'sj-scan-multishort',
                                        sh ? '1' : '0',
                                    );
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {(
                        [
                            [
                                multiShort ? '跌幅≥%' : '漲幅≥%',
                                minPct,
                                setMinPct,
                                'sj-scan-minpct',
                            ],
                            ['量≥千張', minVolK, setMinVolK, 'sj-scan-minvol'],
                            ['額≥億', minAmtB, setMinAmtB, 'sj-scan-minamt'],
                        ] as [string, number, (v: number) => void, string][]
                    ).map(([label, value, set, key]) => (
                        <label key={key} className={styles.filterItem}>
                            {label}
                            <input
                                className={styles.filterInput}
                                value={value}
                                inputMode='decimal'
                                onChange={(e) => {
                                    const v = Number(e.target.value);
                                    if (Number.isFinite(v) && v >= 0) {
                                        set(v);
                                        localStorage.setItem(key, String(v));
                                    }
                                }}
                            />
                        </label>
                    ))}
                </div>
            )}
            <div className={panel.panelBody}>
                {error && (
                    <div className={styles.errorBox}>
                        <span className={styles.scName}>排行資料無法取得</span>
                        <button
                            className={styles.retryBtn}
                            onClick={() => setReloadSeq((s) => s + 1)}
                        >
                            重試
                        </button>
                    </div>
                )}
                {items.map((it, i) => {
                    const dir =
                        it.change_price > 0
                            ? 'up'
                            : it.change_price < 0
                              ? 'down'
                              : 'flat';
                    // reference = close - change; guard zero/flat prices
                    const ref = it.close - it.change_price;
                    const pct =
                        it.change_price && ref > 0
                            ? (it.change_price / ref) * 100
                            : 0;
                    const sub =
                        mode.key === 'amt'
                            ? fmtAmount(it.total_amount)
                            : it.total_volume > 0
                              ? fmtInt(it.total_volume)
                              : '';
                    const meta = metaByCode.get(it.code);
                    const atLimit = quoteLimitState({
                        price: it.close,
                        limitUp: meta?.limit_up,
                        limitDown: meta?.limit_down,
                    });
                    const limitLabel =
                        atLimit === 'up'
                            ? '漲停'
                            : atLimit === 'down'
                              ? '跌停'
                              : null;
                    return (
                        <div
                            key={it.code}
                            className={`${styles.row} ${
                                picked === it.code ? styles.rowPicked : ''
                            }`}
                            onClick={() => {
                                setPicked(it.code);
                                onPick(
                                    it.code,
                                    scannerItemToSnapshot(
                                        it,
                                        meta?.exchange || 'TSE',
                                    ),
                                );
                            }}
                        >
                            <span className={styles.rank}>
                                {String(i + 1).padStart(2, '0')}
                            </span>
                            <span className={styles.idBlock}>
                                <span className={styles.scCode}>
                                    {it.code}
                                </span>
                                <span className={styles.scName}>
                                    {it.name}
                                </span>
                            </span>
                            {catByCode.get(it.code) ? (
                                <button
                                    className={styles.sectorTag}
                                    title='跳到此類股熱力圖'
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        focusSector(catByCode.get(it.code)!);
                                    }}
                                >
                                    {sectorLabel(catByCode.get(it.code)!)}
                                </button>
                            ) : (
                                <span />
                            )}
                            <span
                                className={styles.quoteGroup[atLimit ?? 'neutral']}
                                data-limit-state={atLimit ?? undefined}
                                data-quote-group='current'
                                aria-label={
                                    limitLabel
                                        ? `${limitLabel}，最新價 ${fmtPrice(it.close)}，${fmtPct(pct)}`
                                        : undefined
                                }
                            >
                                <span
                                    className={`${styles.scValue} ${
                                        atLimit
                                            ? styles.limitText
                                            : panel.dirText[dir]
                                    }`}
                                >
                                    {fmtPrice(it.close)} {fmtPct(pct)}
                                </span>
                            </span>
                            <span className={styles.scSub}>{sub}</span>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
