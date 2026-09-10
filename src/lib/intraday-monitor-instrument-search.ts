import {
    searchTaiwanInstrumentCatalog,
    taiwanInstrumentSearchUrl,
    type TaiwanInstrumentSearchResult,
    type TaiwanInstrumentSuggestion,
} from './taiwan-instrument-search';

export type IntradayMonitorInstrumentSuggestion = TaiwanInstrumentSuggestion;
export type IntradayMonitorInstrumentSearchResult = TaiwanInstrumentSearchResult;

export function intradayMonitorInstrumentSearchUrl(
    query: string,
    limit = 8,
    multiviewUrl?: string,
) {
    return taiwanInstrumentSearchUrl(query, limit, multiviewUrl);
}

export async function searchIntradayMonitorInstruments(
    query: string,
    {
        limit = 8,
        fetchImpl = fetch,
        signal,
        multiviewUrl,
    }: {
        limit?: number;
        fetchImpl?: typeof fetch;
        signal?: AbortSignal;
        multiviewUrl?: string;
    } = {},
): Promise<IntradayMonitorInstrumentSearchResult> {
    return searchTaiwanInstrumentCatalog(query, {
        limit,
        fetchImpl,
        signal,
        multiviewUrl,
    });
}
