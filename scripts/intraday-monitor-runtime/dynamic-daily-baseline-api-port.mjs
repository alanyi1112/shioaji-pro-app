export const DYNAMIC_DAILY_BASELINE_API_PORT_SCHEMA = 'intraday-monitor-daily-baseline-api-port/1';
const MAX_RESPONSE_BYTES = 16 * 1024 ** 2;

function contract(request) {
    if (!/^(?!00)\d{4}$/.test(request?.code ?? '') ||
        !['TSE', 'OTC'].includes(request?.exchange) ||
        request.canonicalSymbol !== `${request.code}.${request.exchange === 'TSE' ? 'TW' : 'TWO'}`) {
        throw new TypeError('daily_baseline_contract_invalid');
    }
    return { security_type: 'STK', region: 'TW', exchange: request.exchange,
        code: request.code, target_code: null };
}

async function readLimited(response) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        throw new Error('baseline_response_too_large');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('baseline_provider_response_invalid');
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) throw new Error('baseline_response_too_large');
            chunks.push(value);
        }
    } finally { await reader.cancel().catch(() => {}); }
    const raw = Buffer.concat(chunks, bytes).toString('utf8');
    let value;
    try { value = JSON.parse(raw); }
    catch { throw new Error('baseline_provider_json_invalid'); }
    return { value, responseBytes: bytes };
}

// 僅封裝既有本機 simulation API 的唯讀資訊／歷史資料端點，不提供 login、stream 或交易方法。
export function createDynamicDailyBaselineApiPort({ fetchImpl = fetch,
    api = 'http://127.0.0.1:8080', now = () => new Date().toISOString() } = {}) {
    if (typeof fetchImpl !== 'function' ||
        typeof now !== 'function' ||
        !/^http:\/\/127\.0\.0\.1:\d+$/.test(api)) {
        throw new TypeError('daily_baseline_api_port_invalid');
    }
    async function request(pathname, body = undefined, signal = undefined) {
        const response = await fetchImpl(`${api}${pathname}`, {
            method: body === undefined ? 'GET' : 'POST', redirect: 'error',
            headers: { accept: 'application/json',
                ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal,
        });
        if (!response.ok || response.status !== 200) {
            throw new Error('baseline_provider_unavailable');
        }
        return readLimited(response);
    }
    return Object.freeze({ schemaVersion: DYNAMIC_DAILY_BASELINE_API_PORT_SCHEMA,
        async preflight() {
            const info = (await request('/api/v1/info')).value;
            const health = (await request('/api/v1/health')).value;
            if (info?.simulation !== true || health?.status !== 'healthy' ||
                typeof info.version !== 'string') {
                throw new Error('simulation_business_session_unavailable');
            }
            // info/health 只能證明 simulation API 可用，不能證明當前交易日及 generation。
            // 呼叫端須另以既有 current-session authority 驗證，不得由此 preflight 冒充。
            return Object.freeze({ simulation: true, businessSessionCurrent: false,
                sourceVersion: `shioaji-http-${info.version}`,
                brokerWriteAuthority: false, productionAuthority: false });
        },
        async readUsage() { return (await request('/api/v1/auth/usage')).value; },
        async readSnapshot2330(signal) {
            return (await request('/api/v1/data/snapshots', { contracts: [{
                security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330',
                target_code: null,
            }] }, signal)).value;
        },
        async fetchContract(input) {
            const stock = contract(input);
            return request(`/api/v1/data/contracts/${stock.code}/info?security_type=STK&region=TW`,
                undefined, input.signal);
        },
        async fetchKbars(input) {
            const stock = contract(input);
            const answer = await request('/api/v1/data/kbars', { contract: stock,
                start: input.tradeDate, end: input.tradeDate }, input.signal);
            // 驗證器需要記下每次獨立抓取時間；不能把原始陣列直接當 candidate。
            return { value: { data: answer.value, fetchedAt: now() },
                responseBytes: answer.responseBytes };
        },
        async fetchTicks(input) {
            const stock = contract(input);
            return request('/api/v1/data/ticks', { contract: stock,
                date: input.tradeDate, query_type: 'RangeTime',
                time_start: '09:00:00', time_end: '13:34:00' }, input.signal);
        },
    });
}
