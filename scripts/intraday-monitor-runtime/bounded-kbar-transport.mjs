import { createHash } from 'node:crypto';
import { INTRADAY_MONITOR_KBAR_EVENT_SCHEMA, INTRADAY_MONITOR_KBAR_PILOT_LIMIT } from './kbar-stream-adapter.mjs';
import { DIRECT_160_STORAGE } from './direct-160-storage.mjs';
import { DYNAMIC_DAILY_STORAGE } from './dynamic-daily-storage.mjs';

export const INTRADAY_MONITOR_BOUNDED_KBAR_TRANSPORT_SCHEMA = 'intraday-monitor-bounded-kbar-transport/1';
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_FRAME_BYTES = 128 * 1024;

function normalizeContract(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const securityType = value.securityType ?? value.security_type;
    const targetCode = value.targetCode ?? value.target_code ?? null;
    if (securityType !== 'STK' || !['TSE', 'OTC'].includes(value.exchange) ||
        !/^\d{4,6}[A-Z]?$/.test(String(value.code ?? '')) || targetCode !== null) return null;
    return Object.freeze({ security_type: 'STK', exchange: value.exchange, code: String(value.code), target_code: null });
}

function canonicalHash(contracts) {
    return `sha256:${createHash('sha256').update(JSON.stringify(contracts)).digest('hex')}`;
}

