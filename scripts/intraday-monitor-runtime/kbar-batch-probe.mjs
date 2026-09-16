import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_API = 'http://127.0.0.1:8080';
const MAX_SYMBOLS = 20;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FRAME_BYTES = 128 * 1024;

function safeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function exactContract(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const code = String(value.code ?? '');
    if (!/^\d{4,6}[A-Z]?$/.test(code) || value.security_type !== 'STK' ||
        !['TSE', 'OTC'].includes(value.exchange)) return null;
    return Object.freeze({
        security_type: 'STK',
        exchange: value.exchange,
        code,
        target_code: value.target_code ?? null,
    });
}

export function createKbarEventSummary(expectedCodes) {
    const expected = new Set(expectedCodes);
    const symbols = new Map([...expected].map((code) => [code, {
        events: 0,
        validCompletedMinutes: 0,
        firstMinute: null,
        lastMinute: null,
        firstObservedAt: null,
        lastObservedAt: null,
        minimumArrivalLagSeconds: null,
        maximumArrivalLagSeconds: null,
        accumulatedVolume: 0,
    }]));
    let pending = '';
    let bytes = 0;
    let kbarEvents = 0;
    let rejectedEvents = 0;
    let unexpectedSymbols = 0;
    const payloadShapes = new Set();
    const payloadFormats = new Set();
    const rejectionReasons = new Map();

    function reject(reason) {
        rejectedEvents += 1;
        rejectionReasons.set(reason, (rejectionReasons.get(reason) ?? 0) + 1);
    }

    function consume(frame, observedAt) {
        const lines = frame.split('\n');
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        const payload = lines.filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart()).join('\n');
        if (event !== 'kbar' || !payload) return;
        kbarEvents += 1;
        try {
            const item = JSON.parse(payload);
            if (item && typeof item === 'object' && !Array.isArray(item) && payloadShapes.size < 4) {
                payloadShapes.add(Object.entries(item).map(([key, value]) =>
                    `${key}:${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`).sort().join(','));
            }
            const code = String(item.code ?? '');
            const record = symbols.get(code);
            if (!record) {
                unexpectedSymbols += 1;
                return;
            }
            record.events += 1;
            const date = typeof item.date === 'string' ? item.date : '';
            const time = typeof item.time === 'string' ? item.time : '';
            const volume = safeInteger(item.volume);
            const datePattern = /^\d{4}-\d{2}-\d{2}$/.test(date) ? 'yyyy-mm-dd' :
                /^\d{4}\/\d{2}\/\d{2}$/.test(date) ? 'yyyy/mm/dd' : `other-${date.length}`;
            const timePattern = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(time) ? 'hh:mm:ss' :
                /^\d{2}:\d{2}$/.test(time) ? 'hh:mm' : `other-${time.length}`;
            payloadFormats.add(`date=${datePattern},time=${timePattern},volume=${volume === null ? 'invalid' : 'safe-integer'}`);
            if (datePattern.startsWith('other-')) { reject('date_format_invalid'); return; }
            if (timePattern.startsWith('other-')) { reject('time_format_invalid'); return; }
            if (volume === null) { reject('volume_invalid'); return; }
            const normalizedDate = date.replaceAll('/', '-');
            const minute = `${normalizedDate}T${time.slice(0, 5)}`;
            record.validCompletedMinutes += 1;
            record.firstMinute ??= minute;
            record.lastMinute = minute;
            record.firstObservedAt ??= observedAt;
            record.lastObservedAt = observedAt;
            const eventEpochMs = Date.parse(`${normalizedDate}T${time}+08:00`);
            const observedEpochMs = Date.parse(observedAt);
            const lagSeconds = Number(((observedEpochMs - eventEpochMs) / 1_000).toFixed(3));
            if (Number.isFinite(lagSeconds)) {
                record.minimumArrivalLagSeconds = record.minimumArrivalLagSeconds === null ? lagSeconds :
                    Math.min(record.minimumArrivalLagSeconds, lagSeconds);
                record.maximumArrivalLagSeconds = record.maximumArrivalLagSeconds === null ? lagSeconds :
                    Math.max(record.maximumArrivalLagSeconds, lagSeconds);
            }
            record.accumulatedVolume += volume;
        } catch {
            reject('json_or_schema_invalid');
        }
    }

    return Object.freeze({
        push(text, observedAt = new Date().toISOString()) {
            bytes += Buffer.byteLength(text);
            if (bytes > MAX_BYTES) throw new Error('stream_byte_limit');
            pending += text.replace(/\r/g, '');
            if (Buffer.byteLength(pending) > MAX_FRAME_BYTES) throw new Error('stream_frame_limit');
            let boundary;
            while ((boundary = pending.indexOf('\n\n')) >= 0) {
                consume(pending.slice(0, boundary), observedAt);
                pending = pending.slice(boundary + 2);
            }
        },
        result() {
            return {
                bytes,
                kbarEvents,
                rejectedEvents,
                unexpectedSymbols,
                payloadShapes: [...payloadShapes].sort(),
                payloadFormats: [...payloadFormats].sort(),
                rejectionReasons: Object.fromEntries([...rejectionReasons.entries()].sort()),
                symbols: Object.fromEntries([...symbols.entries()].map(([code, value]) => [code, { ...value }])),
                rawPayloadSaved: false,
            };
        },
    });
}

