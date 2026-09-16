import { createHash, createHmac, randomBytes } from 'node:crypto';

export const INTRADAY_MONITOR_LOCAL_API_PREFIX = '/api/intraday-monitor/v1';
export const INTRADAY_MONITOR_LOCAL_API_MAX_BODY_BYTES = 128 * 1024;
export const INTRADAY_MONITOR_LOCAL_API_MAX_PAGE_SIZE = 100;

const API_SCHEMA = 'intraday-monitor-local-api/1';
const CONFIG_RESPONSE_SCHEMA = 'intraday-monitor-config-response/1';
const CONFIG_REPLACE_SCHEMA = 'intraday-monitor-config-replace-request/1';
const LEASE_REQUEST_SCHEMA = 'intraday-monitor-lease-request/1';
const LEASE_RESPONSE_SCHEMA = 'intraday-monitor-lease-response/1';
const STATUS_SCHEMA = 'intraday-monitor-status/1';
const CAPACITY_SCHEMA = 'intraday-monitor-capacity-response/1';
const RESULTS_SCHEMA = 'intraday-monitor-results/1';
const EVENTS_SCHEMA = 'intraday-monitor-events/1';
const DIAGNOSTICS_SCHEMA = 'intraday-monitor-diagnostics/1';
const PILOT_COHORT_LIMIT = 20;
const OPAQUE = /^[A-Za-z0-9_-]{16,128}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_KEY = /(?:account|credential|password|secret|token|order|position|strategy|quantity|price|broker)/i;

function frozen(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) frozen(child);
    return Object.freeze(value);
}

function exactRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function containsForbiddenKey(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8) return depth > 8;
    if (Array.isArray(value)) return value.some((child) => containsForbiddenKey(child, depth + 1));
    return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || containsForbiddenKey(child, depth + 1));
}

function validOpaque(value) {
    return typeof value === 'string' && OPAQUE.test(value);
}

