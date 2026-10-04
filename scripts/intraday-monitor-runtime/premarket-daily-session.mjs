import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    IntradayMonitorConfigRepository,
    resolveIntradayMonitorDatabasePath,
} from './config-repository.mjs';
import {
    IntradayMonitorSessionStateRepository,
    createDailySessionRecord,
} from './session-state-repository.mjs';
import { resolveIntradayMonitorRuntimeArtifactBundle } from './runtime-artifact-bundle.mjs';

function hash(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function unprefixedHash(value) {
    const normalized = String(value ?? '').replace(/^sha256:/, '');
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

async function json(file) {
    return JSON.parse(await readFile(file, 'utf8'));
}

export function resolveIntradayMonitorDailyBaselinePath(appSupportRoot, authority) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(authority?.tradeDate ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(authority?.previousTradeDate ?? '')) {
        throw new TypeError('daily baseline identity is invalid');
    }
    return path.join(appSupportRoot, 'intraday-baselines',
        `${authority.previousTradeDate}-for-${authority.tradeDate}-verified`, 'baseline-set.json');
}

function canonicalSymbol(item) {
    if (typeof item?.canonicalSymbol === 'string') return item.canonicalSymbol;
    const contract = item?.contractIdentity ?? item?.contract;
    if (!contract?.code) return null;
    const exchange = contract.exchange === 'TSE' ? 'TW' : 'TWO';
    return `${contract.code}.${exchange}`;
}

function readConfigRevision(config, appSupportRoot) {
    const repository = new IntradayMonitorConfigRepository(
        config.configDatabasePath ?? resolveIntradayMonitorDatabasePath(appSupportRoot),
    );
    try { return repository.read(); } finally { repository.close(); }
}

export async function prepareIntradayMonitorPremarketDailySession({
    appSupportRoot,
    config,
    authority,
    connectionGeneration,
    schedulerReceipt,
    now = new Date(),
} = {}) {
    if (!authority?.current || authority.isTradingDate !== true ||
        authority.tradeDate !== new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(now) || !authority.previousTradeDate) {
        throw new Error('calendar_authority_unavailable');
    }
    const bundle = await resolveIntradayMonitorRuntimeArtifactBundle({
        appSupportRoot,
        bundleHash: config.artifactBundleHash,
    });
    if (!bundle.valid) throw new Error('artifact_bundle_invalid');
    const baselinePath = config.baselinePath ??
        resolveIntradayMonitorDailyBaselinePath(appSupportRoot, authority);
    const [cohort, baseline] = await Promise.all([
        json(bundle.files.cohort),
        json(baselinePath).catch(() => null),
    ]);
    const symbols = (cohort.cohort ?? cohort.items ?? []).map(canonicalSymbol);
    if (symbols.length !== 160 || symbols.some((symbol) => symbol === null) ||
        new Set(symbols).size !== 160) {
        throw new Error('artifact_bundle_invalid');
    }
    const cohortHash = unprefixedHash(cohort.manifestHash ?? cohort.cohortHash);
    if (!cohortHash) throw new Error('artifact_bundle_invalid');
    const repository = new IntradayMonitorSessionStateRepository(appSupportRoot);
    const approval = repository.readApproval();
    if (!approval || approval.artifactBundleHash !== bundle.bundleHash) {
        throw new Error('capacity_approval_missing');
    }
    const savedConfig = readConfigRevision(config, appSupportRoot);
    const baselineCurrent = Boolean(baseline?.calendar?.targetTradeDate === authority.tradeDate &&
        baseline?.calendar?.previousTradeDate === authority.previousTradeDate &&
        baseline?.manifests?.length === symbols.length);
    const baselineHash = baselineCurrent ? unprefixedHash(baseline.baselineHash) : null;
    const observedAt = now.toISOString();
    const schedulerReceiptHash = hash(schedulerReceipt);
    const sessionId = `session-${authority.tradeDate}-${hash({
        tradeDate: authority.tradeDate,
        configRevision: savedConfig.revision,
        cohortHash,
        artifactBundleHash: bundle.bundleHash,
        connectionGeneration,
    }).slice(0, 24)}`;
    const session = createDailySessionRecord({
        sessionId,
        tradeDate: authority.tradeDate,
        previousTradeDate: authority.previousTradeDate,
        configRevision: savedConfig.revision,
        cohortHash,
        baselineHash,
        artifactBundleHash: bundle.bundleHash,
        approvalHash: approval.approvalHash,
        connectionGeneration,
        schedulerReceiptHash,
        calendarAuthority: authority,
        phase: baselineCurrent ? 'starting' : 'waiting_baseline',
        itemStates: symbols.map((symbol) => ({
            canonicalSymbol: symbol,
            state: baselineCurrent ? 'awaiting_first_kbar' : 'waiting_baseline',
            reason: baselineCurrent ? 'awaiting_first_kbar' : 'baseline_missing',
            baselineState: baselineCurrent ? 'complete' : 'missing',
            baselineTradeDate: baselineCurrent ? authority.previousTradeDate : null,
            subscriptionState: 'none',
            firstKbarAt: null,
            updatedAt: observedAt,
        })),
        controlPlane: { requested: false, accepted: false },
        freshness: { evidenceAt: observedAt, budgetMs: baselineCurrent ? 20 * 60_000 : 0 },
        blocker: baselineCurrent ? null : 'baseline_missing',
        createdAt: observedAt,
    });
    const saved = repository.claimSession(session);
    return Object.freeze({ session: saved, approval, bundle, savedConfig, baselineCurrent });
}

export async function inspectIntradayMonitorPremarketDailySession({
    appSupportRoot,
    config,
    authority,
    connectionGeneration,
    now = new Date(),
} = {}) {
    const repository = new IntradayMonitorSessionStateRepository(appSupportRoot);
    let session = authority?.tradeDate ? repository.readSession(authority.tradeDate) : null;
    const approval = repository.readApproval();
    const bundle = await resolveIntradayMonitorRuntimeArtifactBundle({
        appSupportRoot,
        bundleHash: config.artifactBundleHash,
    }).catch(() => ({ valid: false, reason: 'artifact_bundle_invalid' }));
    let savedConfig = null;
    try { savedConfig = readConfigRevision(config, appSupportRoot); } catch {}
    const baselinePath = config.baselinePath ?? (authority?.tradeDate && authority?.previousTradeDate
        ? resolveIntradayMonitorDailyBaselinePath(appSupportRoot, authority) : null);
    const baseline = baselinePath ? await json(baselinePath).catch(() => null) : null;
    const baselineCurrent = Boolean(baseline?.calendar?.targetTradeDate === authority?.tradeDate &&
        baseline?.calendar?.previousTradeDate === authority?.previousTradeDate &&
        baseline?.manifests?.length === session?.itemStates?.length);
    const baselineHash = baselineCurrent ? unprefixedHash(baseline.baselineHash) : null;
    if (session?.baselineHash === null && baselineHash) {
        session = repository.attachSessionBaseline({ tradeDate: session.tradeDate, baselineHash,
            observedAt: now.toISOString() });
    }
    const reasons = [];
    if (!authority?.current) reasons.push('calendar_authority_unavailable');
    if (!session) reasons.push('current_session_missing');
    if (session && session.tradeDate !== authority?.tradeDate) reasons.push('session_trade_date_stale');
    if (!approval || session?.approvalHash !== approval?.approvalHash) reasons.push('capacity_approval_missing');
    if (!bundle.valid || session?.artifactBundleHash !== bundle.bundleHash) reasons.push('artifact_bundle_invalid');
    if (session && session.configRevision !== savedConfig?.revision) reasons.push('config_revision_mismatch');
    if (session && session.connectionGeneration !== connectionGeneration) reasons.push('generation_mismatch');
    if (session && (!session.baselineHash || !baselineCurrent || session.baselineHash !== baselineHash)) {
        reasons.push('baseline_missing');
    }
    let verifiedSession = session;
    if (reasons.length === 0 && session) {
        const observedAt = now.toISOString();
        verifiedSession = repository.updateSession({
            ...session,
            freshness: { evidenceAt: observedAt, budgetMs: 20 * 60_000 },
            updatedAt: observedAt,
        });
    }
    return Object.freeze({
        ready: reasons.length === 0,
        reason: reasons[0] ?? null,
        reasons: Object.freeze([...new Set(reasons)]),
        session: verifiedSession,
        approval,
        bundle,
        savedConfig,
    });
}