async function requestJson(fetchImpl, url, init = {}) {
    const response = await fetchImpl(url, {
        ...init,
        headers: {
            accept: 'application/json',
            ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: response.ok, status: response.status, body };
}

export async function runKbarBatchProbe({
    contracts,
    durationMs = 55_000,
    api = DEFAULT_API,
    fetchImpl = fetch,
} = {}) {
    if (!Array.isArray(contracts) || contracts.length < 1 || contracts.length > MAX_SYMBOLS ||
        !Number.isSafeInteger(durationMs) || durationMs < 5_000 || durationMs > 55_000 ||
        typeof api !== 'string' || !api.startsWith('http://127.0.0.1:')) {
        throw new TypeError('probe_options_invalid');
    }
    const normalized = contracts.map(exactContract);
    if (normalized.some((item) => !item) || new Set(normalized.map((item) => item.code)).size !== normalized.length) {
        throw new TypeError('probe_contracts_invalid');
    }

    const startedAt = new Date().toISOString();
    const info = await requestJson(fetchImpl, `${api}/api/v1/info`);
    if (!info.ok || info.body?.simulation !== true) throw new Error('REFUSED: simulation mode not confirmed');
    const before = await requestJson(fetchImpl, `${api}/api/v1/stream/status`);
    if (!before.ok || safeInteger(before.body?.active_connections) === null) throw new Error('stream_status_unavailable');

    const controller = new AbortController();
    const summary = createKbarEventSummary(normalized.map((item) => item.code));
    let reader;
    let streamOpened = false;
    let streamEnd = 'stream_ended';
    let subscribe = null;
    let unsubscribe = null;
    let timer;
    try {
        const response = await fetchImpl(`${api}/api/v1/stream/data/kbar`, {
            method: 'GET',
            headers: { accept: 'text/event-stream' },
            redirect: 'error',
            signal: controller.signal,
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
            throw new Error('kbar_stream_invalid');
        }
        streamOpened = true;
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        const pump = (async () => {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    summary.push(decoder.decode(value, { stream: true }));
                }
            } catch (error) {
                streamEnd = controller.signal.aborted ? 'duration_limit' : error.message;
            }
        })();
        subscribe = await requestJson(fetchImpl, `${api}/api/v1/stream/subscribe/kbars`, {
            method: 'POST',
            body: JSON.stringify({ stocks: normalized }),
        });
        if (!subscribe.ok || subscribe.body?.success !== true) throw new Error('kbar_batch_subscribe_not_accepted');
        timer = setTimeout(() => controller.abort(), durationMs);
        await pump;
        if (controller.signal.aborted) streamEnd = 'duration_limit';
    } finally {
        clearTimeout(timer);
        controller.abort();
        await reader?.cancel().catch(() => {});
        if (subscribe?.ok && subscribe.body?.success === true) {
            unsubscribe = await requestJson(fetchImpl, `${api}/api/v1/stream/unsubscribe/kbars`, {
                method: 'POST',
                body: JSON.stringify({ stocks: normalized }),
            }).catch((error) => ({ ok: false, status: null, body: { error: error.message } }));
        }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = await requestJson(fetchImpl, `${api}/api/v1/stream/status`);
    const finalInfo = await requestJson(fetchImpl, `${api}/api/v1/info`);
    const capture = summary.result();
    const observedAllSymbols = normalized.every((item) =>
        capture.symbols[item.code]?.validCompletedMinutes > 0);
    return {
        schemaVersion: 'intraday-monitor-kbar-batch-probe/1',
        startedAt,
        endedAt: new Date().toISOString(),
        api: {
            version: typeof info.body?.version === 'string' ? info.body.version : null,
            simulationBefore: info.body?.simulation === true,
            simulationAfter: finalInfo.body?.simulation === true,
        },
        batch: {
            requestedSymbolCount: normalized.length,
            symbols: normalized.map((item) => `${item.code}.${item.exchange === 'TSE' ? 'TW' : 'TWO'}`),
            oneSubscribeRequest: true,
            oneUnsubscribeRequest: unsubscribe !== null,
        },
        transport: {
            streamOpened,
            streamEnd,
            subscribe: { httpStatus: subscribe?.status ?? null, accepted: subscribe?.body?.success === true },
            unsubscribe: { httpStatus: unsubscribe?.status ?? null, accepted: unsubscribe?.body?.success === true },
            activeConnectionsBefore: before.body?.active_connections ?? null,
            activeConnectionsAfter: after.body?.active_connections ?? null,
            providerPhysicalUsageProven: false,
            providerReleaseProven: false,
        },
        capture,
        assessment: {
            observedAllSymbols,
            functionalInputPathProven: observedAllSymbols && capture.rejectedEvents === 0,
            quotaCountingDimensionProven: false,
            gate0Approved: false,
            note: '本探針只證明單一多商品 KBar request 的實際資料路徑；HTTP accepted 不等於 provider physical receipt。',
        },
        operations: {
            simulationOnly: true,
            subscriptionMutations: (subscribe ? 1 : 0) + (unsubscribe ? 1 : 0),
            brokerWrites: 0,
            productionLogins: 0,
            serviceRestarts: 0,
            rawPayloadSaved: false,
        },
    };
}

async function main() {
    const args = new Map(process.argv.slice(2).map((arg) => {
        const [key, ...rest] = arg.split('=');
        return [key, rest.join('=')];
    }));
    if (!args.has('--execute')) {
        throw new Error('usage: --execute --output=PATH [--duration-ms=55000]');
    }
    const output = args.get('--output');
    if (!output) throw new Error('output path is required');
    const result = await runKbarBatchProbe({
        contracts: [
            { security_type: 'STK', exchange: 'TSE', code: '2330', target_code: null },
            { security_type: 'STK', exchange: 'TSE', code: '2454', target_code: null },
        ],
        durationMs: Number(args.get('--duration-ms') || 55_000),
    });
    const handle = await open(output, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(result, null, 2)}\n`); } finally { await handle.close(); }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