function validDate(value) {
    return typeof value === 'string' && ISO_DATE.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function bodyHash(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function reply(status, body) {
    return frozen({ status, body: { schemaVersion: API_SCHEMA, ...body, brokerWriteAuthority: false } });
}

function errorReply(status, reason, details = undefined) {
    return reply(status, { ok: false, reason, ...(details === undefined ? {} : { details }) });
}

function configForApi(config) {
    return frozen({
        schemaVersion: config.schemaVersion,
        revision: config.revision,
        globalThreshold: config.globalThreshold,
        items: config.items.map((item) => ({
            contract: {
                security_type: item.contract.securityType,
                region: item.contract.region,
                exchange: item.contract.exchange,
                code: item.contract.code,
                target_code: item.contract.targetCode,
            },
            enabled: item.enabled,
            thresholdOverride: item.thresholdOverride,
            source: item.source,
        })),
    });
}

function publicLease(lease) {
    return {
        schemaVersion: lease.schemaVersion,
        leaseId: lease.leaseId,
        clientId: lease.clientId,
        generation: lease.generation,
        acquiredAt: lease.acquiredAt,
        expiresAt: lease.expiresAt,
    };
}

function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeNullableCount(value) {
    return value === null ? null : safeCount(value);
}

function safeReason(value, fallback = 'unavailable') {
    return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : fallback;
}

function safeCapacity(value = {}) {
    const configured = safeCount(value.configured);
    const eligible = safeCount(value.eligible);
    const active = safeCount(value.active);
    const dataActive = safeCount(value.dataActive ?? active);
    return {
        schemaVersion: CAPACITY_SCHEMA,
        gate0EvidenceCurrent: value.gate0EvidenceCurrent === true,
        globalOwnershipComplete: value.globalOwnershipComplete === true,
        boundedTransportReady: value.boundedTransportReady === true,
        controlPlaneSubscriptionRequested: value.controlPlaneSubscriptionRequested === true,
        awaitingFirstKbar: safeCount(value.awaitingFirstKbar),
        notificationAuthority: value.notificationAuthority === true,
        subscriptionTransportAuthority: false,
        configured,
        eligible,
        pilotCohort: Math.min(PILOT_COHORT_LIMIT, eligible),
        approvedActiveLimit: [20, 50, 100, 160].includes(value.approvedActiveLimit)
            ? value.approvedActiveLimit : PILOT_COHORT_LIMIT,
        evaluationStageTarget: [50, 100, 160].includes(value.evaluationStageTarget)
            ? value.evaluationStageTarget : null,
        evaluationState: [
            'not_scheduled', 'offline_only', 'preflight_blocked', 'running',
            'pending_evidence', 'ready_for_review', 'go', 'no_go', 'rollback',
        ].includes(value.evaluationState) ? value.evaluationState : 'not_scheduled',
        dataActive,
        active,
        waiting: safeCount(value.waiting),
        waitingGate: safeCount(value.waitingGate),
        waitingPilotLimit: safeCount(value.waitingPilotLimit),
        waitingCapacity: safeCount(value.waitingCapacity),
        waitingBaseline: safeCount(value.waitingBaseline),
        degraded: safeCount(value.degraded),
        confirmedPhysicalUsage: safeNullableCount(value.confirmedPhysicalUsage),
        confirmedOtherPhysicalUsage: safeNullableCount(value.confirmedOtherPhysicalUsage),
        providerReleaseProven: value.providerReleaseProven === true
            ? true : value.providerReleaseProven === false ? false : null,
        confirmedHeadroom: safeNullableCount(value.confirmedHeadroom ?? null),
        localPhysicalLimit: 160,
        requiredHeadroom: 40,
        availableForMonitor: safeCount(value.availableForMonitor),
        connectionGeneration: validOpaque(value.connectionGeneration) ? value.connectionGeneration : null,
        evidenceAt: typeof value.evidenceAt === 'string' && Number.isFinite(Date.parse(value.evidenceAt)) ? value.evidenceAt : null,
        reason: safeReason(value.reason, 'gate_evidence_missing'),
    };
}

const ITEM_STATES = new Set([
    'disabled', 'waiting_gate', 'waiting_pilot_limit', 'waiting_capacity', 'waiting_baseline',
    'awaiting_first_kbar', 'waiting_continuity', 'active', 'degraded',
]);
const BASELINE_STATES = new Set(['complete', 'incomplete', 'missing', 'unknown']);
const SUBSCRIPTION_STATES = new Set(['requested', 'confirmed', 'pending', 'unknown', 'none']);

function canonicalSymbol(item) {
    return `${item.contract.code}.${item.contract.exchange === 'TSE' ? 'TW' : 'TWO'}`;
}

function pilotKbarEligible(item) {
    return item.enabled === true && /^(?!00)\d{4}$/.test(item.contract.code);
}

function safeItemStatuses(config, rawItems, capacity, observedAt) {
    const candidates = Array.isArray(rawItems) ? rawItems : [];
    const bySymbol = new Map(candidates
        .filter((item) => item && typeof item === 'object' && typeof item.canonicalSymbol === 'string')
        .map((item) => [item.canonicalSymbol, item]));
    let enabledPosition = 0;
    const admissionLimit = capacity.evaluationState === 'running' && capacity.evaluationStageTarget
        ? capacity.evaluationStageTarget : capacity.approvedActiveLimit;
    return config.items.map((item) => {
        const symbol = canonicalSymbol(item);
        const raw = bySymbol.get(symbol) ?? {};
        let state;
        let reason;
        if (!item.enabled) {
            state = 'disabled';
            reason = 'disabled';
        } else if (!pilotKbarEligible(item)) {
            state = 'degraded';
            reason = 'kbar_contract_unsupported';
        } else if (enabledPosition++ >= admissionLimit) {
            state = 'waiting_pilot_limit';
            reason = 'approved_active_limit';
        } else if (!capacity.gate0EvidenceCurrent ||
            (!capacity.globalOwnershipComplete && !capacity.boundedTransportReady &&
                !capacity.controlPlaneSubscriptionRequested)) {
            state = 'waiting_gate';
            reason = capacity.reason;
        } else if (!ITEM_STATES.has(raw.state)) {
            state = 'degraded';
            reason = 'subscription_confirmation_unknown';
        } else {
            state = raw.state;
            reason = safeReason(raw.reason, state === 'active' ? 'none' : 'unavailable');
        }
        const baselineState = BASELINE_STATES.has(raw.baselineState)
            ? raw.baselineState
            : 'unknown';
        const subscriptionState = SUBSCRIPTION_STATES.has(raw.subscriptionState)
            ? raw.subscriptionState
            : state === 'active' ? 'confirmed' : 'none';
        if (state === 'active' && (baselineState !== 'complete' || subscriptionState !== 'confirmed')) {
            state = baselineState === 'complete' ? 'degraded' : 'waiting_baseline';
            reason = baselineState === 'complete' ? 'subscription_confirmation_unknown' : 'baseline_incomplete';
        }
        return {
            canonicalSymbol: symbol,
            state,
            reason,
            source: item.source,
            enabled: item.enabled,
            effectiveThreshold: item.effectiveThreshold.decimal,
            baseline: {
                state: baselineState,
                tradeDate: validDate(raw.baselineTradeDate) ? raw.baselineTradeDate : null,
                sourceVersion: typeof raw.baselineSourceVersion === 'string' && raw.baselineSourceVersion.length <= 128
                    ? raw.baselineSourceVersion
                    : null,
            },
            subscription: {
                state: subscriptionState,
                physicalKey: typeof raw.physicalKey === 'string' && raw.physicalKey.length <= 256 ? raw.physicalKey : null,
            },
            completedMinute: typeof raw.completedMinute === 'string' && /^\d{2}:\d{2}$/.test(raw.completedMinute)
                ? raw.completedMinute
                : null,
            currentCumulativeVolume: Number.isSafeInteger(raw.currentCumulativeVolume) && raw.currentCumulativeVolume >= 0
                ? raw.currentCumulativeVolume
                : null,
            previousCumulativeVolume: Number.isSafeInteger(raw.previousCumulativeVolume) && raw.previousCumulativeVolume >= 0
                ? raw.previousCumulativeVolume
                : null,
            updatedAt: typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))
                ? raw.updatedAt
                : observedAt,
        };
    });
}

