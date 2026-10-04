import { mkdir, open, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateDirect160BaselineSet } from './direct-160-baseline.mjs';
import { writeDirect160Artifact } from './direct-160-storage.mjs';
import { reviewDirect160TailGapCapture } from './direct-160-tail-gap-review.mjs';
import { classifyPostcloseTailCapture, buildPostcloseTailDataRecovery,
    sha256Bytes, POSTCLOSE_TAIL_RECOVERY_SCHEMA } from './postclose-tail-recovery-core.mjs';

function appSupportRoot() {
    return process.env.REALTIME_STOCK_APP_SUPPORT ??
        path.join(os.homedir(), 'Library', 'Application Support', 'RealTimeStock');
}

async function readJson(file) {
    const bytes = await readFile(file);
    return { value: JSON.parse(bytes.toString('utf8')), sha256: sha256Bytes(bytes) };
}

async function readOptionalJson(file) {
    try { return (await readJson(file)).value; }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function writeExclusiveJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
}

function withinRoot(root, file) {
    return path.isAbsolute(file ?? '') &&
        (path.resolve(file) === path.resolve(root) || path.resolve(file).startsWith(`${path.resolve(root)}${path.sep}`));
}

export function resolvePostcloseTailRecoveryPaths(root, tradeDate, captureSha256) {
    if (!path.isAbsolute(root ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !/^[a-f0-9]{64}$/.test(captureSha256 ?? '')) {
        throw new TypeError('postclose_recovery_path_identity_invalid');
    }
    const directory = path.join(root, 'IntradayMonitor', 'postclose-tail-recovery');
    const name = `${tradeDate}-${captureSha256}`;
    return Object.freeze({ directory,
        claimPath: path.join(directory, 'claims', `${name}.json`),
        resultPath: path.join(directory, 'results', `${name}.json`),
        boundedReviewPath: path.join(directory, 'bounded-reviews', `${name}.json`) });
}

function verifiedSource({ receipt, verification, baseline, cohort, capture, baselineSha256 }) {
    const results = verification?.results;
    return receipt?.outcome === 'verified' && receipt.tradeDate === capture.tradeDate &&
        receipt.targetTradeDate === verification?.targetTradeDate &&
        receipt.baselineHash === baseline?.baselineHash &&
        verification.previousTradeDate === capture.tradeDate &&
        verification.manifestHash === capture.manifestHash &&
        verification.verifiedCount === 160 && verification.expectedCount === 160 &&
        verification.minuteCount === 43_200 && verification.baselineUsable === true &&
        verification.liveCaptureAcceptance === false &&
        verification.bundle?.sha256 === baselineSha256 &&
        cohort?.manifestHash === capture.manifestHash &&
        validateDirect160BaselineSet(baseline, cohort, receipt.targetTradeDate) &&
        Array.isArray(results) && results.length === 160 &&
        results.every((item, index) => item.verified === true && item.minuteCount === 270 &&
            item.symbol === baseline.manifests[index]?.symbol &&
            item.manifestId === baseline.manifests[index]?.manifestId &&
            item.finalCumulativeVolume ===
                baseline.manifests[index]?.cumulativeSeries?.at(-1)?.cumulativeVolume);
}

function matchesPublishedResult(value, classification, tradeDate, captureSha256) {
    return value?.schemaVersion === POSTCLOSE_TAIL_RECOVERY_SCHEMA &&
        value.tradeDate === tradeDate && value.sourceCaptureSha256 === captureSha256 &&
        value.classification === classification.classification &&
        value.notificationAuthority === false && value.brokerWriteAuthority === false &&
        value.productionAuthority === false && Array.isArray(value.symbols) &&
        value.symbols.length === classification.affectedSymbolCount;
}

export async function runPostcloseTailRecovery({ root = appSupportRoot(), tradeDate,
    capturePath = path.join(root, 'direct-160-live', `capture-${tradeDate}.json`),
    manifestPath, planPath = null, previousBaselinePath = null,
    receipt, now = new Date(), publish = true } = {}) {
    if (!path.isAbsolute(root) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !withinRoot(root, capturePath) || !withinRoot(root, manifestPath) ||
        !(now instanceof Date) || !Number.isFinite(now.valueOf())) {
        throw new TypeError('postclose_recovery_input_invalid');
    }
    if (now.valueOf() < Date.parse(`${tradeDate}T13:34:30+08:00`)) {
        return Object.freeze({ state: 'closing_window_not_finished', tradeDate });
    }
    const captureSource = await readJson(capturePath).catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
    });
    if (!captureSource) return Object.freeze({ state: 'source_pending', reason: 'capture_missing', tradeDate });
    const { value: capture, sha256: captureSha256 } = captureSource;
    const classification = classifyPostcloseTailCapture({ capture,
        sourceCaptureSha256: captureSha256, observedAt: now.toISOString() });
    if (classification.tradeDate !== tradeDate) {
        return Object.freeze({ state: 'non_tail_or_ineligible', reason: 'trade_date_mismatch', tradeDate });
    }
    if (!['bounded_tail_candidate', 'correlated_tail_failure'].includes(classification.classification)) {
        return Object.freeze({ state: classification.classification,
            reason: classification.reason, classification, tradeDate });
    }
    const paths = resolvePostcloseTailRecoveryPaths(root, tradeDate, captureSha256);
    const existing = await readOptionalJson(paths.resultPath);
    const priorClaim = await readOptionalJson(paths.claimPath);
    if (priorClaim && (priorClaim.schemaVersion !== POSTCLOSE_TAIL_RECOVERY_SCHEMA ||
        priorClaim.tradeDate !== tradeDate ||
        priorClaim.sourceCaptureSha256 !== captureSha256 ||
        priorClaim.cohortHash !== classification.cohortHash ||
        priorClaim.connectionGeneration !== classification.connectionGeneration ||
        priorClaim.notificationAuthority !== false ||
        priorClaim.brokerWriteAuthority !== false ||
        priorClaim.productionAuthority !== false)) {
        return Object.freeze({ state: 'claim_conflict', claimPath: paths.claimPath,
            classification, tradeDate });
    }
    if (existing) {
        if (!priorClaim || !matchesPublishedResult(existing, classification, tradeDate, captureSha256)) {
            return Object.freeze({ state: 'result_conflict', resultPath: paths.resultPath,
                classification, tradeDate });
        }
        return Object.freeze({ state: 'already_completed', result: existing,
            resultPath: paths.resultPath, classification, tradeDate });
    }
    if (receipt?.outcome !== 'verified') {
        return Object.freeze({ state: 'source_pending', reason: 'verified_receipt_missing',
            classification, tradeDate });
    }
    if (![receipt.baselinePath, receipt.verificationPath].every((file) => withinRoot(root, file))) {
        return Object.freeze({ state: 'source_unverified', reason: 'source_path_invalid',
            classification, tradeDate });
    }
    const [baselineSource, verificationSource, cohortSource] = await Promise.all([
        readJson(receipt.baselinePath), readJson(receipt.verificationPath), readJson(manifestPath),
    ]);
    const baseline = baselineSource.value;
    const verification = verificationSource.value;
    if (!verifiedSource({ receipt, verification, baseline, cohort: cohortSource.value,
        capture, baselineSha256: baselineSource.sha256 })) {
        return Object.freeze({ state: 'source_unverified', reason: 'baseline_contract_invalid',
            classification, tradeDate });
    }
    for (const item of classification.symbols.filter((symbol) => symbol.state === 'tail')) {
        const index = cohortSource.value.cohort.findIndex((entry) =>
            entry.canonicalSymbol === item.symbol);
        const code = cohortSource.value.cohort[index]?.contractIdentity?.code;
        if (!/^[A-Za-z0-9]{4,8}$/.test(code ?? '')) {
            return Object.freeze({ state: 'source_unverified', reason: 'contract_identity_invalid',
                classification, tradeDate });
        }
        const file = path.join(path.dirname(receipt.baselinePath), `${code}.baseline.json`);
        const entry = await readJson(file).catch((error) => {
            if (error?.code === 'ENOENT') return null;
            throw error;
        });
        if (!entry || entry.sha256 !== verification.results[index]?.fileSha256 ||
            !isDeepStrictEqual(entry.value, baseline.manifests[index])) {
            return Object.freeze({ state: 'source_unverified', reason: 'symbol_manifest_mismatch',
                classification, tradeDate });
        }
    }
    const result = buildPostcloseTailDataRecovery({ classification, capture, baseline,
        sourceManifestSha256: baselineSource.sha256, verifiedAt: now.toISOString() });
    let boundedReview = null;
    let boundedReviewReason = null;
    if (classification.classification === 'bounded_tail_candidate') {
        if (!withinRoot(root, planPath) || !withinRoot(root, previousBaselinePath)) {
            boundedReviewReason = 'bounded_review_inputs_missing';
        } else {
            try {
                const [plan, previousBaseline] = await Promise.all([
                    readJson(planPath), readJson(previousBaselinePath),
                ]);
                const verifiedHistoricalBySymbol = Object.fromEntries(
                    classification.symbols.filter((item) => item.state === 'tail').map((item) => {
                        const source = baseline.manifests.find((entry) => entry.symbol === item.symbol);
                        return [item.symbol, { sourceVersion: source.sourceVersion,
                            firstHash: source.payloadHash, secondHash: source.refetchPayloadHash,
                            rows: source.cumulativeSeries }];
                    }));
                boundedReview = await reviewDirect160TailGapCapture({ capture,
                    manifest: cohortSource.value, plan: plan.value, baseline: previousBaseline.value,
                    sourceCaptureSha256: captureSha256, reviewedAt: now.toISOString(),
                    verifiedHistoricalBySymbol,
                    fetchImpl: async () => { throw new Error('network_disallowed_for_verified_source'); } });
            } catch (error) {
                boundedReviewReason = String(error?.message ?? 'bounded_review_failed')
                    .replace(/[^A-Za-z0-9:._-]/g, '_').slice(0, 128);
            }
        }
    }
    const resultWithEvidence = { ...result, sourceVerificationSha256: verificationSource.sha256,
        sourceReceiptTradeDate: receipt.tradeDate, sourceReceiptOutcome: receipt.outcome,
        sourceBaselineHash: baseline.baselineHash,
        originalFormalAcceptanceEvidence: capture.assessment?.formalAcceptanceEvidence === true,
        originalDataContinuityComplete: capture.assessment?.dataContinuityComplete === true,
        boundedDerivedAcceptance: boundedReview !== null,
        boundedReviewReason,
        boundedReviewArtifactSha256: null,
        nextDayBaselineUsable: baseline.baselineUsable === true };
    if (!publish) return Object.freeze({ state: result.postcloseDataRecovered ?
        'postclose_data_recovered_dry_run' : 'partial_or_source_unverified_dry_run',
    tradeDate, classification, result: resultWithEvidence, resultPath: null });
    const claim = { schemaVersion: POSTCLOSE_TAIL_RECOVERY_SCHEMA, tradeDate,
        sourceCaptureSha256: captureSha256, cohortHash: classification.cohortHash,
        connectionGeneration: classification.connectionGeneration,
        claimedAt: now.toISOString(), sourceReceiptOutcome: receipt.outcome,
        notificationAuthority: false, brokerWriteAuthority: false,
        productionAuthority: false, serviceLifecycleAuthority: false };
    if (!priorClaim) {
        try { await writeExclusiveJson(paths.claimPath, claim); }
        catch (error) {
            if (error?.code !== 'EEXIST') throw error;
            return Object.freeze({ state: 'already_claimed', claimPath: paths.claimPath,
                classification, tradeDate });
        }
    }
    if (boundedReview) {
        await mkdir(path.dirname(paths.boundedReviewPath), { recursive: true, mode: 0o700 });
        try {
            const reviewReceipt = await writeDirect160Artifact(paths.boundedReviewPath,
                boundedReview, 'capture');
            resultWithEvidence.boundedReviewArtifactSha256 = reviewReceipt.sha256;
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error;
            const existingReview = await readJson(paths.boundedReviewPath);
            if (existingReview.value?.tailGapReview?.sourceCaptureSha256 !== captureSha256 ||
                existingReview.value?.assessment?.formalAcceptanceEvidence !== true) {
                throw new Error('bounded_review_artifact_conflict');
            }
            resultWithEvidence.boundedReviewArtifactSha256 = existingReview.sha256;
        }
    }
    await mkdir(path.dirname(paths.resultPath), { recursive: true, mode: 0o700 });
    let artifactReceipt;
    try { artifactReceipt = await writeDirect160Artifact(paths.resultPath, resultWithEvidence, 'capture'); }
    catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const raced = await readOptionalJson(paths.resultPath);
        return Object.freeze({ state: raced && matchesPublishedResult(raced, classification,
            tradeDate, captureSha256) ? 'already_completed' : 'result_conflict',
            result: raced && matchesPublishedResult(raced, classification,
                tradeDate, captureSha256) ? raced : null,
            claimPath: paths.claimPath, resultPath: paths.resultPath,
            classification, tradeDate });
    }
    return Object.freeze({ state: result.postcloseDataRecovered ? 'postclose_data_recovered' :
        'partial_or_source_unverified', tradeDate, classification,
    result: resultWithEvidence, claimPath: paths.claimPath, resultPath: paths.resultPath,
    artifactReceipt });
}

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    if (!process.argv.includes('--execute') && !process.argv.includes('--dry-run')) {
        throw new Error('--execute or --dry-run required');
    }
    const root = argument('root') ?? appSupportRoot();
    const tradeDate = argument('trade-date');
    const manifestPath = argument('manifest');
    const receiptPath = argument('receipt');
    const receipt = receiptPath ? (await readJson(receiptPath)).value : null;
    const result = await runPostcloseTailRecovery({ root, tradeDate, manifestPath, receipt,
        publish: process.argv.includes('--execute') });
    process.stdout.write(`${JSON.stringify({ state: result.state, tradeDate: result.tradeDate,
        classification: result.classification?.classification ?? null,
        resultPath: result.resultPath ?? null })}\n`);
}
