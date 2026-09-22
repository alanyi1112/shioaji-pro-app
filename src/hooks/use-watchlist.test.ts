import { describe, expect, it } from 'vitest';
import {
    serviceRecoveryDelayMs,
    watchlistInvalidationReloadsActiveList,
} from './use-watchlist';

describe('watchlist service recovery backoff', () => {
    it('依 5、10、20、30 秒退避並封頂 30 秒', () => {
        expect([0, 1, 2, 3, 4, 12].map(serviceRecoveryDelayMs)).toEqual([
            5_000,
            10_000,
            20_000,
            30_000,
            30_000,
            30_000,
        ]);
    });
});

describe('watchlist invalidation scope', () => {
    it('其他清單變更只更新 metadata，不要求重載目前清單', () => {
        const active = { id: 'mine', name: '我的自選', contracts: [] };
        expect(watchlistInvalidationReloadsActiveList('盤中選股', active)).toBe(false);
        expect(watchlistInvalidationReloadsActiveList('選股', active)).toBe(false);
        expect(watchlistInvalidationReloadsActiveList(' 我的自選 ', active)).toBe(true);
        expect(watchlistInvalidationReloadsActiveList('我的自選', undefined)).toBe(false);
    });
});