function safeDiagnostics(value = {}) {
    const baseline = value.baseline ?? {};
    const completedMinute = value.completedMinute ?? {};
    return {
        schemaVersion: DIAGNOSTICS_SCHEMA,
        state: ['feature_off', 'idle', 'active', 'degraded', 'offline'].includes(value.state) ? value.state : 'offline',
        reason: safeReason(value.reason, 'unavailable'),
        ownershipRevision: Number.isSafeInteger(value.ownershipRevision) && value.ownershipRevision >= 0 ? value.ownershipRevision : null,
        evidenceRevision: Number.isSafeInteger(value.evidenceRevision) && value.evidenceRevision >= 0 ? value.evidenceRevision : null,
        baseline: {
            complete: baseline.complete === true,
            tradeDate: validDate(baseline.tradeDate) ? baseline.tradeDate : null,
            sourceVersion: typeof baseline.sourceVersion === 'string' && baseline.sourceVersion.length <= 128 ? baseline.sourceVersion : null,
            itemCount: safeCount(baseline.itemCount),
        },
        completedMinute: {
            tradeDate: validDate(completedMinute.tradeDate) ? completedMinute.tradeDate : null,
            minuteKey: typeof completedMinute.minuteKey === 'string' && /^\d{2}:\d{2}$/.test(completedMinute.minuteKey) ? completedMinute.minuteKey : null,
            evidenceAt: typeof completedMinute.evidenceAt === 'string' && Number.isFinite(Date.parse(completedMinute.evidenceAt)) ? completedMinute.evidenceAt : null,
        },
        secretsExposed: false,
        accountIdentifiersExposed: false,
        brokerWriteAuthority: false,
    };
}

