import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SupportResistanceMenu } from './support-resistance-menu';

describe('SupportResistanceMenu', () => {
    it('renders the keyboard button with inactive default state', () => {
        const html = renderToStaticMarkup(
            <SupportResistanceMenu
                enabled={new Set()}
                readOnly={false}
                onToggle={vi.fn()}
                onConfigure={vi.fn()}
            />,
        );
        expect(html).toContain('壓撐');
        expect(html).toContain('aria-haspopup="dialog"');
        expect(html).toContain('aria-expanded="false"');
    });
});
