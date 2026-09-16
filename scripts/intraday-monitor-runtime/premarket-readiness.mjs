import {
    validateIntradayMonitorPilotCohortReceiptManifest,
} from './pilot-cohort-receipts.mjs';
import {
    validateIntradayMonitorPilotStagePlan,
} from './pilot-shadow-evidence.mjs';

export const INTRADAY_MONITOR_PREMARKET_RUNTIME_SNAPSHOT_SCHEMA =
    'intraday-monitor-premarket-runtime-snapshot/1';

const RUNTIME_KEYS = Object.freeze([
    'schemaVersion',
    'capturedAt',
    'endpointUrl',
    'simulation',
    'production',
    'featureEnabled',
    'notificationsEnabled',
    'gate0Decision',
    'gate0EvidenceCurrent',
    'globalOwnershipComplete',
    'confirmedActiveCapacity',
    'configRevision',
    'plannedTradeDate',
    'calendarAuthorityReady',
    'connectionGeneration',
    'providerRequestAuthority',
    'automaticSubscriptionAuthority',
    'subscriptionTransportAuthority',
    'serviceLifecycleAuthority',
    'brokerWriteAuthority',
]);
const STORAGE_KEYS = Object.freeze([
    'evidenceDirectory',
    'directoryExists',
    'readable',
    'writable',
    'availableDiskBytes',
    'minimumRequiredDiskBytes',
    'capturedAt',
]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OPAQUE = /^[A-Za-z0-9:_-]{8,128}$/;

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function exactRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length &&
        actual.every((key, index) => key === expected[index]);
}

function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function validInstant(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validDate(value) {
    return typeof value === 'string' && DATE.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function isLoopbackHttpUrl(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) &&
            ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    } catch {
        return false;
    }
}

function validRuntimeSnapshot(value) {
    return Boolean(
        exactRecord(value, RUNTIME_KEYS) &&
            value.schemaVersion === INTRADAY_MONITOR_PREMARKET_RUNTIME_SNAPSHOT_SCHEMA &&
            validInstant(value.capturedAt) &&
            typeof value.endpointUrl === 'string' &&
            typeof value.simulation === 'boolean' &&
            typeof value.production === 'boolean' &&
            typeof value.featureEnabled === 'boolean' &&
            typeof value.notificationsEnabled === 'boolean' &&
            ['go', 'no_go'].includes(value.gate0Decision) &&
            typeof value.gate0EvidenceCurrent === 'boolean' &&
            typeof value.globalOwnershipComplete === 'boolean' &&
            safeCount(value.confirmedActiveCapacity) &&
            safeCount(value.configRevision) &&
            validDate(value.plannedTradeDate) &&
            typeof value.calendarAuthorityReady === 'boolean' &&
            typeof value.connectionGeneration === 'string' &&
            OPAQUE.test(value.connectionGeneration) &&
            typeof value.providerRequestAuthority === 'boolean' &&
            typeof value.automaticSubscriptionAuthority === 'boolean' &&
            typeof value.subscriptionTransportAuthority === 'boolean' &&
            typeof value.serviceLifecycleAuthority === 'boolean' &&
            typeof value.brokerWriteAuthority === 'boolean',
    );
}

function validStorageSnapshot(value) {
    return Boolean(
        exactRecord(value, STORAGE_KEYS) &&
            typeof value.evidenceDirectory === 'string' &&
            value.evidenceDirectory.length > 0 &&
            typeof value.directoryExists === 'boolean' &&
            typeof value.readable === 'boolean' &&
            typeof value.writable === 'boolean' &&
            safeCount(value.availableDiskBytes) &&
            safeCount(value.minimumRequiredDiskBytes) &&
            value.minimumRequiredDiskBytes > 0 &&
            validInstant(value.capturedAt),
    );
}

