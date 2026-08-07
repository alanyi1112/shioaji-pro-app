import { fetchSnapshots } from './shioaji';
import {
    getRuntimeMode,
    subscribeRuntimeMode,
} from './runtime-mode';
import type { RuntimeMode } from './runtime-mode-shared';

export const BUSINESS_SESSION_PROBE_INTERVAL_MS = 30_000;

export type BusinessSessionStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'session-unavailable'
    | 'unavailable';

export interface BusinessSessionSnapshot {
    status: BusinessSessionStatus;
    checkedAt: number | null;
}

interface BusinessSessionMonitorDependencies {
    getMode: () => RuntimeMode;
    subscribeMode: (listener: () => void) => () => void;
    probe: () => Promise<void>;
    now: () => number;
    setInterval: (callback: () => void, delay: number) => unknown;
    clearInterval: (timer: unknown) => void;
}

const SENTINEL_CONTRACT = {
    security_type: 'STK' as const,
    region: 'TW' as const,
    exchange: 'TSE' as const,
    code: '2330',
    target_code: null,
};

function isSessionUnavailable(error: unknown): boolean {
    return (
        error instanceof Error &&
        error.message.includes('SessionNotEstablished')
    );
}

async function probeSentinelSnapshot(): Promise<void> {
    const snapshots = await fetchSnapshots([SENTINEL_CONTRACT]);
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
        throw new Error('business snapshot unavailable');
    }
}

function defaultDependencies(): BusinessSessionMonitorDependencies {
    return {
        getMode: getRuntimeMode,
        subscribeMode: subscribeRuntimeMode,
        probe: probeSentinelSnapshot,
        now: Date.now,
        setInterval: (callback, delay) => window.setInterval(callback, delay),
        clearInterval: (timer) => window.clearInterval(timer as number),
    };
}

export function createBusinessSessionMonitor(
    overrides: Partial<BusinessSessionMonitorDependencies> = {},
) {
    const dependencies = { ...defaultDependencies(), ...overrides };
    const listeners = new Set<() => void>();
    let snapshot: BusinessSessionSnapshot = {
        status: 'idle',
        checkedAt: null,
    };
    let interval: unknown = null;
    let unsubscribeMode: (() => void) | null = null;
    let inFlight: Promise<void> | null = null;

    const publish = (next: BusinessSessionSnapshot) => {
        if (
            next.status === snapshot.status &&
            next.checkedAt === snapshot.checkedAt
        ) {
            return;
        }
        snapshot = next;
        listeners.forEach((listener) => listener());
    };

    const check = (): Promise<void> => {
        if (inFlight) return inFlight;
        if (dependencies.getMode() !== 'simulation') {
            publish({ status: 'idle', checkedAt: null });
            return Promise.resolve();
        }

        publish({ status: 'checking', checkedAt: snapshot.checkedAt });
        const task = dependencies
            .probe()
            .then(() => {
                publish({
                    status: 'available',
                    checkedAt: dependencies.now(),
                });
            })
            .catch((error: unknown) => {
                publish({
                    status: isSessionUnavailable(error)
                        ? 'session-unavailable'
                        : 'unavailable',
                    checkedAt: dependencies.now(),
                });
            })
            .finally(() => {
                if (inFlight === task) inFlight = null;
            });
        inFlight = task;
        return task;
    };

    const start = () => {
        if (interval !== null) return;
        unsubscribeMode = dependencies.subscribeMode(() => void check());
        interval = dependencies.setInterval(
            () => void check(),
            BUSINESS_SESSION_PROBE_INTERVAL_MS,
        );
        void check();
    };

    const stop = () => {
        if (interval !== null) dependencies.clearInterval(interval);
        interval = null;
        unsubscribeMode?.();
        unsubscribeMode = null;
        publish({ status: 'idle', checkedAt: null });
    };

    return {
        start,
        stop,
        check,
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

const businessSessionMonitor = createBusinessSessionMonitor();

export function startBusinessSessionMonitor(): () => void {
    businessSessionMonitor.start();
    return businessSessionMonitor.stop;
}

export const getBusinessSessionSnapshot =
    businessSessionMonitor.getSnapshot;
export const subscribeBusinessSession = businessSessionMonitor.subscribe;
