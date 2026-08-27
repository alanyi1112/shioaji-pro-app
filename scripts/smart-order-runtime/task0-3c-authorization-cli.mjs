import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { canonicalJson } from './canonical-json.mjs';
import { canonicalSmartOrderGateProbeSafetyEnvelope } from './gate-probe-safety-envelope.mjs';
import { notifySmartOrderAuthorizationRequired } from './authorization-required-notifier.mjs';

export const SMART_ORDER_TASK_0_3C_AUTHORIZATION_SCHEMA_VERSION =
    'smart-order-task-0.3c-memory-authorization/2026-08-27.1';

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function smartOrderTask03cAuthorizationPhrase({
    requestSha256,
    operationId,
    expectedApiGeneration,
}) {
    if (
        !/^sha256:[0-9a-f]{64}$/.test(requestSha256 ?? '') ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            operationId ?? '',
        ) ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(
            expectedApiGeneration ?? '',
        )
    ) {
        throw new TypeError('Task 0.3c authorization phrase input is invalid');
    }
    return `AUTHORIZE EXTERNAL SELL ${requestSha256.slice(-16)} ${operationId.toLowerCase().slice(-12)} ${sha256(expectedApiGeneration).slice(-12)}`;
}

async function readPrivateToken(filePath, pattern, label) {
    const handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 1 ||
            metadata.size > 512 ||
            (metadata.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
        ) {
            throw new Error(`${label} metadata is invalid`);
        }
        const value = (await handle.readFile('utf8')).trim();
        if (!pattern.test(value)) throw new Error(`${label} is invalid`);
        return value;
    } finally {
        await handle.close();
    }
}

async function assertSidecarStopped(appSupportRoot, expectedApiGeneration) {
    const discoveryPath = path.join(
        appSupportRoot,
        'smart-order',
        'run',
        'control-plane.json',
    );
    try {
        await lstat(discoveryPath);
        throw new Error('Task 0.3c requires the smart-order sidecar to be stopped');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    const [mode, generation] = await Promise.all([
        readPrivateToken(
            path.join(appSupportRoot, 'runtime-mode'),
            /^simulation$/,
            'Task 0.3c runtime mode',
        ),
        readPrivateToken(
            path.join(appSupportRoot, 'runtime-api-generation'),
            /^simulation:[A-Za-z0-9._:-]{1,240}$/,
            'Task 0.3c API generation',
        ),
    ]);
    if (mode !== 'simulation' || generation !== expectedApiGeneration) {
        throw new Error('Task 0.3c simulation generation drifted');
    }
}

export async function runSmartOrderTask03cAuthorizationCli({
    appSupportRoot,
    authorizationDeadlineEpochMs,
    envelope,
    expectedApiGeneration,
    input = process.stdin,
    output = process.stderr,
    now = () => Date.now(),
    notifyAuthorizationRequired = notifySmartOrderAuthorizationRequired,
}) {
    if (input.isTTY !== true || output.isTTY !== true) {
        throw new Error('Task 0.3c authorization requires an interactive terminal');
    }
    const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(envelope);
    if (
        canonical.envelope.operation !== 'place' ||
        canonical.request.payload.stock_order.action !== 'Sell' ||
        !Number.isSafeInteger(authorizationDeadlineEpochMs) ||
        authorizationDeadlineEpochMs <= now() ||
        authorizationDeadlineEpochMs > canonical.envelope.validUntilEpochMs
    ) {
        throw new Error('Task 0.3c authorization envelope is invalid or expired');
    }
    await assertSidecarStopped(appSupportRoot, expectedApiGeneration);
    const phrase = smartOrderTask03cAuthorizationPhrase({
        requestSha256: canonical.envelope.requestSha256,
        operationId: canonical.envelope.operationId,
        expectedApiGeneration,
    });
    output.write(
        `Task 0.3c external simulation client; Sell ${canonical.request.payload.contract.exchange}:${canonical.request.payload.contract.code} LMT@${canonical.request.payload.stock_order.price} ROD 1 CommonLot; account=…${canonical.envelope.accountScopeSha256.slice(-12)}; request=…${canonical.envelope.requestSha256.slice(-16)}; sidecar=stopped; no retry; no cleanup.\nType exactly: ${phrase}\n> `,
    );
    try {
        notifyAuthorizationRequired();
    } catch {
        // Best-effort local reminder; never changes authorization state.
    }
    const prompt = createInterface({ input, output, terminal: true });
    const abort = new AbortController();
    const timer = setTimeout(
        () => abort.abort(),
        Math.max(1, authorizationDeadlineEpochMs - now()),
    );
    let answer;
    try {
        answer = await prompt.question('', { signal: abort.signal });
    } catch (error) {
        if (abort.signal.aborted) {
            throw new Error('Task 0.3c authorization expired before confirmation');
        }
        throw error;
    } finally {
        clearTimeout(timer);
        prompt.close();
    }
    if (answer !== phrase || now() >= authorizationDeadlineEpochMs) {
        throw new Error('Task 0.3c exact authorization did not match');
    }
    await assertSidecarStopped(appSupportRoot, expectedApiGeneration);
    const authorizedAtEpochMs = now();
    const projection = Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3C_AUTHORIZATION_SCHEMA_VERSION,
        operationId: canonical.envelope.operationId,
        requestSha256: canonical.envelope.requestSha256,
        accountScopeSha256: canonical.envelope.accountScopeSha256,
        apiGenerationSha256: sha256(expectedApiGeneration),
        authorizedAtEpochMs,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        brokerAuthority: false,
    });
    return Object.freeze({
        ...projection,
        cliAuthorizationSha256: sha256(canonicalJson(projection)),
    });
}
