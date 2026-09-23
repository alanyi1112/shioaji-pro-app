import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTO_FOLLOW_SIGNALS } from './market-pulse-panel';

describe('market signal follow policy', () => {
    it('keeps automatic signal following opt-in', () => {
        expect(DEFAULT_AUTO_FOLLOW_SIGNALS).toBe(false);
    });
});
