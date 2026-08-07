import { describe, expect, it } from 'vitest';
import { serviceRecoveryDelayMs } from './use-watchlist';

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
