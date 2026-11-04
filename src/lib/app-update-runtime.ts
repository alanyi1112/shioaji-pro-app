import { APP_REVISION_ENDPOINT, APP_UPDATE_INTERVAL_MS, APP_UPDATE_SETTLE_MS, createAppUpdateChecker, updateInteractionIdle } from './app-update-client';
import { prepareUpdateHandoff } from './app-update-checkpoints';

if (import.meta.hot) {
    const revision = document.querySelector<HTMLMetaElement>('meta[name="realtimestock-app-revision"]')?.content ?? '';
    let pointerDown = false, lastInteraction = 0;
    const checker = createAppUpdateChecker({
        loadedRevision: revision,
        readRevision: async () => {
            const response = await fetch(APP_REVISION_ENDPOINT, { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
            if (!response.ok) throw Error('app_revision_unavailable');
            return response.json();
        },
        canReload: () => Date.now() - lastInteraction >= 1_000 && updateInteractionIdle(document, pointerDown),
        checkpoint: prepareUpdateHandoff,
        reload: () => window.location.reload(),
    });
    const check = () => { void checker.check(); };
    const down = () => { pointerDown = true; };
    const activity = () => { lastInteraction = Date.now(); };
    const up = () => { pointerDown = false; activity(); };
    const focus = () => { pointerDown = false; check(); };
    const timer = setInterval(check, APP_UPDATE_INTERVAL_MS);
    const settleTimer = setTimeout(check, APP_UPDATE_SETTLE_MS);
    document.documentElement.dataset.appRevision = revision;
    window.addEventListener('wheel', activity, { capture: true, passive: true });
    window.addEventListener('keydown', activity, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('focus', focus);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    check();
    import.meta.hot.dispose(() => {
        checker.stop(); clearInterval(timer); clearTimeout(settleTimer);
        window.removeEventListener('wheel', activity, true);
        window.removeEventListener('keydown', activity, true);
        window.removeEventListener('pointerdown', down, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        window.removeEventListener('focus', focus);
        window.removeEventListener('online', check);
        document.removeEventListener('visibilitychange', check);
    });
}
