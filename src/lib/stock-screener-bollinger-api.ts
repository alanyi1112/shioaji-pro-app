import { validateCriteriaV8, validateBollingerSqueeze, type CriteriaV8, type BollingerSqueezeCriteria, type BollingerOutcome,
    SCREENER_V8_FORMULA_VERSION, SCREENER_V8_MAPPING_VERSION, validBollingerMapping, countBollingerStages } from './stock-screener-v8.ts';
import { validBollingerSourceEvidence, type BollingerSourceEvidence } from './stock-screener-source-evidence.ts';
import type { BollingerSortKey } from './stock-screener-bollinger-query';
import { validBollingerDate } from './stock-screener-bollinger-source.ts';
import type { UniverseStock, Verdict } from './stock-screener-domain';
import { BOLLINGER_SOURCE_COMPARISON_POLICY, BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY, compareSourceVolume, compareSourceTurnover,
    type SourceVolumeDifference, type SourceTurnoverDifference } from './stock-screener-source-comparison.ts';
export const BOLLINGER_PREFS = 'sj-pro-stock-screener-v8';
export interface BollingerQueryDraft { criteria: CriteriaV8; sort: BollingerSortKey; direction: 'asc' | 'desc'; resultState: 'matched' | 'unknown' | 'notMatched' | 'all'; stage?: 'all' | BollingerOutcome['stage'] }
export interface BollingerDailyProfileView { revision: number; enabled: boolean; criteria: CriteriaV8; createdAt: string }
export interface BollingerResultRow extends Omit<UniverseStock, 'kind'> { ordinary: boolean; verdict: Verdict; outcome: BollingerOutcome; legacyEvidence: unknown }
export interface BollingerResponse {
    version: 8; state: 'ready' | 'pending' | 'stale' | 'unavailable' | 'history_pending'; reason?: string;
    sourceEvidence?: BollingerSourceEvidence;
    sourceConflicts?: Array<{ id: string; market: 'TWSE' | 'TPEx'; sessionDate: string; provider: string;
        frozenPayloadHash: string; officialPayloadHash: string }>;
    sourceVolumeTolerances?: Array<{ id: string; market: 'TWSE' | 'TPEx'; sessionDate: string; provider: string;
        frozenPayloadHash: string; officialPayloadHash: string; comparisonPolicyVersion: string; volumeTolerancePercent: number;
        turnoverToleranceNtd?: number; toleratedSymbols: number;
        samples: Array<{ symbol: string; volumeDifferences: SourceVolumeDifference[]; turnoverDifferences?: SourceTurnoverDifference[] }> }>;
    snapshotId: string | null; expectedSessionDate: string | null; effectiveSessionDate: string | null;
    canUseResults?: boolean; rows: BollingerResultRow[]; nextCursor: string | null;
    counts?: ReturnType<typeof countBollingerStages>; combinationCounts?: { total: number; matched: number; notMatched: number; unknown: number };
    filteredCount?: number; profile?: BollingerDailyProfileView | null; requiredDays?: number; availableDays?: number;
    preparation?: { reason?: string; plannedDays?: number; requiredDays?: number; availableDays?: number; nextAttemptAt?: string | null } | null;
    legacyJoin?: { reason: string; enabled: string[]; snapshotId: string | null } | null;
}
export function isBollingerQueryDraft(value: unknown): value is BollingerQueryDraft {
    const q = value as BollingerQueryDraft;
    return !!q && validateCriteriaV8(q.criteria) && ['code', 'bbw', 'percentilePosition', 'b', 'breakoutVolumeRatio', 'momentum'].includes(q.sort)
        && ['asc', 'desc'].includes(q.direction) && ['matched', 'unknown', 'notMatched', 'all'].includes(q.resultState)
        && (q.stage === undefined || ['all', 'breakout', 'preparing', 'compressing', 'unknown', 'notMatched'].includes(q.stage));
}
export function loadBollingerPreference(storage: Pick<Storage, 'getItem'>): BollingerQueryDraft | null {
    try { const saved = JSON.parse(storage.getItem(BOLLINGER_PREFS) ?? 'null');
        return saved?.version === 8 && isBollingerQueryDraft(saved.query) ? saved.query : null; } catch { return null; }
}
export function bollingerSearch(query: BollingerQueryDraft, cursor?: string, snapshotId?: string) {
    if (!isBollingerQueryDraft(query) || !query.criteria.bollSqueezeStages.enabled) throw new Error('invalid_bollinger_query');
    return new URLSearchParams({ version: '8', criteria: JSON.stringify(query.criteria), sort: query.sort, direction: query.direction,
        resultState: query.resultState, stage: query.stage ?? 'all', limit: '20', ...(cursor ? { cursor } : {}), ...(snapshotId ? { snapshotId } : {}) }).toString();
}
const countValid = (c: Record<string, number>, keys: string[]) => c && keys.every(k => Number.isSafeInteger(c[k]) && c[k]! >= 0)
    && keys.filter(k => k !== 'total').reduce((n, k) => n + c[k]!, 0) === c.total;
