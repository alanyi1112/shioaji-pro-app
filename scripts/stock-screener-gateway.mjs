const PREFIX = '/api/stock-screener';
const TARGET = 'http://127.0.0.1:5174';
const paths = new Set([`${PREFIX}/status`, `${PREFIX}/results`]);
const keys = new Set(['version','mode','volume','volumeThreshold','volumeTurnover','volumeTurnoverMinimumWan',
    'holder','holderThreshold','holderMode','holderStreakWeeks','holderTurnover','holderTurnoverMinimumWan',
    'sort','direction','resultState','limit','cursor']);

export function validateScreenerGatewayRequest(req) {
    const raw = req.url ?? '/';
    let url;
    try { url = new URL(raw, 'http://127.0.0.1'); } catch { return { status: 400, reason: 'invalid_url' }; }
    if (!url.pathname.startsWith(PREFIX)) return null;
    if (!raw.startsWith(`${PREFIX}/`) || raw.includes('%') && /%2f|%5c|%2e/i.test(raw)) return { status: 400, reason: 'invalid_url' };
    if (req.method !== 'GET') return { status: 405, reason: 'method_not_allowed' };
    if (!paths.has(url.pathname)) return { status: 404, reason: 'route_not_allowed' };
    const host = req.headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):5173$/.test(host)) return { status: 403, reason: 'local_only' };
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return { status: 403, reason: 'same_origin_required' };
    if (req.headers['sec-fetch-site'] === 'cross-site') return { status: 403, reason: 'same_origin_required' };
    if (raw.length > 2400 || [...url.searchParams.keys()].some((key) => !keys.has(key) || url.searchParams.getAll(key).length !== 1)
        || url.pathname.endsWith('/status') && url.search
        || url.searchParams.has('limit') && (!/^\d{1,3}$/.test(url.searchParams.get('limit')) || Number(url.searchParams.get('limit')) < 1 || Number(url.searchParams.get('limit')) > 100)) return { status: 400, reason: 'invalid_query' };
    return { url: `${TARGET}${url.pathname}${url.search}` };
}

export function stockScreenerGateway(fetcher = fetch, timeoutMs = 8000) {
    return {
        name: 'realtimestock-local-stock-screener',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const checked = validateScreenerGatewayRequest(req);
                if (!checked) return next();
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Cache-Control', 'no-store');
                const reply = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
                if (checked.reason) return reply(checked.status, { reason: checked.reason });
                const controller = new AbortController();
                let timer;
                try {
                    const result = await Promise.race([
                        (async () => {
                            // Deliberately forward no credentials, cookies, caller headers, or body.
                            const response = await fetcher(checked.url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } });
                            const body = await response.text();
                            if (body.length > 1024 * 1024) throw new Error('response_too_large');
                            return { status: response.status, body: JSON.parse(body) };
                        })(),
                        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); }),
                    ]);
                    reply(result.status, result.body);
                } catch {
                    reply(503, { version: 2, state: 'unavailable', reason: 'local_data_service_unavailable', snapshotId: null,
                        universeRevision:null,formulaVersion:'after-market-v2',criteriaFingerprint:null,expectedSessionDate:null,createdAt: null,
                        anchors: { daily: null, weekly: null, weeklyPeriods:[] }, counts: null, byMarket: null, rows: [], nextCursor: null });
                } finally { clearTimeout(timer); controller.abort(); }
            });
        },
    };
}
