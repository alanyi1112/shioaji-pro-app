import { createHash, randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

export const INTRADAY_MONITOR_KBAR_CAPTURE_FAILURE_SCHEMA =
    'intraday-monitor-kbar-capture-failure/1';
export const INTRADAY_MONITOR_KBAR_CAPTURE_OUTPUT_MAXIMUM_BYTES = 16 * 1024 * 1024;
const FAILURE_HASH_MAXIMUM_BYTES = 64 * 1024;

export function resolveIntradayMonitorCapturePaths(outputPath) {
    if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
        throw new TypeError('absolute outputPath is required');
    }
    return Object.freeze({ capturePath: outputPath, failurePath: `${outputPath}.failure.json` });
}

function safeText(value, fallback, maximumLength = 256) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return normalized.length > 0 ? normalized.slice(0, maximumLength) : fallback;
}

function failureCode(error) {
    if (error instanceof RangeError && error.message === 'canonical JSON exceeds its byte limit') {
        return 'evidence_canonical_size_limit_exceeded';
    }
    if (typeof error?.message === 'string' && error.message.startsWith('REFUSED:')) {
        return 'capture_refused';
    }
    return 'capture_failed';
}

function receiptSummary(receipt) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
    return Object.freeze({
        started: receipt.started === true,
        stopped: receipt.stopped === true,
        cohortSize: Number.isSafeInteger(receipt.cohortSize) ? receipt.cohortSize : null,
        subscribeAccepted: receipt.subscribeAccepted === true,
        unsubscribeAccepted: receipt.unsubscribeAccepted === true,
        providerReleaseProven: receipt.providerReleaseProven === true,
    });
}

function transportSummary(status) {
    if (!status || typeof status !== 'object' || Array.isArray(status)) return null;
    return Object.freeze({
        phase: safeText(status.phase, 'unknown', 32),
        cohortHash: typeof status.cohortHash === 'string' ? status.cohortHash : null,
        cohortSize: Number.isSafeInteger(status.cohortSize) ? status.cohortSize : null,
        connectionGeneration: typeof status.connectionGeneration === 'string'
            ? status.connectionGeneration.slice(0, 128) : null,
        bytes: Number.isSafeInteger(status.bytes) ? status.bytes : null,
        kbarFrames: Number.isSafeInteger(status.kbarFrames) ? status.kbarFrames : null,
        malformedFrames: Number.isSafeInteger(status.malformedFrames) ? status.malformedFrames : null,
        deliveredEvents: Number.isSafeInteger(status.deliveredEvents) ? status.deliveredEvents : null,
        subscribeAccepted: status.subscribeAccepted === true,
        unsubscribeAccepted: status.unsubscribeAccepted === true,
        providerPhysicalUsage: null,
        providerReleaseProven: status.providerReleaseProven === true,
    });
}

function hash(value, maximumBytes) {
    return `sha256:${createHash('sha256').update(canonicalJson(value, { maximumBytes })).digest('hex')}`;
}

export function buildIntradayMonitorKbarCaptureFailure({ outputPath, tradeDate, captureMode, failedAt,
    stage, error, startReceipt = null, stopReceipt = null, transportStatus = null,
    interrupted = false } = {}) {
    if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !['full-session', 'partial-rehearsal'].includes(captureMode) ||
        !Number.isFinite(Date.parse(failedAt ?? ''))) {
        throw new TypeError('capture failure options are invalid');
    }
    const paths = resolveIntradayMonitorCapturePaths(outputPath);
    const seed = {
        schemaVersion: INTRADAY_MONITOR_KBAR_CAPTURE_FAILURE_SCHEMA,
        tradeDate,
        captureMode,
        failedAt,
        stage: safeText(stage, 'unknown', 64),
        error: {
            code: failureCode(error),
            name: safeText(error?.name, 'Error', 64),
            message: safeText(error?.message, 'capture failed'),
        },
        output: {
            intendedPath: paths.capturePath,
            mainEvidenceCreated: false,
            failurePath: paths.failurePath,
        },
        receipts: { start: receiptSummary(startReceipt), stop: receiptSummary(stopReceipt) },
        transport: transportSummary(transportStatus),
        assessment: {
            baselineUsable: false,
            liveCaptureAcceptance: false,
            notificationEligible: false,
            retroactiveTriggerEligible: false,
        },
        interrupted: interrupted === true,
        operations: {
            notificationDispatchCount: 0,
            brokerWriteAttemptCount: 0,
            productionTransitionCount: 0,
            serviceLifecycleMutationCount: 0,
            rawPayloadSaved: false,
        },
    };
    return Object.freeze({ ...seed, failureHash: hash(seed, FAILURE_HASH_MAXIMUM_BYTES) });
}

export async function writeExclusiveJsonAtomically(outputPath, value) {
    if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
        throw new TypeError('absolute outputPath is required');
    }
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > INTRADAY_MONITOR_KBAR_CAPTURE_OUTPUT_MAXIMUM_BYTES) {
        throw new RangeError('capture output exceeds its byte limit');
    }
    const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    let temporaryCreated = false;
    try {
        const handle = await open(temporaryPath, 'wx', 0o600);
        temporaryCreated = true;
        try {
            await handle.writeFile(serialized);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await link(temporaryPath, outputPath);
        await unlink(temporaryPath);
        temporaryCreated = false;
        return Object.freeze({ created: true, outputPath, bytes: Buffer.byteLength(serialized) });
    } finally {
        if (temporaryCreated) await unlink(temporaryPath).catch(() => {});
    }
}

export async function writeIntradayMonitorKbarCaptureFailure(options) {
    const failure = buildIntradayMonitorKbarCaptureFailure(options);
    const receipt = await writeExclusiveJsonAtomically(failure.output.failurePath, failure);
    return Object.freeze({ failure, receipt });
}
