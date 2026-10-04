/** API 與 immutable publication 的來源摘要契約；沒有 fetch／Node runtime 依賴。 */
import { BOLLINGER_SOURCE_POLICY_VERSION, SCREENER_V8_MAPPING_VERSION } from './stock-screener-v8.ts';
import { validBollingerDate } from './stock-screener-bollinger-source.ts';
export interface BollingerSourceManifest {
    policyVersion: typeof BOLLINGER_SOURCE_POLICY_VERSION; universeRevision: string; universeHash: string;
    market: 'TWSE' | 'TPEx'; sessionDate: string; provider: 'official-twse' | 'official-tpex' | 'shioaji-daily-quotes';
    mappingVersion: string; manifestHash: string; payloadHash: string; reviewId: string; reviewHash: string;
    requestedDate: string; actualDate: string; switchReason: string | null; rowsHash: string; rowCount: number;
    officialFailures: Array<{ id: string; hash: string; reason: string }>;
    [key: string]: unknown;
}
export interface BollingerSourceEvidence {
    manifest: { policyVersion: typeof BOLLINGER_SOURCE_POLICY_VERSION; universeRevision: string; universeHash: string;
        entries: Array<{ sessionDate: string; market: 'TWSE' | 'TPEx'; manifestHash: string }> };
    manifestHash: string; selections: BollingerSourceManifest[];
}
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function validBollingerSourceEvidence(v: BollingerSourceEvidence, mapping: string, sessions?: string[]) {
    if (!v || !hash(v.manifestHash) || mapping !== `${BOLLINGER_SOURCE_POLICY_VERSION}:${v.manifestHash}`
        || v.manifest?.policyVersion !== BOLLINGER_SOURCE_POLICY_VERSION || !hash(v.manifest.universeHash)
        || typeof v.manifest.universeRevision !== 'string' || !v.manifest.universeRevision
        || !Array.isArray(v.manifest.entries) || !v.manifest.entries.length || v.manifest.entries.length > 800
        || !Array.isArray(v.selections) || v.selections.length !== v.manifest.entries.length) return false;
    const dates = [...new Set(v.manifest.entries.map(e => e.sessionDate))];
    if (dates.length * 2 !== v.manifest.entries.length || dates.some((d,i) => !validBollingerDate(d) || i > 0 && d <= dates[i-1]!)
        || sessions && JSON.stringify(dates) !== JSON.stringify(sessions)) return false;
    return v.manifest.entries.every((e, i) => {
        const s = v.selections[i]; if (!s) return false;
        return e.sessionDate === dates[Math.floor(i/2)] && e.market === (i % 2 === 0 ? 'TWSE' : 'TPEx') && hash(e.manifestHash)
            && s.policyVersion === BOLLINGER_SOURCE_POLICY_VERSION && s.manifestHash === e.manifestHash
            && s.universeRevision === v.manifest.universeRevision && s.universeHash === v.manifest.universeHash
            && s.market === e.market && s.sessionDate === e.sessionDate && s.actualDate === e.sessionDate && s.requestedDate === e.sessionDate
            && hash(s.payloadHash) && hash(s.reviewId) && hash(s.reviewHash) && hash(s.rowsHash)
            && Number.isInteger(s.rowCount) && s.rowCount > 0 && s.rowCount <= 10000
            && (s.provider === 'shioaji-daily-quotes' ? ['shioaji-daily-quotes-shares-twd-v1', 'shioaji-daily-quotes-shares-twd-v2'].includes(s.mappingVersion)
                && ['official_contract_pending','official_source_failed','official_source_cooldown'].includes(s.switchReason ?? '')
                : s.provider === (e.market === 'TWSE' ? 'official-twse' : 'official-tpex') && s.mappingVersion === SCREENER_V8_MAPPING_VERSION && s.switchReason === null)
            && Array.isArray(s.officialFailures) && s.officialFailures.length <= 18
            && s.officialFailures.every(f => typeof f.id === 'string' && hash(f.hash) && /^(?:source|invalid)_\w{1,80}$/.test(f.reason));
    });
}
