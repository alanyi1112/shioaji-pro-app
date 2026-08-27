import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    importSmartOrderTask13_2CompletedTask03Evidence,
} from './smart-order-task13-2-completed-evidence-import.mjs';
import { readOrCreateSmartOrderTask13_2EvidenceCapability } from './smart-order-runtime/task13-2-evidence-capability.mjs';
import {
    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3_TRUST,
    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_CURRENT_TRUST,
    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_PLACE_TRUST,
    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_UPDATE_TRUST,
    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_4_0_6_CURRENT_TRUST,
    SMART_ORDER_TASK_13_2_TRUSTED_HISTORICAL_VERIFIER_FINGERPRINTS,
} from './smart-order-runtime/task13-2-completed-evidence-trust.mjs';
import {
    SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE,
    aggregateSmartOrderTask13_2FormalEvidence,
    currentSmartOrderTask13_2EvidenceSourceFingerprint,
    currentSmartOrderTask13_2VerifierFingerprint,
    verifySmartOrderTask13_2FormalEvidence,
} from './smart-order-runtime/task13-2-formal-evidence.mjs';

const MAX_EVIDENCE_BYTES = 64 * 1024;

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export const SMART_ORDER_TASK_13_2_EVIDENCE_FILES = Object.freeze({
    '0.3:place_confirmed': 'task13-2-formal-0.3-place-confirmed.json',
    '0.3b:place_confirmed':
        SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_CURRENT_TRUST.operations[
            '0.3b:place_confirmed'
        ].fileName,
    '0.3b:update_confirmed':
        SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_CURRENT_TRUST.operations[
            '0.3b:update_confirmed'
        ].fileName,
    '0.3b:cancel_confirmed':
        SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_CURRENT_TRUST.operations[
            '0.3b:cancel_confirmed'
        ].fileName,
    '0.3c:external_working_sells_complete':
        'task13-2-formal-0.3c-external-working-sells-complete.json',
    '0.4:order_deal_round_trip':
        'task13-2-formal-0.4-order-deal-round-trip.json',
    '0.6:lmt_rod': 'task13-2-formal-0.6-lmt-rod.json',
    '0.6:lmt_ioc': 'task13-2-formal-0.6-lmt-ioc.json',
    '0.6:mkt_ioc': 'task13-2-formal-0.6-mkt-ioc.json',
    '0.7:unit_contract': 'task13-2-formal-0.7-unit-contract.json',
    'pnl_current_day:full_day':
        'task13-2-formal-pnl-current-day-full-day.json',
});

function mode(metadata) {
    return metadata.mode & 0o777;
}

async function assertPrivateDirectory(directoryPath, label) {
    const canonical = await realpath(directoryPath);
    const metadata = await lstat(canonical);
    if (
        canonical !== directoryPath ||
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        metadata.uid !== process.getuid() ||
        mode(metadata) !== 0o700
    ) {
        throw new Error(`${label} is not a canonical private directory`);
    }
    return canonical;
}

async function readStablePrivateJson(filePath) {
    let handle;
    try {
        handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.uid !== process.getuid() ||
            mode(before) !== 0o600 ||
            before.size < 2 ||
            before.size > MAX_EVIDENCE_BYTES
        ) {
            throw new Error('evidence file is not a bounded private regular file');
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            bytes.byteLength !== before.size
        ) {
            throw new Error('evidence file changed while reading');
        }
        return Object.freeze({
            artifactSha256: sha256(bytes),
            evidence: JSON.parse(bytes.toString('utf8')),
        });
    } finally {
        await handle?.close();
    }
}

export function smartOrderTask13_2EvidenceMatchesCompletedTrust({
    artifactSha256,
    evidence,
    evidenceKey,
    manifest = SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_4_0_6_CURRENT_TRUST,
}) {
    const trust = manifest?.operations?.[evidenceKey];
    return Boolean(
        trust &&
            artifactSha256 === trust.artifactSha256 &&
            evidence?.evidenceId === trust.evidenceId &&
            evidence?.runId === trust.runId &&
            evidence?.observedTradeDate === manifest.tradeDate &&
            evidence?.accountScopeSha256 === manifest.accountScopeSha256 &&
            evidence?.apiGenerationSha256 === manifest.apiGenerationSha256 &&
            evidence?.requestSha256 === trust.requestSha256 &&
            evidence?.resultSha256 === trust.resultSha256 &&
            evidence?.sourceFingerprintSha256 ===
                trust.sourceFingerprintSha256 &&
            evidence?.verifierFingerprintSha256 ===
                trust.verifierFingerprintSha256 &&
            evidence?.evidenceHashSha256 === trust.evidenceHashSha256,
    );
}

function taipeiTradeDate(nowEpochMs) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(nowEpochMs));
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

