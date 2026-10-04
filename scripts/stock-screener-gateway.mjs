const PREFIX = '/api/stock-screener';
const TARGET = 'http://127.0.0.1:5174';
export const STOCK_SCREENER_MULTIVIEW_LIST_PATH = '/local-multiview/api/v1/stock-screener-list/items';
const STOCK_SCREENER_MULTIVIEW_LIST_TARGET = 'http://127.0.0.1:5174/api/integrations/stock-screener-list/items';
const STOCK_SCREENER_MULTIVIEW_LIST_SCHEMA = 'multiview-stock-screener-list-sync/1';
const STOCK_SCREENER_MULTIVIEW_LIST_MAX_BODY_BYTES = 512;
const rejectedProxyHeaders = new Set(['forwarded', 'via', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip', 'cf-ray', 'cdn-loop']);
const paths = new Set([`${PREFIX}/status`, `${PREFIX}/results`, `${PREFIX}/daily-profile`]);
const keys = new Set(['version','mode','volume','volumeThreshold','volumeTurnover','volumeTurnoverMinimumWan',
    'holder','holderThreshold','holderMode','holderStreakWeeks','holderTurnover','holderTurnoverMinimumWan',
    'fractal','fractalAlgorithm','fractalDirection','bollReversal','bollMode',
    'ma','maMode','compressionDays','maxSpreadPct','divergence','divergenceSource','divergenceDirection','requireZeroReset',
    'largeHolderTrendEnabled','largeHolderTrendMinimumRatioPct','largeHolderTrendMaximumRatioPct','largeHolderTrendWeeks','largeHolderTrendMinimumIncreasePp',
    'largeHolderConcentrationEnabled','largeHolderConcentrationWeeks','retailHolderDeclineEnabled','retailHolderDeclineWeeks',
    'trustOwnershipEnabled','trustOwnershipDays','trustOwnershipMinimumPct','priceMarginEnabled','priceMarginDays',
    'shortMarginRatioEnabled','shortMarginRatioMinimumPct','closeHighEnabled','closeHighDays','closeSmaBreakoutEnabled','closeSmaBreakoutPeriod',
    'foreignReversalEnabled','foreignReversalSellStreakDays','foreignReversalTodayNetBuyMinimumLots','foreignReversalMinimumTurnoverPct',
    'foreignReversalComparisonDays','foreignReversalTurnoverMultiple','foreignReversalMaPeriod','foreignReversalLiquidityDays','foreignReversalMinimumAverageVolumeLots',
    'trustReversalEnabled','trustReversalSellStreakDays','trustReversalTodayNetBuyMinimumLots','trustReversalMinimumTurnoverPct',
    'trustReversalComparisonDays','trustReversalTurnoverMultiple','trustReversalMaPeriod','trustReversalLiquidityDays','trustReversalMinimumAverageVolumeLots',
    'trustReversalMinimumRecoveryPct','trustReversalMinimumParticipationPct','trustReversalMaximumParticipationPct',
    'bollPositionEnabled','bollPositionMode','bollPositionTolerancePercent','bollPositionMiddleTrend',
    'rsiCrossEnabled','rsiCrossMode','rsiCrossHighThreshold','rsiCrossLowThreshold',
    'kdCrossEnabled','kdCrossMode','kdCrossHighThreshold','kdCrossLowThreshold',
    'macdSignalEnabled','macdSignalMode','macdSignalApproachThresholdPct',
    ...['bollPosition','rsiCross','kdCross','macdSignal'].flatMap(prefix => [
        `${prefix}VolumeEnabled`,`${prefix}VolumeBaselineDays`,`${prefix}VolumeRatio`,
        `${prefix}VolumeMinimumAverageVolumeEnabled`,`${prefix}VolumeMinimumAverageVolumeLots`]),
    'sort','direction','resultState','limit','cursor']);

const requestedVersion = (url) => url.searchParams.get('version') === '9' ? 9 : url.searchParams.get('version') === '8' ? 8 : url.searchParams.get('version') === '7' ? 7 : url.searchParams.get('version') === '6' ? 6 : url.searchParams.get('version') === '5' ? 5 : url.searchParams.get('version') === '4' ? 4 : url.searchParams.get('version') === '3' ? 3 : 2;

const unavailablePayload = (version) => version === 9
    ? { version: 9, state: 'unavailable', reason: 'local_data_service_unavailable', snapshotId: null, canUseResults: false,
        formulaVersion: 'candlestick-reversal-v1', capability: 'candlestick-ohlcv-history-v1',
        expectedSessionDate: null, effectiveSessionDate: null, rows: [], nextCursor: null }
    : version === 8
    ? { version: 8, state: 'unavailable', reason: 'local_data_service_unavailable', snapshotId: null,
        formulaVersion: 'bollinger-squeeze-stages-v1', sourceMappingVersion: 'official-daily-ohlcv-turnover-v1',
        expectedSessionDate: null, effectiveSessionDate: null, rows: [], nextCursor: null }
    : version === 7
    ? { version: 7, state: 'unavailable', reason: 'local_data_service_unavailable', snapshotId: null,
        universeRevision: null, formulaVersion: 'after-market-v7-boll-rsi-kd-macd-1', sourceMappingVersion: 'official-daily-ohlcv-v2', criteriaFingerprint: null,
        expectedSessionDate: null, effectiveSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] },
        technicalAnchors: null, counts: null, byMarket: null, preparation: null, chipCoverage: null, institutionalCoverage: null,
        technicalCoverage: null, rows: [], nextCursor: null }
    : version === 6
    ? { version: 6, state: 'unavailable', reason: 'local_data_service_unavailable', snapshotId: null,
        universeRevision: null, formulaVersion: 'after-market-v6-institutional-reversal-1', sourceMappingVersion: 'official-market-institutional-v2', criteriaFingerprint: null,
        expectedSessionDate: null, effectiveSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] },
        technicalAnchors: null, counts: null, byMarket: null, preparation: null, chipCoverage: null, institutionalCoverage: null, chipHealth: null, rows: [], nextCursor: null }
    : version === 5
    ? { version: 5, state: 'unavailable', reason: 'local_data_service_unavailable', snapshotId: null,
        universeRevision: null, formulaVersion: 'after-market-v5-chip-price-1', sourceMappingVersion: 'official-market-chip-v1', criteriaFingerprint: null,
        expectedSessionDate: null, effectiveSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] },
        technicalAnchors: null, counts: null, byMarket: null, preparation: null, chipCoverage: null, chipHealth: null, rows: [], nextCursor: null }
    : version === 4
    ? { version: 4, state: 'unavailable', reason: 'local_data_service_unavailable', snapshotId: null,
        universeRevision: null, formulaVersion: 'after-market-v4-ma-divergence-multichart-ecae7ca-v1', sourceMappingVersion: 'official-daily-ohlcv-v2', criteriaFingerprint: null,
        expectedSessionDate: null, effectiveSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] },
        technicalAnchors: null, counts: null, byMarket: null, preparation: null, rows: [], nextCursor: null }
    : version === 3
    ? { version: 3, state: 'unavailable', reason: 'local_data_service_unavailable', snapshotId: null,
        universeRevision: null, formulaVersion: 'after-market-v3-technical-multichart-ecae7ca-v1', criteriaFingerprint: null,
        expectedSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] },
        technicalAnchors: null, counts: null, byMarket: null, preparation: null, rows: [], nextCursor: null }
    : { version: 2, state: 'unavailable', reason: 'local_data_service_unavailable', snapshotId: null,
        universeRevision: null, formulaVersion: 'after-market-v2', criteriaFingerprint: null,
        expectedSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] },
        counts: null, byMarket: null, rows: [], nextCursor: null };

