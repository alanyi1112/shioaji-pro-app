import { resolveMultiViewUrl } from './multiview-window';

export const TAIWAN_INSTRUMENT_SEARCH_TIMEOUT_MS = 4_000;
export const TAIWAN_INSTRUMENT_FUZZY_MIN_SCORE = 0.34;

const STOCK_SYMBOL = /^(\d{4,6}[A-Z]?)\.(TW|TWO)$/u;
const SEARCH_SEPARATORS = /[\s\-_.·・/\\()（）\[\]【】]+/gu;

export interface TaiwanInstrumentSuggestion {
    code: string;
    symbol: string;
    name: string;
    exchange: 'TSE' | 'OTC';
    market: 'TWSE' | 'TPEx';
    score: number | null;
    matchedBy: string | null;
}

export interface TaiwanInstrumentSearchResult {
    items: TaiwanInstrumentSuggestion[];
    warnings: string[];
}

export interface InstrumentSearchCandidate {
    code: string;
    name: string;
    security_type: string;
    exchange: string;
    detail: string;
    source?: 'multiview' | 'local';
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

export function normalizeInstrumentSearchText(value: string): string {
    return value
        .normalize('NFKC')
        .trim()
        .replace(/臺/gu, '台')
        .replace(SEARCH_SEPARATORS, '')
        .toUpperCase();
}

function bigramCounts(value: string): Map<string, number> {
    const counts = new Map<string, number>();
    if (value.length < 2) {
        if (value) counts.set(value, 1);
        return counts;
    }
    for (let index = 0; index < value.length - 1; index += 1) {
        const gram = value.slice(index, index + 2);
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
}

export function bigramDiceSimilarity(left: string, right: string): number {
    const a = normalizeInstrumentSearchText(left);
    const b = normalizeInstrumentSearchText(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const aCounts = bigramCounts(a);
    const bCounts = bigramCounts(b);
    let overlap = 0;
    let aTotal = 0;
    let bTotal = 0;
    for (const count of aCounts.values()) aTotal += count;
    for (const count of bCounts.values()) bTotal += count;
    for (const [gram, count] of aCounts) {
        overlap += Math.min(count, bCounts.get(gram) ?? 0);
    }
    return aTotal + bTotal === 0 ? 0 : (2 * overlap) / (aTotal + bTotal);
}

export function normalizedEditSimilarity(left: string, right: string): number {
    const a = normalizeInstrumentSearchText(left);
    const b = normalizeInstrumentSearchText(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let row = 1; row <= a.length; row += 1) {
        const current = [row];
        for (let column = 1; column <= b.length; column += 1) {
            current[column] = Math.min(
                (current[column - 1] ?? 0) + 1,
                (previous[column] ?? 0) + 1,
                (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
            );
        }
        previous.splice(0, previous.length, ...current);
    }
    return 1 - (previous[b.length] ?? Math.max(a.length, b.length))
        / Math.max(a.length, b.length);
}

export function scoreInstrumentCandidate(
    query: string,
    candidate: Pick<InstrumentSearchCandidate, 'code' | 'name'>,
): number | null {
    const normalizedQuery = normalizeInstrumentSearchText(query);
    const code = normalizeInstrumentSearchText(candidate.code);
    const name = normalizeInstrumentSearchText(candidate.name);
    if (!normalizedQuery) return null;

    const equityBonus = /^\d{4}$/u.test(code) ? 5 : 0;
    if (code === normalizedQuery) return 1_000 + equityBonus;
    if (code.startsWith(normalizedQuery)) return 900 + equityBonus;
    if (name === normalizedQuery) return 800 + equityBonus;
    if (name.startsWith(normalizedQuery)) return 700 + equityBonus;
    if (name.includes(normalizedQuery)) return 600 + equityBonus;
    const similarity = Math.max(
        bigramDiceSimilarity(normalizedQuery, name),
        normalizedEditSimilarity(normalizedQuery, name),
    );
    if (similarity < TAIWAN_INSTRUMENT_FUZZY_MIN_SCORE) return null;
    return 100 + similarity * 400 + equityBonus;
}

function candidateKey(candidate: InstrumentSearchCandidate): string {
    return [
        candidate.security_type.toUpperCase(),
        candidate.exchange.toUpperCase(),
        candidate.code.toUpperCase(),
    ].join(':');
}

function nameQuality(candidate: InstrumentSearchCandidate): number {
    const normalizedName = normalizeInstrumentSearchText(candidate.name);
    const normalizedCode = normalizeInstrumentSearchText(candidate.code);
    return (normalizedName && normalizedName !== normalizedCode ? 100 : 0)
        + (candidate.source === 'multiview' ? 10 : 0)
        + Math.min(candidate.name.trim().length, 9);
}

export function rankAndMergeInstrumentCandidates<T extends InstrumentSearchCandidate>(
    query: string,
    candidates: T[],
    limit = 10,
): T[] {
    const merged = new Map<string, T>();
    for (const candidate of candidates) {
        const key = candidateKey(candidate);
        const current = merged.get(key);
        if (!current) {
            merged.set(key, candidate);
            continue;
        }
        const preferred = nameQuality(candidate) > nameQuality(current)
            ? candidate
            : current;
        merged.set(key, {
            ...current,
            ...preferred,
            name: preferred.name,
            detail: preferred.detail || current.detail,
        });
    }

    return [...merged.values()]
        .map((candidate) => ({
            candidate,
            score: scoreInstrumentCandidate(query, candidate),
        }))
        .filter((entry): entry is { candidate: T; score: number } => entry.score !== null)
        .sort((left, right) =>
            right.score - left.score
            || left.candidate.exchange.localeCompare(right.candidate.exchange)
            || left.candidate.code.localeCompare(right.candidate.code)
            || left.candidate.name.localeCompare(right.candidate.name, 'zh-Hant-TW'))
        .slice(0, Math.max(0, Math.trunc(limit)))
        .map((entry) => entry.candidate);
}

export function taiwanInstrumentSearchUrl(
    query: string,
    limit = 8,
    multiviewUrl = resolveMultiViewUrl(),
) {
    const url = new URL('/api/instrument-search', multiviewUrl);
    url.searchParams.set('q', query.trim());
    url.searchParams.set('limit', String(Math.min(20, Math.max(1, Math.trunc(limit)))));
    return url.toString();
}

export async function searchTaiwanInstrumentCatalog(
    query: string,
    {
        limit = 8,
        fetchImpl = fetch,
        signal,
        multiviewUrl,
        timeoutMs = TAIWAN_INSTRUMENT_SEARCH_TIMEOUT_MS,
    }: {
        limit?: number;
        fetchImpl?: typeof fetch;
        signal?: AbortSignal;
        multiviewUrl?: string;
        timeoutMs?: number;
    } = {},
): Promise<TaiwanInstrumentSearchResult> {
    const normalized = query.trim();
    if (!normalized) return { items: [], warnings: [] };

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.max(1, timeoutMs));
    try {
        const response = await fetchImpl(
            taiwanInstrumentSearchUrl(normalized, limit, multiviewUrl),
            {
                headers: { accept: 'application/json' },
                cache: 'no-store',
                signal: controller.signal,
            },
        );
        if (!response.ok) {
            throw new Error(`instrument_search_http_${response.status}`);
        }
        const payload = record(await response.json());
        if (!payload || !Array.isArray(payload.results)) {
            throw new Error('instrument_search_invalid_response');
        }

        const seen = new Set<string>();
        const items: TaiwanInstrumentSuggestion[] = [];
        for (const raw of payload.results) {
            const item = record(raw);
            if (!item || typeof item.symbol !== 'string') continue;
            const match = item.symbol.toUpperCase().match(STOCK_SYMBOL);
            if (!match || item.quoteType !== 'EQUITY') continue;
            const name = typeof item.localizedName === 'string' && item.localizedName.trim()
                ? item.localizedName.trim()
                : typeof item.name === 'string' ? item.name.trim() : '';
            if (!name) continue;
            const code = match[1]!;
            const suffix = match[2]!;
            const key = `${suffix}:${code}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({
                code,
                symbol: `${code}.${suffix}`,
                name,
                exchange: suffix === 'TW' ? 'TSE' : 'OTC',
                market: suffix === 'TW' ? 'TWSE' : 'TPEx',
                score: typeof item.score === 'number' && Number.isFinite(item.score)
                    ? item.score
                    : null,
                matchedBy: typeof item.matchedBy === 'string'
                    ? item.matchedBy
                    : null,
            });
            if (items.length >= limit) break;
        }
        const warnings = Array.isArray(payload.warnings)
            ? payload.warnings.filter((warning): warning is string => typeof warning === 'string')
            : typeof payload.warning === 'string' && payload.warning
                ? [payload.warning]
                : [];
        return { items, warnings };
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}
