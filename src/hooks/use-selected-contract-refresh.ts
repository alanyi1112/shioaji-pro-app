import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { ContractInfo } from '../lib/types/contract';

export function useSelectedContractRefresh(
    selected: ContractInfo | null,
    setSelected: Dispatch<SetStateAction<ContractInfo | null>>,
    items: readonly { contract: ContractInfo }[],
    cachedSelected: ContractInfo | undefined,
    allowInitialFallback: boolean,
    restoreStatus: string,
) {
    // One authority per render. Two independent effects can alternate forever
    // between an older watchlist object and the refreshed cache object.
    useEffect(() => {
        if (!selected && items[0] && restoreStatus === 'none' && allowInitialFallback) {
            setSelected(items[0].contract);
            return;
        }
        if (selected) {
            const sameIdentity = (candidate: ContractInfo) => candidate.code === selected.code
                && candidate.security_type === selected.security_type
                && candidate.exchange === selected.exchange
                && (candidate.region ?? 'TW') === (selected.region ?? 'TW')
                && (candidate.target_code ?? null) === (selected.target_code ?? null);
            const cached = cachedSelected && sameIdentity(cachedSelected) ? cachedSelected : undefined;
            const next = cached ?? items.find(item => sameIdentity(item.contract))?.contract;
            if (next && next !== selected) setSelected(next);
        }
    }, [items, cachedSelected, selected, restoreStatus, allowInitialFallback, setSelected]);
}
