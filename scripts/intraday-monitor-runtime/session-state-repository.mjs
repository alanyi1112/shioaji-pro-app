import { createHash, randomUUID } from 'node:crypto';
import {
    closeSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const INTRADAY_MONITOR_CAPACITY_APPROVAL_SCHEMA =
    'intraday-monitor-capacity-approval/1';
export const INTRADAY_MONITOR_DAILY_SESSION_SCHEMA =
    'intraday-monitor-daily-session/1';
export const INTRADAY_MONITOR_LEGACY_MIGRATION_SCHEMA =
    'intraday-monitor-legacy-migration/1';
export const INTRADAY_MONITOR_LEGACY_STATE_MAPPING = Object.freeze({
    approvedActiveLimit: 'approval.approvedActiveLimit',
    evaluationStageTarget: 'approval.stage',
    evaluationState: 'approval.decision',
    tradeDate: 'approval.evidenceTradeDate',
    updatedAt: 'approval.reviewedAt',
    provider: 'approval.providerEvidence (unknown values preserved)',
    configRevision: 'historical only; never current session',
    connectionGeneration: 'historical only; never current session',
    controlPlaneSubscriptionRequested: 'historical only; never today control plane',
    dataActive: 'historical only; never today data plane',
    items: 'historical only; never today item states',
    notificationAuthority: 'discarded; migrated authority is always false',
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9:._-]{1,160}$/;
const APPROVAL_DECISIONS = new Set(['go', 'no_go', 'rollback']);
const REVIEWER_TYPES = new Set(['human', 'codex_delegated', 'system']);
const SESSION_PHASES = new Set([
    'waiting_baseline',
    'starting',
    'running',
    'closing',
    'complete',
    'blocked',
]);
const ITEM_STATES = new Set([
    'waiting_gate',
    'waiting_pilot_limit',
    'waiting_capacity',
    'waiting_baseline',
    'awaiting_first_kbar',
    'waiting_continuity',
    'active',
    'degraded',
]);

function validInstant(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validDate(value) {
    return typeof value === 'string' && DATE.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort()
        .map((key) => [key, stableValue(value[key])]));
}

function hashRecord(value) {
    return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function atomicWriteJson(file, value) {
    const directory = path.dirname(file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor = null;
    try {
        descriptor = openSync(temporary, 'wx', 0o600);
        writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = null;
        renameSync(temporary, file);
        const directoryDescriptor = openSync(directory, 'r');
        try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    } catch (error) {
        if (descriptor !== null) closeSync(descriptor);
        try { unlinkSync(temporary); } catch {}
        throw error;
    }
}

function readJson(file) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

export function resolveIntradayMonitorSessionStatePaths(appSupportRoot) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new TypeError('application support root is invalid');
    }
    const directory = path.join(appSupportRoot, 'IntradayMonitor', 'session-state');
    return Object.freeze({
        directory,
        approvalPath: path.join(directory, 'capacity-approval.json'),
        migrationPath: path.join(directory, 'legacy-migration.json'),
        sessionsDirectory: path.join(directory, 'sessions'),
        generationTransitionsDirectory: path.join(directory, 'generation-transitions'),
    });
}

export function capacityApprovalIdentity(value) {
    return {
        approvedActiveLimit: value.approvedActiveLimit,
        stage: value.stage,
        decision: value.decision,
        reviewerType: value.reviewerType,
        reviewerId: value.reviewerId,
        reviewedAt: value.reviewedAt,
        evidenceTradeDate: value.evidenceTradeDate,
        artifactBundleHash: value.artifactBundleHash,
        authorizationProvenance: value.authorizationProvenance,
        providerEvidence: value.providerEvidence,
    };
}

export function createCapacityApprovalRecord(input) {
    const identity = capacityApprovalIdentity(input ?? {});
    const record = {
        schemaVersion: INTRADAY_MONITOR_CAPACITY_APPROVAL_SCHEMA,
        ...identity,
        approvalHash: hashRecord(identity),
    };
    if (!validateCapacityApprovalRecord(record)) {
        throw new TypeError('capacity approval record is invalid');
    }
    return Object.freeze(record);
}

export function validateCapacityApprovalRecord(value) {
    return Boolean(value?.schemaVersion === INTRADAY_MONITOR_CAPACITY_APPROVAL_SCHEMA &&
        [20, 50, 100, 160].includes(value.approvedActiveLimit) &&
        [20, 50, 100, 160].includes(value.stage) &&
        APPROVAL_DECISIONS.has(value.decision) && REVIEWER_TYPES.has(value.reviewerType) &&
        TOKEN.test(value.reviewerId ?? '') && validInstant(value.reviewedAt) &&
        validDate(value.evidenceTradeDate) && HASH.test(value.artifactBundleHash ?? '') &&
        typeof value.authorizationProvenance === 'string' &&
        value.authorizationProvenance.length >= 1 && value.authorizationProvenance.length <= 512 &&
        value.providerEvidence?.physicalUsage === null &&
        value.providerEvidence?.otherUsage === null &&
        value.providerEvidence?.globalOwnershipComplete === null &&
        value.providerEvidence?.releaseProven === null &&
        value.providerEvidence?.headroom === null &&
        HASH.test(value.approvalHash ?? '') &&
        value.approvalHash === hashRecord(capacityApprovalIdentity(value)));
}

function sessionIdentity(value) {
    return {
        sessionId: value.sessionId,
        tradeDate: value.tradeDate,
        previousTradeDate: value.previousTradeDate,
        configRevision: value.configRevision,
        cohortHash: value.cohortHash,
        baselineHash: value.baselineHash,
        artifactBundleHash: value.artifactBundleHash,
        approvalHash: value.approvalHash,
        connectionGeneration: value.connectionGeneration,
        schedulerReceiptHash: value.schedulerReceiptHash,
        calendarAuthorityHash: value.calendarAuthorityHash,
    };
}

export function createDailySessionRecord(input) {
    const calendarAuthority = input?.calendarAuthority;
    const calendarAuthorityHash = hashRecord(calendarAuthority);
    const identity = sessionIdentity({ ...input, calendarAuthorityHash });
    const record = {
        schemaVersion: INTRADAY_MONITOR_DAILY_SESSION_SCHEMA,
        ...identity,
        sessionIdentityHash: hashRecord(identity),
        calendarAuthority,
        phase: input?.phase ?? 'waiting_baseline',
        itemStates: input?.itemStates ?? [],
        controlPlane: input?.controlPlane ?? { requested: false, accepted: false },
        freshness: input?.freshness ?? { evidenceAt: null, budgetMs: 0 },
        createdAt: input?.createdAt,
        updatedAt: input?.updatedAt ?? input?.createdAt,
        blocker: input?.blocker ?? null,
        brokerWriteAuthority: false,
        productionAuthority: false,
    };
    if (!validateDailySessionRecord(record)) {
        throw new TypeError('daily session record is invalid');
    }
    return Object.freeze(record);
}

export function validateDailySessionRecord(value) {
    const symbols = value?.itemStates?.map((item) => item.canonicalSymbol) ?? [];
    return Boolean(value?.schemaVersion === INTRADAY_MONITOR_DAILY_SESSION_SCHEMA &&
        TOKEN.test(value.sessionId ?? '') && validDate(value.tradeDate) &&
        validDate(value.previousTradeDate) && value.previousTradeDate < value.tradeDate &&
        Number.isSafeInteger(value.configRevision) && value.configRevision >= 0 &&
        HASH.test(value.cohortHash ?? '') &&
        (value.baselineHash === null || HASH.test(value.baselineHash ?? '')) &&
        HASH.test(value.artifactBundleHash ?? '') && HASH.test(value.approvalHash ?? '') &&
        TOKEN.test(value.connectionGeneration ?? '') && HASH.test(value.schedulerReceiptHash ?? '') &&
        HASH.test(value.calendarAuthorityHash ?? '') &&
        value.calendarAuthorityHash === hashRecord(value.calendarAuthority) &&
        value.calendarAuthority?.current === true &&
        value.calendarAuthority?.tradeDate === value.tradeDate &&
        value.calendarAuthority?.previousTradeDate === value.previousTradeDate &&
        value.calendarAuthority?.isTradingDate === true &&
        typeof value.calendarAuthority?.source === 'string' &&
        Array.isArray(value.calendarAuthority?.sourceVersions) &&
        validInstant(value.calendarAuthority?.observedAt) &&
        HASH.test(value.sessionIdentityHash ?? '') &&
        value.sessionIdentityHash === hashRecord(sessionIdentity(value)) &&
        SESSION_PHASES.has(value.phase) && Array.isArray(value.itemStates) &&
        value.itemStates.every((item) =>
            /^\d{4,6}[A-Z]?\.(?:TW|TWO)$/.test(item?.canonicalSymbol ?? '') &&
            ITEM_STATES.has(item.state) && typeof item.reason === 'string' &&
            item.reason.length >= 1 && item.reason.length <= 128 &&
            ['complete', 'missing', 'stale', 'unknown'].includes(item.baselineState) &&
            ['none', 'requested', 'accepted', 'confirmed', 'unknown'].includes(item.subscriptionState) &&
            (item.firstKbarAt === null || validInstant(item.firstKbarAt)) &&
            validInstant(item.updatedAt)) &&
        new Set(symbols).size === symbols.length &&
        typeof value.controlPlane?.requested === 'boolean' &&
        typeof value.controlPlane?.accepted === 'boolean' &&
        (value.freshness?.evidenceAt === null || validInstant(value.freshness.evidenceAt)) &&
        Number.isSafeInteger(value.freshness?.budgetMs) && value.freshness.budgetMs >= 0 &&
        validInstant(value.createdAt) && validInstant(value.updatedAt) &&
        (value.generationEpoch === undefined ||
            (Number.isSafeInteger(value.generationEpoch) && value.generationEpoch >= 0 &&
                value.generationEpoch <= 4)) &&
        (value.generationRecoveryIds === undefined ||
            (Array.isArray(value.generationRecoveryIds) &&
                value.generationRecoveryIds.length <= 4 &&
                value.generationRecoveryIds.every((id) => HASH.test(id)))) &&
        (value.blocker === null || TOKEN.test(value.blocker)) &&
        value.brokerWriteAuthority === false && value.productionAuthority === false);
}

export class IntradayMonitorSessionStateRepository {
    constructor(appSupportRoot) {
        this.paths = resolveIntradayMonitorSessionStatePaths(appSupportRoot);
    }

    readApproval() {
        const value = readJson(this.paths.approvalPath);
        return validateCapacityApprovalRecord(value) ? value : null;
    }

    writeApproval(value) {
        if (!validateCapacityApprovalRecord(value)) {
            throw new TypeError('capacity approval record is invalid');
        }
        const existing = this.readApproval();
        if (existing && existing.approvalHash !== value.approvalHash) {
            throw new Error('capacity_approval_conflict');
        }
        if (!existing) atomicWriteJson(this.paths.approvalPath, value);
        return existing ?? value;
    }

    sessionPath(tradeDate) {
        if (!validDate(tradeDate)) throw new TypeError('session trade date is invalid');
        return path.join(this.paths.sessionsDirectory, `${tradeDate}.json`);
    }

    readSession(tradeDate) {
        const value = readJson(this.sessionPath(tradeDate));
        return validateDailySessionRecord(value) ? value : null;
    }

    claimSession(value) {
        if (!validateDailySessionRecord(value)) {
            throw new TypeError('daily session record is invalid');
        }
        mkdirSync(this.paths.sessionsDirectory, { recursive: true, mode: 0o700 });
        const target = this.sessionPath(value.tradeDate);
        let descriptor;
        try {
            descriptor = openSync(target, 'wx', 0o600);
            writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
            fsyncSync(descriptor);
            closeSync(descriptor);
            return value;
        } catch (error) {
            if (descriptor !== undefined) {
                try { closeSync(descriptor); } catch {}
            }
            if (error?.code === 'EEXIST') {
                const existing = this.readSession(value.tradeDate);
                if (existing?.sessionIdentityHash === value.sessionIdentityHash) return existing;
                throw new Error('daily_session_claim_conflict');
            }
            throw error;
        }
    }

    updateSession(value) {
        if (!validateDailySessionRecord(value)) {
            throw new TypeError('daily session record is invalid');
        }
        const existing = this.readSession(value.tradeDate);
        if (!existing || existing.sessionIdentityHash !== value.sessionIdentityHash) {
            throw new Error('daily_session_identity_mismatch');
        }
        atomicWriteJson(this.sessionPath(value.tradeDate), value);
        return value;
    }

    attachSessionBaseline({ tradeDate, baselineHash, observedAt }) {
        if (!validDate(tradeDate) || !HASH.test(baselineHash ?? '') || !validInstant(observedAt)) {
            throw new TypeError('daily session baseline attachment is invalid');
        }
        const existing = this.readSession(tradeDate);
        if (!existing) throw new Error('current_session_missing');
        if (existing.baselineHash && existing.baselineHash !== baselineHash) {
            throw new Error('daily_session_baseline_conflict');
        }
        if (existing.baselineHash === baselineHash) return existing;
        if (existing.phase !== 'waiting_baseline') {
            throw new Error('daily_session_baseline_attachment_not_allowed');
        }
        const identity = sessionIdentity({ ...existing, baselineHash });
        const next = {
            ...existing,
            baselineHash,
            sessionIdentityHash: hashRecord(identity),
            phase: 'starting',
            itemStates: existing.itemStates.map((item) => ({
                ...item,
                state: 'awaiting_first_kbar',
                reason: 'awaiting_first_kbar',
                baselineState: 'complete',
                baselineTradeDate: existing.previousTradeDate,
                updatedAt: observedAt,
            })),
            freshness: { evidenceAt: observedAt, budgetMs: 20 * 60_000 },
            updatedAt: observedAt,
            blocker: null,
        };
        if (!validateDailySessionRecord(next)) {
            throw new TypeError('daily session baseline attachment is invalid');
        }
        atomicWriteJson(this.sessionPath(tradeDate), next);
        return next;
    }

    rebindUnstartedSessionGeneration({ tradeDate, expectedSessionIdentityHash,
        newGeneration, schedulerStep, observedAt, evidence } = {}) {
        if (!validDate(tradeDate) || !HASH.test(expectedSessionIdentityHash ?? '') ||
            !/^simulation:[A-Za-z0-9_-]{16,100}$/.test(newGeneration ?? '') ||
            !['08:35', '08:45'].includes(schedulerStep) || !validInstant(observedAt) ||
            evidence?.apiSimulation !== true || evidence?.businessSession !== true ||
            evidence?.snapshot2330 !== true || evidence?.calendarVerified !== true ||
            evidence?.artifactVerified !== true || evidence?.configRevisionVerified !== true ||
            evidence?.noCurrentResults !== true) {
            throw new TypeError('generation recovery evidence is invalid');
        }
        const existing = this.readSession(tradeDate);
        if (!existing || existing.sessionIdentityHash !== expectedSessionIdentityHash ||
            existing.connectionGeneration === newGeneration) {
            throw new Error('generation_recovery_identity_mismatch');
        }
        if (!['waiting_baseline', 'starting'].includes(existing.phase) ||
            existing.controlPlane.requested || existing.controlPlane.accepted ||
            !Array.isArray(existing.itemStates) || existing.itemStates.length !== 160 ||
            existing.itemStates.some((item) => item.subscriptionState !== 'none' ||
                item.firstKbarAt !== null ||
                !['waiting_baseline', 'awaiting_first_kbar'].includes(item.state)) ||
            (existing.generationRecoveryIds?.length ?? 0) >= 4) {
            throw new Error('generation_recovery_data_activity_present');
        }
        const transitionId = hashRecord({ tradeDate,
            priorSessionIdentityHash: existing.sessionIdentityHash, newGeneration });
        const nextSessionIdentityHash = hashRecord(sessionIdentity({
            ...existing, connectionGeneration: newGeneration,
        }));
        const transition = {
            schemaVersion: 'intraday-monitor-generation-transition/1', transitionId,
            tradeDate, sessionId: existing.sessionId,
            previousGeneration: existing.connectionGeneration, newGeneration,
            priorSessionIdentityHash: existing.sessionIdentityHash,
            nextSessionIdentityHash,
            schedulerStep, observedAt,
            baselineHash: existing.baselineHash,
            cohortHash: existing.cohortHash,
            artifactBundleHash: existing.artifactBundleHash,
            approvalHash: existing.approvalHash,
            configRevision: existing.configRevision,
            evidence,
            brokerWriteAuthority: false, productionAuthority: false,
            serviceLifecycleAuthority: false,
        };
        const transitionPath = path.join(this.paths.generationTransitionsDirectory,
            tradeDate, `${transitionId}.json`);
        mkdirSync(path.dirname(transitionPath), { recursive: true, mode: 0o700 });
        let descriptor = null;
        try {
            descriptor = openSync(transitionPath, 'wx', 0o600);
            writeFileSync(descriptor, `${JSON.stringify(transition, null, 2)}\n`);
            fsyncSync(descriptor);
            closeSync(descriptor);
            descriptor = null;
        } catch (error) {
            if (descriptor !== null) closeSync(descriptor);
            if (error?.code !== 'EEXIST') throw error;
            const stored = readJson(transitionPath);
            if (stored?.transitionId !== transitionId ||
                stored.priorSessionIdentityHash !== existing.sessionIdentityHash ||
                stored.nextSessionIdentityHash !== nextSessionIdentityHash ||
                stored.newGeneration !== newGeneration) {
                throw new Error('generation_recovery_receipt_conflict');
            }
        }
        const next = {
            ...existing,
            connectionGeneration: newGeneration,
            sessionIdentityHash: nextSessionIdentityHash,
            generationRecoveryIds: [...(existing.generationRecoveryIds ?? []), transitionId],
            generationEpoch: (existing.generationEpoch ?? 0) + 1,
            freshness: { evidenceAt: observedAt, budgetMs: existing.baselineHash ? 20 * 60_000 : 0 },
            updatedAt: observedAt,
        };
        if (!validateDailySessionRecord(next)) {
            throw new TypeError('recovered daily session is invalid');
        }
        atomicWriteJson(this.sessionPath(tradeDate), next);
        return Object.freeze({ session: next, transition, transitionPath });
    }

    migrateLegacyProductState(legacy, {
        artifactBundleHash,
        reviewerType = 'codex_delegated',
        reviewerId = 'codex-delegated-review',
        authorizationProvenance = 'user_delegated_evidence_review',
    } = {}) {
        if (legacy?.schemaVersion !== 'intraday-monitor-direct-160-product-runtime/1' ||
            legacy.phase !== 'complete_go' || legacy.evaluationState !== 'go' ||
            legacy.approvedActiveLimit !== 160 || !validDate(legacy.tradeDate) ||
            !validInstant(legacy.updatedAt) || !HASH.test(artifactBundleHash ?? '')) {
            throw new TypeError('legacy product state is not migratable');
        }
        const approval = createCapacityApprovalRecord({
            approvedActiveLimit: 160,
            stage: legacy.evaluationStageTarget,
            decision: 'go',
            reviewerType,
            reviewerId,
            reviewedAt: legacy.updatedAt,
            evidenceTradeDate: legacy.tradeDate,
            artifactBundleHash,
            authorizationProvenance,
            providerEvidence: {
                physicalUsage: null,
                otherUsage: null,
                globalOwnershipComplete: null,
                releaseProven: null,
                headroom: null,
            },
        });
        const saved = this.writeApproval(approval);
        const migration = {
            schemaVersion: INTRADAY_MONITOR_LEGACY_MIGRATION_SCHEMA,
            sourceSchemaVersion: legacy.schemaVersion,
            sourceTradeDate: legacy.tradeDate,
            sourceStateHash: hashRecord(legacy),
            approvalHash: saved.approvalHash,
            historicalOnly: true,
            currentSessionCreated: false,
            subscriptionAuthority: false,
            resultsAuthority: false,
            notificationAuthority: false,
            migratedAt: new Date().toISOString(),
        };
        const existing = readJson(this.paths.migrationPath);
        if (existing && existing.sourceStateHash !== migration.sourceStateHash) {
            throw new Error('legacy_migration_conflict');
        }
        if (!existing) atomicWriteJson(this.paths.migrationPath, migration);
        return Object.freeze({ approval: saved, migration: existing ?? migration });
    }
}

export const intradayMonitorSessionStateInternals = Object.freeze({
    hashRecord,
});