const isLoopbackAddress = (value) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);

export function validateStockScreenerMultiViewListRequest(req) {
    const raw = req.url ?? '/';
    let url;
    try { url = new URL(raw, 'http://127.0.0.1'); } catch { return { status: 400, reason: 'invalid_url' }; }
    if (!(raw === STOCK_SCREENER_MULTIVIEW_LIST_PATH || raw.startsWith(`${STOCK_SCREENER_MULTIVIEW_LIST_PATH}?`))) return null;
    if (raw !== STOCK_SCREENER_MULTIVIEW_LIST_PATH || url.search !== '' || /%(?:2f|5c|2e|00)/i.test(raw)) return { status: 400, reason: 'invalid_url' };
    if (req.method !== 'POST') return { status: 405, reason: 'method_not_allowed' };
    if (!isLoopbackAddress(req.socket?.remoteAddress) || !isLoopbackAddress(req.socket?.localAddress)) return { status: 403, reason: 'loopback_required' };
    const headers = req.headers ?? {};
    const host = headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):(?:[1-9]\d{0,4})$/.test(host)) return { status: 403, reason: 'local_only' };
    if (headers.origin !== undefined && headers.origin !== `http://${host}`) return { status: 403, reason: 'same_origin_required' };
    if (headers['sec-fetch-site'] === 'cross-site') return { status: 403, reason: 'same_origin_required' };
    if ([...rejectedProxyHeaders].some((name) => headers[name] !== undefined)) return { status: 403, reason: 'hosted_target_disabled' };
    if (String(headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') return { status: 415, reason: 'json_required' };
    const declaredLength = headers['content-length'];
    if (declaredLength !== undefined && (!/^\d+$/.test(String(declaredLength)) || Number(declaredLength) > STOCK_SCREENER_MULTIVIEW_LIST_MAX_BODY_BYTES)) return { status: 413, reason: 'payload_too_large' };
    return { url: STOCK_SCREENER_MULTIVIEW_LIST_TARGET };
}

export function validateStockScreenerMultiViewListPayload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'symbol') return null;
    const symbol = String(value.symbol ?? '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');
    return /^[0-9A-Z]{4,8}\.(TW|TWO)$/.test(symbol) ? { symbol } : null;
}

