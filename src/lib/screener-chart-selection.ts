import type { ContractInfo } from './types/contract';
import type { UniverseStock } from './stock-screener-domain';
import type { Snapshot } from './types/market';

export interface ChartTarget { id: string; pin: string | null; type: string }
export interface ScreenerChartStock extends UniverseStock {
    volume?: { previous?: string | null; current?: string | null; previousDate?: string | null; currentDate?: string | null };
}
export interface ScreenerChartSelectionState {
    contract: ContractInfo;
    snapshot?: Snapshot;
    snapshotError?: string;
    generation: number;
    evidence?: ScreenerChartStock['volume'];
}
/** A separate selection generation: it cannot update the global order/watchlist contract. */
export function createScreenerChartSelection(
    getTargets: () => ChartTarget[],
    resolve: (code: string) => Promise<ContractInfo>,
    snapshot: (contract: ContractInfo) => Promise<Snapshot | undefined>,
    commit: (id: string, selection: ScreenerChartSelectionState) => void,
) {
    let generation = 0;
    const cancel = () => { generation++; };
    const available = (id: string) => getTargets().some((target) => target.id === id && target.type === 'chart' && target.pin === null);
    return {
        cancel,
        async pick(
            stock: ScreenerChartStock,
            targetId: string,
            stillOwnsTarget: () => boolean = () => true,
        ): Promise<boolean> {
            const ticket = ++generation;
            const current = () => ticket === generation
                && available(targetId)
                && stillOwnsTarget();
            if (!available(targetId) || !stillOwnsTarget()) throw new Error('請先指定未鎖定的 K 線圖');
            let contract: ContractInfo;
            try { contract = await resolve(stock.code); }
            catch { if (!current()) return false; throw new Error('無法解析商品，原圖表保持不變'); }
            if (!current()) return false;
            if (contract.code !== stock.code || contract.security_type !== 'STK'
                || contract.exchange !== (stock.market === 'TWSE' ? 'TSE' : 'OTC')) throw new Error('商品市場不一致，原圖表保持不變');
            let quote: Snapshot | undefined;
            let snapshotError: string | undefined;
            try {
                quote = await snapshot(contract);
                if (!quote || quote.code !== contract.code) snapshotError = '盤後行情 Snapshot 暫時不可用';
            } catch {
                snapshotError = '盤後行情 Snapshot 暫時不可用';
            }
            if (!current()) return false;
            commit(targetId, { contract, snapshot: quote?.code === contract.code ? quote : undefined,
                snapshotError, generation: ticket, evidence: stock.volume });
            return true;
        },
    };
}
