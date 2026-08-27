import { describe, expect, it, vi } from 'vitest';

const forbidden = vi.hoisted(() => ({
    onOrderEvent: vi.fn(),
    fetchTrades: vi.fn(),
    addTrigger: vi.fn(),
    placeQuickOrder: vi.fn(),
}));

vi.mock('./stream', () => ({ onOrderEvent: forbidden.onOrderEvent }));
vi.mock('./shioaji', () => ({ fetchTrades: forbidden.fetchTrades }));
vi.mock('./trigger-engine', () => ({ addTrigger: forbidden.addTrigger }));
vi.mock('./trade', () => ({ placeQuickOrder: forbidden.placeQuickOrder }));

describe('legacy bracket fail-closed boundary', () => {
    it('rejects synchronously without starting a watcher or reaching broker work', async () => {
        const bracket = await import('./bracket');

        expect(() =>
            bracket.registerBracket({
                orderId: 'legacy-entry-id',
                seqno: 'legacy-seqno',
                code: '2330',
                action: 'Buy',
                quantity: 1,
                stopPrice: 900,
                takePrice: 1_100,
                accountType: 'S',
            }),
        ).toThrowError(bracket.LegacyBracketDisabledError);

        expect(forbidden.onOrderEvent).not.toHaveBeenCalled();
        expect(forbidden.fetchTrades).not.toHaveBeenCalled();
        expect(forbidden.addTrigger).not.toHaveBeenCalled();
        expect(forbidden.placeQuickOrder).not.toHaveBeenCalled();
    });
});
