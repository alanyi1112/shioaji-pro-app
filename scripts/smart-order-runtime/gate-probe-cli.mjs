#!/usr/bin/env node

import { createHash, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { canonicalSmartOrderGateProbeSafetyEnvelope } from './gate-probe-safety-envelope.mjs';
import { issueSmartOrderGateProbeCliAuthorization } from './gate-probe-cli-authorization.mjs';
import {
    readPrivateRuntimeDiscovery,
    readPrivateSecret,
} from './private-storage.mjs';
import { prepareSmartOrderGateProbeSafetyEnvelope } from './runtime-diagnostics.mjs';
import { notifySmartOrderAuthorizationRequired } from './authorization-required-notifier.mjs';

const MAX_ENVELOPE_BYTES = 64 * 1024;
function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function smartOrderGateProbeCliOperationSummary(envelope) {
    const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(envelope);
    return canonical.envelope.operation === 'place'
        ? `${canonical.request.payload.stock_order.action} ${canonical.request.payload.contract.exchange}:${canonical.request.payload.contract.code} ${canonical.request.payload.stock_order.price_type}@${canonical.request.payload.stock_order.price} ${canonical.request.payload.stock_order.order_type} ${canonical.request.payload.stock_order.quantity} ${canonical.request.payload.stock_order.order_lot}`
        : canonical.request.operation === 'update_price'
          ? `UPDATE_PRICE newPrice=${canonical.request.payload.price} target=…${canonical.envelope.target.targetIdSha256.slice(-12)} revision=${canonical.envelope.target.revision}`
          : canonical.request.operation === 'update_quantity'
            ? `UPDATE_QUANTITY newQuantity=${canonical.request.payload.quantity} CommonLot target=…${canonical.envelope.target.targetIdSha256.slice(-12)} revision=${canonical.envelope.target.revision}`
            : `CANCEL target=…${canonical.envelope.target.targetIdSha256.slice(-12)} revision=${canonical.envelope.target.revision}`;
}

async function readPrivateEnvelope(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
        throw new TypeError('gate probe envelope path must be absolute');
    }
    const resolved = path.resolve(filePath);
    if ((await realpath(resolved)) !== resolved) {
        throw new Error('gate probe envelope path must be canonical');
    }
    const handle = await open(
        resolved,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 1 ||
            before.size > MAX_ENVELOPE_BYTES ||
            (before.mode & 0o077) !== 0 ||
            (typeof process.getuid === 'function' &&
                before.uid !== process.getuid())
        ) {
            throw new Error(
                'gate probe envelope must be a bounded current-user 0600 file',
            );
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs
        ) {
            bytes.fill(0);
            throw new Error('gate probe envelope changed while reading');
        }
        try {
            return JSON.parse(bytes.toString('utf8'));
        } finally {
            bytes.fill(0);
        }
    } finally {
        await handle.close();
    }
}

