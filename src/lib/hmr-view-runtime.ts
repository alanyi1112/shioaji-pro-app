import { registerUpdateCheckpoint, prepareUpdateHandoff } from './app-update-checkpoints';
import { attachHmrViewStore } from './hmr-view-state';

const hot = import.meta.hot;
let storage: Storage | undefined;
try { storage = hot ? window.sessionStorage : undefined; } catch { /* denied storage */ }
const scopeQuery = new URLSearchParams(window.location.search);
scopeQuery.delete('watchlist'); // This is restored from the per-tab handoff, not a different layout.
scopeQuery.sort();
export const hmrViewStore = hot ? attachHmrViewStore(hot, {
    scope: window.location.pathname + '?' + scopeQuery.toString(),
    storage,
    reload: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload',
}) : null;

if (hot && hmrViewStore) {
    const unregister = registerUpdateCheckpoint('trading-view', () => hmrViewStore.beforeFullReload(), 100);
    const checkpoint = () => { prepareUpdateHandoff(); };
    window.addEventListener('beforeunload', checkpoint);
    hot.on('vite:beforeFullReload', checkpoint);
    hot.dispose(() => {
        unregister(); window.removeEventListener('beforeunload', checkpoint);
        hot.off('vite:beforeFullReload', checkpoint);
    });
}
