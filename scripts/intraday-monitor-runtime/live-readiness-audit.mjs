// 盤中唯讀鑑識：僅固定 GET 與 STK 專用 SSE，不提出 subscription demand。
import { createHash } from 'node:crypto';

const API = 'http://127.0.0.1:8080';
const WEB = 'http://127.0.0.1:5173/api/intraday-monitor/v1';
const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const safeVersion = (value) => typeof value === 'string' && /^[\w.-]{1,64}$/.test(value) ? value : null;

async function readJson(fetchImpl, url) {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error('read_endpoint_failed');
    const body = await response.json();
    return body;
}

export function summarizeMonitorReadiness(status, diagnostics) {
    const capacity = status?.capacity ?? {};
    return {
        featureOff: status?.state === 'feature_off',
        configRevision: safeCount(status?.configRevision),
        configured: safeCount(capacity.configured),
        eligible: safeCount(capacity.eligible),
        pilotCohort: safeCount(capacity.pilotCohort),
        dataActive: safeCount(capacity.dataActive),
        active: safeCount(capacity.active),
        waitingGate: safeCount(capacity.waitingGate),
        waitingPilotLimit: safeCount(capacity.waitingPilotLimit),
        degraded: safeCount(capacity.degraded),
        activeLeaseCount: safeCount(status?.lease?.activeLeaseCount),
        gate0EvidenceCurrent: capacity.gate0EvidenceCurrent === true,
        globalOwnershipComplete: capacity.globalOwnershipComplete === true,
        subscriptionTransportAuthority: capacity.subscriptionTransportAuthority === true,
        confirmedPhysicalUsage: safeCount(capacity.confirmedPhysicalUsage),
        availableForMonitor: safeCount(capacity.availableForMonitor),
        evidenceRevision: safeCount(diagnostics?.evidenceRevision),
        baselineComplete: diagnostics?.baseline?.complete === true,
        baselineItemCount: safeCount(diagnostics?.baseline?.itemCount),
        completedMinutePresent: typeof diagnostics?.completedMinute?.minuteKey === 'string',
    };
}

export function createPassiveTickSummary() {
    let pending = '';
    let bytes = 0;
    let events = 0;
    let validRegularTicks = 0;
    let rejectedTicks = 0;
    const symbols = new Set();
    return {
        push(text) {
            bytes += Buffer.byteLength(text);
            if (bytes > 4 * 1024 * 1024) throw new Error('stream_byte_limit');
            pending += text.replace(/\r/g, '');
            if (Buffer.byteLength(pending) > 128 * 1024) throw new Error('stream_frame_limit');
            let boundary;
            while ((boundary = pending.indexOf('\n\n')) >= 0) {
                const frame = pending.slice(0, boundary);
                pending = pending.slice(boundary + 2);
                const lines = frame.split('\n');
                const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
                const payload = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
                if (event !== 'tick_stk' || !payload) continue;
                events += 1;
                try {
                    const tick = JSON.parse(payload);
                    if (!/^\d{4,6}[A-Z]?$/.test(tick.code) ||
                        !/^\d{4}-\d{2}-\d{2}$/.test(tick.date) ||
                        !/^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(tick.time) ||
                        safeCount(tick.total_volume) === null ||
                        tick.simtrade !== false || tick.intraday_odd !== false) throw new Error();
                    validRegularTicks += 1;
                    if (symbols.size < 200) symbols.add(tick.code);
                } catch { rejectedTicks += 1; }
            }
        },
        result() {
            return { bytes, tickEvents: events, structurallyValidRegularTicks: validRegularTicks,
                rejectedTicks, observedSymbolCount: symbols.size,
                provesContinuity: false, provesPhysicalOwnership: false, rawPayloadSaved: false };
        },
    };
}

