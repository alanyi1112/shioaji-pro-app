import { performance } from 'node:perf_hooks';
import process from 'node:process';

const API = 'http://127.0.0.1:8080';
const EXECUTE = process.argv.includes('--execute');
const previousDate = process.argv
    .find((value) => value.startsWith('--previous='))
    ?.slice('--previous='.length);
const todayDate = process.argv
    .find((value) => value.startsWith('--today='))
    ?.slice('--today='.length);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TARGET_COUNT = 200;
const REQUEST_SPACING_MS = 260;
const REQUEST_TIMEOUT_MS = 8_000;
const TOTAL_DEADLINE_MS = 75_000;

if (
    !EXECUTE ||
    !DATE.test(previousDate ?? '') ||
    !DATE.test(todayDate ?? '') ||
    previousDate >= todayDate
) {
    console.error(
        'usage: node probe-bootstrap-capacity.mjs --execute --previous=YYYY-MM-DD --today=YYYY-MM-DD',
    );
    process.exit(2);
}

const sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const startedAt = performance.now();
    const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
            accept: 'application/json',
            ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = null;
    }
    return {
        ok: response.ok,
        status: response.status,
        body,
        byteLength: Buffer.byteLength(text),
        cacheControl: response.headers.get('cache-control'),
        age: response.headers.get('age'),
        durationMs: performance.now() - startedAt,
    };
}

function percentile(values, fraction) {
    if (values.length === 0) return null;
    const ordered = [...values].sort((left, right) => left - right);
    const index = Math.min(
        ordered.length - 1,
        Math.max(0, Math.ceil(ordered.length * fraction) - 1),
    );
    return Number(ordered[index].toFixed(1));
}

function inspectKbars(body, date) {
    const columns = ['datetime', 'Open', 'High', 'Low', 'Close', 'Volume', 'Amount'];
    if (
        !body ||
        typeof body !== 'object' ||
        !columns.every((column) => Array.isArray(body[column]))
    ) {
        return { structurallyValid: false, reason: 'missing_columns' };
    }
    const lengths = columns.map((column) => body[column].length);
    if (!lengths.every((length) => length === lengths[0])) {
        return { structurallyValid: false, reason: 'unequal_columns' };
    }
    const rows = body.datetime
        .map((datetime, index) => ({
            datetime,
            volume: body.Volume[index],
        }))
        .filter(
            (row) =>
                typeof row.datetime === 'string' &&
                row.datetime.startsWith(`${date}T`),
        );
    const regular = rows.filter((row) => {
        const minute = row.datetime.slice(11, 16);
        return minute >= '09:00' && minute <= '13:30';
    });
    const minuteKeys = regular.map((row) => row.datetime.slice(11, 16));
    const unique = new Set(minuteKeys);
    const validVolumes = regular.every(
        (row) => Number.isSafeInteger(row.volume) && row.volume >= 0,
    );
    const sorted = minuteKeys.every(
        (minute, index) => index === 0 || minute > minuteKeys[index - 1],
    );
    const firstMinute = minuteKeys[0] ?? null;
    const lastMinute = minuteKeys.at(-1) ?? null;
    return {
        structurallyValid:
            unique.size === minuteKeys.length && validVolumes && sorted,
        rowCount: regular.length,
        firstMinute,
        lastMinute,
        fullSessionAnchored:
            firstMinute === '09:01' && lastMinute === '13:30',
        outsideRegularSessionRows: rows.length - regular.length,
    };
}

const info = await request('/api/v1/info');
if (!info.ok || info.body?.simulation !== true) {
    throw new Error('REFUSED: simulation mode not confirmed');
}
const stream = await request('/api/v1/stream/status');
if (!stream.ok || stream.body?.active_connections !== 0) {
    throw new Error('REFUSED: clean zero-SSE baseline required');
}

const contractsResponse = await request(
    '/api/v1/data/contracts?security_type=STK&region=TW',
);
const eligible = (contractsResponse.body?.contracts ?? [])
    .filter(
        (contract) =>
            contract?.security_type === 'STK' &&
            contract?.region === 'TW' &&
            ['TSE', 'OTC'].includes(contract?.exchange) &&
            /^[1-9]\d{3}$/.test(String(contract?.code ?? '')),
    )
    .sort((left, right) =>
        `${left.exchange}:${left.code}`.localeCompare(
            `${right.exchange}:${right.code}`,
        ),
    );
const tse = eligible.filter((contract) => contract.exchange === 'TSE').slice(0, 100);
const otc = eligible.filter((contract) => contract.exchange === 'OTC').slice(0, 100);
const contracts = [...tse, ...otc];
if (contracts.length !== TARGET_COUNT) {
    throw new Error(`REFUSED: only ${contracts.length} balanced eligible contracts`);
}