function readJsonBody(request, timeoutMs = 3000, maximumBytes = STOCK_SCREENER_MULTIVIEW_LIST_MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const finish = (callback) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback();
        };
        const timer = setTimeout(() => finish(() => reject(new Error('body_timeout'))), timeoutMs);
        timer.unref?.();
        request.on('data', (chunk) => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > maximumBytes) return finish(() => reject(new Error('payload_too_large')));
            chunks.push(buffer);
        });
        request.once('end', () => finish(() => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(new Error('invalid_json')); }
        }));
        request.once('error', () => finish(() => reject(new Error('invalid_request'))));
    });
}

function safeMultiViewListResponse(status, value) {
    const body = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    if (status >= 200 && status < 300 && body.ok === true && ['added', 'already_present'].includes(body.status)
        && /^[0-9A-Z]{4,8}\.(TW|TWO)$/.test(String(body.symbol || ''))
        && typeof body.tabId === 'string' && typeof body.tabLabel === 'string') {
        return { status, body: { schemaVersion: STOCK_SCREENER_MULTIVIEW_LIST_SCHEMA, ok: true, status: body.status, symbol: body.symbol, tabId: body.tabId, tabLabel: body.tabLabel } };
    }
    const reason = typeof body.reason === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(body.reason) ? body.reason : 'multiview_rejected';
    return { status: status >= 400 && status <= 599 ? status : 502, body: { schemaVersion: STOCK_SCREENER_MULTIVIEW_LIST_SCHEMA, ok: false, reason, retryable: body.retryable === true || status >= 500 } };
}

export function validateScreenerGatewayRequest(req) {
    const raw = req.url ?? '/';
    let url;
    try { url = new URL(raw, 'http://127.0.0.1'); } catch { return { status: 400, reason: 'invalid_url' }; }
    if (!url.pathname.startsWith(PREFIX)) return null;
    if (!raw.startsWith(`${PREFIX}/`) || raw.includes('%') && /%2f|%5c|%2e/i.test(raw)) return { status: 400, reason: 'invalid_url' };
    const profileWrite = req.method === 'PUT' && url.pathname === `${PREFIX}/daily-profile` && url.searchParams.get('version') === '8';
    if (req.method !== 'GET' && !profileWrite) return { status: 405, reason: 'method_not_allowed' };
    if (!paths.has(url.pathname)) return { status: 404, reason: 'route_not_allowed' };
    const host = req.headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):5173$/.test(host)) return { status: 403, reason: 'local_only' };
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return { status: 403, reason: 'same_origin_required' };
    if (req.headers['sec-fetch-site'] === 'cross-site') return { status: 403, reason: 'same_origin_required' };
    const version = url.searchParams.get('version');
    if (profileWrite && (!isLoopbackAddress(req.socket?.remoteAddress) || !isLoopbackAddress(req.socket?.localAddress)
        || [...rejectedProxyHeaders].some(h => req.headers[h] !== undefined))) return { status: 403, reason: 'loopback_required' };
    if (profileWrite && String(req.headers['content-type'] ?? '').split(';')[0] !== 'application/json') return { status: 415, reason: 'json_required' };
    const queryKeys = version === '9' ? new Set(['version', 'criteria', 'sort', 'direction', 'resultState', 'limit', 'cursor', 'snapshotId'])
        : version === '8' ? new Set(['version', 'criteria', 'sort', 'direction', 'resultState', 'stage', 'limit', 'cursor', 'snapshotId']) : keys;
    if (raw.length > 16384 || [...url.searchParams.keys()].some((key) => !queryKeys.has(key) || url.searchParams.getAll(key).length !== 1)
        || version !== null && version !== '2' && version !== '3' && version !== '4' && version !== '5' && version !== '6' && version !== '7' && version !== '8' && version !== '9'
        || url.pathname.endsWith('/daily-profile') && (version !== '8' || [...url.searchParams.keys()].some(k => k !== 'version'))
        || url.pathname.endsWith('/status') && [...url.searchParams.keys()].some((key) => key !== 'version')
        || url.searchParams.has('limit') && (!/^\d{1,3}$/.test(url.searchParams.get('limit')) || Number(url.searchParams.get('limit')) < 1 || Number(url.searchParams.get('limit')) > 100)) return { status: 400, reason: 'invalid_query' };
    return { url: `${TARGET}${url.pathname}${url.search}`, version: requestedVersion(url), profileWrite };
}

