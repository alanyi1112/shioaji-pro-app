import type { ScannerItem, Snapshot } from './types/market';

export type QuotePickHandler = (code: string, snapshot?: Snapshot) => void;

export function scannerItemToSnapshot(
    item: ScannerItem,
    exchange: string,
): Snapshot {
    const reference = item.close - item.change_price;
    return {
        code: item.code,
        exchange,
        datetime: item.date,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        average_price: item.average_price,
        buy_price: item.buy_price,
        buy_volume: 0,
        sell_price: item.sell_price,
        sell_volume: 0,
        volume: 0,
        total_volume: item.total_volume,
        amount: 0,
        total_amount: item.total_amount,
        change_price: item.change_price,
        change_rate:
            Number.isFinite(reference) && reference > 0
                ? (item.change_price / reference) * 100
                : 0,
        change_type: String(item.change_type),
        tick_type: String(item.tick_type),
        volume_ratio: item.volume_ratio,
        yesterday_volume: item.yesterday_volume,
    };
}
