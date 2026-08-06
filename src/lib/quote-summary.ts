import type { PriceDirection } from './price-direction';
import { priceDirection } from './price-direction';
import { fmtInt, fmtPrice } from './utils/format';

export type QuoteMetricTone = PriceDirection | 'neutral';

export interface QuoteSummaryMetric {
    key: string;
    label: string;
    value: string;
    tone: QuoteMetricTone;
}

export interface QuoteSummaryValues {
    isIndex: boolean;
    reference?: number;
    open?: number;
    high?: number;
    low?: number;
    volume?: number;
    limitUp?: number;
    limitDown?: number;
    time?: string;
    bid?: number;
    bidVolume?: number;
    ask?: number;
    askVolume?: number;
    raiseCount?: number;
    flatCount?: number;
    fallCount?: number;
    limitUpCount?: number;
    noTradeCount?: number;
    limitDownCount?: number;
}

function metric(
    key: string,
    label: string,
    value: string,
    tone: QuoteMetricTone = 'neutral',
): QuoteSummaryMetric {
    return { key, label, value, tone };
}

function priceMetric(
    key: string,
    label: string,
    value: number | undefined,
    reference: number | undefined,
): QuoteSummaryMetric {
    return metric(
        key,
        label,
        fmtPrice(value),
        priceDirection(value, reference),
    );
}

export function buildQuoteSummaryMetrics(
    values: QuoteSummaryValues,
): QuoteSummaryMetric[] {
    const {
        reference,
        open,
        high,
        low,
        volume,
        limitUp,
        limitDown,
        time,
    } = values;

    const firstRow = [
        priceMetric('open', '開', open, reference),
        priceMetric('high', '高', high, reference),
        priceMetric('low', '低', low, reference),
        metric('volume', '量', fmtInt(volume)),
    ];

    if (values.isIndex) {
        return [
            ...firstRow,
            metric('reference', '參考', fmtPrice(reference), 'flat'),
            metric('raise-count', '上漲', fmtInt(values.raiseCount), 'up'),
            metric('flat-count', '平盤', fmtInt(values.flatCount), 'flat'),
            metric('fall-count', '下跌', fmtInt(values.fallCount), 'down'),
            metric(
                'limit-up-count',
                '漲停',
                fmtInt(values.limitUpCount),
                'up',
            ),
            metric('no-trade-count', '未成交', fmtInt(values.noTradeCount)),
            metric(
                'limit-down-count',
                '跌停',
                fmtInt(values.limitDownCount),
                'down',
            ),
            metric('time', '時間', time ?? '—'),
        ];
    }

    return [
        ...firstRow,
        metric('reference', '參考', fmtPrice(reference), 'flat'),
        priceMetric('limit-up', '漲停', limitUp, reference),
        priceMetric('limit-down', '跌停', limitDown, reference),
        metric('time', '時間', time ?? '—'),
        priceMetric('bid', '委買', values.bid, reference),
        metric('bid-volume', '買量', fmtInt(values.bidVolume)),
        priceMetric('ask', '委賣', values.ask, reference),
        metric('ask-volume', '賣量', fmtInt(values.askVolume)),
    ];
}
