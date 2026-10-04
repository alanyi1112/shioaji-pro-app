/** 來源相容性檢查，不修正原值、不改策略量能門檻；政策版本只屬新增比較收據。 */
export const BOLLINGER_SOURCE_COMPARISON_POLICY = Object.freeze({
    version: 'bollinger-source-comparison-volume-1pct-v1',
    volumeTolerancePercent: 1, denominator: 'official-volume', otherFields: 'exact',
} as const);
export const BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY = Object.freeze({
    version: 'bollinger-source-comparison-volume-1pct-turnover-1ntd-v2',
    volumeTolerancePercent: 1, denominator: 'official-volume', turnoverToleranceNtd: 1, otherFields: 'exact',
} as const);
export interface SourceTurnoverDifference {
    field: 'sourceAmounts.turnoverNtd' | 'bar.turnoverNtd'; frozenNtd: string; officialNtd: string;
    absoluteDifferenceNtd: string; withinTolerance: boolean;
}
export interface SourceComparisonValue {
    readiness: string;
    sourceAmounts: { volumeShares: string; turnoverNtd: string } | null;
    bar: { sessionDate: string; open: string | null; high: string | null; low: string | null;
        close: string | null; volumeShares: string; turnoverNtd: string } | null;
}
export interface SourceVolumeDifference {
    field: 'sourceAmounts.volumeShares' | 'bar.volumeShares'; frozenShares: string; officialShares: string;
    absoluteDifferenceShares: string; withinTolerance: boolean;
}
const int64 = (v: string) => {
    if (typeof v !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(v) || BigInt(v) > BigInt('9223372036854775807'))
        throw new Error('invalid_source_comparison_volume');
    return BigInt(v);
};
export function compareSourceVolume(frozenShares: string, officialShares: string) {
    const frozen = int64(frozenShares), official = int64(officialShares);
    const difference = frozen > official ? frozen - official : official - frozen;
    return { frozenShares, officialShares, absoluteDifferenceShares: difference.toString(),
        withinTolerance: official === BigInt(0) ? difference === BigInt(0) : difference * BigInt(100) <= official };
}
export function compareSourceTurnover(frozenNtd: string, officialNtd: string) {
    const f=int64(frozenNtd),o=int64(officialNtd),d=f>o?f-o:o-f;
    return {frozenNtd,officialNtd,absoluteDifferenceNtd:d.toString(),withinTolerance:d<=BigInt(1)};
}
function withoutVolume(v: SourceComparisonValue) {
    return { ...v, sourceAmounts: v.sourceAmounts ? { ...v.sourceAmounts, volumeShares: undefined } : null,
        bar: v.bar ? { ...v.bar, volumeShares: undefined } : null };
}
export function assessSourceComparison(frozen: SourceComparisonValue, official: SourceComparisonValue,
    policy: typeof BOLLINGER_SOURCE_COMPARISON_POLICY | typeof BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY = BOLLINGER_SOURCE_COMPARISON_POLICY) {
    if (![BOLLINGER_SOURCE_COMPARISON_POLICY, BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY]
        .some(p => JSON.stringify(p) === JSON.stringify(policy))) throw new Error('invalid_source_comparison_policy');
    const volumeDifferences: SourceVolumeDifference[] = [];
    for (const [key, field] of [['sourceAmounts', 'sourceAmounts.volumeShares'], ['bar', 'bar.volumeShares']] as const) {
        if (frozen[key] && official[key]) {
            const compared = compareSourceVolume(frozen[key].volumeShares, official[key].volumeShares);
            if (compared.absoluteDifferenceShares !== '0') volumeDifferences.push({ field, ...compared });
        }
    }
    const exact = JSON.stringify(frozen) === JSON.stringify(official);
    if (policy.version === BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY.version) {
        const turnoverDifferences: SourceTurnoverDifference[]=[];
        for(const [key,field] of [['sourceAmounts','sourceAmounts.turnoverNtd'],['bar','bar.turnoverNtd']] as const) {
            if(frozen[key]&&official[key]) {
                const c=compareSourceTurnover(frozen[key].turnoverNtd,official[key].turnoverNtd);
                if(c.absoluteDifferenceNtd!=='0')turnoverDifferences.push({field,...c});
            }
        }
        const rest=(v:SourceComparisonValue)=>{
            const r=withoutVolume(v);return {...r,sourceAmounts:r.sourceAmounts?{...r.sourceAmounts,turnoverNtd:undefined}:null,
                bar:r.bar?{...r.bar,turnoverNtd:undefined}:null};
        };
        const tolerated=!exact&&JSON.stringify(rest(frozen))===JSON.stringify(rest(official))
            && volumeDifferences.length+turnoverDifferences.length>0
            && volumeDifferences.every(d=>d.withinTolerance)&&turnoverDifferences.every(d=>d.withinTolerance);
        return {verdict:exact?'exact':tolerated?'within_source_tolerance':'conflict',volumeDifferences,turnoverDifferences} as const;
    }
    const tolerated = !exact && JSON.stringify(withoutVolume(frozen)) === JSON.stringify(withoutVolume(official))
        && volumeDifferences.length > 0 && volumeDifferences.every(v => v.withinTolerance);
    return { verdict: exact ? 'exact' : tolerated ? 'within_volume_tolerance' : 'conflict', volumeDifferences } as const;
}
