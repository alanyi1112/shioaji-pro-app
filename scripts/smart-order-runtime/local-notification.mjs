import { execFile as nodeExecFile } from 'node:child_process';

export const SMART_ORDER_LOCAL_NOTIFICATION_SCHEMA_VERSION =
    'smart-order-local-notification/2026-08-15.2';

const MAX_EVENT_BATCH = 100;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const APPLE_SCRIPT = [
    'on run argv',
    'display notification (item 2 of argv) with title (item 1 of argv)',
    'end run',
].join('\n');

const NOTIFICATIONS = Object.freeze({
    triggered: Object.freeze({
        category: 'triggered',
        title: '智慧下單條件已觸發',
        body: '觸發不等於已送單或成交；請回到 Runtime 查看目前狀態。',
    }),
    broker_accepted: Object.freeze({
        category: 'broker_accepted',
        title: '智慧下單收到 broker 回應',
        body: 'broker 回應或受理不等於成交；仍須以 Runtime 對帳結果確認。',
    }),
    part_filled: Object.freeze({
        category: 'part_filled',
        title: '智慧下單部分成交',
        body: '仍有未成交量或保護義務；請查看 Runtime 的累計成交與 remainder。',
    }),
    filled: Object.freeze({
        category: 'filled',
        title: '智慧下單收到全部成交證據',
        body: '單筆成交不代表整體策略已結案；請以 Runtime 歷程與義務狀態確認。',
    }),
    failed: Object.freeze({
        category: 'failed',
        title: '智慧下單處理失敗',
        body: '自動動作已保守停止；請查看 Runtime reason code 與券商正式狀態。',
    }),
    runtime_offline: Object.freeze({
        category: 'runtime_offline',
        title: '智慧下單 Runtime 無法確認',
        body: '本機監控可能已中斷；請立即查看 Runtime 與券商正式委託／部位。',
    }),
    manual_intervention: Object.freeze({
        category: 'manual_intervention',
        title: '智慧下單需要人工處理',
        body: '結果或保護量無法唯一確認；禁止自動重送，請依 Runtime 指示人工核對。',
    }),
    protection_drift: Object.freeze({
        category: 'protection_drift',
        title: '智慧下單保護數量已縮減',
        body: '偵測到外部或手動部位減少；Runtime 已縮減尚未觸發的保護量，請核對目前未受保護數量。',
    }),
});