export async function runSmartOrderTask13_2EvidenceAggregate({
    appSupportRoot,
    nowEpochMs = Date.now(),
} = {}) {
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot) ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs < 0
    ) {
        throw new TypeError('Task 13.2 production aggregate input is invalid');
    }
    const canonicalRoot = await assertPrivateDirectory(
        appSupportRoot,
        'app support root',
    );
    const privateDirectory = await assertPrivateDirectory(
        path.join(canonicalRoot, 'smart-order', 'private'),
        'smart-order private directory',
    );
    const task03FormalPath = path.join(
        privateDirectory,
        SMART_ORDER_TASK_13_2_EVIDENCE_FILES['0.3:place_confirmed'],
    );
    try {
        await lstat(task03FormalPath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        // Completed Task 0.3 is immutable historical evidence. Re-encode it
        // through the current verifier only when the fixed formal slot is
        // absent. Any invalid, ambiguous, replayed, or stale-source lineage
        // remains a normal missing-evidence blocker; this path never repairs
        // source evidence and never acquires broker authority.
        await importSmartOrderTask13_2CompletedTask03Evidence({
            appSupportRoot: canonicalRoot,
            nowEpochMs,
        }).catch(() => null);
    }
    const capability =
        await readOrCreateSmartOrderTask13_2EvidenceCapability(privateDirectory);
    const verifierFingerprintSha256 =
        await currentSmartOrderTask13_2VerifierFingerprint();
    const verifiedRows = [];
    const blockers = [];
    try {
        for (const evidenceKey of SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE) {
            const completedTrust =
                SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_4_0_6_CURRENT_TRUST
                    .operations[evidenceKey] ?? null;
            const fileNames = [
                SMART_ORDER_TASK_13_2_EVIDENCE_FILES[evidenceKey],
                completedTrust?.fileName,
            ].filter((value, index, values) => value && values.indexOf(value) === index);
            const candidates = [];
            let unreadable = false;
            for (const fileName of fileNames) {
                try {
                    candidates.push(
                        Object.freeze({
                            fileName,
                            ...(await readStablePrivateJson(
                                path.join(privateDirectory, fileName),
                            )),
                        }),
                    );
                } catch (error) {
                    if (error?.code !== 'ENOENT') unreadable = true;
                }
            }
            if (unreadable) blockers.push(`unreadable:${evidenceKey}`);
            if (candidates.length > 1) {
                blockers.push(`ambiguous:${evidenceKey}`);
                continue;
            }
            if (candidates.length === 0) continue;
            const selected = candidates[0];
            const evidence = selected.evidence;
            const currentSourceFingerprintSha256 =
                await currentSmartOrderTask13_2EvidenceSourceFingerprint(evidenceKey);
            const sourceFingerprints = new Set([
                currentSourceFingerprintSha256,
                ...(evidenceKey.startsWith('0.3b:')
                    ? [
                          SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_CURRENT_TRUST
                              .operations[evidenceKey]
                              .sourceFingerprintSha256,
                      ]
                    : []),
                ...(evidenceKey === '0.3:place_confirmed'
                    ? [
                          SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3_TRUST
                              .sourceFingerprintSha256,
                      ]
                    : []),
                ...(evidenceKey === '0.3b:place_confirmed'
                    ? [
                          SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_PLACE_TRUST
                              .sourceFingerprintSha256,
                      ]
                    : []),
                ...(evidenceKey === '0.3b:update_confirmed'
                    ? [
                          SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_UPDATE_TRUST
                              .formalSourceFingerprintSha256,
                      ]
                    : []),
                ...(completedTrust
                    ? [completedTrust.sourceFingerprintSha256]
                    : []),
            ]);
            const verifierFingerprints = new Set([
                verifierFingerprintSha256,
                ...(SMART_ORDER_TASK_13_2_TRUSTED_HISTORICAL_VERIFIER_FINGERPRINTS[
                    evidenceKey
                ] ?? []),
                ...(completedTrust
                    ? [completedTrust.verifierFingerprintSha256]
                    : []),
            ]);
            let verified = Object.freeze({ eligible: false });
            let matchedCurrent = false;
            for (const expectedSourceFingerprintSha256 of sourceFingerprints) {
                for (const expectedVerifierFingerprintSha256 of verifierFingerprints) {
                    verified = verifySmartOrderTask13_2FormalEvidence({
                        capability,
                        evidence,
                        expectedSourceFingerprintSha256,
                        expectedVerifierFingerprintSha256,
                    });
                    if (verified.eligible) {
                        matchedCurrent =
                            expectedSourceFingerprintSha256 ===
                                currentSourceFingerprintSha256 &&
                            expectedVerifierFingerprintSha256 ===
                                verifierFingerprintSha256;
                        break;
                    }
                }
                if (verified.eligible) break;
            }
            const completedTrustValid =
                completedTrust === null ||
                matchedCurrent ||
                (selected.fileName === completedTrust.fileName
                    ? smartOrderTask13_2EvidenceMatchesCompletedTrust({
                          artifactSha256: selected.artifactSha256,
                          evidence,
                          evidenceKey,
                      })
                    : matchedCurrent);
            if (
                !verified.eligible ||
                verified.evidenceKey !== evidenceKey ||
                !completedTrustValid
            ) {
                blockers.push(`invalid:${evidenceKey}`);
                continue;
            }
            verifiedRows.push(verified);
        }
        return aggregateSmartOrderTask13_2FormalEvidence({
            evidence: verifiedRows,
            expectedPnlTradeDate: taipeiTradeDate(nowEpochMs),
            nowEpochMs,
            additionalBlockers: blockers,
        });
    } finally {
        capability.fill(0);
    }
}

async function main() {
    if (process.argv.length !== 2) {
        throw new Error('Task 13.2 evidence aggregate accepts no arguments');
    }
    const aggregate = await runSmartOrderTask13_2EvidenceAggregate({
        appSupportRoot: process.env.REALTIME_STOCK_APP_SUPPORT,
    });
    process.stdout.write(`${JSON.stringify(aggregate)}\n`);
    if (!aggregate.eligible) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        process.stderr.write(
            `Task 13.2 evidence aggregate blocked: ${error?.message ?? 'unknown'}\n`,
        );
        process.exitCode = 1;
    });
}
