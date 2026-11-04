export const APP_REVISION_ENDPOINT = '/__realtimestock/app-revision';
export const APP_UPDATE_INTERVAL_MS = 15_000;
export const APP_UPDATE_SETTLE_MS = 2_000;
const validRevision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Two stable observations prevent reloads into a half-written frontend update. */
export function createAppUpdateChecker(ports: {
    loadedRevision: string;
    readRevision: () => Promise<unknown>;
    canReload: () => boolean;
    checkpoint: () => boolean;
    reload: () => void;
    now?: () => number;
}) {
    let candidate: { revision: string; at: number } | null = null;
    let busy = false, stopped = false, reloading = false;
    const now = ports.now ?? Date.now;
    return {
        async check() {
            if (busy || stopped || reloading || !validRevision(ports.loadedRevision)) return;
            busy = true;
            try {
                const payload = await ports.readRevision();
                if (stopped || !payload || typeof payload !== 'object' || !('revision' in payload) || !validRevision(payload.revision)) { candidate = null; return; }
                const revision = payload.revision;
                if (revision === ports.loadedRevision) { candidate = null; return; }
                if (candidate?.revision !== revision) { candidate = { revision, at: now() }; return; }
                if (now() - candidate.at < APP_UPDATE_SETTLE_MS || !ports.canReload() || !ports.checkpoint()) return;
                reloading = true;
                ports.reload();
            } catch { candidate = null; /* Offline/failed checks never force a reload. */ }
            finally { busy = false; }
        },
        stop() { stopped = true; },
    };
}

export function updateInteractionIdle(document: Document, pointerDown: boolean) {
    const active = document.activeElement;
    return !pointerDown && !document.hidden &&
        !active?.matches('input, textarea, select, [contenteditable="true"]') &&
        !document.querySelector('[role="dialog"], dialog[open], [role="listbox"], vite-error-overlay');
}
