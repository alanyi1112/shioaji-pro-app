import { afterEach, describe, expect, it } from 'vitest';
import * as styles from './candle-chart.css';

describe('indicator readout browser layout', () => {
    afterEach(() => document.body.replaceChildren());

    it('窄版只在 output 單位之間換行且不超出父層', async () => {
        const host = document.createElement('div');
        host.style.width = '220px';
        const row = document.createElement('div');
        row.className = styles.legendItem.normal;
        const values = document.createElement('span');
        values.className = styles.legendVals;
        for (const text of [
            '5MA 929.8',
            '10MA 934.1',
            '20MA 937.5',
            '60MA 939.8',
            '120MA 911.2',
        ]) {
            const value = document.createElement('span');
            value.className = styles.legendVal;
            value.textContent = text;
            values.append(value);
        }
        row.append(values);
        host.append(row);
        document.body.append(host);

        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
        );

        expect(getComputedStyle(values).flexWrap).toBe('wrap');
        for (const value of values.children) {
            expect(getComputedStyle(value).whiteSpace).toBe('nowrap');
        }
        expect(row.getBoundingClientRect().width).toBeLessThanOrEqual(
            host.getBoundingClientRect().width,
        );
        expect(row.getBoundingClientRect().height).toBeGreaterThan(
            values.firstElementChild!.getBoundingClientRect().height,
        );
    });
});
