const DEFAULT_MULTIVIEW_URL = 'http://127.0.0.1:5174/';

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

export function openMultiViewWindow(
    target: Pick<Window, 'open'> = window,
    configured = import.meta.env.VITE_MULTIVIEW_URL,
) {
    return target.open(
        resolveMultiViewUrl(configured),
        'realtimestock-multiview',
    );
}
