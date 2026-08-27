import type { FuturesPriceType, StockPriceType } from './types/order';

export type DisplayPriceType = StockPriceType | FuturesPriceType;

const PRICE_TYPE_LABELS: Readonly<Record<DisplayPriceType, string>> =
    Object.freeze({
        LMT: '限價單',
        MKT: '市價單',
        MKP: '範圍市價',
    });

/**
 * 只轉換介面文案，不改寫送往 broker adapter 的 canonical price_type。
 * 自動化是否允許某一價別仍由獨立的 Runtime order-class matrix 決定。
 */
export function orderPriceTypeLabel(priceType: DisplayPriceType): string {
    return PRICE_TYPE_LABELS[priceType];
}
