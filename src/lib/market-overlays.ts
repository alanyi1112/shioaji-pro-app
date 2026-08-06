import { chronologicalCandles, roundReference } from './indicators';
import type { Candle } from './types/market';

export const FVG_FORMULA_VERSION = 'multichart-ecae7ca-fvg-v1';
export const FIXED_VOLUME_PROFILE_VERSION =
    'multichart-ecae7ca-fixed-volume-profile-v1';

export interface FvgZone {
    id: string;
    direction: 'bullish' | 'bearish';
    startTime: number;
    endTime: number;
    lower: number;
    upper: number;
    fullyMitigated: boolean;
    mitigatedTime?: number;
}

export interface FvgMarker {
    time: number;
    direction: 'bullish' | 'bearish';
    price: number;
}

export function detectFairValueGaps(bars: Candle[]): {
    markers: FvgMarker[];
    zones: FvgZone[];
} {
    const rows = chronologicalCandles(bars);
    const allZones: FvgZone[] = [];
    const markers: FvgMarker[] = [];
    for (let index = 2; index < rows.length; index++) {
        const first = rows[index - 2]!;
        const current = rows[index]!;
        let zone: FvgZone | null = null;
        if (current.low > first.high) {
            zone = {
                id: `bullish-${current.time}-${first.high}-${current.low}`,
                direction: 'bullish',
                startTime: first.time,
                endTime: rows[rows.length - 1]!.time,
                lower: roundReference(first.high),
                upper: roundReference(current.low),
                fullyMitigated: false,
            };
            markers.push({
                time: current.time,
                direction: 'bullish',
                price: current.low,
            });
        } else if (current.high < first.low) {
            zone = {
                id: `bearish-${current.time}-${current.high}-${first.low}`,
                direction: 'bearish',
                startTime: first.time,
                endTime: rows[rows.length - 1]!.time,
                lower: roundReference(current.high),
                upper: roundReference(first.low),
                fullyMitigated: false,
            };
            markers.push({
                time: current.time,
                direction: 'bearish',
                price: current.high,
            });
        }
        if (!zone) continue;
        for (let later = index + 1; later < rows.length; later++) {
            const candidate = rows[later]!;
            const filled =
                zone.direction === 'bullish'
                    ? candidate.low <= zone.lower
                    : candidate.high >= zone.upper;
            if (!filled) continue;
            zone.fullyMitigated = true;
            zone.mitigatedTime = candidate.time;
            zone.endTime = candidate.time;
            break;
        }
        allZones.push(zone);
    }
    return {
        markers: markers.slice(-20),
        zones: allZones.filter((zone) => !zone.fullyMitigated).slice(-12),
    };
}

export interface FixedRangeAnchors {
    startTime: number;
    endTime: number;
}

export function normalizeFixedRange(
    firstTime: number,
    secondTime: number,
): FixedRangeAnchors {
    if (!Number.isFinite(firstTime) || !Number.isFinite(secondTime)) {
        throw new RangeError('fixed-range-anchor:non-finite');
    }
    return {
        startTime: Math.min(firstTime, secondTime),
        endTime: Math.max(firstTime, secondTime),
    };
}

export interface VolumeProfileBin {
    index: number;
    lower: number;
    upper: number;
    volume: number;
}

export interface FixedVolumeProfile {
    anchors: FixedRangeAnchors;
    bins: VolumeProfileBin[];
    totalVolume: number;
    poc: number;
    vah: number;
    val: number;
}

export function fixedRangeVolumeProfile(
    bars: Candle[],
    anchors: FixedRangeAnchors,
    binCount = 24,
    valueAreaRatio = 0.7,
): FixedVolumeProfile | null {
    if (!Number.isInteger(binCount) || binCount < 1 || binCount > 200) {
        throw new RangeError('volume-profile-bins:out-of-range');
    }
    if (
        !Number.isFinite(valueAreaRatio) ||
        valueAreaRatio <= 0 ||
        valueAreaRatio > 1
    ) {
        throw new RangeError('volume-profile-value-area:out-of-range');
    }
    const range = normalizeFixedRange(anchors.startTime, anchors.endTime);
    const rows = chronologicalCandles(bars).filter(
        (bar) => bar.time >= range.startTime && bar.time <= range.endTime,
    );
    if (rows.length === 0) return null;
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const bar of rows) {
        minimum = Math.min(minimum, bar.low);
        maximum = Math.max(maximum, bar.high);
    }
    const flat = maximum === minimum;
    const step = flat ? 0 : (maximum - minimum) / binCount;
    const volumes = Array.from({ length: binCount }, () => 0);
    for (const bar of rows) {
        const typicalPrice = (bar.high + bar.low + bar.close) / 3;
        const index = flat
            ? 0
            : Math.min(
                  binCount - 1,
                  Math.max(0, Math.floor((typicalPrice - minimum) / step)),
              );
        volumes[index] = volumes[index]! + bar.volume;
    }
    const bins = volumes.map((volume, index) => ({
        index,
        lower: roundReference(flat ? minimum : minimum + index * step),
        upper: roundReference(
            flat ? maximum : minimum + (index + 1) * step,
        ),
        volume: roundReference(volume),
    }));
    const totalVolume = volumes.reduce((sum, volume) => sum + volume, 0);
    let pocIndex = 0;
    for (let index = 1; index < volumes.length; index++) {
        if (volumes[index]! > volumes[pocIndex]!) pocIndex = index;
    }
    let lowIndex = pocIndex;
    let highIndex = pocIndex;
    let includedVolume = volumes[pocIndex]!;
    const target = totalVolume * valueAreaRatio;
    while (includedVolume < target && (lowIndex > 0 || highIndex < binCount - 1)) {
        const below = lowIndex > 0 ? volumes[lowIndex - 1]! : -1;
        const above = highIndex < binCount - 1 ? volumes[highIndex + 1]! : -1;
        if (above > below) {
            highIndex += 1;
            includedVolume += volumes[highIndex]!;
        } else {
            lowIndex -= 1;
            includedVolume += volumes[lowIndex]!;
        }
    }
    return {
        anchors: range,
        bins,
        totalVolume: roundReference(totalVolume),
        poc: roundReference((bins[pocIndex]!.lower + bins[pocIndex]!.upper) / 2),
        vah: bins[highIndex]!.upper,
        val: bins[lowIndex]!.lower,
    };
}
