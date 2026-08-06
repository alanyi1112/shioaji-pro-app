// src/components/quote-board.tsx — selected symbol mega display

import { useQuote } from '../hooks/use-stream';
import type { ContractInfo } from '../lib/types/contract';
import type { Snapshot } from '../lib/types/market';
import { priceDirection } from '../lib/price-direction';
import { buildQuoteSummaryMetrics } from '../lib/quote-summary';
import { fmtPct, fmtPrice, fmtSigned } from '../lib/utils/format';
import * as panel from './panel.css';
import * as styles from './quote-board.css';

export function QuoteBoard({
    contract,
    snapshot,
}: {
    contract: ContractInfo;
    snapshot?: Snapshot;
}) {
    const quote = useQuote(contract.code);
    const tick = quote?.tick;
    const index = quote?.index;
    const isIndex = contract.security_type === 'IND';

    const close = tick
        ? Number(tick.close)
        : index
          ? Number(index.close)
          : snapshot?.close;
    const ref = index ? Number(index.reference) : contract.reference;
    const chg = tick?.price_chg
        ? Number(tick.price_chg)
        : index
          ? Number(index.close) - Number(index.reference)
        : snapshot?.change_price;
    // NEVER use tick.pct_chg — its unit differs between stk (％×100) and
    // fop (％) streams; derive from the price change and reference instead
    const pct =
        chg !== undefined && ref
            ? (chg / ref) * 100
            : snapshot?.change_rate;
    const open = tick
        ? Number(tick.open)
        : index
          ? Number(index.open)
          : snapshot?.open;
    const high = tick
        ? Number(tick.high)
        : index
          ? Number(index.high)
          : snapshot?.high;
    const low = tick
        ? Number(tick.low)
        : index
          ? Number(index.low)
          : snapshot?.low;
    const vol =
        tick?.total_volume ??
        index?.vol_sum ??
        index?.volume ??
        snapshot?.total_volume;
    const bidask = quote?.bidask;
    const bid1 = bidask ? Number(bidask.bid_price[0]) : undefined;
    const ask1 = bidask ? Number(bidask.ask_price[0]) : undefined;

    const dir = priceDirection(close, ref);
    const atLimit =
        !isIndex && close !== undefined && contract.limit_up > 0
            ? close >= contract.limit_up
                ? 'up'
                : contract.limit_down > 0 && close <= contract.limit_down
                  ? 'down'
                  : null
            : null;
    const metrics = buildQuoteSummaryMetrics({
        isIndex,
        reference: validPrice(ref),
        open: validPrice(open),
        high: validPrice(high),
        low: validPrice(low),
        volume: validNumber(vol),
        limitUp: validPrice(contract.limit_up),
        limitDown: validPrice(contract.limit_down),
        time: (isIndex ? index?.time : tick?.time)?.slice(0, 8),
        bid: validPrice(bid1),
        bidVolume: bidask ? validNumber(bidask.bid_volume[0]) : undefined,
        ask: validPrice(ask1),
        askVolume: bidask ? validNumber(bidask.ask_volume[0]) : undefined,
        raiseCount: validNumber(index?.raise_count),
        flatCount: validNumber(index?.flat_count),
        fallCount: validNumber(index?.fall_count),
        limitUpCount: validNumber(index?.limit_up_count),
        noTradeCount: validNumber(index?.no_trade),
        limitDownCount: validNumber(index?.limit_down_count),
    });

    return (
        <div className={`${styles.board} drag-handle`}>
            <div className={styles.boardLayout}>
                <div
                    className={styles.hero}
                    data-quote-hero={isIndex ? 'index' : 'market'}
                >
                    <span
                        className={styles.symbolCode}
                        data-quote-field='symbol'
                    >
                        {contract.code}
                    </span>

                    <div
                        className={styles.priceBlock}
                        data-quote-field='price'
                    >
                        <span className={styles.bigPrice[dir]}>
                            {fmtPrice(close)}
                        </span>
                        {atLimit && (
                            <span className={styles.limitBadge[atLimit]}>
                                {atLimit === 'up' ? '漲停' : '跌停'}
                            </span>
                        )}
                    </div>

                    <span
                        className={styles.symbolName}
                        data-quote-field='name'
                    >
                        {contract.name}
                    </span>

                    <div
                        className={`${styles.changeBlock} ${panel.dirText[dir]}`}
                        data-quote-field='change'
                    >
                        <span>{fmtSigned(chg)}</span>
                        <span>{fmtPct(pct)}</span>
                    </div>
                </div>

                <div
                    className={styles.statGrid}
                    aria-label='行情摘要'
                    data-quote-summary={isIndex ? 'index' : 'market'}
                >
                    {metrics.map((metric) => (
                        <span
                            key={metric.key}
                            className={styles.statMetric}
                            data-metric={metric.key}
                            data-tone={metric.tone}
                        >
                            <span className={styles.statLabel}>
                                {metric.label}
                            </span>
                            <span
                                className={styles.statValue[metric.tone]}
                            >
                                {metric.value}
                            </span>
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

function validNumber(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

function validPrice(value: number | undefined): number | undefined {
    const valid = validNumber(value);
    return valid !== undefined && valid > 0 ? valid : undefined;
}