async function requestJson(fetchImpl, url, init = {}) {
    const response = await fetchImpl(url, {
        ...init,
        headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: response.ok, status: response.status, body };
}

export function createBoundedKbarTransport({
    fetchImpl = fetch,
    api = 'http://127.0.0.1:8080',
    onEvent,
    onDisconnect = () => {},
    onRecovered = () => {},
    onSubscribeAccepted = () => {},
    now = () => new Date().toISOString(),
    storageProfile = null,
} = {}) {
    const direct160 = storageProfile?.schemaVersion === DIRECT_160_STORAGE.schemaVersion &&
        Object.entries(DIRECT_160_STORAGE).every(([key, expected]) => storageProfile[key] === expected);
    const dynamicDaily = storageProfile?.schemaVersion === DYNAMIC_DAILY_STORAGE.schemaVersion &&
        Object.keys(storageProfile).length === Object.keys(DYNAMIC_DAILY_STORAGE).length &&
        Object.entries(DYNAMIC_DAILY_STORAGE).every(([key, expected]) => storageProfile[key] === expected);
    const maximumCohortSize = direct160 ? DIRECT_160_STORAGE.targetCount :
        dynamicDaily ? DYNAMIC_DAILY_STORAGE.maximumCohortSize : INTRADAY_MONITOR_KBAR_PILOT_LIMIT;
    const maximumBytes = direct160 ? DIRECT_160_STORAGE.streamTotalBytes :
        dynamicDaily ? DYNAMIC_DAILY_STORAGE.streamTotalBytes : MAX_BYTES;
    const maximumFrameBytes = direct160 ? DIRECT_160_STORAGE.streamFrameBytes :
        dynamicDaily ? DYNAMIC_DAILY_STORAGE.streamFrameBytes : MAX_FRAME_BYTES;
    if (storageProfile !== null && !direct160 && !dynamicDaily) {
        throw new TypeError('bounded kbar storage profile is invalid');
    }
    if (typeof fetchImpl !== 'function' || typeof onEvent !== 'function' || typeof onDisconnect !== 'function' ||
        typeof onRecovered !== 'function' || typeof onSubscribeAccepted !== 'function' ||
        typeof now !== 'function' || typeof api !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(api)) {
        throw new TypeError('bounded kbar transport options are invalid');
    }
    let phase = 'idle';
    let cohort = null;
    let cohortHash = null;
    let generation = null;
    let controller = null;
    let reader = null;
    let pumpPromise = null;
    let bytes = 0;
    let kbarFrames = 0;
    let malformedFrames = 0;
    let deliveredEvents = 0;
    let disconnectNotified = false;
    let subscribe = null;
    let unsubscribe = null;
    let recoveryAttempts = 0;
    let recoveryReceipt = null;
    let apiVersion = null;
    let streamActive = false;
    let lastDisconnectReason = null;
    const closeFramesByCode = new Map();
    let sourceGapEvents = 0;
    let sourceDroppedFrames = 0;
    let sourceGapInvalid = false;
    const sourceGapSamples = [];
    const nonKbarEventCounts = new Map();
    let nonKbarEventOverflow = 0;

    function notifyDisconnect(reason) {
        if (disconnectNotified || !generation) return;
        disconnectNotified = true;
        lastDisconnectReason = reason;
        try { Reflect.apply(onDisconnect, undefined, [{ connectionGeneration: generation, reason }]); } catch {}
    }

    async function openSse() {
        controller = new AbortController();
        const currentController = controller;
        // Header timeout only; the accepted SSE must survive the full session.
        const headerTimer = setTimeout(() => currentController.abort(), 8_000);
        let response;
        try {
            response = await fetchImpl(`${api}/api/v1/stream/data/kbar`, {
                method: 'GET', headers: { accept: 'text/event-stream' },
                redirect: 'error', signal: currentController.signal,
            });
        } finally { clearTimeout(headerTimer); }
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
            currentController.abort();
            throw new Error('kbar_stream_invalid');
        }
        reader = response.body.getReader();
        streamActive = true;
        const currentReader = reader;
        pumpPromise = (async () => {
            const decoder = new TextDecoder();
            let pending = '';
            let disconnectReason = null;
            try {
                while (true) {
                    const { done, value } = await currentReader.read();
                    if (done) { disconnectReason = 'stream_ended'; break; }
                    const chunk = decoder.decode(value, { stream: true });
                    bytes += Buffer.byteLength(chunk);
                    if (bytes > maximumBytes) throw new Error('stream_byte_limit');
                    pending += chunk.replace(/\r/g, '');
                    if (Buffer.byteLength(pending) > maximumFrameBytes) throw new Error('stream_frame_limit');
                    let boundary;
                    while ((boundary = pending.indexOf('\n\n')) >= 0) {
                        const frame = pending.slice(0, boundary);
                        pending = pending.slice(boundary + 2);
                        const lines = frame.split('\n');
                        const eventName = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
                        const payload = lines.filter(line => line.startsWith('data:'))
                            .map(line => line.slice(5).trimStart()).join('\n');
                        if (eventName !== 'kbar') {
                            // A live socket can lose frames in the server's broadcast
                            // channel. Its kbar_gap notice is evidence, not a KBar or
                            // a heartbeat, and must not disappear from the receipt.
                            const name = /^[a-z_]{1,64}$/.test(eventName ?? '') ? eventName : 'unknown';
                            if (nonKbarEventCounts.has(name) || nonKbarEventCounts.size < 16) {
                                nonKbarEventCounts.set(name, (nonKbarEventCounts.get(name) ?? 0) + 1);
                            } else nonKbarEventOverflow += 1;
                            if (eventName === 'kbar_gap') {
                                sourceGapEvents += 1;
                                let notice;
                                try { notice = JSON.parse(payload); } catch { notice = null; }
                                const dropped = notice?.type === 'lagged' &&
                                    Number.isSafeInteger(notice?.dropped) && notice.dropped > 0 ? notice.dropped : null;
                                if (dropped === null || !Number.isSafeInteger(sourceDroppedFrames + dropped)) {
                                    sourceGapInvalid = true;
                                } else sourceDroppedFrames += dropped;
                                if (sourceGapSamples.length < 8) sourceGapSamples.push({
                                    observedAt: Reflect.apply(now, undefined, []), eventName: 'kbar_gap',
                                    reason: dropped === null ? 'invalid_gap_notice' : 'server_subscriber_lagged',
                                    dropped, payloadHash: createHash('sha256').update(payload).digest('hex'),
                                });
                            }
                            continue;
                        }
                        if (!payload) { malformedFrames += 1; continue; }
                        kbarFrames += 1;
                        let raw;
                        try { raw = JSON.parse(payload); } catch { malformedFrames += 1; continue; }
                        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                            malformedFrames += 1; continue;
                        }
                        const receivedTime = Reflect.apply(now, undefined, []);
                        if (cohort?.some(contract => contract.code === String(raw.code)) &&
                            ['13:29', '13:30', '13:33'].includes(String(raw.time ?? '').slice(0, 5))) {
                            const key = String(raw.code);
                            const previous = closeFramesByCode.get(key) ?? {};
                            const minute = String(raw.time).slice(0, 5);
                            closeFramesByCode.set(key, { ...previous, [minute]: {
                                frames: (previous[minute]?.frames ?? 0) + 1,
                                lastReceivedAt: receivedTime,
                                lastVolume: Number.isSafeInteger(raw.volume) ? raw.volume : null,
                            } });
                        }
                        const shaped = Object.freeze({ schemaVersion: INTRADAY_MONITOR_KBAR_EVENT_SCHEMA,
                            code: raw.code, date: raw.date, time: raw.time, volume: raw.volume,
                            receivedTime, connectionGeneration: generation, unit: 'common_lot',
                            sourceVersion: `shioaji-http-${apiVersion}` });
                        try {
                            const result = Reflect.apply(onEvent, undefined, [shaped]);
                            if (result?.accepted === true) deliveredEvents += 1;
                        } catch { malformedFrames += 1; }
                    }
                }
            } catch (error) {
                if (!currentController.signal.aborted) disconnectReason =
                    ['stream_byte_limit', 'stream_frame_limit'].includes(error?.message) ?
                        error.message : 'stream_read_failed';
            } finally {
                // An exhausted or failed reader must not leave its physical SSE
                // socket open while the single-owner recovery decision is made.
                streamActive = false;
                currentController.abort();
                if (disconnectReason) notifyDisconnect(disconnectReason);
            }
        })();
    }

    async function start({ contracts, connectionGeneration } = {}) {
        if (phase !== 'idle') throw new Error('transport_session_already_used');
        if (!Array.isArray(contracts) || contracts.length < 1 || contracts.length > maximumCohortSize ||
            (direct160 && contracts.length !== DIRECT_160_STORAGE.targetCount) ||
            typeof connectionGeneration !== 'string' || connectionGeneration.length < 16 || connectionGeneration.length > 128) {
            throw new TypeError('bounded kbar start request is invalid');
        }
        const normalized = contracts.map(normalizeContract);
        if (normalized.some((item) => !item) || new Set(normalized.map((item) => `${item.exchange}:${item.code}`)).size !== normalized.length) {
            throw new TypeError('bounded kbar cohort is invalid');
        }
        cohort = Object.freeze(normalized);
        cohortHash = canonicalHash(cohort);
        generation = connectionGeneration;
        phase = 'starting';
        const info = await requestJson(fetchImpl, `${api}/api/v1/info`);
        if (!info.ok || info.body?.simulation !== true) {
            phase = 'refused';
            throw new Error('REFUSED: simulation mode not confirmed');
        }
        apiVersion = info.body.version;
        try { await openSse(); }
        catch (error) { phase = 'failed'; throw error; }
        subscribe = await requestJson(fetchImpl, `${api}/api/v1/stream/subscribe/kbars`, {
            method: 'POST', body: JSON.stringify({ stocks: cohort }),
        });
        if (!subscribe.ok || subscribe.body?.success !== true) {
            controller.abort();
            await reader.cancel().catch(() => {});
            await pumpPromise.catch(() => {});
            phase = 'failed';
            throw new Error('kbar_batch_subscribe_not_accepted');
        }
        try { onSubscribeAccepted(); }
        catch (error) {
            controller.abort();
            await reader.cancel().catch(() => {});
            await pumpPromise.catch(() => {});
            phase = 'failed';
            throw error;
        }
        phase = 'running';
        return Object.freeze({ started: true, cohortHash, cohortSize: cohort.length, subscribeAccepted: true,
            controlPlaneState: 'subscription_requested', dataPlaneReady: false,
            providerPhysicalUsage: null, brokerWriteAuthority: false, productionAuthority: false,
            serviceLifecycleAuthority: false, storageProfile: storageProfile?.schemaVersion ?? null });
    }

    async function stop({ unsubscribeAllowed = true } = {}) {
        if (!['running', 'failed'].includes(phase) || !cohort) {
            return Object.freeze({ stopped: false, reason: 'transport_not_running', brokerWriteAuthority: false });
        }
        phase = 'stopping';
        unsubscribe = unsubscribeAllowed ? await requestJson(fetchImpl, `${api}/api/v1/stream/unsubscribe/kbars`, {
            method: 'POST', body: JSON.stringify({ stocks: cohort }),
        }).catch(() => ({ ok: false, status: null, body: null })) : { ok: false, status: null, body: null };
        controller?.abort();
        await reader?.cancel().catch(() => {});
        await pumpPromise?.catch(() => {});
        phase = 'stopped';
        return Object.freeze({ stopped: true, unsubscribeAccepted: unsubscribe.ok && unsubscribe.body?.success === true,
            unsubscribeSkipped: !unsubscribeAllowed,
            providerReleaseProven: false, cohortHash, brokerWriteAuthority: false,
            productionAuthority: false, serviceLifecycleAuthority: false });
    }

    async function recover({ connectionGeneration, requestedCohortHash } = {}) {
        if (phase !== 'running' || recoveryAttempts !== 0 || connectionGeneration !== generation ||
            requestedCohortHash !== cohortHash) {
            return Object.freeze({ recovered: false,
                reason: recoveryAttempts !== 0 ? 'recovery_already_attempted' : 'recovery_authority_mismatch' });
        }
        recoveryAttempts = 1;
        const unsubscribeRecovery = await requestJson(fetchImpl,
            `${api}/api/v1/stream/unsubscribe/kbars`, {
                method: 'POST', body: JSON.stringify({ stocks: cohort }),
            }).catch(() => ({ ok: false, status: null, body: null }));
        const subscribeRecovery = await requestJson(fetchImpl,
            `${api}/api/v1/stream/subscribe/kbars`, {
                method: 'POST', body: JSON.stringify({ stocks: cohort }),
            }).catch(() => ({ ok: false, status: null, body: null }));
        recoveryReceipt = Object.freeze({ recovered: unsubscribeRecovery.ok &&
            unsubscribeRecovery.body?.success === true && subscribeRecovery.ok &&
            subscribeRecovery.body?.success === true, attempt: 1, cohortHash,
            unsubscribeAccepted: unsubscribeRecovery.ok && unsubscribeRecovery.body?.success === true,
            subscribeAccepted: subscribeRecovery.ok && subscribeRecovery.body?.success === true,
            secondStreamCreated: false, symbolsRotated: false });
        if (!recoveryReceipt.recovered) phase = 'failed';
        return recoveryReceipt;
    }

    async function reconnectEndedStream({ connectionGeneration, requestedCohortHash } = {}) {
        if (phase !== 'running' || streamActive || recoveryAttempts !== 0 ||
            connectionGeneration !== generation || requestedCohortHash !== cohortHash) {
            return Object.freeze({ recovered: false, reason: recoveryAttempts !== 0
                ? 'recovery_already_attempted' : 'recovery_authority_mismatch' });
        }
        recoveryAttempts = 1;
        // The old pump must have exited; no second physical reader may overlap it.
        await pumpPromise?.catch(() => {});
        controller?.abort();
        const info = await requestJson(fetchImpl, `${api}/api/v1/info`).catch(() => null);
        if (!info?.ok || info.body?.simulation !== true || info.body.version !== apiVersion) {
            phase = 'failed';
            recoveryReceipt = Object.freeze({ recovered: false, attempt: 1, cohortHash,
                reason: 'recovery_source_identity_mismatch', secondStreamCreated: false });
            return recoveryReceipt;
        }
        const released = await requestJson(fetchImpl, `${api}/api/v1/stream/unsubscribe/kbars`, {
            method: 'POST', body: JSON.stringify({ stocks: cohort }),
        }).catch(() => ({ ok: false, body: null }));
        if (!released.ok || released.body?.success !== true) {
            phase = 'failed';
            recoveryReceipt = Object.freeze({ recovered: false, attempt: 1, cohortHash,
                reason: 'recovery_unsubscribe_unverified', secondStreamCreated: false });
            return recoveryReceipt;
        }
        try { await openSse(); }
        catch {
            phase = 'failed';
            recoveryReceipt = Object.freeze({ recovered: false, attempt: 1, cohortHash,
                reason: 'recovery_stream_invalid', secondStreamCreated: false });
            return recoveryReceipt;
        }
        const accepted = await requestJson(fetchImpl, `${api}/api/v1/stream/subscribe/kbars`, {
            method: 'POST', body: JSON.stringify({ stocks: cohort }),
        }).catch(() => ({ ok: false, body: null }));
        recoveryReceipt = Object.freeze({ recovered: accepted.ok && accepted.body?.success === true &&
            streamActive, attempt: 1, cohortHash, unsubscribeAccepted: true,
            subscribeAccepted: accepted.ok && accepted.body?.success === true,
            secondStreamCreated: true, concurrentStreamCreated: false, symbolsRotated: false });
        if (!recoveryReceipt.recovered) {
            controller?.abort();
            await reader?.cancel().catch(() => {});
            await pumpPromise?.catch(() => {});
            phase = 'failed';
        } else {
            disconnectNotified = false;
            try { Reflect.apply(onRecovered, undefined, [{ connectionGeneration: generation,
                cohortHash, sourceVersion: `shioaji-http-${apiVersion}` }]); } catch {}
        }
        return recoveryReceipt;
    }

    function status() {
        return Object.freeze({ schemaVersion: INTRADAY_MONITOR_BOUNDED_KBAR_TRANSPORT_SCHEMA, phase,
            cohortHash, cohortSize: cohort?.length ?? 0, connectionGeneration: generation, bytes,
            kbarFrames, malformedFrames, deliveredEvents,
            sourceGapEvents, sourceDroppedFrames: sourceGapInvalid ? null : sourceDroppedFrames,
            sourceGapInvalid, sourceGapSamples: sourceGapSamples.map(item => ({ ...item })),
            nonKbarEventCounts: Object.fromEntries(nonKbarEventCounts), nonKbarEventOverflow,
            closeFramesByCode: Object.fromEntries([...closeFramesByCode.entries()]
                .sort(([a], [b]) => a.localeCompare(b))),
            recoveryAttempts, recoveryReceipt, streamActive,
            lastDisconnectReason,
            subscribeAccepted: subscribe?.body?.success === true,
            controlPlaneState: subscribe?.body?.success === true ? 'subscription_requested' : 'not_requested',
            dataPlaneReady: false,
            unsubscribeAccepted: unsubscribe?.body?.success === true,
            providerPhysicalUsage: null, providerReleaseProven: false,
            pollingFallbackAllowed: false, brokerWriteAuthority: false,
            productionAuthority: false, serviceLifecycleAuthority: false,
            maximumBytes, maximumFrameBytes,
            storageProfile: storageProfile?.schemaVersion ?? null });
    }

    return Object.freeze({ start, recover, reconnectEndedStream, stop, status });
}
