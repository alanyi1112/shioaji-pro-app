const DEFAULT_MULTIVIEW_URL = 'http://127.0.0.1:5174/';
const DEFAULT_REALTIME_STOCK_ORIGIN = 'http://127.0.0.1:5173';
const MULTIVIEW_LAUNCHER_POPOUT = 'multiview-launcher';

export type MultiViewLaunchCode =
    | 'ready'
    | 'fallback'
    | 'degraded'
    | 'offline'
    | 'unavailable';

export type MultiViewLaunchStatus = {
    code: MultiViewLaunchCode;
    targetUrl: string;
    multiview: 'available' | 'unavailable';
    shioaji: 'simulation' | 'offline' | 'non_simulation';
    afterHours: 'available' | 'degraded' | 'unknown';
    reasonCode: string | null;
};

export function resolveMultiViewUrl(configured?: string) {
    try {
        const url = new URL(configured || DEFAULT_MULTIVIEW_URL);
        if (
            url.protocol !== 'http:' ||
            !['127.0.0.1', 'localhost', '::1'].includes(url.hostname) ||
            url.port !== '5174' ||
            url.username ||
            url.password
        ) {
            return DEFAULT_MULTIVIEW_URL;
        }
        return url.toString();
    } catch {
        return DEFAULT_MULTIVIEW_URL;
    }
}

export function resolveMultiViewLauncherUrl(
    configured?: string,
    appOrigin = DEFAULT_REALTIME_STOCK_ORIGIN,
) {
    const targetUrl = resolveMultiViewUrl(configured);
    try {
        const origin = new URL(appOrigin);
        if (
            origin.protocol !== 'http:' ||
            !['127.0.0.1', 'localhost', '::1'].includes(origin.hostname) ||
            origin.port !== '5173' ||
            origin.username ||
            origin.password
        ) {
            throw new Error('invalid_origin');
        }
        const launcher = new URL('/', origin);
        launcher.searchParams.set('popout', MULTIVIEW_LAUNCHER_POPOUT);
        launcher.searchParams.set('target', targetUrl);
        return launcher.toString();
    } catch {
        const launcher = new URL('/', DEFAULT_REALTIME_STOCK_ORIGIN);
        launcher.searchParams.set('popout', MULTIVIEW_LAUNCHER_POPOUT);
        launcher.searchParams.set('target', targetUrl);
        return launcher.toString();
    }
}

function object(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function afterHoursStatus(health: Record<string, unknown>) {
    const persistence = object(health.persistence);
    if (!persistence?.d1) return 'degraded' as const;
    const chip = object(health.taiwanStockChip);
    const pe = object(health.taiwanStockPeRiver);
    if (!chip || !pe) return 'unknown' as const;
    const reasons = JSON.stringify([chip.status, chip.reasonCode, pe.status, pe.reasonCode]);
    return /failed|blocked|unavailable|degraded|error/i.test(reasons)
        ? ('degraded' as const)
        : ('available' as const);
}

async function fetchJson(
    url: string,
    fetchImpl: typeof fetch,
    signal: AbortSignal,
) {
    const response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal,
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return object(await response.json());
}

export async function probeMultiView(
    configured?: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 2500,
): Promise<MultiViewLaunchStatus> {
    const targetUrl = resolveMultiViewUrl(configured);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const health = await fetchJson(
            new URL('/api/health', targetUrl).toString(),
            fetchImpl,
            controller.signal,
        );
        if (
            !health ||
            health.ok !== true ||
            health.deploymentTarget !== 'local'
        ) {
            return {
                code: 'unavailable',
                targetUrl,
                multiview: 'unavailable',
                shioaji: 'offline',
                afterHours: 'unknown',
                reasonCode: 'invalid_multiview_health',
            };
        }
        const afterHours = afterHoursStatus(health);
        try {
            const info = await fetchJson(
                new URL('/local-shioaji/api/v1/info', targetUrl).toString(),
                fetchImpl,
                controller.signal,
            );
            if (info?.simulation !== true) {
                return {
                    code: 'offline',
                    targetUrl,
                    multiview: 'available',
                    shioaji:
                        info?.simulation === false
                            ? 'non_simulation'
                            : 'offline',
                    afterHours,
                    reasonCode: 'simulation_required',
                };
            }
            return {
                code: afterHours === 'degraded' ? 'degraded' : 'ready',
                targetUrl,
                multiview: 'available',
                shioaji: 'simulation',
                afterHours,
                reasonCode:
                    afterHours === 'degraded'
                        ? 'after_hours_degraded'
                        : null,
            };
        } catch {
            return {
                code: 'fallback',
                targetUrl,
                multiview: 'available',
                shioaji: 'offline',
                afterHours,
                reasonCode: 'shioaji_business_unavailable',
            };
        }
    } catch {
        return {
            code: 'unavailable',
            targetUrl,
            multiview: 'unavailable',
            shioaji: 'offline',
            afterHours: 'unknown',
            reasonCode: 'multiview_unavailable',
        };
    } finally {
        clearTimeout(timer);
    }
}

export function openMultiViewWindow(
    target: Pick<Window, 'open'> = window,
    configured = import.meta.env.VITE_MULTIVIEW_URL,
    appOrigin = window.location.origin,
) {
    return target.open(
        resolveMultiViewLauncherUrl(configured, appOrigin),
        'realtimestock-multiview',
    );
}
