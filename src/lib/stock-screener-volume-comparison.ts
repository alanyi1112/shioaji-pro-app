export interface StockScreenerVolumeComparison {
    officialLots: string;
    snapshotLots: string;
    differenceLots: string;
}

export interface StockScreenerVolumeComparisonInput {
    officialShares: string | null;
    officialDate: string | null;
    snapshotLots: number | null;
    snapshotDate: string | null;
}

const INTEGER = /^\d+$/;

function formatThousands(value: string): string {
    return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatSharesAsLots(value: number): string {
    const negative = value < 0;
    const absolute = negative ? -value : value;
    const whole = Math.floor(absolute / 1000);
    const remainder = String(absolute % 1000).padStart(3, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${formatThousands(String(whole))}${remainder ? `.${remainder}` : ''}`;
}

export function stockScreenerVolumeComparison({
    officialShares,
    officialDate,
    snapshotLots,
    snapshotDate,
}: StockScreenerVolumeComparisonInput): StockScreenerVolumeComparison | null {
    if (!officialShares || !INTEGER.test(officialShares) || !officialDate || officialDate !== snapshotDate
        || snapshotLots === null || !Number.isSafeInteger(snapshotLots) || snapshotLots < 0) {
        return null;
    }
    const official = Number(officialShares);
    const snapshotShares = snapshotLots * 1000;
    const difference = official - snapshotShares;
    if (!Number.isSafeInteger(official) || !Number.isSafeInteger(snapshotShares) || !Number.isSafeInteger(difference)) {
        return null;
    }
    return {
        officialLots: formatSharesAsLots(official),
        snapshotLots: formatThousands(String(snapshotLots)),
        differenceLots: difference === 0 ? '0' : `${difference > 0 ? '+' : ''}${formatSharesAsLots(difference)}`,
    };
}
