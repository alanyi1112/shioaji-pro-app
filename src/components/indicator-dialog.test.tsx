import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
    KBAR_READOUT_TYPE,
    newInstance,
} from '../lib/indicator-defs';
import {
    IndicatorDialog,
    IndicatorSettingsModal,
} from './indicator-dialog';

describe('K 棒價量 picker 與設定', () => {
    it('在主圖疊加顯示可搜尋 metadata，使用 K 圖示而非 series 色票', () => {
        const html = renderToStaticMarkup(
            <IndicatorDialog
                instances={[]}
                onAdd={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(html).toContain('K 棒價量');
        expect(html).toContain('時間區間、開高低收與成交量');
        expect(html).toContain('>K</span>');
        expect(html).toContain('一般指標同型可加多個；K 棒價量限一個');
    });

    it('readout 設定只提供時框顯示與移除', () => {
        const html = renderToStaticMarkup(
            <IndicatorSettingsModal
                inst={newInstance(KBAR_READOUT_TYPE)}
                timeframes={[
                    { label: '1m', minutes: 1 },
                    { label: '5m', minutes: 5 },
                ]}
                onPatch={vi.fn()}
                onRemove={vi.fn()}
                onCommit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(html).toContain('時框顯示');
        expect(html).toContain('移除');
        expect(html).not.toContain('>樣式<');
        expect(html).not.toContain('預設值');
        expect(html).not.toContain('小數位數');
    });
});