const TRIGGER_REASONS = new Set([
    'CONDITION_EDGE_FALSE_TO_TRUE',
    'CONDITION_IMMEDIATE_CONFIRMED',
]);
const BROKER_ACCEPT_REASONS = new Set([
    'BROKER_ACK_DURABLE',
    'BROKER_PENDING_SUBMIT_OBSERVED',
    'BROKER_PRE_SUBMITTED_OBSERVED',
    'BROKER_SUBMITTED_OBSERVED',
    'BROKER_ORDER_WORKING_CONFIRMED',
    'EXIT_BROKER_WORKING_CONFIRMED',
]);
const PART_FILL_REASONS = new Set([
    'BROKER_PART_FILL_CONFIRMED',
    'BROKER_ADDITIONAL_FILL_CONFIRMED',
    'EXIT_PART_FILL_CONFIRMED',
    'EXIT_ADDITIONAL_FILL_CONFIRMED',
]);
const FULL_FILL_REASONS = new Set([
    'BROKER_FULL_FILL_CONFIRMED',
    'PROTECTION_FULLY_EXITED_CONFIRMED',
    'EXIT_CLAIM_CONSUMED_CONFIRMED',
]);
const FAILURE_REASONS = new Set([
    'ACTIVATION_VALIDATION_FAILED_PRE_DISPATCH',
    'BROKER_FAILED_CONFIRMED',
    'BROKER_REJECTED_CONFIRMED',
    'RUNTIME_STARTUP_FAIL_CLOSED',
    'RUNTIME_SENDER_FAIL_STOP',
    'DB_COMMIT_FAILED',
    'DB_INTEGRITY_FAILED',
    'SIMULATION_ATTESTATION_FAILED',
]);
const RUNTIME_OFFLINE_REASONS = new Set([
    'RUNTIME_API_GENERATION_SUPERSEDED',
    'RUNTIME_READINESS_REVOKED',
    'RUNTIME_RECONCILIATION_REQUIRED',
    'RUNTIME_QUIESCE_BLOCKED_OBLIGATION',
    'SENDER_FENCE_LOST',
    'MODE_GENERATION_CHANGED',
    'GATE_MANIFEST_INVALID',
]);
const MANUAL_REASONS = new Set([
    'BROKER_RESPONSE_LOST_RECONCILE',
    'ACKNOWLEDGED_RECONCILIATION_REQUIRED',
    'BROKER_OUTCOME_UNKNOWN',
    'BROKER_CORRELATION_AMBIGUOUS',
    'BROKER_ACCOUNT_MISMATCH',
    'BROKER_STATE_UNKNOWN',
    'BROKER_FINAL_EVIDENCE_CONFLICT',
    'ENTRY_RESULT_UNKNOWN',
    'ENTRY_RESERVATION_UNKNOWN',
    'EXIT_CLAIM_UNKNOWN',
    'PROTECTION_RECONCILIATION_REQUIRED',
    'PROTECTION_UNPROTECTED_REMAINDER',
    'QUOTE_GAP_CROSSING_UNKNOWN',
    'TRAILING_GAP_EXTREME_UNKNOWN',
    'EXTERNAL_POSITION_DRIFT',
    'POSITION_OR_UNIT_UNKNOWN',
    'EXTERNAL_WORKING_SET_INCOMPLETE',
    'WORKING_SELL_SET_CHANGED',
    'RESOLUTION_CASE_OPENED',
    'RESOLUTION_CASE_DECISION_REQUIRED',
    'SAFETY_BLOCKER_OPENED',
    'RELINQUISHED_UNKNOWN_EXPOSURE_OPENED',
    'MANUAL_RECONCILIATION_STARTED',
    'MANUAL_BREAK_GLASS_RELINQUISHED',
]);
const PROTECTION_DRIFT_REASONS = new Set([
    'PROTECTION_RESERVATION_SHRUNK_EXTERNAL_POSITION_DRIFT',
]);

function safeReasonCode(value) {
    return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,159}$/.test(value)
        ? value
        : null;
}

export function classifySmartOrderLocalNotification(event) {
    const reasonCode = safeReasonCode(event?.reasonCode);
    if (!reasonCode) return null;
    if (TRIGGER_REASONS.has(reasonCode)) return NOTIFICATIONS.triggered;
    if (BROKER_ACCEPT_REASONS.has(reasonCode)) {
        return NOTIFICATIONS.broker_accepted;
    }
    if (PART_FILL_REASONS.has(reasonCode)) return NOTIFICATIONS.part_filled;
    if (FULL_FILL_REASONS.has(reasonCode)) return NOTIFICATIONS.filled;
    if (FAILURE_REASONS.has(reasonCode)) return NOTIFICATIONS.failed;
    if (RUNTIME_OFFLINE_REASONS.has(reasonCode)) {
        return NOTIFICATIONS.runtime_offline;
    }
    if (PROTECTION_DRIFT_REASONS.has(reasonCode)) {
        return NOTIFICATIONS.protection_drift;
    }
    if (MANUAL_REASONS.has(reasonCode)) {
        return NOTIFICATIONS.manual_intervention;
    }
    return null;
}

