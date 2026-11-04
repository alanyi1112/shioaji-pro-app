import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { captureHmrView, resolveHmrView, type HmrViewStore, type HmrIdentity } from '../lib/hmr-view-state';
import { hmrViewStore } from '../lib/hmr-view-runtime';
import type { Workspace } from '../lib/workspace';
import type { ContractInfo } from '../lib/types/contract';
import type { ScreenerChartSelectionState } from '../lib/screener-chart-selection';

export interface HmrRestorePorts {
    activeListId?: string;
    resolve: (identity: HmrIdentity) => Promise<ContractInfo>;
    activate: (contract: ContractInfo) => Promise<unknown>;
}
export function useHmrTradingView(factory: () => Workspace, ports: HmrRestorePorts, store: HmrViewStore | null = hmrViewStore) {
    const portsRef = useRef(ports);
    portsRef.current = ports;
    const [resume] = useState(() => store?.read() ?? null);
    const [selected, rawSelected] = useState<ContractInfo | null>(null);
    const [workspace, rawWorkspace] = useState(() => resume?.workspace ?? factory());
    const [chartSelections, rawCharts] = useState<Record<string,ScreenerChartSelectionState>>({});
    const [dailyChartIds, setDailyChartIds] = useState(() => new Set(resume?.dailyCharts ?? []));
    const [restoreStatus, setRestoreStatus] = useState<'none'|'pending'|'restored'|'failed'>(resume ? 'pending' : 'none');
    const [restoreError, setRestoreError] = useState<string | null>(null);
    const owner = useRef(0);
    const cancel = () => { owner.current++; setRestoreStatus('none'); setRestoreError(null); };
    const setSelected: Dispatch<SetStateAction<ContractInfo | null>> = value => { cancel(); rawSelected(value); };
    const setWorkspace: Dispatch<SetStateAction<Workspace>> = value => { rawWorkspace(value); };
    const setChartSelections: Dispatch<SetStateAction<Record<string,ScreenerChartSelectionState>>> = value => { cancel(); rawCharts(value); };
    // Stable wrappers avoid changing App callbacks/effect ownership every render.
    const setters = useRef({ setSelected, setWorkspace, setChartSelections }).current;
    const blockSignature = JSON.stringify(workspace.blocks);
    const previousBlocks = useRef(blockSignature);
    useLayoutEffect(() => {
        if (previousBlocks.current !== blockSignature) cancel();
        previousBlocks.current = blockSignature;
    }, [blockSignature]);
    useEffect(() => {
        if (!resume) return;
        const ticket = ++owner.current;
        const owns = () => owner.current === ticket;
        void resolveHmrView(resume, i => portsRef.current.resolve(i), owns)
            .then(restored => {
                if (!restored || !owns()) return;
                rawSelected(restored.selected); rawCharts(restored.charts);
                setRestoreStatus('restored');
                // Only the identity-verified original set reaches the existing same-key path.
                for (const c of restored.contracts) {
                    void portsRef.current.activate(c).catch(() => undefined);
                }
            }).catch(error => {
                if (!owns()) return;
                setRestoreError(error instanceof Error ? error.message : 'HMR 原商品恢復失敗');
                setRestoreStatus('failed');
            });
        return () => { if (owns()) owner.current++; };
    }, [resume]);
    useLayoutEffect(() => {
        if (!store || restoreStatus === 'pending' || restoreStatus === 'failed') return;
        store.commit(captureHmrView(workspace, selected, chartSelections, dailyChartIds, store.read()?.periods ?? {}, { activeListId: ports.activeListId || store.read()?.activeListId, viewports: store.read()?.viewports }));
    }, [store, workspace, selected, chartSelections, dailyChartIds, restoreStatus, ports.activeListId]);
    return { selected, ...setters, workspace, chartSelections, dailyChartIds, setDailyChartIds,
        restoreStatus, restoreError, allowInitialFallback: resume === null,
        resumeGeneration: Math.max(0, ...Object.values(resume?.charts ?? {}).map(c => c.generation)) };
}

export function useHmrChartPeriod(key: string | undefined, initialDaily: boolean,
    dailyGeneration?: number, store: HmrViewStore | null = hmrViewStore) {
    const [restored] = useState(() => key ? store?.period(key) : undefined);
    const [index, setIndex] = useState(restored?.index ?? (initialDaily ? 4 : 1));
    const applied = useRef(restored?.dailyGeneration);
    useEffect(() => {
        if (dailyGeneration === undefined || applied.current === dailyGeneration) return;
        applied.current = dailyGeneration; setIndex(4);
        if (key) store?.setPeriod(key, { index:4, dailyGeneration });
    }, [dailyGeneration, key, store]);
    useLayoutEffect(() => {
        if (key) store?.setPeriod(key, { index, dailyGeneration: applied.current });
    }, [key, store, index, dailyGeneration]);
    return [index, setIndex] as const;
}