export function evaluateIntradayMonitorPremarketReadiness({
    plan,
    cohortReceipts,
    runtime,
    storage,
} = {}) {
    const reasons = new Set();
    const planValid = validateIntradayMonitorPilotStagePlan(plan).valid;
    const receiptsValid =
        validateIntradayMonitorPilotCohortReceiptManifest(cohortReceipts).valid;
    const runtimeValid = validRuntimeSnapshot(runtime);
    const storageValid = validStorageSnapshot(storage);

    if (!planValid) reasons.add('invalid_stage_plan');
    if (!receiptsValid) reasons.add('invalid_cohort_receipt_manifest');
    if (!runtimeValid) reasons.add('invalid_runtime_snapshot');
    if (!storageValid) reasons.add('invalid_storage_snapshot');

    if (planValid && receiptsValid) {
        if (plan.cohortReceiptManifestHash !== cohortReceipts.manifestHash) {
            reasons.add('cohort_receipt_hash_mismatch');
        }
        if (
            plan.cohort.length !== cohortReceipts.cohort.length ||
            plan.cohort.some((symbol, index) => symbol !== cohortReceipts.cohort[index])
        ) {
            reasons.add('cohort_mismatch');
        }
    }

    if (runtimeValid) {
        if (!isLoopbackHttpUrl(runtime.endpointUrl)) reasons.add('endpoint_not_loopback');
        if (!runtime.simulation) reasons.add('simulation_not_confirmed');
        if (runtime.production) reasons.add('production_enabled');
        if (runtime.featureEnabled) reasons.add('feature_must_remain_off');
        if (runtime.notificationsEnabled) reasons.add('notifications_must_remain_off');
        if (runtime.gate0Decision !== 'go') reasons.add('gate0_not_go');
        if (!runtime.gate0EvidenceCurrent) reasons.add('gate0_evidence_not_current');
        if (!runtime.globalOwnershipComplete) reasons.add('ownership_incomplete');
        if (planValid && runtime.confirmedActiveCapacity < plan.minimumActiveMonitorCount) {
            reasons.add('confirmed_capacity_below_plan_minimum');
        }
        if (runtime.configRevision < 1) reasons.add('config_revision_missing');
        if (!runtime.calendarAuthorityReady) reasons.add('calendar_authority_not_ready');
        if (runtime.providerRequestAuthority) reasons.add('provider_request_authority_present');
        if (runtime.automaticSubscriptionAuthority) reasons.add('automatic_subscription_authority_present');
        if (runtime.subscriptionTransportAuthority) reasons.add('subscription_transport_authority_present');
        if (runtime.serviceLifecycleAuthority) reasons.add('service_lifecycle_authority_present');
        if (runtime.brokerWriteAuthority) reasons.add('broker_write_authority_present');
    }

    if (storageValid) {
        if (!storage.directoryExists) reasons.add('evidence_directory_missing');
        if (!storage.readable) reasons.add('evidence_directory_not_readable');
        if (!storage.writable) reasons.add('evidence_directory_not_writable');
        if (storage.availableDiskBytes < storage.minimumRequiredDiskBytes) {
            reasons.add('insufficient_evidence_disk_space');
        }
    }

    return deepFreeze({
        validInputs: planValid && receiptsValid && runtimeValid && storageValid,
        readyForControlledPilot: reasons.size === 0,
        reasons: [...reasons].sort(),
        checks: {
            planHash: planValid ? plan.planHash : null,
            cohortReceiptManifestHash: receiptsValid ? cohortReceipts.manifestHash : null,
            plannedTradeDate: runtimeValid ? runtime.plannedTradeDate : null,
            confirmedActiveCapacity: runtimeValid ? runtime.confirmedActiveCapacity : null,
            availableDiskBytes: storageValid ? storage.availableDiskBytes : null,
            minimumRequiredDiskBytes: storageValid ? storage.minimumRequiredDiskBytes : null,
            preflightProviderRequestAuthority: false,
            networkRequestPerformed: false,
            subscriptionMutationPerformed: false,
            serviceLifecycleMutationPerformed: false,
            brokerWritePerformed: false,
        },
    });
}
