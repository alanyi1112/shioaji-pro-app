import {
    addWatchlistContracts,
    createWatchlist,
    fetchWatchlists,
    resolveContract,
    type ServerWatchlist,
} from './shioaji';
import type { UniverseStock } from './stock-screener-domain';
import type { ContractInfo } from './types/contract';
import { emitWatchlistInvalidation } from './watchlist-invalidation';

export const INTRADAY_MONITOR_LIST_NAME = '盤中選股';

export type IntradayMonitorWatchlistResult = {
    status: 'added' | 'already_present';
    listId: string;
};

export interface IntradayMonitorWatchlistDependencies {
    resolveContract: (code: string) => Promise<ContractInfo>;
    fetchWatchlists: () => Promise<ServerWatchlist[]>;
    createWatchlist: (name: string, contracts: ContractInfo[]) => Promise<ServerWatchlist>;
    addWatchlistContracts: (id: string, contracts: ContractInfo[]) => Promise<ServerWatchlist>;
    invalidate: (listName: string) => void;
}

const defaultDependencies: IntradayMonitorWatchlistDependencies = {
    resolveContract: (code) => resolveContract(code, 'STK'),
    fetchWatchlists,
    createWatchlist,
    addWatchlistContracts,
    invalidate: emitWatchlistInvalidation,
};

function normalizedName(name: string) {
    return name.normalize('NFKC').trim();
}

function uniqueTarget(lists: ServerWatchlist[]) {
    const matches = lists.filter(
        (list) => normalizedName(list.name) === INTRADAY_MONITOR_LIST_NAME,
    );
    if (matches.length > 1) {
        throw new Error('存在多個同名「盤中選股」清單，無法安全判定加入目標');
    }
    return matches[0] ?? null;
}

function matchesStock(contract: ContractInfo, stock: UniverseStock) {
    return contract.code === stock.code
        && contract.security_type === 'STK'
        && contract.exchange === (stock.market === 'TWSE' ? 'TSE' : 'OTC');
}

function containsContract(list: ServerWatchlist, contract: ContractInfo) {
    return list.contracts.some((item) =>
        item.code === contract.code
        && item.security_type === contract.security_type
        && item.exchange === contract.exchange,
    );
}

async function reconcile(
    dependencies: IntradayMonitorWatchlistDependencies,
    contract: ContractInfo,
) {
    const confirmed = uniqueTarget(await dependencies.fetchWatchlists());
    return confirmed && containsContract(confirmed, contract) ? confirmed : null;
}

async function addStock(
    stock: UniverseStock,
    dependencies: IntradayMonitorWatchlistDependencies,
): Promise<IntradayMonitorWatchlistResult> {
    const contract = await dependencies.resolveContract(stock.code);
    if (!matchesStock(contract, stock)) {
        throw new Error('商品市場或種類不一致，未加入「盤中選股」清單');
    }

    let target = uniqueTarget(await dependencies.fetchWatchlists());
    const wasPresent = target ? containsContract(target, contract) : false;
    if (!target) {
        try {
            target = await dependencies.createWatchlist(
                INTRADAY_MONITOR_LIST_NAME,
                [contract],
            );
        } catch {
            // This is reconciliation only: the failed mutation is never retried.
            target = uniqueTarget(await dependencies.fetchWatchlists());
            if (!target) throw new Error('建立「盤中選股」清單失敗，伺服器未確認結果');
        }
    }

    if (!containsContract(target, contract)) {
        try {
            await dependencies.addWatchlistContracts(target.id, [contract]);
        } catch {
            // An ambiguous response may still have committed. Read once and fail
            // closed unless the server now confirms the exact contract.
            const confirmedAfterError = await reconcile(dependencies, contract);
            if (!confirmedAfterError) {
                throw new Error('加入「盤中選股」清單結果不明，伺服器尚未確認');
            }
            dependencies.invalidate(INTRADAY_MONITOR_LIST_NAME);
            return { status: 'added', listId: confirmedAfterError.id };
        }
    }

    const confirmed = await reconcile(dependencies, contract);
    if (!confirmed) {
        throw new Error('伺服器尚未確認商品已加入「盤中選股」清單');
    }
    dependencies.invalidate(INTRADAY_MONITOR_LIST_NAME);
    return {
        status: wasPresent ? 'already_present' : 'added',
        listId: confirmed.id,
    };
}

let mutationQueue: Promise<void> = Promise.resolve();

/** Same-tab serialization plus server reconciliation provides idempotent UX. */
export function addStockToIntradayMonitorWatchlist(
    stock: UniverseStock,
    dependencies: IntradayMonitorWatchlistDependencies = defaultDependencies,
) {
    const result = mutationQueue.then(() => addStock(stock, dependencies));
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
}