export async function runSmartOrderGateProbeCli({
    envelopeFilePath,
    envelope,
    appSupportRoot,
    expectedApiGeneration,
    input = process.stdin,
    output = process.stderr,
    prepare = prepareSmartOrderGateProbeSafetyEnvelope,
    now = () => Date.now(),
    returnAuthorizationOnly = false,
    authorizationDeadlineEpochMs,
    notifyAuthorizationRequired = notifySmartOrderAuthorizationRequired,
}) {
    if (input.isTTY !== true || output.isTTY !== true) {
        throw new Error(
            'gate probe preparation requires an interactive terminal',
        );
    }
    if ((envelope === undefined) === (envelopeFilePath === undefined)) {
        throw new TypeError(
            'exactly one in-memory or private-file envelope is required',
        );
    }
    const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(
        envelope === undefined
            ? await readPrivateEnvelope(envelopeFilePath)
            : envelope,
    );
    if (
        authorizationDeadlineEpochMs !== undefined &&
        (!Number.isSafeInteger(authorizationDeadlineEpochMs) ||
            authorizationDeadlineEpochMs <= now() ||
            authorizationDeadlineEpochMs > canonical.envelope.validUntilEpochMs)
    ) {
        throw new Error('gate probe authorization deadline is invalid or expired');
    }
    if (
        typeof expectedApiGeneration !== 'string' ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration)
    ) {
        throw new TypeError('expected API generation is invalid');
    }
    const discoveryPath = path.join(
        appSupportRoot,
        'smart-order',
        'run',
        'control-plane.json',
    );
    const gateProbeCapabilityPath = path.join(
        appSupportRoot,
        'smart-order',
        'private',
        'gate-probe-cli-capability.bin',
    );
    const beforeDiscovery = await readPrivateRuntimeDiscovery(discoveryPath, {
        nowEpochMs: now(),
    });
    const gateProbeCapability = await readPrivateSecret(
        gateProbeCapabilityPath,
    );
    const apiGenerationSha256 = sha256(expectedApiGeneration);
    const runtimeEpochIdSha256 = sha256(beforeDiscovery.runtimeEpochId);
    const accountSuffix = canonical.envelope.accountScopeSha256.slice(-12);
    const envelopeSuffix = canonical.envelopeSha256.slice(-16);
    const requestSuffix = canonical.envelope.requestSha256.slice(-16);
    const operationSummary = smartOrderGateProbeCliOperationSummary(
        canonical.sourceEnvelope,
    );
    const phrase = `AUTHORIZE ${canonical.envelope.operation.toUpperCase()} ${envelopeSuffix} ${canonical.envelope.operationId.slice(-12)} ${runtimeEpochIdSha256.slice(-12)} ${apiGenerationSha256.slice(-12)}`;
    const actionBoundary = returnAuthorizationOnly
        ? 'this prompt itself performs no broker write; its in-memory HMAC may be consumed once by the exact Task 0.3 simulation trigger'
        : 'no broker write will run';
    output.write(
        `Gate 0 probe-only preparation; ${operationSummary}; tradeDate=${canonical.envelope.tradeDate}; account=…${accountSuffix}; request=…${requestSuffix}; run=…${canonical.envelope.runId.slice(-12)}; runtime=…${runtimeEpochIdSha256.slice(-12)}; generation=…${apiGenerationSha256.slice(-12)}; maximum=1 CommonLot; simulation only; ${actionBoundary}.\nType exactly: ${phrase}\n> `,
    );
    try {
        notifyAuthorizationRequired();
    } catch {
        // A local reminder is best-effort and never changes broker authority.
    }
    try {
        const prompt = createInterface({ input, output, terminal: true });
        const authorizationAbort = new AbortController();
        const authorizationTimer =
            authorizationDeadlineEpochMs === undefined
                ? undefined
                : setTimeout(
                      () => authorizationAbort.abort(),
                      Math.max(1, authorizationDeadlineEpochMs - now()),
                  );
        let answer;
        try {
            answer = await prompt.question(
                '',
                authorizationDeadlineEpochMs === undefined
                    ? undefined
                    : { signal: authorizationAbort.signal },
            );
        } catch (error) {
            if (authorizationAbort.signal.aborted) {
                throw new Error('gate probe authorization expired before confirmation');
            }
            throw error;
        } finally {
            clearTimeout(authorizationTimer);
            prompt.close();
        }
        if (
            answer !== phrase ||
            (authorizationDeadlineEpochMs !== undefined &&
                now() >= authorizationDeadlineEpochMs)
        ) {
            throw new Error('gate probe explicit authorization did not match');
        }
        const afterDiscovery = await readPrivateRuntimeDiscovery(
            discoveryPath,
            { nowEpochMs: now() },
        );
        const currentCapability = await readPrivateSecret(
            gateProbeCapabilityPath,
        );
        try {
            if (
                afterDiscovery.runtimeEpochId !==
                    beforeDiscovery.runtimeEpochId ||
                afterDiscovery.port !== beforeDiscovery.port ||
                afterDiscovery.startedAtEpochMs !==
                    beforeDiscovery.startedAtEpochMs ||
                !timingSafeEqual(
                    Buffer.from(currentCapability),
                    Buffer.from(gateProbeCapability),
                )
            ) {
                throw new Error(
                    'gate probe Runtime generation changed during authorization',
                );
            }
        } finally {
            currentCapability.fill(0);
        }
        const cliAuthorization =
            issueSmartOrderGateProbeCliAuthorization({
                capability: gateProbeCapability,
                envelope: canonical.sourceEnvelope,
                authorizedAtEpochMs: now(),
                apiGenerationSha256,
                runtimeEpochIdSha256,
            });
        if (returnAuthorizationOnly === true) {
            return Object.freeze({
                schemaVersion: 'smart-order-gate-probe-cli-memory-authorization/2026-08-22.1',
                authorized: true,
                envelopeSha256: canonical.envelopeSha256,
                accountRef: `…${accountSuffix}`,
                authorization: cliAuthorization,
                brokerWriteAttempted: false,
                brokerWriteNetworked: false,
                brokerAuthority: false,
                writeMasterAuthority: false,
            });
        }
        return prepare({
            appSupportRoot,
            expectedApiGeneration,
            envelope: canonical.sourceEnvelope,
            cliAuthorization,
            now,
        });
    } finally {
        gateProbeCapability.fill(0);
    }
}

async function runAsCli() {
    const [envelopeFilePath] = process.argv.slice(2);
    if (process.argv.length !== 3) {
        throw new TypeError(
            'usage: gate-probe-cli.mjs <absolute-private-envelope-json>',
        );
    }
    const result = await runSmartOrderGateProbeCli({
        envelopeFilePath,
        appSupportRoot: process.env.REALTIME_STOCK_APP_SUPPORT,
        expectedApiGeneration:
            process.env.REALTIME_STOCK_EXPECTED_API_GENERATION,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
    runAsCli().catch((error) => {
        const name =
            typeof error?.name === 'string' && error.name.length <= 80
                ? error.name
                : 'Error';
        process.stderr.write(`smart_order_gate_probe=unavailable:${name}\n`);
        process.exitCode = 1;
    });
}
