/** 一次 port 呼叫就是一次 HTTP request：不跟轉址、不內建重試、不使用 broker。 */
import { request as httpsRequest } from 'node:https';
import { bollingerSourceUrl } from '../src/lib/stock-screener-bollinger-source.ts';

const TRANSPORT_REASONS = {
    ECONNRESET: 'source_connection_reset', ETIMEDOUT: 'source_timeout',
    ENOTFOUND: 'source_dns_failed', EAI_AGAIN: 'source_dns_failed',
    ECONNREFUSED: 'source_connection_refused', ABORT_ERR: 'source_aborted',
    CERT_HAS_EXPIRED: 'source_tls_verification_failed',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'source_tls_verification_failed',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'source_tls_verification_failed',
    ERR_TLS_CERT_ALTNAME_INVALID: 'source_tls_verification_failed',
};

/** 只保存有界的傳輸分類，不把任意 error.message、headers 或憑證內容寫入收據。 */
export function bollingerTransportFailureEvidence(error) {
    const evidence = error?.transportEvidence;
    return evidence?.version === 1 ? evidence : null;
}

function fetchOnce(request, sourceUrl, market, signal, maxBytes, purpose) {
    return new Promise((resolve, reject) => {
        let phase = 'request_created', bytes = 0, statusCode = null, tlsProtocol = null, tlsAuthorized = null;
        const fail = (error, reason) => {
            const code = Object.hasOwn(TRANSPORT_REASONS, error?.code) ? error.code
                : Object.hasOwn(TRANSPORT_REASONS, error?.message) ? error.message : null;
            const failure = new Error(reason ?? TRANSPORT_REASONS[code] ?? 'source_transport_failed', { cause: error });
            failure.transportEvidence = Object.freeze({ version: 1, phase, code, bytes, statusCode, tlsProtocol, tlsAuthorized });
            reject(failure);
        };
        // 官方站目前協商 TLS1.2；保持系統憑證驗證，不將此設定當作 API 可用性的保證。
        const req = request(sourceUrl, { method: 'GET', signal, timeout: 30000,
            ...(market === 'TPEx' ? { maxVersion: 'TLSv1.2' } : {}),
            headers: { 'accept-encoding': 'identity', 'user-agent': `RealTimeStock/1.0 (${purpose})` } }, response => {
            phase = 'response_headers'; statusCode = response.statusCode ?? null;
            const chunks = [];
            response.on('data', chunk => {
                phase = 'response_body'; bytes += chunk.length;
                if (bytes > maxBytes) { response.destroy(new Error('invalid_source_size')); return; }
                chunks.push(chunk);
            });
            response.on('error', error => fail(error, error.message === 'invalid_source_size' ? 'invalid_source_size' : undefined));
            response.on('aborted', () => fail(new Error('response_aborted'), 'source_response_aborted'));
            response.on('end', () => resolve({ sourceUrl, status: response.statusCode ?? 500,
                retryAfter: response.headers['retry-after'] ?? null,
                text: Buffer.concat(chunks).toString('utf8'), fetchedAt: new Date().toISOString() }));
        });
        req.on('socket', socket => socket.on('secureConnect', () => {
            tlsAuthorized = socket.authorized === true;
            const protocol = socket.getProtocol();
            tlsProtocol = /^TLSv1\.[0-3]$/.test(protocol) ? protocol : null;
            phase = tlsAuthorized ? 'tls_verified' : 'tls_unverified';
        }));
        req.on('finish', () => { phase = 'request_sent'; });
        req.on('error', error => fail(error));
        req.on('timeout', () => req.destroy(Object.assign(new Error('source_timeout'), { code: 'ETIMEDOUT' })));
        req.end();
    });
}

export function createBollingerSourceFetcher(request = httpsRequest, { maxBytes = 8 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) throw new Error('invalid_source_budget');
    return async (target, signal) => {
        const sourceUrl = bollingerSourceUrl(target.market, target.sessionDate);
        return fetchOnce(request, sourceUrl, target.market, signal, maxBytes, 'local official-data collector');
    };
}

/** 日曆與成交日報分開：固定兩個官方 URL，每次只送一次，不跟轉址／重試。 */
export function createBollingerCalendarFetcher(request = httpsRequest) {
    return (market, year, signal) => {
        if (!['TWSE', 'TPEx'].includes(market) || !Number.isInteger(year) || year < 2020 || year > 2200) {
            return Promise.reject(new Error('invalid_calendar_target'));
        }
        const sourceUrl = market === 'TWSE'
            ? `https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=${year - 1911}`
            : `https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=${year}`;
        return fetchOnce(request, sourceUrl, market, signal, 2 * 1024 * 1024, 'local official-calendar collector');
    };
}

/** 官網實際表單採年度 startDate/endDate，不是 YYYYMMDD；不跟轉址、不重試。 */
export function createBollingerClosureFetcher(request = httpsRequest) {
    return (year, signal) => {
        if (!Number.isInteger(year) || year < 2020 || year > 2200) return Promise.reject(new Error('invalid_closure_target'));
        const url = `https://www.twse.com.tw/rwd/zh/news/newsList?response=json&startDate=${year}&endDate=${year}`;
        return fetchOnce(request, url, 'TWSE', signal, 2 * 1024 * 1024, 'local official-calendar closure collector');
    };
}