export function createIntradayMonitorLocalApiService({
    configRepository,
    leaseCoordinator,
    evidenceRepository,
    generation,
    capacityProvider = () => ({}),
    diagnosticsProvider = () => ({}),
    now = () => new Date().toISOString(),
    cursorSecret = randomBytes(32),
} = {}) {
    if (!configRepository || typeof configRepository.read !== 'function' || typeof configRepository.replace !== 'function') throw new TypeError('configRepository is invalid');
    if (!leaseCoordinator || !['acquire', 'renew', 'release', 'status'].every((name) => typeof leaseCoordinator[name] === 'function')) throw new TypeError('leaseCoordinator is invalid');
    if (!evidenceRepository || typeof evidenceRepository.currentRevision !== 'function' || typeof evidenceRepository.listTriggers !== 'function') throw new TypeError('evidenceRepository is invalid');
    if (!validOpaque(generation)) throw new TypeError('generation is invalid');
    if (!Buffer.isBuffer(cursorSecret) || cursorSecret.length < 32) throw new TypeError('cursorSecret is invalid');

    const idempotency = new Map();
    const leaseHandles = new Map();
    const subscribers = new Set();
    let closed = false;

    function cursorFor(offset, tradeDate) {
        const payload = Buffer.from(JSON.stringify({ generation, offset, tradeDate })).toString('base64url');
        const signature = createHmac('sha256', cursorSecret).update(payload).digest('base64url');
        return `${payload}.${signature}`;
    }

    function parseCursor(cursor, tradeDate) {
        if (cursor === null || cursor === undefined || cursor === '') return 0;
        if (typeof cursor !== 'string' || cursor.length > 512 || !/^[A-Za-z0-9_.-]+$/.test(cursor)) return null;
        const [payload, signature, extra] = cursor.split('.');
        if (!payload || !signature || extra) return null;
        const expected = createHmac('sha256', cursorSecret).update(payload).digest('base64url');
        if (signature !== expected) return null;
        try {
            const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
            if (!exactRecord(decoded, ['generation', 'offset', 'tradeDate']) || decoded.generation !== generation || decoded.tradeDate !== tradeDate || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0) return null;
            return decoded.offset;
        } catch {
            return null;
        }
    }

    function idempotent(route, request, operation) {
        if (!validOpaque(request?.idempotencyKey)) return errorReply(400, 'invalid_idempotency_key');
        const hash = bodyHash(request);
        const existing = idempotency.get(request.idempotencyKey);
        if (existing) return existing.route === route && existing.hash === hash ? existing.response : errorReply(409, 'idempotency_conflict');
        const response = operation();
        idempotency.set(request.idempotencyKey, { route, hash, response });
        if (idempotency.size > 512) idempotency.delete(idempotency.keys().next().value);
        return response;
    }

    function readConfig() {
        try {
            const config = configForApi(configRepository.read());
            return reply(200, { ok: true, schemaVersion: CONFIG_RESPONSE_SCHEMA, revision: config.revision, config });
        } catch {
            return errorReply(503, 'config_repository_unavailable');
        }
    }

    function replaceConfig(request) {
        if (!exactRecord(request, ['schemaVersion', 'idempotencyKey', 'expectedRevision', 'config']) || request.schemaVersion !== CONFIG_REPLACE_SCHEMA || containsForbiddenKey(request)) return errorReply(400, 'invalid_config_request');
        return idempotent('config_replace', request, () => {
            if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || request.config?.revision !== request.expectedRevision) return errorReply(400, 'invalid_revision');
            try {
                const config = configForApi(configRepository.replace(request.config));
                return reply(200, { ok: true, schemaVersion: CONFIG_RESPONSE_SCHEMA, revision: config.revision, config });
            } catch (error) {
                if (error?.code === 'revision_conflict') return errorReply(409, 'revision_conflict', error.details ?? undefined);
                if (error?.code === 'invalid_config') return errorReply(422, 'invalid_config', error.details?.errors ?? []);
                return errorReply(503, 'config_repository_unavailable');
            }
        });
    }

    function validateLeaseRequest(request, action) {
        const keys = action === 'acquire'
            ? ['schemaVersion', 'idempotencyKey', 'clientId', 'generation']
            : ['schemaVersion', 'idempotencyKey', 'clientId', 'generation', 'leaseId'];
        return exactRecord(request, keys) && request.schemaVersion === LEASE_REQUEST_SCHEMA && !containsForbiddenKey(request) && validOpaque(request.idempotencyKey) && validOpaque(request.clientId) && validOpaque(request.generation) && (action === 'acquire' || validOpaque(request.leaseId));
    }

    function mutateLease(action, request) {
        if (!validateLeaseRequest(request, action)) return errorReply(400, 'invalid_lease_request');
        return idempotent(`lease_${action}`, request, () => {
            if (request.generation !== generation) return errorReply(409, 'stale_generation', { currentGeneration: generation });
            let result;
            if (action === 'acquire') {
                result = leaseCoordinator.acquire({ clientId: request.clientId, generation });
            } else {
                const handle = leaseHandles.get(request.leaseId);
                if (!handle || handle.clientId !== request.clientId || handle.generation !== request.generation) return errorReply(409, 'lease_not_current');
                result = leaseCoordinator[action](handle);
                leaseHandles.delete(request.leaseId);
            }
            if (result?.allowed === false) return errorReply(409, safeReason(result.reason, 'lease_rejected'));
            if (action === 'release') return reply(200, { ok: true, schemaVersion: LEASE_RESPONSE_SCHEMA, action: 'released', activeLeaseCount: safeCount(result.activeLeaseCount), stopCompleted: result.stopCompleted === true });
            leaseHandles.set(result.leaseId, result);
            return reply(200, { ok: true, schemaVersion: LEASE_RESPONSE_SCHEMA, action: action === 'acquire' ? 'acquired' : 'renewed', lease: publicLease(result), ttlMs: Math.max(0, Date.parse(result.expiresAt) - Date.parse(result.acquiredAt)) });
        });
    }

    function readStatus() {
        let config;
        try { config = configRepository.read(); } catch { return errorReply(503, 'config_repository_unavailable'); }
        const leases = leaseCoordinator.status();
        const rawCapacity = capacityProvider() ?? {};
        const preliminary = safeCapacity({ ...rawCapacity, configured: config.items.length, eligible: config.items.filter(pilotKbarEligible).length, connectionGeneration: generation });
        const itemStatuses = safeItemStatuses(config, rawCapacity.items, preliminary, now());
        const waitingGate = itemStatuses.filter((item) => item.state === 'waiting_gate').length;
        const waitingPilotLimit = itemStatuses.filter((item) => item.state === 'waiting_pilot_limit').length;
        const waitingCapacity = itemStatuses.filter((item) => item.state === 'waiting_capacity').length;
        const waitingBaseline = itemStatuses.filter((item) => item.state === 'waiting_baseline').length;
        const awaitingFirstKbar = itemStatuses.filter((item) => item.state === 'awaiting_first_kbar').length;
        const waitingContinuity = itemStatuses.filter((item) => item.state === 'waiting_continuity').length;
        const degraded = itemStatuses.filter((item) => item.state === 'degraded').length;
        const active = itemStatuses.filter((item) => item.state === 'active').length;
        const capacity = safeCapacity({
            ...rawCapacity,
            configured: config.items.length,
            eligible: config.items.filter(pilotKbarEligible).length,
            active,
            waiting: waitingGate + waitingPilotLimit + waitingCapacity + waitingBaseline +
                awaitingFirstKbar + waitingContinuity,
            awaitingFirstKbar,
            waitingGate,
            waitingPilotLimit,
            waitingCapacity,
            waitingBaseline,
            degraded,
            connectionGeneration: generation,
        });
        const state = !capacity.gate0EvidenceCurrent ||
            (!capacity.globalOwnershipComplete && !capacity.boundedTransportReady &&
                !capacity.controlPlaneSubscriptionRequested)
            ? 'feature_off'
            : degraded > 0
              ? 'degraded'
              : leases.acceptingEvents && active > 0
                ? 'active'
                : 'idle';
        const reason = state === 'feature_off'
            ? capacity.reason
            : state === 'degraded'
              ? itemStatuses.find((item) => item.state === 'degraded')?.reason ?? 'unavailable'
              : !leases.acceptingEvents
                ? 'lease_missing'
                : awaitingFirstKbar > 0
                  ? 'awaiting_first_kbar'
                  : waitingContinuity > 0
                    ? 'minute_continuity_unknown'
                : waitingBaseline > 0
                  ? 'baseline_missing'
                  : waitingPilotLimit > 0
                    ? 'pilot_limit'
                  : waitingCapacity > 0
                    ? 'capacity_exhausted'
                    : 'none';
        return reply(200, {
            ok: true,
            schemaVersion: STATUS_SCHEMA,
            state,
            reason,
            generation,
            configRevision: config.revision,
            lease: { activeLeaseCount: safeCount(leases.activeLeaseCount), sessionState: safeReason(leases.sessionState, 'unavailable'), acceptingEvents: leases.acceptingEvents === true },
            capacity,
            itemStatuses,
            observedAt: now(),
        });
    }

    function readCapacity() {
        let config;
        try { config = configRepository.read(); } catch { return errorReply(503, 'config_repository_unavailable'); }
        const rawCapacity = capacityProvider() ?? {};
        const preliminary = safeCapacity({ ...rawCapacity, configured: config.items.length, eligible: config.items.filter(pilotKbarEligible).length, connectionGeneration: generation });
        const itemStatuses = safeItemStatuses(config, rawCapacity.items, preliminary, now());
        return reply(200, { ok: true, ...safeCapacity({
            ...rawCapacity,
            configured: config.items.length,
            eligible: config.items.filter(pilotKbarEligible).length,
            active: itemStatuses.filter((item) => item.state === 'active').length,
            waiting: itemStatuses.filter((item) => item.state.startsWith('waiting_') ||
                item.state === 'awaiting_first_kbar').length,
            awaitingFirstKbar: itemStatuses.filter((item) => item.state === 'awaiting_first_kbar').length,
            waitingGate: itemStatuses.filter((item) => item.state === 'waiting_gate').length,
            waitingPilotLimit: itemStatuses.filter((item) => item.state === 'waiting_pilot_limit').length,
            waitingCapacity: itemStatuses.filter((item) => item.state === 'waiting_capacity').length,
            waitingBaseline: itemStatuses.filter((item) => item.state === 'waiting_baseline').length,
            degraded: itemStatuses.filter((item) => item.state === 'degraded').length,
            connectionGeneration: generation,
        }) });
    }

    function readPage({ tradeDate, limit = '50', cursor = null }, schemaVersion = RESULTS_SCHEMA) {
        if (!validDate(tradeDate) || !/^\d{1,3}$/.test(String(limit)) || Number(limit) < 1 || Number(limit) > INTRADAY_MONITOR_LOCAL_API_MAX_PAGE_SIZE) return errorReply(400, 'invalid_query');
        const offset = parseCursor(cursor, tradeDate);
        if (offset === null) return errorReply(409, 'invalid_cursor');
        try {
            const all = typeof evidenceRepository.listTriggerResults === 'function'
                ? evidenceRepository.listTriggerResults(tradeDate)
                : evidenceRepository.listTriggers(tradeDate);
            if (offset > all.length) return errorReply(409, 'stale_cursor');
            const items = all.slice(offset, offset + Number(limit)).map((event) => ({ ...event, notificationAuthority: false, brokerWriteAuthority: false }));
            const nextOffset = offset + items.length;
            return reply(200, {
                ok: true,
                schemaVersion,
                generation,
                repositoryRevision: evidenceRepository.currentRevision(),
                tradeDate,
                items,
                cursor: cursorFor(nextOffset, tradeDate),
                nextCursor: nextOffset < all.length ? cursorFor(nextOffset, tradeDate) : null,
                replayNotificationAuthority: false,
            });
        } catch {
            return errorReply(503, 'evidence_repository_unavailable');
        }
    }

    function readDiagnostics() {
        let evidenceRevision = null;
        try { evidenceRevision = evidenceRepository.currentRevision(); } catch {}
        return reply(200, { ok: true, ...safeDiagnostics({ ...diagnosticsProvider(), evidenceRevision }) });
    }

    function subscribe(listener) {
        if (typeof listener !== 'function' || closed) return () => {};
        subscribers.add(listener);
        return () => subscribers.delete(listener);
    }

    function publishPersistedTrigger(event) {
        if (closed || !event || typeof event !== 'object') return false;
        let cursor = null;
        try {
            const rows = evidenceRepository.listTriggers(event.tradeDate);
            cursor = cursorFor(rows.length, event.tradeDate);
        } catch {
            return false;
        }
        const projected = frozen({ cursor, event: { ...event, notificationAuthority: event.kind === 'live', brokerWriteAuthority: false } });
        for (const listener of subscribers) {
            try { listener(projected); } catch {}
        }
        return true;
    }

    function liveNotificationAuthority() {
        const capacity = safeCapacity(capacityProvider() ?? {});
        return capacity.notificationAuthority === true && capacity.evaluationState === 'go';
    }

    function close() {
        closed = true;
        subscribers.clear();
        leaseHandles.clear();
        idempotency.clear();
    }

    return frozen({
        generation,
        readConfig,
        replaceConfig,
        mutateLease,
        readStatus,
        readCapacity,
        readResults: (query) => readPage(query, RESULTS_SCHEMA),
        readEvents: (query) => readPage(query, EVENTS_SCHEMA),
        readDiagnostics,
        subscribe,
        publishPersistedTrigger,
        liveNotificationAuthority,
        close,
    });
}

export const intradayMonitorLocalApiSchemas = frozen({
    api: API_SCHEMA,
    configReplace: CONFIG_REPLACE_SCHEMA,
    leaseRequest: LEASE_REQUEST_SCHEMA,
});
