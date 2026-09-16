import { createHash } from 'node:crypto';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

export const DIRECT_160_GAP_BOOTSTRAP_SCHEMA = 'intraday-monitor-direct-160-gap-bootstrap/1';
const COLUMNS = ['datetime', 'Open', 'High', 'Low', 'Close', 'Volume', 'Amount'];

function minuteNumber(value) {
    if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
}

function minuteKey(value) {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function range(start, end) {
    const first = minuteNumber(start);
    const last = minuteNumber(end);
    if (first === null || last === null || first < 9 * 60 + 1 || last > 13 * 60 + 30 || first > last) {
        throw new TypeError('bounded bootstrap range is invalid');
    }
    return Array.from({ length: last - first + 1 }, (_, index) => minuteKey(first + index));
}

function inspect(body, tradeDate, expected) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        COLUMNS.some((column) => !Array.isArray(body[column]))) return { ok: false, reason: 'invalid_payload' };
    const lengths = COLUMNS.map((column) => body[column].length);
    if (!lengths.every((length) => length === lengths[0]) || lengths[0] > 50_000) {
        return { ok: false, reason: 'column_length_mismatch' };
    }
    const expectedSet = new Set(expected);
    const rows = [];
    for (let index = 0; index < lengths[0]; index += 1) {
        const datetime = body.datetime[index];
        if (typeof datetime !== 'string' || !datetime.startsWith(`${tradeDate}T`)) continue;
        const key = datetime.slice(11, 16);
        if (!expectedSet.has(key)) continue;
        if (!Number.isFinite(body.Open[index]) || !Number.isFinite(body.High[index]) ||
            !Number.isFinite(body.Low[index]) || !Number.isFinite(body.Close[index]) ||
            !Number.isSafeInteger(body.Volume[index]) || body.Volume[index] < 0 ||
            !Number.isFinite(body.Amount[index])) return { ok: false, reason: 'invalid_row' };
        rows.push({ minuteKey: key, open: body.Open[index], high: body.High[index],
            low: body.Low[index], close: body.Close[index], volumeCommonLot: body.Volume[index],
            amount: body.Amount[index] });
    }
    if (rows.length !== expected.length || rows.some((row, index) => row.minuteKey !== expected[index])) {
        return { ok: false, reason: rows.some((row, index) => index > 0 &&
            row.minuteKey <= rows[index - 1].minuteKey) ? 'duplicate_or_non_monotonic_minute' :
            'minute_coverage_incomplete' };
    }
    return { ok: true, rows };
}

function digest(value) {
    return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function validateDirect160GapBootstrap({ contract, tradeDate, startMinute = '09:01',
    endMinute, overlapMinute = null, first, second, fetchedAt, refetchedAt, restGeneration, liveGeneration,
    sourceVersion, liveOverlap = [] } = {}) {
    const reasons = [];
    let expected = [];
    try { expected = range(startMinute, endMinute); } catch { reasons.push('range_invalid'); }
    let inspectedMinutes = expected;
    if (overlapMinute !== null) {
        const end = minuteNumber(endMinute);
        const overlap = minuteNumber(overlapMinute);
        if (end === null || overlap !== end + 1) reasons.push('overlap_minute_invalid');
        else {
            try { inspectedMinutes = range(startMinute, overlapMinute); }
            catch { reasons.push('overlap_minute_invalid'); }
        }
    }
    const suffix = contract?.exchange === 'TSE' ? 'TW' : contract?.exchange === 'OTC' ? 'TWO' : null;
    if (contract?.securityType !== 'STK' || contract?.region !== 'TW' || contract?.targetCode !== null ||
        !/^\d{4,6}[A-Z]?$/.test(contract?.code ?? '') ||
        contract?.canonicalSymbol !== `${contract?.code}.${suffix}`) reasons.push('contract_identity_invalid');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '')) reasons.push('trade_date_invalid');
    if (!Number.isFinite(Date.parse(fetchedAt ?? '')) || !Number.isFinite(Date.parse(refetchedAt ?? '')) ||
        Date.parse(refetchedAt) < Date.parse(fetchedAt)) reasons.push('fetch_time_invalid');
    if (typeof restGeneration !== 'string' || restGeneration.length < 16 ||
        typeof liveGeneration !== 'string' || liveGeneration.length < 16 ||
        typeof sourceVersion !== 'string' || sourceVersion.length < 1) reasons.push('source_identity_invalid');
    const firstInspection = inspectedMinutes.length
        ? inspect(first, tradeDate, inspectedMinutes) : { ok: false, reason: 'range_invalid' };
    const secondInspection = inspectedMinutes.length
        ? inspect(second, tradeDate, inspectedMinutes) : { ok: false, reason: 'range_invalid' };
    if (!firstInspection.ok) reasons.push(firstInspection.reason);
    if (!secondInspection.ok) reasons.push(`refetch_${secondInspection.reason}`);
    const firstHash = firstInspection.ok ? digest(firstInspection.rows) : null;
    const secondHash = secondInspection.ok ? digest(secondInspection.rows) : null;
    if (firstHash && secondHash && firstHash !== secondHash) reasons.push('refetch_payload_unstable');
    if (!Array.isArray(liveOverlap) || (overlapMinute !== null && liveOverlap.length < 1) ||
        liveOverlap.some((row) =>
        !inspectedMinutes.includes(row?.minuteKey) ||
        (overlapMinute !== null && row?.minuteKey !== overlapMinute) ||
        !Number.isSafeInteger(row?.volumeCommonLot) ||
        row.volumeCommonLot < 0)) reasons.push('live_overlap_invalid');
    if (firstInspection.ok && Array.isArray(liveOverlap)) {
        const byMinute = new Map(firstInspection.rows.map((row) => [row.minuteKey, row.volumeCommonLot]));
        if (liveOverlap.some((row) => byMinute.get(row.minuteKey) !== row.volumeCommonLot)) {
            reasons.push('live_overlap_conflict');
        }
    }
    if (reasons.length) return Object.freeze({ ok: false, reasons: [...new Set(reasons)],
        notificationAuthority: false, brokerWriteAuthority: false });
    let cumulativeVolume = 0;
    const rows = firstInspection.rows.slice(0, expected.length).map((row) => ({ ...row,
        cumulativeVolume: cumulativeVolume += row.volumeCommonLot }));
    const receipt = {
        schemaVersion: DIRECT_160_GAP_BOOTSTRAP_SCHEMA,
        canonicalSymbol: contract.canonicalSymbol, tradeDate, timeZone: 'Asia/Taipei',
        requestedMinuteStart: startMinute, requestedMinuteEnd: endMinute,
        validationMinuteEnd: overlapMinute ?? endMinute,
        expectedMinuteCount: expected.length, actualMinuteCount: rows.length,
        source: 'shioaji-kbars-bootstrap', sourceVersion, sourceUnit: 'common_lot',
        canonicalUnit: 'common_lot', fetchedAt, refetchedAt, restGeneration, liveGeneration,
        rangeHash: firstHash, refetchRangeHash: secondHash, stableRefetch: true,
        liveOverlap: { comparedMinutes: liveOverlap.map((row) => row.minuteKey), matched: true },
        liveDelivered: false, rows, notificationAuthority: false,
        retroactiveTriggerEligible: false, brokerWriteAuthority: false,
        productionAuthority: false,
    };
    return Object.freeze({ ok: true, receipt: Object.freeze({ ...receipt,
        receiptHash: digest(receipt) }) });
}

