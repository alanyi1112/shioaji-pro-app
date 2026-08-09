import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndicatorReadoutValues } from './indicator-readout-values';

describe('IndicatorReadoutValues', () => {
    it('以同色不可拆單位呈現 prefix、數值與 accessible name', () => {
        const html = renderToStaticMarkup(
            <IndicatorReadoutValues
                values={[
                    {
                        key: 'upper',
                        label: '上軌',
                        prefix: '上',
                        text: '952.9',
                        color: '#5a89c9',
                    },
                    {
                        key: 'mid',
                        label: '中軌',
                        prefix: '中軌',
                        text: '—',
                        color: '#8b94a7',
                    },
                ]}
            />,
        );
        expect(html).toContain('data-indicator-readout-values="true"');
        expect(html).toContain('data-indicator-readout-value="upper"');
        expect(html).toContain('aria-label="上 952.9"');
        expect(html).toContain('title="中軌 —"');
        expect(html).toContain('style="color:#5a89c9"');
        expect(html).toContain('<span>上 </span>952.9');
        expect(html).not.toContain('aria-live');
    });

    it('沒有 prefix 的既有 indicator 保留 output label 語意', () => {
        const html = renderToStaticMarkup(
            <IndicatorReadoutValues
                values={[
                    {
                        key: 'line',
                        label: 'MA',
                        text: '100.0',
                        color: '#e0a43c',
                    },
                ]}
            />,
        );
        expect(html).toContain('aria-label="MA 100.0"');
        expect(html).not.toContain('<span>MA </span>');
    });
});
