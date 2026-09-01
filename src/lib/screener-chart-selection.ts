import type { ContractInfo } from './types/contract';
import type { UniverseStock } from './stock-screener-domain';

export interface ChartTarget { id: string; pin: string | null; type: string }
/** A separate selection generation: it cannot update the global order/watchlist contract. */
export function createScreenerChartSelection(
    getTargets: () => ChartTarget[],
    resolve: (code: string) => Promise<ContractInfo>,
    commit: (id: string, contract: ContractInfo) => void,
) {
    let generation = 0;
    const cancel = () => { generation++; };
    const available = (id: string) => getTargets().some((target) => target.id === id && target.type === 'chart' && target.pin === null);
    return {
        cancel,
        async pick(stock: UniverseStock, targetId: string): Promise<boolean> {
            const ticket = ++generation;
            if (!available(targetId)) throw new Error('請先指定未鎖定的 K 線圖');
            let contract: ContractInfo;
            try { contract = await resolve(stock.code); }
            catch { if (ticket !== generation || !available(targetId)) return false; throw new Error('無法解析商品，原圖表保持不變'); }
            if (ticket !== generation || !available(targetId)) return false;
            if (contract.code !== stock.code || contract.security_type !== 'STK'
                || contract.exchange !== (stock.market === 'TWSE' ? 'TSE' : 'OTC')) throw new Error('商品市場不一致，原圖表保持不變');
            commit(targetId, contract);
            return true;
        },
    };
}
