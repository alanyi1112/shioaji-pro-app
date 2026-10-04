import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { StockScreenerDailyBollinger } from './stock-screener-daily-bollinger';
import { dailyBollingerCriteria } from '../lib/stock-screener-daily-bollinger-ui';
import type { BollingerDailyProfileView } from '../lib/stock-screener-bollinger-api';
import { darkTwClass } from '../theme.css';
import * as styles from './stock-screener-panel.css';
import '../index.css';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.restoreAllMocks(); });
async function mount(profile: BollingerDailyProfileView | null = null, busy = false, width = 320) {
    host = document.createElement('div'); host.className = `${darkTwClass} ${styles.root}`;
    host.style.width = `${width}px`; host.style.boxSizing = 'border-box'; document.body.append(host); root = createRoot(host);
    const onSave = vi.fn(async () => {});
    await act(async () => root.render(createElement(StockScreenerDailyBollinger, { profile, ready: true, busy, onSave })));
    return { onSave, details: host.querySelector('details')! };
}
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
describe('每日布林收合控制（隔離 UI fixture，不寫正式設定）', () => {
    it('預設收合、全選且展開不觸發儲存', async () => {
        const { details, onSave } = await mount(); expect(details.open).toBe(false);
        await act(async () => details.querySelector('summary')!.click()); expect(details.open).toBe(true);
        expect([...host.querySelectorAll('button[aria-pressed]')].map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true']);
        expect(host.querySelectorAll('details')[1]?.open).toBe(false); expect(onSave).not.toHaveBeenCalled();
    });
    it('切換只改草稿，明確儲存單一階段與原參數', async () => {
        const criteria = dailyBollingerCriteria(null); criteria.bollSqueezeStages.breakoutVolumeRatio = '2';
        const { details, onSave } = await mount({ revision: 2, enabled: true, criteria, createdAt: '2026-10-04' });
        await act(async () => details.querySelector('summary')!.click());
        await act(async () => { button('正在壓縮').click(); button('準備突破').click(); });
        expect(onSave).not.toHaveBeenCalled(); expect(host.textContent).toContain('尚未儲存');
        await act(async () => button('儲存每日策略').click());
        expect(onSave).toHaveBeenCalledExactlyOnceWith(true, expect.objectContaining({ bollSqueezeStages: expect.objectContaining({ stages: ['breakout'], breakoutVolumeRatio: '2' }) }));
        expect(criteria.bollSqueezeStages.stages).toHaveLength(3);
    });
    it('既有部分選擇保留；全取消禁止儲存但可停用原設定', async () => {
        const criteria = dailyBollingerCriteria(null); criteria.bollSqueezeStages.stages = ['breakout'];
        const { details, onSave } = await mount({ revision: 4, enabled: true, criteria, createdAt: '2026-10-04' });
        await act(async () => details.querySelector('summary')!.click());
        expect(button('正在壓縮').getAttribute('aria-pressed')).toBe('false');
        await act(async () => button('今日正式突破').click()); expect(button('儲存每日策略').disabled).toBe(true);
        expect(host.textContent).toContain('至少選取一個');
        await act(async () => button('停用每日布林策略').click()); expect(onSave).toHaveBeenCalledExactlyOnceWith(false);
    });
    it('附註反映非預設數值與真實日期邊界、320px不溢位、鍵盤可切換', async () => {
        const criteria = dailyBollingerCriteria(null); Object.assign(criteria.bollSqueezeStages, { minimumPrice: 35, lookbackDays: 100, breakoutVolumeRatio: '2' });
        const { details } = await mount({ revision: 3, enabled: true, criteria, createdAt: '2026-10-04' });
        await act(async () => details.querySelector('summary')!.click());
        await act(async () => host.querySelectorAll('details')[1]!.querySelector('summary')!.click());
        expect(host.textContent).toContain('≥ 35 元'); expect(host.textContent).toContain('前 100 日'); expect(host.textContent).toContain('前 20 日均量 × 2（不含今日）');
        expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
        button('正在壓縮').focus(); await act(async () => { await userEvent.keyboard('{Enter}'); });
        expect(button('正在壓縮').getAttribute('aria-pressed')).toBe('false');
    });
    it('儲存中鎖定切換與停用，避免並行草稿遺失', async () => {
        const criteria = dailyBollingerCriteria(null); await mount({ revision: 1, enabled: true, criteria, createdAt: '2026-10-04' }, true);
        expect([...host.querySelectorAll('button')].every(b => b.disabled)).toBe(true);
    });
});
