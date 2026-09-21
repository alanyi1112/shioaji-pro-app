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

export const STOCK_SCREENER_LIST_NAME = '選股';

export type ScreenerWatchlistResult = {
    status: 'added' | 'already_present';
    listId: string;
};

export interface ScreenerWatchlistDependencies {
    resolveContract: (code: string) => Promise<ContractInfo>;
    fetchWatchlists: () => Promise<ServerWatchlist[]>;
    createWatchlist: (name: string, contracts: ContractInfo[]) => Promise<ServerWatchlist>;
    addWatchlistContracts: (id: string, contracts: ContractInfo[]) => Promise<ServerWatchlist>;
    invalidate: (listName: string) => void;
}

const defaultDependencies: ScreenerWatchlistDependencies = {
    resolveContract: (code) => resolveContract(code, 'STK'),
    fetchWatchlists,
    createWatchlist,
    addWatchlistContracts,
    invalidate: emitWatchlistInvalidation,
};

function normalizedName(name: string) {
    return name.normalize('NFKC').trim();
}

function contractMatchesStock(contract: ContractInfo, stock: UniverseStock) {
    return contract.code === stock.code
        && contract.security_type === 'STK'
        && contract.exchange === (stock.market === 'TWSE' ? 'TSE' : 'OTC');
}

function sameContract(
    contract: ServerWatchlist['contracts'][number],
    resolved: ContractInfo,
) {
    return contract.code === resolved.code
        && contract.security_type === resolved.security_type
        && contract.exchange === resolved.exchange;
}

function uniqueNamedList(lists: ServerWatchlist[]) {
    const matches = lists.filter(
        (list) => normalizedName(list.name) === STOCK_SCREENER_LIST_NAME,
    );
    if (matches.length > 1) {
        throw new Error('存在多個同名「選股」清單，無法安全判定加入目標');
    }
    return matches[0] ?? null;
}

async function addStock(
    stock: UniverseStock,
    dependencies: ScreenerWatchlistDependencies,
): Promise<ScreenerWatchlistResult> {
    const contract = await dependencies.resolveContract(stock.code);
    if (!contractMatchesStock(contract, stock)) {
        throw new Error('商品市場或種類不一致，未加入自選清單');
    }

    let lists = await dependencies.fetchWatchlists();
    let target = uniqueNamedList(lists);
    let createdWithContract = false;

    if (!target) {
        try {
            target = await dependencies.createWatchlist(
                STOCK_SCREENER_LIST_NAME,
                [contract],
            );
            createdWithContract = true;
        } catch {
            // Another tab may have created the exact list after our read.
            lists = await dependencies.fetchWatchlists();
            target = uniqueNamedList(lists);
            if (!target) throw new Error('建立「選股」清單失敗');
        }
    }

    if (!createdWithContract && !target.contracts.some((item) => sameContract(item, contract))) {
        await dependencies.addWatchlistContracts(target.id, [contract]);
    }

    const confirmedLists = await dependencies.fetchWatchlists();
    const confirmed = uniqueNamedList(confirmedLists);
    if (!confirmed || !confirmed.contracts.some((item) => sameContract(item, contract))) {
        throw new Error('伺服器尚未確認商品已加入「選股」清單');
    }

    const wasPresent = !createdWithContract
        && target.contracts.some((item) => sameContract(item, contract));
    dependencies.invalidate(STOCK_SCREENER_LIST_NAME);
    return {
        status: wasPresent ? 'already_present' : 'added',
        listId: confirmed.id,
    };
}

let mutationQueue: Promise<void> = Promise.resolve();

/** Serializes same-tab mutations; server confirmation handles cross-tab races. */
export function addStockToScreenerWatchlist(
    stock: UniverseStock,
    dependencies: ScreenerWatchlistDependencies = defaultDependencies,
) {
    const result = mutationQueue.then(() => addStock(stock, dependencies));
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
}
