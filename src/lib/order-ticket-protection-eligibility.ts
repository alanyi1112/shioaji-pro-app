import type { ContractInfo } from './types/contract';
import type { Account } from './types/portfolio';
import type { Action, StockOrderLot } from './types/order';

export type OrderTicketCanonicalCategory = 'stock' | 'etf';

export const AUTOMATIC_PROTECTION_ORDER_COND = 'Cash' as const;

export function canonicalOrderTicketCategory(
    contract: ContractInfo,
): OrderTicketCanonicalCategory | null {
    if (typeof contract.category !== 'string') return null;
    const category = contract.category.trim();
    if (category === '00') return 'etf';
    return /^(?:0[1-9]|[1-9]\d)$/.test(category) ? 'stock' : null;
}

function isFixedSignedStockAccount(account: Account | null): boolean {
    return Boolean(
        account &&
            account.account_type === 'S' &&
            account.signed === true &&
            typeof account.broker_id === 'string' &&
            account.broker_id.trim() &&
            typeof account.account_id === 'string' &&
            account.account_id.trim(),
    );
}

export function orderTicketProtectionEligibilityReason(input: {
    contract: ContractInfo;
    action: Action;
    orderCond: string;
    orderLot: StockOrderLot;
    daytradeShort: boolean;
    fixedStockAccount: Account | null;
}): string | null {
    const {
        contract,
        action,
        orderCond,
        orderLot,
        daytradeShort,
        fixedStockAccount,
    } = input;
    if (
        contract.security_type !== 'STK' ||
        (contract.exchange !== 'TSE' && contract.exchange !== 'OTC')
    ) {
        return '只支援 TSE／OTC 現股股票與 ETF';
    }
    if (orderCond !== AUTOMATIC_PROTECTION_ORDER_COND) {
        return '第一階段只支援 Cash 現股委託';
    }
    if (action !== 'Buy') return '第一階段只支援現股多單買進';
    if (orderLot !== 'Common') return '第一階段只支援整股 Common';
    if (daytradeShort) return '現沖先賣不支援自動保護';
    if (!isFixedSignedStockAccount(fixedStockAccount)) {
        return '尚未取得已簽署的固定股票帳號';
    }
    if (
        !Number.isFinite(contract.reference) ||
        contract.reference <= 0 ||
        !Number.isFinite(contract.limit_up) ||
        contract.limit_up <= 0 ||
        !Number.isFinite(contract.limit_down) ||
        contract.limit_down <= 0 ||
        typeof contract.update_date !== 'string' ||
        !contract.update_date.trim() ||
        canonicalOrderTicketCategory(contract) === null
    ) {
        return 'canonical contract 價格／分類資料不完整';
    }
    return null;
}
