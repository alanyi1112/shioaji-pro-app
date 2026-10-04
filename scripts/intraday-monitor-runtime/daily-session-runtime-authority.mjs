import {
    IntradayMonitorConfigRepository,
    resolveIntradayMonitorDatabasePath,
} from './config-repository.mjs';
import { evaluateIntradayMonitorCurrentSession } from './current-session-authority.mjs';
import { resolveIntradayMonitorRuntimeArtifactBundleSync } from './runtime-artifact-bundle.mjs';
import { IntradayMonitorSessionStateRepository } from './session-state-repository.mjs';

export const INTRADAY_MONITOR_CLOSING_TRANSITION_TIME = '13:30:15';

function readConfigRevision(configDatabasePath, appSupportRoot) {
    const repository = new IntradayMonitorConfigRepository(
        configDatabasePath ?? resolveIntradayMonitorDatabasePath(appSupportRoot),
    );
    try { return repository.read().revision; } finally { repository.close(); }
}

function replaceItem(items, canonicalSymbol, transform) {
    let found = false;
    const next = items.map((item) => {
        if (item.canonicalSymbol !== canonicalSymbol) return item;
        found = true;
        return transform(item);
    });
    if (!found) throw new Error('current_session_symbol_unknown');
    return next;
}

export function createIntradayMonitorDailySessionRuntimeAuthority({
    appSupportRoot,
    tradeDate,
    connectionGeneration,
    configDatabasePath = null,
    now = () => new Date().toISOString(),
} = {}) {
    const repository = new IntradayMonitorSessionStateRepository(appSupportRoot);

    function context() {
        const session = repository.readSession(tradeDate);
        const approval = repository.readApproval();
        const artifactBundle = session
            ? resolveIntradayMonitorRuntimeArtifactBundleSync({
                appSupportRoot,
                bundleHash: session.artifactBundleHash,
            })
            : { valid: false, bundleHash: null };
        let savedConfigRevision = null;
        try { savedConfigRevision = readConfigRevision(configDatabasePath, appSupportRoot); } catch {}
        const authority = evaluateIntradayMonitorCurrentSession({
            authority: session?.calendarAuthority ?? null,
            session,
            approval,
            artifactBundle,
            savedConfigRevision,
            apiGeneration: connectionGeneration,
            nowEpochMs: Date.parse(now()),
        });
        return Object.freeze({ authority, session, approval, artifactBundle, savedConfigRevision });
    }

    function update(transform) {
        const before = context();
        if (!before.authority.current || !before.session) {
            throw new Error(before.authority.reason ?? 'current_session_missing');
        }
        const observedAt = now();
        const next = transform(before.session, observedAt);
        repository.updateSession({
            ...next,
            freshness: { evidenceAt: observedAt,
                budgetMs: next.phase === 'closing' ? 10 * 60_000 : 2 * 60_000 },
            updatedAt: observedAt,
        });
        return context();
    }

    return Object.freeze({
        evaluate: () => context().authority,
        beginClosing() {
            const observedAt = now();
            const epochMs = Date.parse(observedAt);
            if (!Number.isFinite(epochMs) ||
                epochMs < Date.parse(`${tradeDate}T13:30:00+08:00`) ||
                epochMs > Date.parse(`${tradeDate}T13:32:00+08:00`)) {
                throw new Error('session_closing_transition_outside_window');
            }
            const before = context();
            if (!before.authority.current || !before.session) {
                throw new Error(before.authority.reason ?? 'current_session_missing');
            }
            if (before.session.phase !== 'running' || before.session.controlPlane?.accepted !== true) {
                throw new Error('session_closing_transition_not_ready');
            }
            repository.updateSession({
                ...before.session,
                phase: 'closing',
                // A scheduled phase transition is not a new market observation.
                freshness: { ...before.session.freshness, budgetMs: 10 * 60_000 },
                updatedAt: observedAt,
            });
            return context().authority;
        },
        markControlPlane({ requested, accepted }) {
            return update((session) => ({
                ...session,
                phase: 'starting',
                controlPlane: { requested: requested === true, accepted: accepted === true },
                blocker: accepted ? null : 'control_plane_not_accepted',
                itemStates: session.itemStates.map((item) => ({
                    ...item,
                    subscriptionState: accepted ? 'accepted' : requested ? 'requested' : 'none',
                })),
            })).authority;
        },
        recordFirstKbar({ canonicalSymbol, receivedAt }) {
            return update((session) => ({
                ...session,
                phase: session.phase === 'closing' ? 'closing' : 'running',
                itemStates: replaceItem(session.itemStates, canonicalSymbol, (item) => ({
                    ...item,
                    state: item.baselineState === 'complete' ? 'active' : 'waiting_baseline',
                    reason: item.baselineState === 'complete' ? 'none' : 'baseline_missing',
                    subscriptionState: 'confirmed',
                    firstKbarAt: item.firstKbarAt ?? receivedAt,
                    updatedAt: receivedAt,
                })),
            })).authority;
        },
        recordObservation({ canonicalSymbol, receivedAt, continuityComplete }) {
            return update((session) => ({
                ...session,
                phase: session.phase === 'closing' ? 'closing' : 'running',
                itemStates: replaceItem(session.itemStates, canonicalSymbol, (item) => ({
                    ...item,
                    state: continuityComplete && item.baselineState === 'complete'
                        ? 'active'
                        : item.baselineState === 'complete' ? 'waiting_continuity' : 'waiting_baseline',
                    reason: continuityComplete && item.baselineState === 'complete'
                        ? 'none'
                        : item.baselineState === 'complete' ? 'minute_continuity_unknown' : 'baseline_missing',
                    subscriptionState: 'confirmed',
                    firstKbarAt: item.firstKbarAt ?? receivedAt,
                    updatedAt: receivedAt,
                })),
            })).authority;
        },
    });
}