export function stockScreenerGateway(fetcher = fetch, timeoutMs = 8000) {
    return {
        name: 'realtimestock-local-stock-screener',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const multiviewChecked = validateStockScreenerMultiViewListRequest(req);
                if (multiviewChecked) {
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.setHeader('Cache-Control', 'no-store');
                    res.setHeader('X-Content-Type-Options', 'nosniff');
                    const reply = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
                    if (multiviewChecked.reason) return reply(multiviewChecked.status, { schemaVersion: STOCK_SCREENER_MULTIVIEW_LIST_SCHEMA, ok: false, reason: multiviewChecked.reason, retryable: false });
                    let payload;
                    try { payload = validateStockScreenerMultiViewListPayload(await readJsonBody(req)); }
                    catch (error) {
                        const reason = error?.message === 'payload_too_large' ? 'payload_too_large' : 'invalid_json';
                        return reply(reason === 'payload_too_large' ? 413 : 400, { schemaVersion: STOCK_SCREENER_MULTIVIEW_LIST_SCHEMA, ok: false, reason, retryable: false });
                    }
                    if (!payload) return reply(400, { schemaVersion: STOCK_SCREENER_MULTIVIEW_LIST_SCHEMA, ok: false, reason: 'invalid_payload', retryable: false });
                    const controller = new AbortController();
                    let timer;
                    try {
                        const result = await Promise.race([
                            (async () => {
                                const response = await fetcher(multiviewChecked.url, {
                                    method: 'POST', signal: controller.signal, redirect: 'error',
                                    headers: { accept: 'application/json', 'content-type': 'application/json' },
                                    body: JSON.stringify(payload),
                                });
                                const rawBody = await response.text();
                                if (Buffer.byteLength(rawBody) > 64 * 1024) throw new Error('response_too_large');
                                return safeMultiViewListResponse(response.status, JSON.parse(rawBody));
                            })(),
                            new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); }),
                        ]);
                        return reply(result.status, result.body);
                    } catch {
                        return reply(503, { schemaVersion: STOCK_SCREENER_MULTIVIEW_LIST_SCHEMA, ok: false, reason: 'multiview_unavailable', retryable: true });
                    } finally { clearTimeout(timer); controller.abort(); }
                }
                const checked = validateScreenerGatewayRequest(req);
                if (!checked) return next();
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Cache-Control', 'no-store');
                const reply = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
                if (checked.reason) return reply(checked.status, { reason: checked.reason });
                let profileBody;
                if (checked.profileWrite) {
                    try { profileBody = JSON.stringify(await readJsonBody(req, 3000, 16384)); }
                    catch (e) { return reply(e.message === 'payload_too_large' ? 413 : 400, { reason: e.message === 'payload_too_large' ? e.message : 'invalid_json' }); }
                }
                const controller = new AbortController();
                let timer;
                try {
                    const result = await Promise.race([
                        (async () => {
                            // Deliberately forward no credentials, cookies, caller headers, or body.
                            const response = await fetcher(checked.url, { signal: controller.signal, redirect: 'error',
                                ...(checked.profileWrite ? { method: 'PUT', body: profileBody } : {}),
                                headers: { accept: 'application/json', ...(checked.profileWrite ? { 'content-type': 'application/json' } : {}) } });
                            const body = await response.text();
                            if (Buffer.byteLength(body) > (checked.version >= 8 ? 8 : 1) * 1024 * 1024) throw new Error('response_too_large');
                            return { status: response.status, body: JSON.parse(body) };
                        })(),
                        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); }),
                    ]);
                    reply(result.status, result.body);
                } catch {
                    reply(503, unavailablePayload(checked.version));
                } finally { clearTimeout(timer); controller.abort(); }
            });
        },
    };
}
