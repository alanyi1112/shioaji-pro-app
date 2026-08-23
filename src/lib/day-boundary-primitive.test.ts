import { describe, expect, it, vi } from 'vitest';
import type { PaneAttachedParameter, Time } from 'lightweight-charts';
import {
    DAY_BOUNDARY_WIDTH_CSS_PX,
    DayBoundaryPaneManager,
    DayBoundaryPrimitive,
} from './day-boundary-primitive';

function drawPrimitive(
    primitive: DayBoundaryPrimitive,
    { horizontalPixelRatio = 2 } = {},
) {
    const fillRect = vi.fn();
    const context = {
        save: vi.fn(),
        restore: vi.fn(),
        fillRect,
        fillStyle: '',
    };
    const target = {
        useBitmapCoordinateSpace: (callback: (scope: unknown) => unknown) =>
            callback({
                context,
                mediaSize: { width: 100, height: 50 },
                bitmapSize: { width: 200, height: 100 },
                horizontalPixelRatio,
                verticalPixelRatio: 2,
            }),
    };
    const renderer = primitive.paneViews()[0]!.renderer() as {
        draw: (drawTarget: unknown) => void;
    } | null;
    renderer?.draw(target);
    return fillRect;
}

describe('DayBoundaryPrimitive', () => {
    it('預設使用獨立亮黃色，不沿用 grid color', () => {
        expect(new DayBoundaryPrimitive().color).toBe('#facc15');
    });

    it('在兩根 candle 中點畫 1.2 CSS px，HiDPI 2x 換算為 2.4 bitmap px', () => {
        expect(DAY_BOUNDARY_WIDTH_CSS_PX).toBe(1.2);
        const requestUpdate = vi.fn();
        const chart = {
            timeScale: () => ({
                timeToCoordinate: (time: number) =>
                    time === 100 ? 0 : time === 200 ? 10 : null,
            }),
        };
        const primitive = new DayBoundaryPrimitive();
        primitive.attached({ chart, requestUpdate } as unknown as PaneAttachedParameter<Time>);
        primitive.setData(
            [{ previousTime: 100, nextTime: 200 }],
            'rgba(1, 2, 3, 0.5)',
        );
        expect(requestUpdate).toHaveBeenCalledOnce();
        const fillRect = drawPrimitive(primitive);
        expect(fillRect).toHaveBeenCalledWith(8.8, 0, 2.4, 100);
        expect(
            drawPrimitive(primitive, { horizontalPixelRatio: 1 }),
        ).toHaveBeenCalledWith(4.4, 0, 1.2, 100);
        expect('hitTest' in primitive).toBe(false);
    });

    it('相同 boundaries 在不同 pane primitive 產生相同 X 座標', () => {
        const chart = {
            timeScale: () => ({
                timeToCoordinate: (time: number) => (time === 1 ? 20 : 30),
            }),
        };
        const first = new DayBoundaryPrimitive();
        const second = new DayBoundaryPrimitive();
        for (const primitive of [first, second]) {
            primitive.attached({ chart, requestUpdate: vi.fn() } as unknown as PaneAttachedParameter<Time>);
            primitive.setData([{ previousTime: 1, nextTime: 2 }], '#123456');
        }
        expect(drawPrimitive(first).mock.calls[0]?.[0]).toBe(
            drawPrimitive(second).mock.calls[0]?.[0],
        );
    });

    it('平移或縮放後以最新 time coordinate 重畫，不保存舊 X', () => {
        let previousX = 20;
        let nextX = 30;
        const chart = {
            timeScale: () => ({
                timeToCoordinate: (time: number) =>
                    time === 1 ? previousX : nextX,
            }),
        };
        const primitive = new DayBoundaryPrimitive();
        primitive.attached({ chart, requestUpdate: vi.fn() } as unknown as PaneAttachedParameter<Time>);
        primitive.setData([{ previousTime: 1, nextTime: 2 }], '#123456');
        expect(drawPrimitive(primitive)).toHaveBeenCalledWith(48.8, 0, 2.4, 100);

        previousX = 40;
        nextX = 60;
        expect(drawPrimitive(primitive)).toHaveBeenCalledWith(98.8, 0, 2.4, 100);
    });
});

describe('DayBoundaryPaneManager', () => {
    type Pane = Parameters<DayBoundaryPaneManager['reconcile']>[0][number];

    const pane = (): Pane =>
        ({
            attachPrimitive: vi.fn(),
            detachPrimitive: vi.fn(),
        }) as unknown as Pane;

    it('副圖新增、重排與移除只 reconcile primitive，不建立重複 attachment', () => {
        const created: DayBoundaryPrimitive[] = [];
        const manager = new DayBoundaryPaneManager(() => {
            const primitive = new DayBoundaryPrimitive();
            vi.spyOn(primitive, 'setData');
            created.push(primitive);
            return primitive;
        });
        const main = pane();
        const rsi = pane();
        const macd = pane();
        const boundaries = [{ previousTime: 1, nextTime: 2 }];

        manager.reconcile([main, rsi], boundaries, '#111111');
        manager.reconcile([rsi, main], boundaries, '#222222');
        expect(manager.size).toBe(2);
        expect(main.attachPrimitive).toHaveBeenCalledOnce();
        expect(rsi.attachPrimitive).toHaveBeenCalledOnce();
        expect(created[0]?.setData).toHaveBeenLastCalledWith(
            boundaries,
            '#222222',
        );

        manager.reconcile([rsi, macd], boundaries, '#333333');
        expect(main.detachPrimitive).toHaveBeenCalledOnce();
        expect(macd.attachPrimitive).toHaveBeenCalledOnce();
        expect(manager.size).toBe(2);

        manager.destroy();
        expect(rsi.detachPrimitive).toHaveBeenCalledOnce();
        expect(macd.detachPrimitive).toHaveBeenCalledOnce();
        expect(manager.size).toBe(0);
    });

    it('history paging 與 theme 更新只重送資料並要求 redraw', () => {
        const primitive = new DayBoundaryPrimitive();
        const setData = vi.spyOn(primitive, 'setData');
        const manager = new DayBoundaryPaneManager(() => primitive);
        const main = pane();
        manager.reconcile(
            [main],
            [{ previousTime: 1, nextTime: 2 }],
            '#111111',
        );
        manager.update(
            [
                { previousTime: 1, nextTime: 2 },
                { previousTime: 3, nextTime: 4 },
            ],
            '#abcdef',
        );
        expect(setData).toHaveBeenLastCalledWith(
            [
                { previousTime: 1, nextTime: 2 },
                { previousTime: 3, nextTime: 4 },
            ],
            '#abcdef',
        );
        expect(main.attachPrimitive).toHaveBeenCalledOnce();
    });
});