function runExecFile(execFileImpl, file, args, options) {
    return new Promise((resolve, reject) => {
        execFileImpl(file, args, options, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

export function createMacOsSmartOrderNotificationSender({
    platform = process.platform,
    execFileImpl = nodeExecFile,
} = {}) {
    return async (notification) => {
        if (platform !== 'darwin') return false;
        if (!Object.values(NOTIFICATIONS).includes(notification)) {
            throw new TypeError('notification must come from the fixed allowlist');
        }
        await runExecFile(
            execFileImpl,
            '/usr/bin/osascript',
            ['-e', APPLE_SCRIPT, '--', notification.title, notification.body],
            {
                timeout: 5_000,
                maxBuffer: 16_384,
                windowsHide: true,
            },
        );
        return true;
    };
}

function safeCursorProjection(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        !['initialized', 'current', 'gap'].includes(value.cursorStatus) ||
        !Number.isSafeInteger(value.nextSequence) ||
        value.nextSequence < 0 ||
        !Number.isSafeInteger(value.highWaterSequence) ||
        value.highWaterSequence < value.nextSequence ||
        !Array.isArray(value.events) ||
        value.events.length > MAX_EVENT_BATCH
    ) {
        throw new TypeError('local notification event projection is invalid');
    }
    return value;
}

export async function startSmartOrderLocalNotificationPump({
    readEvents,
    sendNotification = createMacOsSmartOrderNotificationSender(),
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
} = {}) {
    if (typeof readEvents !== 'function' || typeof sendNotification !== 'function') {
        throw new TypeError('local notification pump dependencies are invalid');
    }
    if (
        !Number.isSafeInteger(pollIntervalMs) ||
        pollIntervalMs < 250 ||
        pollIntervalMs > 60_000
    ) {
        throw new TypeError('local notification poll interval is invalid');
    }

    const initial = safeCursorProjection(
        await readEvents({ afterSequence: null, limit: MAX_EVENT_BATCH }),
    );
    if (initial.cursorStatus !== 'initialized' || initial.events.length !== 0) {
        throw new Error('local notification cursor did not initialize safely');
    }
    let cursor = initial.nextSequence;
    let stopped = false;
    let inFlight = null;
    let offlineNoticeSent = false;

    const deliverBestEffort = async (notification) => {
        try {
            await sendNotification(notification);
        } catch {
            // A local notification is only a convenience. It can never mutate
            // Runtime state, retry a broker operation, or become evidence.
        }
    };

    const pollNow = async () => {
        if (stopped || inFlight) return inFlight;
        inFlight = (async () => {
            try {
                const projection = safeCursorProjection(
                    await readEvents({
                        afterSequence: cursor,
                        limit: MAX_EVENT_BATCH,
                    }),
                );
                offlineNoticeSent = false;
                if (projection.cursorStatus === 'gap') {
                    cursor = projection.nextSequence;
                    await deliverBestEffort(NOTIFICATIONS.manual_intervention);
                    return;
                }
                if (projection.cursorStatus !== 'current') {
                    throw new Error('local notification cursor state is invalid');
                }
                let expectedSequence = cursor + 1;
                for (const event of projection.events) {
                    if (
                        !Number.isSafeInteger(event?.sequence) ||
                        event.sequence !== expectedSequence
                    ) {
                        throw new Error('local notification event sequence has a gap');
                    }
                    expectedSequence += 1;
                    const notification =
                        classifySmartOrderLocalNotification(event);
                    if (notification) await deliverBestEffort(notification);
                }
                cursor = projection.nextSequence;
            } catch {
                if (!offlineNoticeSent) {
                    offlineNoticeSent = true;
                    await deliverBestEffort(NOTIFICATIONS.runtime_offline);
                }
            }
        })().finally(() => {
            inFlight = null;
        });
        return inFlight;
    };

    const timer = setIntervalImpl(() => void pollNow(), pollIntervalMs);
    timer?.unref?.();
    return Object.freeze({
        schemaVersion: SMART_ORDER_LOCAL_NOTIFICATION_SCHEMA_VERSION,
        authoritativeForBrokerState: false,
        get cursor() {
            return cursor;
        },
        pollNow,
        async close() {
            if (stopped) return;
            stopped = true;
            clearIntervalImpl(timer);
            await inFlight;
        },
    });
}
