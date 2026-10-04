import type { ContractBase } from './types/contract';
import {
    parseIntradayThreshold,
    type IntradayMonitorSource,
} from './intraday-relative-volume-monitor-domain';
import type {
    IntradayMonitorConfigItemView,
    IntradayMonitorConfigView,
} from './intraday-monitor-api';
import {
    decodeScreenerResponse,
    screenerSearchV3,
    screenerSearchV4,
    type ScreenerQueryV3,
} from './stock-screener-api';
import { isV4Preference } from './stock-screener-v4';

export const INTRADAY_MONITOR_DRAFT_LIMIT = 200;
const MAX_IMPORT_TOKENS = 500;
const CODE = /^\d{4,6}[A-Z]?$/;

export interface IntradayMonitorImportCandidate {
    code: string;
    source: IntradayMonitorSource;
}

export interface IntradayMonitorImportReport {
    accepted: IntradayMonitorConfigItemView[];
    duplicates: string[];
    invalid: string[];
    overLimit: string[];
}

export interface SavedScreenerSelection {
    codes: string[];
    state: 'ready' | 'partial';
}

export type ContractResolver = (code: string) => Promise<ContractBase>;

export function canonicalMonitorKey(item: IntradayMonitorConfigItemView) {
    return `${item.contract.exchange}:${item.contract.code}`;
}

export function cloneIntradayMonitorConfig(
    config: IntradayMonitorConfigView,
): IntradayMonitorConfigView {
    return {
        revision: config.revision,
        globalThreshold: config.globalThreshold,
        items: config.items.map((item) => ({
            ...item,
            contract: { ...item.contract },
        })),
    };
}

export function parseIntradayMonitorTokens(input: string): string[] {
    return input
        .split(/[\s,;，；]+/u)
        .map((token) => token.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, MAX_IMPORT_TOKENS)
        .map((token) => token
            .replace(/^(?:TSE|TWSE|OTC|TPEX):/u, '')
            .replace(/\.(?:TW|TWO)$/u, ''));
}

function canonicalContract(contract: ContractBase) {
    if (
        contract.security_type !== 'STK' ||
        contract.region !== 'TW' ||
        (contract.exchange !== 'TSE' && contract.exchange !== 'OTC') ||
        !CODE.test(contract.code) ||
        contract.target_code !== null
    ) return null;
    return {
        security_type: 'STK' as const,
        region: 'TW' as const,
        exchange: contract.exchange,
        code: contract.code,
        target_code: null,
    };
}

export async function resolveIntradayMonitorImport(
    current: readonly IntradayMonitorConfigItemView[],
    candidates: readonly IntradayMonitorImportCandidate[],
    resolveContract: ContractResolver,
): Promise<IntradayMonitorImportReport> {
    const report: IntradayMonitorImportReport = {
        accepted: [],
        duplicates: [],
        invalid: [],
        overLimit: [],
    };
    const existing = new Set(current.map(canonicalMonitorKey));
    const resolved = await Promise.all(candidates.slice(0, MAX_IMPORT_TOKENS).map(async (candidate) => {
        const code = candidate.code.trim().toUpperCase();
        if (!CODE.test(code)) return { candidate, contract: null };
        try {
            return { candidate, contract: canonicalContract(await resolveContract(code)) };
        } catch {
            return { candidate, contract: null };
        }
    }));

    for (const entry of resolved) {
        const label = entry.candidate.code.trim().toUpperCase();
        if (!entry.contract) {
            report.invalid.push(label);
            continue;
        }
        const key = `${entry.contract.exchange}:${entry.contract.code}`;
        if (existing.has(key)) {
            report.duplicates.push(entry.contract.code);
            continue;
        }
        if (current.length + report.accepted.length >= INTRADAY_MONITOR_DRAFT_LIMIT) {
            report.overLimit.push(entry.contract.code);
            continue;
        }
        existing.add(key);
        report.accepted.push({
            contract: entry.contract,
            enabled: true,
            thresholdOverride: null,
            source: entry.candidate.source,
        });
    }
    return report;
}

export function updateIntradayMonitorDraftItem(
    items: readonly IntradayMonitorConfigItemView[],
    key: string,
    patch: Partial<Pick<IntradayMonitorConfigItemView, 'enabled' | 'thresholdOverride'>>,
) {
    return items.map((item) => canonicalMonitorKey(item) === key
        ? { ...item, ...patch, contract: { ...item.contract } }
        : item);
}

export function removeIntradayMonitorDraftItem(
    items: readonly IntradayMonitorConfigItemView[],
    key: string,
) {
    return items.filter((item) => canonicalMonitorKey(item) !== key);
}

export function moveIntradayMonitorDraftItem(
    items: readonly IntradayMonitorConfigItemView[],
    key: string,
    direction: -1 | 1,
) {
    const next = [...items];
    const from = next.findIndex((item) => canonicalMonitorKey(item) === key);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= next.length) return next;
    [next[from], next[to]] = [next[to]!, next[from]!];
    return next;
}

export function canonicalIntradayThreshold(value: string) {
    return parseIntradayThreshold(value)?.decimal ?? null;
}

/**
 * Loads the latest result for the user's saved after-market screener query.
 * It is read-only and bounded to the monitor's 200-item capacity.
 */
export async function loadSavedAfterMarketScreenerSelection(
    storage: Pick<Storage, 'getItem'> = localStorage,
    fetcher: typeof fetch = fetch,
): Promise<SavedScreenerSelection> {
    let saved: unknown;
    try {
        saved = JSON.parse(storage.getItem('sj-pro-stock-screener-v4') ?? 'null');
    } catch {
        throw new Error('saved_screener_query_invalid');
    }
    if (!isV4Preference(saved)) throw new Error('saved_screener_query_missing');

    // Import the matched set even if the screener panel was last viewing its
    // fail/unknown diagnostic tab.
    const query = { ...saved.query, resultState: 'pass' as const };
    const needsV4 = query.criteria.ma.enabled || query.criteria.divergence.enabled;
    const codes: string[] = [];
    let cursor: string | undefined;
    let state: 'ready' | 'partial' | null = null;

    for (let page = 0; page < 4 && codes.length < INTRADAY_MONITOR_DRAFT_LIMIT; page += 1) {
        const search = needsV4
            ? screenerSearchV4({ ...query, cursor })
            : screenerSearchV3({
                ...query,
                criteria: query.criteria,
                sort: query.sort as ScreenerQueryV3['sort'],
                cursor,
            });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12_000);
        try {
            const response = await fetcher(`/api/stock-screener/results?${search}`, {
                credentials: 'same-origin',
                cache: 'no-store',
                signal: controller.signal,
            });
            const raw: unknown = await response.json();
            if (!response.ok) throw new Error('saved_screener_unavailable');
            const decoded = decodeScreenerResponse(raw);
            if (decoded.state !== 'ready' && decoded.state !== 'partial') {
                throw new Error('saved_screener_not_ready');
            }
            state = decoded.state;
            for (const row of decoded.rows) {
                if (!codes.includes(row.code)) codes.push(row.code);
                if (codes.length >= INTRADAY_MONITOR_DRAFT_LIMIT) break;
            }
            cursor = decoded.nextCursor ?? undefined;
            if (!cursor) break;
        } finally {
            clearTimeout(timer);
        }
    }
    if (!state) throw new Error('saved_screener_not_ready');
    return { codes, state };
}
