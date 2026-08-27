import { describe, expect, it, vi } from 'vitest';
import {
    inspectLegacyTriggerJson,
    inspectLegacyTriggerStorage,
    LEGACY_BRACKET_RECOVERY,
} from './smart-order-legacy-migration';

describe('smart-order legacy trigger inspection', () => {
    it('separates pure alerts from trading triggers without returning order authority', () => {
        const inspection = inspectLegacyTriggerJson(
            JSON.stringify([
                {
                    id: 'tg-alert-1',
                    code: '2330',
                    condition: 'above',
                    price: 1000,
                    action: 'Sell',
                    quantity: 999999,
                    kind: 'alert',
                },
                {
                    id: 'tg-stop-1',
                    code: '2330',
                    condition: 'below',
                    price: 900,
                    action: 'Sell',
                    quantity: 1,
                    kind: 'stop',
                    group: 'legacy-oco',
                },
            ]),
        );

        expect(inspection).toMatchObject({
            parsed: true,
            pureAlertCount: 1,
            manualRebuildCount: 1,
            brokerWriteAuthorized: false,
            automaticallyImported: false,
        });
        expect(inspection.items[0]).toMatchObject({
            disposition: 'pure_alert_read_only',
        });
        expect(inspection.items[1]).toMatchObject({
            disposition: 'manual_rebuild_required',
            reasonCode: 'LEGACY_TRADING_TRIGGER_MISSING_AUTHORITY',
        });
        expect(inspection.items[1]).not.toHaveProperty('action');
        expect(inspection.items[1]).not.toHaveProperty('quantity');
        expect(inspection.items[1]).not.toHaveProperty('group');
        expect(Object.isFrozen(inspection)).toBe(true);
        expect(Object.isFrozen(inspection.items)).toBe(true);
    });

    it('treats malformed and executable-looking JSON as inert invalid data', () => {
        const sideEffect = vi.fn();
        const inspection = inspectLegacyTriggerJson(
            JSON.stringify([
                {
                    kind: 'alert',
                    id: 'bad id',
                    code: '<script>sideEffect()</script>',
                    condition: 'above',
                    price: '100',
                    __proto__: { execute: 'sideEffect()' },
                },
                'globalThis.sideEffect()',
            ]),
        );

        expect(sideEffect).not.toHaveBeenCalled();
        expect(inspection).toMatchObject({
            parsed: true,
            invalidCount: 2,
            brokerWriteAuthorized: false,
        });
        expect(inspection.items.every((item) => item.legacyId === null)).toBe(
            true,
        );
    });

    it('fails closed on corrupt, oversized or inaccessible storage', () => {
        expect(inspectLegacyTriggerJson('{')).toMatchObject({
            parsed: false,
            truncated: false,
            totalEntries: 0,
        });
        expect(inspectLegacyTriggerJson('x'.repeat(300_000))).toMatchObject({
            parsed: false,
            truncated: true,
            totalEntries: 0,
        });
        expect(
            inspectLegacyTriggerStorage({
                getItem() {
                    throw new DOMException('denied', 'SecurityError');
                },
            }),
        ).toMatchObject({
            parsed: false,
            brokerWriteAuthorized: false,
        });
    });

    it('never claims that an in-memory legacy bracket can be recovered', () => {
        expect(LEGACY_BRACKET_RECOVERY).toMatchObject({
            recoverable: false,
            brokerWriteAuthorized: false,
            reasonCode: 'LEGACY_MEMORY_BRACKET_NOT_RECOVERABLE',
        });
        expect(LEGACY_BRACKET_RECOVERY.message).toContain('人工核對券商委託與部位');
    });
});
