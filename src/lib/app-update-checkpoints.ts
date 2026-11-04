/** Live callbacks only: never serialize quotes, account data, or executable code. */
const callbacks: Map<string, { priority: number; capture: () => boolean }> =
    import.meta.hot?.data.checkpoints ?? new Map();
if (import.meta.hot) import.meta.hot.dispose(data => { data.checkpoints = callbacks; });
export function registerUpdateCheckpoint(key: string, capture: () => boolean, priority = 0) {
    const value = { capture, priority };
    callbacks.set(key, value);
    return () => { if (callbacks.get(key) === value) callbacks.delete(key); };
}
export function prepareUpdateHandoff() {
    if (!callbacks.has('trading-view')) return false;
    try {
        for (const value of [...callbacks.values()].sort((a, b) => a.priority - b.priority)) {
            if (!value.capture()) return false;
        }
        return true;
    } catch { return false; }
}
