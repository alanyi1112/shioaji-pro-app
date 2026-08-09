import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createFibonacciController } from '../lib/fibonacci-annotations';
import { FibonacciOverlay } from './fibonacci-overlay';

describe('FibonacciOverlay', () => {
    it('由 React 管理 SVG，圖層無 pointer 事件並輸出線、色帶、錨點與標籤', () => {
        const controller = createFibonacciController({
            getIdentity: () => 'STK|TSE|2330|5',
            storage: {
                getItem: () => null,
                setItem: () => {},
                removeItem: () => {},
            },
        });
        controller.restore();
        controller.arm('retracement');
        controller.addPoint({ time: 10, price: 100 });
        controller.addPoint({ time: 20, price: 200 });
        const html = renderToStaticMarkup(
            <FibonacciOverlay
                snapshot={controller.getSnapshot()}
                width={500}
                height={300}
                rightEdge={440}
                coordinates={{
                    timeToCoordinate: (time) => time * 10,
                    priceToCoordinate: (price) => 300 - price,
                }}
                formatPrice={(price) => price.toFixed(2)}
            />,
        );
        expect(html).toContain('data-fibonacci-overlay="true"');
        expect(html).toContain('candle-chart_fibonacciOverlay');
        expect(html.match(/data-fibonacci-band="true"/g)).toHaveLength(9);
        expect(html.match(/data-fibonacci-anchor="fixed"/g)).toHaveLength(2);
        expect(html).toContain('0.5 (150.00)');
    });

    it('pending preview 使用十字而非固定圓，並提供非顏色文字提示', () => {
        const controller = createFibonacciController({
            getIdentity: () => 'IND|TAIFEX|IX0001|1',
            storage: {
                getItem: () => null,
                setItem: () => {},
                removeItem: () => {},
            },
        });
        controller.restore();
        controller.arm('extension');
        controller.addPoint({ time: 10, price: 100 });
        controller.addPoint({ time: 20, price: 200 });
        controller.previewPoint({ time: 30, price: 150 });
        const html = renderToStaticMarkup(
            <FibonacciOverlay
                snapshot={controller.getSnapshot()}
                width={500}
                height={300}
                rightEdge={440}
                coordinates={{
                    timeToCoordinate: (time) => time * 10,
                    priceToCoordinate: (price) => 300 - price,
                }}
                formatPrice={(price) => price.toFixed(2)}
            />,
        );
        expect(html).toContain('data-fibonacci-anchor="preview"');
        expect(html).toContain('待選 C｜150.00');
        expect(html).toContain('data-fibonacci-price-guide="true"');
    });
});