export function createDirect160GapBootstrapWorker({ fetchImpl = fetch,
    api = 'http://127.0.0.1:8080', now = () => new Date().toISOString(), concurrency = 8 } = {}) {
    if (typeof fetchImpl !== 'function' || typeof now !== 'function' ||
        !/^http:\/\/127\.0\.0\.1:\d+$/.test(api) || !Number.isSafeInteger(concurrency) ||
        concurrency < 1 || concurrency > 16) throw new TypeError('gap bootstrap worker options are invalid');
    async function request(path, init = {}) {
        const response = await fetchImpl(`${api}${path}`, { ...init, redirect: 'error',
            headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
            signal: AbortSignal.timeout(8_000) });
        const text = await response.text();
        if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('gap_bootstrap_response_too_large');
        return { ok: response.ok, body: text ? JSON.parse(text) : null };
    }
    async function run({ contracts, tradeDate, endMinute, overlapMinute = null, liveGeneration,
        liveOverlapBySymbol = new Map() } = {}) {
        if (!Array.isArray(contracts) || contracts.length < 1 || contracts.length > 160 ||
            new Set(contracts.map((item) => item.canonicalSymbol)).size !== contracts.length ||
            !(liveOverlapBySymbol instanceof Map)) throw new TypeError('gap bootstrap run input is invalid');
        const info = await request('/api/v1/info');
        if (!info.ok || info.body?.simulation !== true || typeof info.body?.version !== 'string') {
            throw new Error('gap_bootstrap_simulation_preflight_failed');
        }
        let cursor = 0;
        const results = new Array(contracts.length);
        const runner = async () => {
            while (true) {
                const index = cursor++;
                if (index >= contracts.length) return;
                const contract = contracts[index];
                try {
                    const body = JSON.stringify({ contract: { security_type: contract.securityType,
                        region: contract.region, exchange: contract.exchange, code: contract.code,
                        target_code: contract.targetCode }, start: tradeDate, end: tradeDate });
                    const first = await request('/api/v1/data/kbars', { method: 'POST', body });
                    const fetchedAt = now();
                    const second = await request('/api/v1/data/kbars', { method: 'POST', body });
                    const refetchedAt = now();
                    if (!first.ok || !second.ok) throw new Error('gap_bootstrap_request_failed');
                    results[index] = validateDirect160GapBootstrap({ contract, tradeDate, endMinute, overlapMinute,
                        first: first.body, second: second.body, fetchedAt, refetchedAt,
                        restGeneration: `rest:${liveGeneration}`, liveGeneration,
                        sourceVersion: `shioaji-http-${info.body.version}`,
                        liveOverlap: liveOverlapBySymbol.get(contract.canonicalSymbol) ?? [] });
                } catch (error) {
                    results[index] = Object.freeze({ ok: false,
                        reasons: [String(error?.message ?? 'gap_bootstrap_failed').slice(0, 128)],
                        canonicalSymbol: contract.canonicalSymbol,
                        notificationAuthority: false, brokerWriteAuthority: false });
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, contracts.length) }, runner));
        const receipts = results.filter((result) => result?.ok).map((result) => result.receipt);
        return Object.freeze({ tradeDate, requested: contracts.length, completed: receipts.length,
            degraded: contracts.length - receipts.length, receipts: Object.freeze(receipts),
            results: Object.freeze(results), notificationAuthority: false, brokerWriteAuthority: false });
    }
    return Object.freeze({ run });
}
