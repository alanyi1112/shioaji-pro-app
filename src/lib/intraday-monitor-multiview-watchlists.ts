import { resolveMultiViewUrl } from './multiview-window';

const REQUEST_TIMEOUT_MS = 4_000;
const TAIWAN_STOCK_SYMBOL = /^(\d{4,6}[A-Z]?)\.(TW|TWO)$/u;

export interface MultiViewMonitorImportItem {
    code: string;
    symbol: string;
    name: string;
    exchange: 'TSE' | 'OTC';
}

export interface MultiViewMonitorImportList {
    id: string;
    name: string;
    enabled: boolean;
    items: MultiViewMonitorImportItem[];
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function nonEmptyString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function multiViewMonitorImportUrl(multiviewUrl = resolveMultiViewUrl()) {
    const url = new URL('/api/instruments', resolveMultiViewUrl(multiviewUrl));
    url.searchParams.set('mode', 'read-only');
    url.searchParams.set('purpose', 'intraday-monitor-import');
    return url.toString();
}

export function decodeMultiViewMonitorImportLists(payload: unknown): MultiViewMonitorImportList[] {
    const root = record(payload);
    if (!root || !Array.isArray(root.managedTabs) || !Array.isArray(root.instruments)) {
        throw new Error('multiview_watchlists_invalid_response');
    }

    const instruments = root.instruments.flatMap((raw) => {
        const item = record(raw);
        const symbol = nonEmptyString(item?.symbol)?.toUpperCase();
        const match = symbol?.match(TAIWAN_STOCK_SYMBOL);
        const name = nonEmptyString(item?.name);
        if (!item || !match || !name || item.enabled === false) return [];
        return [{
            code: match[1]!,
            symbol: `${match[1]!}.${match[2]!}`,
            name,
            exchange: match[2] === 'TW' ? 'TSE' as const : 'OTC' as const,
            tabId: nonEmptyString(item.tabId) ?? '',
            tabLabel: nonEmptyString(item.tab) ?? '',
            order: Number.isInteger(item.defaultOrder) ? Number(item.defaultOrder) : Number.MAX_SAFE_INTEGER,
        }];
    });

    return root.managedTabs.flatMap((rawTab) => {
        const tab = record(rawTab);
        const id = nonEmptyString(tab?.tabKey) ?? nonEmptyString(tab?.id);
        const rawId = nonEmptyString(tab?.id) ?? '';
        const label = nonEmptyString(tab?.displayLabel) ?? nonEmptyString(tab?.label);
        if (!tab || !id || !label) return [];
        const defaultSymbols = new Set(Array.isArray(tab.defaultSymbols)
            ? tab.defaultSymbols.flatMap((symbol) => nonEmptyString(symbol)?.toUpperCase() ?? [])
            : []);
        const personal = id.startsWith('personal:');
        const bySymbol = new Map<string, MultiViewMonitorImportItem & { order: number }>();
        for (const item of instruments) {
            const belongs = personal
                ? item.tabId === rawId || (!item.tabId && item.tabLabel === label)
                : !item.tabId && (item.tabLabel === label || defaultSymbols.has(item.symbol));
            if (!belongs) continue;
            const previous = bySymbol.get(item.symbol);
            if (!previous || item.order < previous.order) bySymbol.set(item.symbol, item);
        }
        const items = [...bySymbol.values()]
            .sort((left, right) => left.order - right.order || left.symbol.localeCompare(right.symbol, 'en'))
            .map(({ code, symbol, name, exchange }) => ({ code, symbol, name, exchange }));
        if (items.length === 0) return [];
        return [{ id, name: label, enabled: tab.enabled !== false, items }];
    });
}

export async function readMultiViewMonitorImportLists({
    fetchImpl = fetch,
    signal,
    multiviewUrl,
}: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    multiviewUrl?: string;
} = {}): Promise<MultiViewMonitorImportList[]> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
    try {
        const response = await fetchImpl(multiViewMonitorImportUrl(multiviewUrl), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`multiview_watchlists_http_${response.status}`);
        return decodeMultiViewMonitorImportLists(await response.json());
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}
