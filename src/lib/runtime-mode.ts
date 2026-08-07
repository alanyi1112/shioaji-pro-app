import { useSyncExternalStore } from 'react';
import {
    RUNTIME_MODE_ENDPOINT,
    isTradingWriteRequest,
    normalizeRuntimeMode,
    type RuntimeMode,
} from './runtime-mode-shared';

let currentMode: RuntimeMode = 'unknown';
const listeners = new Set<() => void>();

function setRuntimeMode(mode: RuntimeMode) {
    if (mode === currentMode) return;
    currentMode = mode;
    listeners.forEach((listener) => listener());
}

export function getRuntimeMode(): RuntimeMode {
    return currentMode;
}

export function subscribeRuntimeMode(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useRuntimeMode(): RuntimeMode {
    return useSyncExternalStore(
        subscribeRuntimeMode,
        getRuntimeMode,
    );
}

export async function refreshRuntimeMode(): Promise<RuntimeMode> {
    try {
        const response = await fetch(RUNTIME_MODE_ENDPOINT, {
            cache: 'no-store',
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { mode?: unknown };
        const mode = normalizeRuntimeMode(data.mode);
        setRuntimeMode(mode);
        return mode;
    } catch {
        setRuntimeMode('unknown');
        return 'unknown';
    }
}

export function startRuntimeModeSync(): () => void {
    void refreshRuntimeMode();
    const timer = window.setInterval(() => void refreshRuntimeMode(), 5000);
    return () => window.clearInterval(timer);
}

export function assertRuntimeAllowsRequest(pathname: string, method: string) {
    if (
        currentMode === 'production-readonly' &&
        isTradingWriteRequest(pathname, method)
    ) {
        throw new Error(
            '403 正式行情唯讀模式：下單、改單與刪單功能已由本機安全層封鎖',
        );
    }
}
