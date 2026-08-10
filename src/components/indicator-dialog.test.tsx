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
        expect(html).toContain('K 線固定區間 Volume Profile');
        expect(html).not.toContain('Traditional Pivot Point');
        expect(html).not.toContain('PivotPoint');
    });

    it('Traditional Pivot 即使有 disabled reason 也不再出現在 picker', () => {
        const html = renderToStaticMarkup(
            <IndicatorDialog
                instances={[]}
                disabledTypes={
                    new Map([
                        [
                            'traditional-pivot',
                            '第一階段尚未支援 FUT／OPT',
                        ],
                    ])
                }
                onAdd={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(html).not.toContain('第一階段尚未支援 FUT／OPT');
        expect(html).not.toContain('Traditional Pivot Point');
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

    it('RSI 跨欄位錯誤可讀且阻止確認', () => {
        const inst = newInstance('rsi');
        inst.params = { shortPeriod: 20, longPeriod: 10 };
        const html = renderToStaticMarkup(
            <IndicatorSettingsModal
                inst={inst}
                timeframes={[{ label: '1m', minutes: 1 }]}
                onPatch={vi.fn()}
                onRemove={vi.fn()}
                onCommit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(html).toContain('短週期必須小於長週期');
        expect(html).toContain('長週期必須大於短週期');
        expect(html).toContain('aria-invalid="true"');
        expect(html).toContain('title="請先修正輸入欄位"');
        expect(html).toContain('disabled=""');
    });

    it('目標被其他圖移除時顯示 modal-local 衝突，不隱藏草稿', () => {
        const html = renderToStaticMarkup(
            <IndicatorSettingsModal
                inst={newInstance('sma')}
                timeframes={[{ label: '1m', minutes: 1 }]}
                errorMessage='此指標已在其他圖表中移除。草稿未寫回。'
                onPatch={vi.fn()}
                onRemove={vi.fn()}
                onCommit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(html).toContain('role="alert"');
        expect(html).toContain('此指標已在其他圖表中移除');
        expect(html).toContain('MA 移動平均');
    });
});
