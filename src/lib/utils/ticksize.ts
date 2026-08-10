// src/lib/utils/ticksize.ts — TW market tick size tables

import type { ContractBase } from '../types/contract';

export type TickSizeContract = ContractBase & { category?: string };

// TWSE/TPEX equities
function stockTick(price: number): number {
    if (price < 10) return 0.01;
    if (price < 50) return 0.05;
    if (price < 100) return 0.1;
    if (price < 500) return 0.5;
    if (price < 1000) return 1;
    return 5;
}

// TWSE/TPEx ETFs and other beneficial certificates
function etfTick(price: number): number {
    return price < 50 ? 0.01 : 0.05;
}

export function isTaiwanStock(contract: TickSizeContract): boolean {
    return (
        contract.security_type === 'STK' &&
        (contract.exchange === 'TSE' || contract.exchange === 'OTC')
    );
}

export function isTaiwanEtf(contract: TickSizeContract): boolean {
    const category = contract.category?.trim();
    if (category) return category === '00';
    // Contract V2 catalog rows omit category until details load. Keep this
    // fallback broad enough for suffix ETFs such as 00981A, but never override
    // a canonical non-ETF category.
    return /^00[0-9A-Z]+$/i.test(contract.code.trim());
}

export function tickSizeFor(contract: TickSizeContract, price: number): number {
    if (contract.security_type === 'FUT') return 1; // TXF/MXF/TMF index futures
    if (contract.security_type === 'OPT') return price >= 10 ? 1 : 0.1;
    if (isTaiwanEtf(contract)) return etfTick(price);
    return stockTick(price);
}

export function taiwanQuoteDigitsFor(
    contract: TickSizeContract,
    price: number,
): number | null {
    if (!isTaiwanStock(contract) || !Number.isFinite(price) || price < 0) {
        return null;
    }
    const tick = tickSizeFor(contract, price);
    if (tick >= 1) return 0;
    if (tick >= 0.1) return 1;
    return 2;
}

export function roundToTick(contract: TickSizeContract, price: number): number {
    const tick = tickSizeFor(contract, price);
    const rounded = Math.round(price / tick) * tick;
    // avoid float dust (0.1 steps)
    return Number(rounded.toFixed(2));
}

export function stepPrice(
    contract: TickSizeContract,
    price: number,
    steps: number,
): number {
    let p = price;
    for (let i = 0; i < Math.abs(steps); i++) {
        const tick = tickSizeFor(contract, steps > 0 ? p : p - 0.0001);
        p = Number((p + (steps > 0 ? tick : -tick)).toFixed(2));
    }
    return p;
}