const startedAt = performance.now();
const measurements = [];
let nextRequestAt = startedAt;
for (const contract of contracts) {
    if (performance.now() - startedAt > TOTAL_DEADLINE_MS) {
        throw new Error('bootstrap total deadline exceeded');
    }
    await sleep(Math.max(0, nextRequestAt - performance.now()));
    const requestStartedAt = performance.now();
    const result = await request('/api/v1/data/kbars', {
        method: 'POST',
        body: JSON.stringify({
            contract: {
                security_type: contract.security_type,
                region: contract.region,
                exchange: contract.exchange,
                code: contract.code,
                target_code: contract.target_code ?? null,
            },
            start: previousDate,
            end: todayDate,
        }),
    });
    measurements.push({
        symbol: `${contract.code}.${contract.exchange === 'TSE' ? 'TW' : 'TWO'}`,
        status: result.status,
        durationMs: result.durationMs,
        byteLength: result.byteLength,
        cacheControl: result.cacheControl,
        age: result.age,
        previous: result.ok
            ? inspectKbars(result.body, previousDate)
            : { structurallyValid: false, reason: 'http_error' },
        today: result.ok
            ? inspectKbars(result.body, todayDate)
            : { structurallyValid: false, reason: 'http_error' },
    });
    nextRequestAt = requestStartedAt + REQUEST_SPACING_MS;
}

const warmSamples = [];
nextRequestAt = performance.now();
for (const contract of contracts.slice(0, 5)) {
    await sleep(Math.max(0, nextRequestAt - performance.now()));
    const requestStartedAt = performance.now();
    const result = await request('/api/v1/data/kbars', {
        method: 'POST',
        body: JSON.stringify({
            contract: {
                security_type: contract.security_type,
                region: contract.region,
                exchange: contract.exchange,
                code: contract.code,
                target_code: contract.target_code ?? null,
            },
            start: previousDate,
            end: todayDate,
        }),
    });
    warmSamples.push({
        symbol: `${contract.code}.${contract.exchange === 'TSE' ? 'TW' : 'TWO'}`,
        status: result.status,
        durationMs: Number(result.durationMs.toFixed(1)),
        cacheControl: result.cacheControl,
        age: result.age,
    });
    nextRequestAt = requestStartedAt + REQUEST_SPACING_MS;
}

const durations = measurements.map((item) => item.durationMs);
const byteLengths = measurements.map((item) => item.byteLength);
const successful = measurements.filter((item) => item.status === 200);
const structuralPrevious = successful.filter(
    (item) => item.previous.structurallyValid,
);
const structuralToday = successful.filter((item) => item.today.structurallyValid);
const anchoredPrevious = structuralPrevious.filter(
    (item) => item.previous.fullSessionAnchored,
);
const anchoredToday = structuralToday.filter(
    (item) => item.today.fullSessionAnchored,
);
const anomalies = measurements
    .filter(
        (item) =>
            item.status !== 200 ||
            !item.previous.structurallyValid ||
            !item.today.structurallyValid ||
            !item.previous.fullSessionAnchored ||
            !item.today.fullSessionAnchored,
    )
    .slice(0, 25)
    .map((item) => ({
        symbol: item.symbol,
        status: item.status,
        previous: item.previous,
        today: item.today,
    }));

console.log(
    JSON.stringify(
        {
            schemaVersion: 'intraday-bootstrap-capacity-probe/1',
            apiVersion: info.body.version,
            simulation: true,
            dateRange: { previousDate, todayDate },
            sample: {
                target: TARGET_COUNT,
                tse: tse.length,
                otc: otc.length,
            },
            requestPolicy: {
                method: 'one Kbars request per contract for both dates',
                periodicPolling: false,
                requestSpacingMs: REQUEST_SPACING_MS,
                theoreticalRequestsPer10Seconds: Number(
                    (10_000 / REQUEST_SPACING_MS).toFixed(2),
                ),
                perRequestTimeoutMs: REQUEST_TIMEOUT_MS,
                totalDeadlineMs: TOTAL_DEADLINE_MS,
            },
            result: {
                requests: measurements.length,
                successful: successful.length,
                failed: measurements.length - successful.length,
                elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
                durationMs: {
                    p50: percentile(durations, 0.5),
                    p95: percentile(durations, 0.95),
                    max: percentile(durations, 1),
                },
                responseBytes: {
                    total: byteLengths.reduce((sum, value) => sum + value, 0),
                    p50: percentile(byteLengths, 0.5),
                    p95: percentile(byteLengths, 0.95),
                    max: percentile(byteLengths, 1),
                },
                structuralPrevious: structuralPrevious.length,
                structuralToday: structuralToday.length,
                fullSessionAnchoredPrevious: anchoredPrevious.length,
                fullSessionAnchoredToday: anchoredToday.length,
                previousRowCount: {
                    min: Math.min(
                        ...structuralPrevious.map((item) => item.previous.rowCount),
                    ),
                    p50: percentile(
                        structuralPrevious.map((item) => item.previous.rowCount),
                        0.5,
                    ),
                    max: Math.max(
                        ...structuralPrevious.map((item) => item.previous.rowCount),
                    ),
                },
                todayRowCount: {
                    min: Math.min(
                        ...structuralToday.map((item) => item.today.rowCount),
                    ),
                    p50: percentile(
                        structuralToday.map((item) => item.today.rowCount),
                        0.5,
                    ),
                    max: Math.max(
                        ...structuralToday.map((item) => item.today.rowCount),
                    ),
                },
            },
            cacheObservation: {
                responseCacheHeadersPresent: measurements.some(
                    (item) => item.cacheControl !== null || item.age !== null,
                ),
                warmSamples,
                conclusion:
                    'HTTP response does not expose a cache receipt; repeat latency alone is not cache proof',
            },
            semanticCompleteness: {
                provableFromResponse: false,
                reason:
                    'Kbars returns traded-minute rows without a source coverage watermark; missing minutes can be no-trade carry-forward or unavailable data',
            },
            anomalies,
        },
        null,
        2,
    ),
);
