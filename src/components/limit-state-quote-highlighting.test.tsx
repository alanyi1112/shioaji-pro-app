import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WatchItem } from '../hooks/use-watchlist';
import type { ContractInfo } from '../lib/types/contract';
import type { Snapshot } from '../lib/types/market';

const quoteMocks = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../hooks/use-stream', () => ({
    useQuote: (code: string) => quoteMocks.get(code),
}));

import { QuoteBoard } from './quote-board';
import { WatchMini } from './tray-panel';
import { WatchRow } from './watchlist';

function contract(
    code: string,
    overrides: Partial<ContractInfo> = {},
): ContractInfo {
    return {
        code,
        name: `商品${code}`,
        region: 'TW',
        exchange: 'TSE',
        security_type: 'STK',
        target_code: null,
        currency: 'TWD',
        limit_up: 271.5,
        limit_down: 222,
        reference: 247,
        day_trade: 'Yes',
        update_date: '2026-08-10',
        category: '股票',
        margin_trading_balance: 0,
        short_selling_balance: 0,
        ...overrides,
    };
}

function snapshot(code: string, close: number): Snapshot {
    const change = close - 247;
    return {
        code,
        exchange: 'TSE',
        datetime: '2026-08-10T12:00:00+08:00',
        open: 247,
        high: Math.max(247, close),
        low: Math.min(247, close),
        close,
        average_price: 250,
        buy_price: close,
        buy_volume: 10,
        sell_price: close,
        sell_volume: 10,
        volume: 1,
        total_volume: 100,
        amount: close,
        total_amount: close * 100,
        change_price: change,
        change_rate: (change / 247) * 100,
        change_type: change > 0 ? 'Up' : change < 0 ? 'Down' : 'Unchanged',
        tick_type: 'Common',
        volume_ratio: 1,
        yesterday_volume: 100,
    };
}

function renderWatchRow(item: WatchItem, selected = false): string {
    return renderToStaticMarkup(
        <WatchRow
            item={item}
            selected={selected}
            dropTarget={false}
            spark={false}
            onSelect={vi.fn()}
            onRemove={vi.fn()}
            onDragStart={vi.fn()}
            onDragOver={vi.fn()}
            onDrop={vi.fn()}
        />,
    );
}

describe('漲跌停即時報價群組', () => {
    it('QuoteBoard 以 snapshot 合法漲停價反白群組、移除可見徽章並保留可存取文字', () => {
        const c = contract('2301');
        const html = renderToStaticMarkup(
            <QuoteBoard contract={c} snapshot={snapshot(c.code, 271.5)} />,
        );

        expect(html).toContain('data-quote-group="current"');
        expect(html).toContain('data-limit-state="up"');
        expect(html).toContain('>271.50</span>');
        expect(html).toContain('aria-label="漲停，最新價 271.50');
        expect(html).not.toContain('data-limit-badge=');
        expect(html).toContain('data-quote-summary="market"');
    });

    it('自選清單只反白跌停報價群組並提供可存取狀態', () => {
        const c = contract('2302');
        const html = renderWatchRow(
            { contract: c, snapshot: snapshot(c.code, 222) },
            true,
        );

        expect(html).toContain('data-limit-state="down"');
        expect(html).toContain('aria-label="跌停，最新價 222.00');
        expect(html).toContain(`>${c.code}</span>`);
        expect(html).toContain(`>${c.name}</span>`);
    });

    it('托盤迷你自選反白漲停報價群組並提供可存取狀態', () => {
        const c = contract('2303');
        const html = renderToStaticMarkup(
            <WatchMini
                item={{ contract: c, snapshot: snapshot(c.code, 271.5) }}
                spark={false}
            />,
        );

        expect(html).toContain('data-limit-state="up"');
        expect(html).toContain('aria-label="漲停，最新價 271.50');
        expect(html).toContain(`>${c.code}</span>`);
        expect(html).toContain(`>${c.name}</span>`);
    });

    it('live tick 離開漲停時覆蓋舊 snapshot 並移除反白', () => {
        const c = contract('2304');
        quoteMocks.set(c.code, {
            tick: {
                close: 270,
                price_chg: 23,
                open: 247,
                high: 271.5,
                low: 247,
                total_volume: 100,
                time: '12:00:01',
            },
        });

        const html = renderToStaticMarkup(
            <QuoteBoard contract={c} snapshot={snapshot(c.code, 271.5)} />,
        );

        expect(html).toContain('data-quote-group="current"');
        expect(html).not.toContain('data-limit-state=');
        expect(html).not.toContain('data-limit-badge=');
        expect(html).toContain('>270.00</span>');
    });

    it('成交 flash 與選取狀態不取代持續漲停狀態', () => {
        const c = contract('2305');
        quoteMocks.set(c.code, {
            tick: {
                close: 271.5,
                price_chg: 24.5,
            },
            flashSeq: 1,
            lastDir: 1,
        });

        const html = renderWatchRow({ contract: c }, true);

        expect(html).toContain('data-quote-flash="up"');
        expect(html).toContain('data-limit-state="up"');
        expect(html).toContain('aria-label="漲停');
    });

    it('一般價與指數不產生漲跌停反白', () => {
        const normal = contract('2306');
        const index = contract('IX0001', {
            security_type: 'IND',
            limit_up: 271.5,
            limit_down: 222,
        });

        const normalHtml = renderWatchRow({
            contract: normal,
            snapshot: snapshot(normal.code, 250),
        });
        const indexHtml = renderToStaticMarkup(
            <WatchMini
                item={{ contract: index, snapshot: snapshot(index.code, 271.5) }}
                spark={false}
            />,
        );

        expect(normalHtml).not.toContain('data-limit-state=');
        expect(normalHtml).not.toContain('aria-label="漲停');
        expect(indexHtml).not.toContain('data-limit-state=');
        expect(indexHtml).not.toContain('aria-label="漲停');
    });
});
