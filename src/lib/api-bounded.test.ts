import { afterEach, expect, it, vi } from 'vitest';
import { apiPostBounded, BoundedApiError } from './api';
vi.mock('./runtime', () => ({ isTauri: false, getApiBase: () => '' }));
vi.mock('./runtime-mode', () => ({ assertRuntimeAllowsRequest: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it('limits actual body bytes without relying on content-length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"large":"payload"}')));
    await expect(apiPostBounded('/api/v1/data/ticks', {}, 4, 100)).rejects.toThrow('容量');
});
it('deadline covers a stalled body even if the transport ignores abort', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start() {} }))));
    await expect(apiPostBounded('/api/v1/data/ticks', {}, 100, 20)).rejects.toThrow('逾時');
});
it('returns complete JSON and rejects malformed payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"count":3}')));
    await expect(apiPostBounded('/api/v1/data/ticks', {}, 100, 100)).resolves.toEqual({ count: 3 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{')));
    await expect(apiPostBounded('/api/v1/data/ticks', {}, 100, 100)).rejects.toThrow();
});
it('preserves HTTP status and Retry-After for persistent caller cooldown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '45' } })));
    const error = await apiPostBounded('/api/v1/data/ticks', {}, 100, 100).catch(value => value);
    expect(error).toBeInstanceOf(BoundedApiError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 45_000 });
});
