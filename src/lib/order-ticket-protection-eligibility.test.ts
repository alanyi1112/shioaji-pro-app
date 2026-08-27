import { describe, expect, it } from 'vitest';
import type { ContractInfo } from './types/contract';
import type { Account } from './types/portfolio';
import {
    AUTOMATIC_PROTECTION_ORDER_COND,
    canonicalOrderTicketCategory,
    orderTicketProtectionEligibilityReason,
} from './order-ticket-protection-eligibility';

const fixedAccount: Account = {
    account_type: 'S',
    broker_id: 'MASKED',
    account_id: 'MASKED',
    person_id: 'MASKED',
    username: 'MASKED',
    signed: true,
};

function contract(overrides: Partial<ContractInfo> = {}): ContractInfo {
    return {
        exchange: 'TSE',
        code: '2330',
        security_type: 'STK',
        target_code: null,
        name: '台積電',
        currency: 'TWD',
        limit_up: 1_100,
        limit_down: 900,
        reference: 1_000,
        day_trade: 'Yes',
        update_date: '2026-08-13',
        category: '24',
        margin_trading_balance: 0,
        short_selling_balance: 0,
        ...overrides,
    };
}

function eligibleInput() {
    return {
        contract: contract(),
        action: 'Buy' as const,
        orderCond: AUTOMATIC_PROTECTION_ORDER_COND,
        orderLot: 'Common' as const,
        daytradeShort: false,
        fixedStockAccount: fixedAccount,
    };
}

describe('order ticket automatic-protection eligibility', () => {
    it.each([
        [contract(), 'stock'],
        [contract({ exchange: 'OTC', code: '00679B', category: '00' }), 'etf'],
    ] as const)('admits only canonical stock/ETF category %#', (value, category) => {
        expect(canonicalOrderTicketCategory(value)).toBe(category);
        expect(
            orderTicketProtectionEligibilityReason({
                ...eligibleInput(),
                contract: value,
            }),
        ).toBeNull();
    });

    it.each([
        [{ orderCond: 'MarginTrading' }, '第一階段只支援 Cash 現股委託'],
        [{ orderCond: 'ShortSelling' }, '第一階段只支援 Cash 現股委託'],
        [{ action: 'Sell' }, '第一階段只支援現股多單買進'],
        [{ orderLot: 'IntradayOdd' }, '第一階段只支援整股 Common'],
        [{ daytradeShort: true }, '現沖先賣不支援自動保護'],
        [{ fixedStockAccount: null }, '尚未取得已簽署的固定股票帳號'],
        [
            { fixedStockAccount: { ...fixedAccount, signed: false } },
            '尚未取得已簽署的固定股票帳號',
        ],
    ] as const)('rejects unsupported order scope %#', (overrides, reason) => {
        expect(
            orderTicketProtectionEligibilityReason({
                ...eligibleInput(),
                ...overrides,
            }),
        ).toBe(reason);
    });

    it.each([
        { security_type: 'FUT', exchange: 'TAIFEX' },
        { exchange: 'OES' },
        { category: 'ETF' },
        { category: undefined as unknown as string },
        { category: '01', reference: 0 },
        { category: '01', update_date: '' },
    ] satisfies Array<Partial<ContractInfo>>)(
        'fails closed for unsupported or incomplete contract %#',
        (overrides) => {
            expect(
                orderTicketProtectionEligibilityReason({
                    ...eligibleInput(),
                    contract: contract(overrides),
                }),
            ).not.toBeNull();
        },
    );
});
