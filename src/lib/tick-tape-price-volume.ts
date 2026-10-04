import type { TickTapeRow } from './tick-tape-large-trade';

export type PriceVolumeMarker = 'high' | 'current' | 'open' | 'low';

export interface PriceVolumeBucket {
    price: number;
    totalVolume: number;
    buyVolume: number;
    sellVolume: number;
    unknownVolume: number;
    largeVolume: number;
}

export interface PriceVolumeDistributionRow extends PriceVolumeBucket {
    totalShare: number;
    largeShare: number;
    barRatio: number;
    markers: PriceVolumeMarker[];
}

export interface PriceVolumeDistributionSnapshot {
    revision: number;
    totalVolume: number;
    largeVolume: number;
    totalAveragePrice: number | null;
    largeAveragePrice: number | null;
    maximumBucketVolume: number;
    openPrice: number | null;
    currentPrice: number | null;
    highPrice: number | null;
    lowPrice: number | null;
    rows: PriceVolumeDistributionRow[];
}

type DistributionInput = Pick<
    TickTapeRow,
    | 'contractKey'
    | 'time'
    | 'close'
    | 'volume'
    | 'tickType'
    | 'intradayOdd'
    | 'simtrade'
    | 'isLarge'
>;

interface MutableBucket extends PriceVolumeBucket {
    priceCents: number;
}

const emptySnapshot: PriceVolumeDistributionSnapshot = Object.freeze({
    revision: 0,
    totalVolume: 0,
    largeVolume: 0,
    totalAveragePrice: null,
    largeAveragePrice: null,
    maximumBucketVolume: 0,
    openPrice: null,
    currentPrice: null,
    highPrice: null,
    lowPrice: null,
    rows: Object.freeze([]) as unknown as PriceVolumeDistributionRow[],
});

function eligible(input: DistributionInput): boolean {
    const [securityType, exchange] = input.contractKey.split(':');
    return securityType === 'STK'
        && (exchange === 'TSE' || exchange === 'OTC')
        && Number.isFinite(input.close)
        && input.close > 0
        && Number.isFinite(input.volume)
        && input.volume > 0
        && input.intradayOdd !== true
        && input.simtrade !== true
        && input.time >= '09:00:00.000000'
        && input.time < '14:00:00.000000';
}

function markersFor(
    price: number,
    openPrice: number,
    currentPrice: number,
    highPrice: number,
    lowPrice: number,
): PriceVolumeMarker[] {
    const markers: PriceVolumeMarker[] = [];
    if (price === highPrice) markers.push('high');
    if (price === currentPrice) markers.push('current');
    if (price === openPrice) markers.push('open');
    if (price === lowPrice) markers.push('low');
    return markers;
}

export class PriceVolumeDistributionAccumulator {
    private buckets = new Map<number, MutableBucket>();
    private totalVolume = 0;
    private largeVolume = 0;
    private totalPriceVolumeCents = 0;
    private largePriceVolumeCents = 0;
    private openPriceCents: number | null = null;
    private currentPriceCents: number | null = null;
    private highPriceCents: number | null = null;
    private lowPriceCents: number | null = null;
    private revision = 0;
    private cached: PriceVolumeDistributionSnapshot = emptySnapshot;

    append(input: DistributionInput): boolean {
        if (!eligible(input)) return false;
        const priceCents = Math.round(input.close * 100);
        if (!Number.isSafeInteger(priceCents) || priceCents <= 0) return false;
        const price = priceCents / 100;
        const volume = Number(input.volume);
        const bucket = this.buckets.get(priceCents) ?? {
            priceCents,
            price,
            totalVolume: 0,
            buyVolume: 0,
            sellVolume: 0,
            unknownVolume: 0,
            largeVolume: 0,
        };
        bucket.totalVolume += volume;
        if (input.tickType === 1) bucket.buyVolume += volume;
        else if (input.tickType === 2) bucket.sellVolume += volume;
        else bucket.unknownVolume += volume;
        if (input.isLarge) bucket.largeVolume += volume;
        this.buckets.set(priceCents, bucket);

        this.totalVolume += volume;
        this.totalPriceVolumeCents += priceCents * volume;
        if (input.isLarge) {
            this.largeVolume += volume;
            this.largePriceVolumeCents += priceCents * volume;
        }
        this.openPriceCents ??= priceCents;
        this.currentPriceCents = priceCents;
        this.highPriceCents = this.highPriceCents === null
            ? priceCents
            : Math.max(this.highPriceCents, priceCents);
        this.lowPriceCents = this.lowPriceCents === null
            ? priceCents
            : Math.min(this.lowPriceCents, priceCents);
        this.revision += 1;
        return true;
    }

    snapshot(): PriceVolumeDistributionSnapshot {
        if (this.cached.revision === this.revision) return this.cached;
        if (
            this.totalVolume <= 0 ||
            this.openPriceCents === null ||
            this.currentPriceCents === null ||
            this.highPriceCents === null ||
            this.lowPriceCents === null
        ) {
            this.cached = { ...emptySnapshot, revision: this.revision };
            return this.cached;
        }
        const maximumBucketVolume = Math.max(
            0,
            ...[...this.buckets.values()].map((bucket) => bucket.totalVolume),
        );
        const openPrice = this.openPriceCents / 100;
        const currentPrice = this.currentPriceCents / 100;
        const highPrice = this.highPriceCents / 100;
        const lowPrice = this.lowPriceCents / 100;
        const rows = [...this.buckets.values()]
            .sort((left, right) => right.priceCents - left.priceCents)
            .map(({ priceCents: _priceCents, ...bucket }) => ({
                ...bucket,
                totalShare: bucket.totalVolume / this.totalVolume,
                largeShare: bucket.largeVolume / this.totalVolume,
                barRatio: maximumBucketVolume > 0
                    ? bucket.totalVolume / maximumBucketVolume
                    : 0,
                markers: markersFor(
                    bucket.price,
                    openPrice,
                    currentPrice,
                    highPrice,
                    lowPrice,
                ),
            }));
        this.cached = {
            revision: this.revision,
            totalVolume: this.totalVolume,
            largeVolume: this.largeVolume,
            totalAveragePrice:
                this.totalPriceVolumeCents / this.totalVolume / 100,
            largeAveragePrice: this.largeVolume > 0
                ? this.largePriceVolumeCents / this.largeVolume / 100
                : null,
            maximumBucketVolume,
            openPrice,
            currentPrice,
            highPrice,
            lowPrice,
            rows,
        };
        return this.cached;
    }
}
