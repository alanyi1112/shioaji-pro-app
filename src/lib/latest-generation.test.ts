import { describe, expect, it } from 'vitest';
import { isLatestGeneration, nextGeneration } from './latest-generation';

describe('非同步請求 latest-wins generation', () => {
    it('快速切換後拒絕較早商品的結果', () => {
        const ref = { current: 0 };
        const first = nextGeneration(ref);
        const second = nextGeneration(ref);

        expect(isLatestGeneration(ref, first)).toBe(false);
        expect(isLatestGeneration(ref, second)).toBe(true);
    });

    it('直接選取可使進行中的舊請求失效', () => {
        const ref = { current: 4 };
        const pending = ref.current;
        nextGeneration(ref);

        expect(isLatestGeneration(ref, pending)).toBe(false);
    });
});
