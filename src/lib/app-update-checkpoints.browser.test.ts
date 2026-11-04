import { expect, it, vi } from 'vitest';
import { prepareUpdateHandoff, registerUpdateCheckpoint } from './app-update-checkpoints';
it('先擷取各圖視窗再落盤，任一保存失敗不重載，所有callbacks可清除', () => {
    const order:string[]=[], chart=vi.fn(()=>{order.push('chart');return true;}), store=vi.fn(()=>{order.push('store');return true;});
    expect(prepareUpdateHandoff()).toBe(false);
    const removeStore=registerUpdateCheckpoint('trading-view',store,100), removeChart=registerUpdateCheckpoint('chart-fixture',chart);
    try {expect(prepareUpdateHandoff()).toBe(true);expect(order).toEqual(['chart','store']);chart.mockReturnValue(false);expect(prepareUpdateHandoff()).toBe(false);expect(store).toHaveBeenCalledOnce();}
    finally {removeChart();removeStore();} expect(prepareUpdateHandoff()).toBe(false);
});
