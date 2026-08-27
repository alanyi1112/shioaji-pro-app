// src/lib/bracket.ts — fail-closed compatibility boundary.
//
// The former browser-memory bracket watcher was not durable broker authority.
// Keeping this exported boundary makes stale callers fail synchronously before
// an entry order can be submitted.  Durable protection belongs to the smart
// order runtime and must be rebuilt there after manual broker/position checks.

import type { Action } from './types/order';

export interface PendingBracket {
    orderId: string;
    seqno: string;
    code: string;
    action: Action;
    quantity: number;
    stopPrice: number | null;
    takePrice: number | null;
    accountType: 'S' | 'F';
}

export const LEGACY_BRACKET_DISABLED_MESSAGE =
    '舊版瀏覽器括號單已停用，不會建立停損／停利；請先人工核對券商委託與部位，再到智慧下單重建。';

export class LegacyBracketDisabledError extends Error {
    readonly code = 'LEGACY_BRACKET_DISABLED';

    constructor() {
        super(LEGACY_BRACKET_DISABLED_MESSAGE);
        this.name = 'LegacyBracketDisabledError';
    }
}

/**
 * Always rejects legacy bracket creation synchronously.  This function has no
 * stream, trade, contract, or broker dependency by design.
 */
export function registerBracket(_bracket: PendingBracket): never {
    throw new LegacyBracketDisabledError();
}