export async function runLiveReadinessAudit({ fetchImpl = fetch, durationMs = 15_000 } = {}) {
    if (!Number.isSafeInteger(durationMs) || durationMs < 1_000 || durationMs > 30_000) throw new TypeError('duration_out_of_bounds');
    const startedAt = new Date().toISOString();
    const info = await readJson(fetchImpl, `${API}/api/v1/info`);
    if (info.simulation !== true) throw new Error('simulation_not_confirmed');
    const openapi = await readJson(fetchImpl, `${API}/openapi.json`);
    const before = await readJson(fetchImpl, `${API}/api/v1/stream/status`);
    const initialStatus = await readJson(fetchImpl, `${WEB}/status`);
    const initialDiagnostics = await readJson(fetchImpl, `${WEB}/diagnostics`);
    const monitorBefore = summarizeMonitorReadiness(initialStatus, initialDiagnostics);
    const streamPaths = Object.keys(openapi.paths ?? {}).filter((p) => /^\/api\/v1\/stream\/[a-z_\/]+$/.test(p)).sort();
    const responseFields = Object.keys(openapi.components?.schemas?.['shioaji.server.http.stream.SubscriptionResponse']?.properties ?? {})
        .filter((key) => /^[a-z_]{1,64}$/.test(key)).sort();
    const tick = createPassiveTickSummary();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), durationMs);
    const captureStartedAt = new Date().toISOString();
    let streamOpened = false;
    let captureEnd = 'stream_ended';
    let reader;
    try {
        const response = await fetchImpl(`${API}/api/v1/stream/data/tick_stk`, {
            method: 'GET', redirect: 'error', signal: controller.signal,
            headers: { Accept: 'text/event-stream' },
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('invalid_stream');
        streamOpened = true;
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            tick.push(decoder.decode(value, { stream: true }));
        }
    } catch (error) {
        captureEnd = controller.signal.aborted ? 'duration_limit' :
            ['stream_byte_limit', 'stream_frame_limit'].includes(error.message) ? error.message : 'stream_failed';
    } finally {
        clearTimeout(timer);
        controller.abort();
        await reader?.cancel().catch(() => {});
    }
    const captureEndedAt = new Date().toISOString();
    // 第二次讀取僅對帳自己結束 SSE 後的 aggregate count；它不是 physical release receipt。
    const after = await readJson(fetchImpl, `${API}/api/v1/stream/status`);
    const finalInfo = await readJson(fetchImpl, `${API}/api/v1/info`);
    const finalStatus = await readJson(fetchImpl, `${WEB}/status`);
    const finalDiagnostics = await readJson(fetchImpl, `${WEB}/diagnostics`);
    const monitorAfter = summarizeMonitorReadiness(finalStatus, finalDiagnostics);
    const reasons = [];
    if (!monitorAfter.gate0EvidenceCurrent) reasons.push('gate0_evidence_missing');
    if (!monitorAfter.globalOwnershipComplete) reasons.push('ownership_incomplete');
    if (!monitorAfter.subscriptionTransportAuthority) reasons.push('transport_not_connected');
    if (monitorAfter.confirmedPhysicalUsage === null) reasons.push('physical_usage_unknown');
    if (monitorAfter.configured === 0) reasons.push('cohort_not_configured');
    if (!monitorAfter.baselineComplete) reasons.push('baseline_not_ready');
    if (!monitorAfter.completedMinutePresent) reasons.push('completed_minute_missing');
    if (finalInfo.simulation !== true) reasons.push('simulation_changed');
    if (initialStatus.generation !== finalStatus.generation) reasons.push('monitor_generation_changed');
    if (!streamOpened || captureEnd !== 'duration_limit') reasons.push('passive_capture_incomplete');
    return {
        schemaVersion: 'intraday-monitor-live-readiness-audit/1', startedAt, endedAt: new Date().toISOString(),
        api: { version: safeVersion(info.version), simulationBefore: info.simulation === true, simulationAfter: finalInfo.simulation === true,
            streamPaths, subscriptionResponseFields: responseFields,
            publicStreamSchemaHash: createHash('sha256').update(JSON.stringify({ streamPaths, responseFields })).digest('hex') },
        monitorBefore, monitorAfter,
        passiveCapture: { durationMs, captureStartedAt, captureEndedAt, streamOpened, captureEnd, ...tick.result(),
            activeConnectionsBefore: safeCount(before.active_connections), activeConnectionsAfter: safeCount(after.active_connections) },
        assessment: { reasons, gate0ApprovalIssued: false, pilotStarted: false, fullTradingDayRecorded: false,
            note: '唯讀可用性鑑識不能核准 Gate 0，也不計入分階段試辦完整交易日。' },
        operations: { methods: ['GET'], subscriptionMutations: 0, brokerWrites: 0, serviceRestarts: 0,
            newLogins: 0, notificationDispatches: 0, pollingFallback: false },
    };
}
