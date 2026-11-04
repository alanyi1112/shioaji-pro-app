import { expect, it, vi } from 'vitest';
import { openWatchlistWindow } from './watchlist-window';

it('新分頁沿用目前的看盤版面與profile，清單由URL獨立指定', () => {
    const target = { open: vi.fn() };
    openWatchlistWindow('wl-ETF', target, 'http://127.0.0.1:5173/?layout=saved-profile&profile=易看盤');
    const [href, name, features] = target.open.mock.calls[0]!;
    const url = new URL(href); expect(url.searchParams.get('layout')).toBe('saved-profile');
    expect(url.searchParams.get('profile')).toBe('易看盤'); expect(url.searchParams.get('watchlist')).toBe('wl-ETF');
    expect(name).toBe('_blank'); expect(features).toBe('noopener');
});