const optionalFinite = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value);
export function decodeBollingerResponse(value: unknown): BollingerResponse {
    const r = value as BollingerResponse & { formulaVersion: string; sourceMappingVersion: string };
    if (!r || r.version !== 8 || !['ready', 'pending', 'stale', 'unavailable', 'history_pending'].includes(r.state)
        || r.formulaVersion !== SCREENER_V8_FORMULA_VERSION || !validBollingerMapping(r.sourceMappingVersion)
        || !Array.isArray(r.rows) || r.rows.length > 100 || new Set(r.rows.map(row => row.symbol)).size !== r.rows.length
        || r.nextCursor !== null && (typeof r.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(r.nextCursor))
        || r.effectiveSessionDate !== null && !validBollingerDate(r.effectiveSessionDate)
        || r.expectedSessionDate !== null && !validBollingerDate(r.expectedSessionDate)) throw new Error('invalid_v8_response');
    if (r.counts) {
        const keys = ['total', 'compressing', 'preparing', 'breakout', 'unknown', 'notMatched'];
        if (!countValid(r.counts.total, keys) || !countValid(r.counts.markets?.TWSE, keys) || !countValid(r.counts.markets?.TPEx, keys)
            || keys.some(k => r.counts!.total[k as keyof typeof r.counts.total] !== r.counts!.markets.TWSE[k as keyof typeof r.counts.total]
                + r.counts!.markets.TPEx[k as keyof typeof r.counts.total])) throw new Error('invalid_v8_response');
    }
    if (r.combinationCounts && !countValid(r.combinationCounts, ['total', 'matched', 'notMatched', 'unknown'])) throw new Error('invalid_v8_response');
    if (r.rows.some(row => !row.name || !/^[A-Z0-9]{4,12}$/.test(row.code) || !['TWSE', 'TPEx'].includes(row.market)
        || row.symbol !== `${row.code}.${row.market === 'TWSE' ? 'TW' : 'TWO'}` || row.ordinary !== true
        || !['pass', 'fail', 'unknown'].includes(row.verdict) || !['breakout', 'preparing', 'compressing', 'unknown', 'notMatched'].includes(row.outcome?.stage)
        || row.outcome.formulaVersion !== SCREENER_V8_FORMULA_VERSION || row.outcome.sourceMappingVersion !== r.sourceMappingVersion
        || row.outcome.date !== r.effectiveSessionDate || !row.outcome.setup || !Array.isArray(row.outcome.recentSetups)
        || !optionalFinite(row.outcome.setup.bbw) || !optionalFinite(row.outcome.setup.b)
        || !row.outcome.setup.gate || !row.outcome.setup.compression || !row.outcome.breakoutChecks
        || !/^[a-f0-9]{64}$/.test(row.outcome.sourceEvidenceHash))) throw new Error('invalid_v8_response');
    if (r.state === 'ready' && (!r.effectiveSessionDate || !/^[\w-]{36}$/.test(r.snapshotId ?? '') || r.canUseResults !== true)) throw new Error('invalid_v8_response');
    if (r.sourceMappingVersion !== SCREENER_V8_MAPPING_VERSION
        ? !r.sourceEvidence || !validBollingerSourceEvidence(r.sourceEvidence, r.sourceMappingVersion)
            || r.sourceEvidence.manifest.entries.at(-1)?.sessionDate !== r.effectiveSessionDate
        : r.sourceEvidence !== undefined) throw new Error('invalid_v8_response');
    if (r.sourceConflicts !== undefined && (!Array.isArray(r.sourceConflicts) || r.sourceConflicts.length > 800
        || r.sourceConflicts.some(c => !/^[a-f0-9]{64}$/.test(c.id) || !validBollingerDate(c.sessionDate)
            || c.provider !== (c.market === 'TWSE' ? 'official-twse' : 'official-tpex')
            || !['TWSE','TPEx'].includes(c.market) || !/^[a-f0-9]{64}$/.test(c.frozenPayloadHash)
            || !/^[a-f0-9]{64}$/.test(c.officialPayloadHash)
            || !r.sourceEvidence?.selections.some(s => s.sessionDate === c.sessionDate && s.market === c.market
                && s.payloadHash === c.frozenPayloadHash)))) throw new Error('invalid_v8_response');
    if (r.sourceVolumeTolerances !== undefined) {
        if (!Array.isArray(r.sourceVolumeTolerances) || r.sourceVolumeTolerances.length > 800) throw new Error('invalid_v8_response');
        for (const c of r.sourceVolumeTolerances) {
            const amountPolicy=c?.comparisonPolicyVersion===BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY.version;
            if (!c || !/^[a-f0-9]{64}$/.test(c.id) || !validBollingerDate(c.sessionDate) || !['TWSE', 'TPEx'].includes(c.market)
                || c.provider !== (c.market === 'TWSE' ? 'official-twse' : 'official-tpex')
                || !/^[a-f0-9]{64}$/.test(c.frozenPayloadHash) || !/^[a-f0-9]{64}$/.test(c.officialPayloadHash)
                || !r.sourceEvidence?.selections.some(s => s.sessionDate === c.sessionDate && s.market === c.market && s.payloadHash === c.frozenPayloadHash)
                || !amountPolicy&&c.comparisonPolicyVersion !== BOLLINGER_SOURCE_COMPARISON_POLICY.version || c.volumeTolerancePercent !== 1
                || (amountPolicy? c?.turnoverToleranceNtd!==1 : c?.turnoverToleranceNtd!==undefined)
                || !Number.isSafeInteger(c.toleratedSymbols) || c.toleratedSymbols < 1 || c.toleratedSymbols > 10000
                || !Array.isArray(c.samples) || c.samples.length !== Math.min(c.toleratedSymbols, 20)
                || new Set(c.samples.map(s => s.symbol)).size !== c.samples.length) throw new Error('invalid_v8_response');
            for (const sample of c.samples) {
                if (!new RegExp(`^[A-Z0-9]{4,12}\\.${c.market === 'TWSE' ? 'TW' : 'TWO'}$`).test(sample.symbol)
                    || !Array.isArray(sample.volumeDifferences) || sample.volumeDifferences.length > 2
                    || (amountPolicy ? !Array.isArray(sample.turnoverDifferences)||sample.turnoverDifferences.length>2
                        || sample.volumeDifferences.length+sample.turnoverDifferences.length<1
                        : !sample.volumeDifferences.length||sample.turnoverDifferences!==undefined)
                    || new Set(sample.volumeDifferences.map(v => v.field)).size !== sample.volumeDifferences.length) throw new Error('invalid_v8_response');
                for (const v of sample.volumeDifferences) {
                    try {
                        const actual = compareSourceVolume(v.frozenShares, v.officialShares);
                        if (!['sourceAmounts.volumeShares', 'bar.volumeShares'].includes(v.field) || !actual.withinTolerance
                            || actual.absoluteDifferenceShares === '0' || v.withinTolerance !== true
                            || v.absoluteDifferenceShares !== actual.absoluteDifferenceShares) throw new Error('invalid_v8_response');
                    } catch { throw new Error('invalid_v8_response'); }
                }
                if(amountPolicy) {
                    if(new Set(sample.turnoverDifferences!.map(v=>v.field)).size!==sample.turnoverDifferences!.length) throw new Error('invalid_v8_response');
                    for(const v of sample.turnoverDifferences!) {
                        try {const actual=compareSourceTurnover(v.frozenNtd,v.officialNtd);
                            if(!['sourceAmounts.turnoverNtd','bar.turnoverNtd'].includes(v.field)||!actual.withinTolerance
                                ||actual.absoluteDifferenceNtd==='0'||v.withinTolerance!==true
                                ||v.absoluteDifferenceNtd!==actual.absoluteDifferenceNtd)throw new Error('invalid_v8_response');
                        }catch{throw new Error('invalid_v8_response');}
                    }
                }
            }
        }
    }
    if (r.state !== 'ready' && r.canUseResults === true) throw new Error('invalid_v8_response');
    if (r.rows.length && (!r.counts || !r.combinationCounts || typeof r.canUseResults !== 'boolean')) throw new Error('invalid_v8_response');
    return r;
}
export const validateBollingerDraft = (value: BollingerSqueezeCriteria) => validateBollingerSqueeze(value);
