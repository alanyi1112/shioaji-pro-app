import { describe, expect, it, vi } from 'vitest';
import {
    bigramDiceSimilarity,
    normalizeInstrumentSearchText,
    normalizedEditSimilarity,
    rankAndMergeInstrumentCandidates,
    searchTaiwanInstrumentCatalog,
    scoreInstrumentCandidate,
    type InstrumentSearchCandidate,
} from './taiwan-instrument-search';

const fixtures: InstrumentSearchCandidate[] = [
    { code: '2330', name: '台積電', exchange: 'TSE', security_type: 'STK', detail: '股票', source: 'local' },
    { code: '3441', name: '聯一光', exchange: 'OTC', security_type: 'STK', detail: '上櫃', source: 'multiview' },
    { code: '8027', name: '鈦昇', exchange: 'OTC', security_type: 'STK', detail: '上櫃', source: 'multiview' },
    { code: '8027', name: '8027', exchange: 'OTC', security_type: 'STK', detail: '股票', source: 'local' },
    { code: '2330A', name: '台積電甲特', exchange: 'TSE', security_type: 'STK', detail: '股票', source: 'local' },
];

function response(body: unknown, ok = true, status = 200) {
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
}

describe('台灣商品模糊搜尋核心', () => {
    it('正規化 NFKC、臺台、大小寫、空白與常見分隔符號', () => {
        expect(normalizeInstrumentSearchText(' ＡＢＣ－臺 積・電 ')).toBe('ABC台積電');
    });

    it('支援名稱近似比對且拒絕低信心候選', () => {
        expect(bigramDiceSimilarity('聯一光', '聯一光電')).toBeGreaterThan(0.5);
        expect(normalizedEditSimilarity('聯光', '聯一光')).toBeGreaterThan(0.5);
        expect(scoreInstrumentCandidate('聯光', fixtures[1]!)).not.toBeNull();
        expect(scoreInstrumentCandidate('完全不相關', fixtures[1]!)).toBeNull();
    });

    it('精確代號優先、同鍵合併正式名稱並維持穩定排序', () => {
        const ranked = rankAndMergeInstrumentCandidates('8027', [...fixtures].reverse());
        expect(ranked[0]).toMatchObject({ code: '8027', name: '鈦昇', exchange: 'OTC' });
        expect(ranked.filter((item) => item.code === '8027')).toHaveLength(1);

        const exactName = rankAndMergeInstrumentCandidates('台積電', fixtures);
        expect(exactName[0]?.code).toBe('2330');
    });

    it('拒絕無效 schema，不把錯誤冒充無結果', async () => {
        await expect(searchTaiwanInstrumentCatalog('台積電', {
            fetchImpl: vi.fn(() => response({ data: [] })),
        })).rejects.toThrow('instrument_search_invalid_response');
    });

    it('timeout 會取消實際 fetch', async () => {
        const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () =>
                    reject(new DOMException('aborted', 'AbortError')),
                );
            }),
        );
        await expect(searchTaiwanInstrumentCatalog('台積電', {
            fetchImpl,
            timeoutMs: 5,
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });
});
