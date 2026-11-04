/** 年線暖機只走既有 MultiView 日線來源，絕不備援至券商分鐘 K。 */
export const CHART_DAILY_HISTORY_PATH = '/api/chart-daily-history/v1';
const loopback = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);
const proxyHeaders = ['forwarded', 'via', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'cf-connecting-ip'];

export function validateChartDailyHistoryRequest(req) {
    const raw = req.url ?? '';
    if (!raw.startsWith(CHART_DAILY_HISTORY_PATH)) return null;
    const url = new URL(raw, 'http://127.0.0.1');
    if (req.method !== 'GET') return { status: 405 };
    const host = req.headers?.host ?? '';
    if (!loopback(req.socket?.remoteAddress) || !loopback(req.socket?.localAddress)
        || !/^(?:127\.0\.0\.1|localhost|\[::1\]):5173$/.test(host)
        || req.headers.origin && req.headers.origin !== `http://${host}`
        || req.headers['sec-fetch-site'] === 'cross-site'
        || proxyHeaders.some(key => req.headers[key] !== undefined)) return { status: 403 };
    const symbol = url.searchParams.get('symbol');
    if (url.pathname !== CHART_DAILY_HISTORY_PATH || raw.length > 160 || raw.includes('%')
        || [...url.searchParams.keys()].some(key => key !== 'symbol')
        || url.searchParams.getAll('symbol').length !== 1
        || !/^\d{4,6}[A-Z]?\.(TW|TWO)$/.test(symbol ?? '')) return { status: 400 };
    return { symbol };
}

async function boundedBody(response) {
    if (!response.ok || !response.body) throw Error('daily_history_unavailable');
    const reader = response.body.getReader(), parts = [];
    let size = 0;
    try {
        for (;;) {
            const item = await reader.read();
            if (item.done) break;
            size += item.value.length;
            if (size > 2 * 1024 * 1024) throw Error('daily_history_response_too_large');
            parts.push(Buffer.from(item.value));
        }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

export function createChartDailyHistoryMiddleware({ fetchImpl = fetch, now = Date.now, timeoutMs = 20000 } = {}) {
    const cache = new Map(), pending = new Map();
    let queue = Promise.resolve();
    const remember = (symbol, body, ttl) => {
        cache.delete(symbol);
        cache.set(symbol, { until: now() + ttl, body });
        while (cache.size > 24) cache.delete(cache.keys().next().value);
    };
    const load = symbol => {
        const hit = cache.get(symbol);
        if (hit && hit.until > now()) return Promise.resolve(hit.body);
        if (pending.has(symbol)) return pending.get(symbol);
        if (pending.size >= 8) return Promise.reject(Error('daily_history_busy'));
        const request = queue.then(async () => {
            try {
                // Fixed origin/path/interval: callers cannot request minute bars or a broker fallback.
                const response = await fetchImpl(`http://127.0.0.1:5174/api/candles?symbol=${symbol}&interval=1d&display_count=500`, {
                    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' },
                });
                const value = await boundedBody(response);
                if (value.symbol !== symbol || value.interval !== '1d' || !Array.isArray(value.candles)
                    || value.candles.length > 500 || value.volumeContract?.canonicalVolumeUnit !== 'common_lot'
                    || !['yahoo-chart', 'yfinance', 'yfinance+twse-official-tail-v1', 'twse-official', 'tpex-official'].includes(value.volumeContract?.provider))
                    throw Error('daily_history_source_invalid');
                const body = { ok: true, symbol, interval: '1d', brokerRequests: 0, candles: value.candles,
                    volumeContract: value.volumeContract, continuity: value.dataWindow?.continuity ?? null };
                remember(symbol, body, 30 * 60000);
                return body;
            } catch {
                // Negative cache prevents failed views/reloads from repeatedly probing the provider.
                const body = { ok: false, reason: 'daily_history_unavailable', brokerRequests: 0 };
                remember(symbol, body, 60000);
                throw Error('daily_history_unavailable');
            }
        });
        queue = request.catch(() => {});
        pending.set(symbol, request);
        request.finally(() => pending.delete(symbol)).catch(() => {});
        return request;
    };
    return async (req, res, next) => {
        const checked = validateChartDailyHistoryRequest(req);
        if (!checked) return next();
        const reply = (status, body) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.end(JSON.stringify(body));
        };
        if (checked.status) return reply(checked.status, { ok: false, reason: 'daily_history_request_denied' });
        try { const body = await load(checked.symbol); return reply(body.ok ? 200 : 503, body); }
        catch { return reply(503, { ok: false, reason: 'daily_history_unavailable', brokerRequests: 0 }); }
    };
}
