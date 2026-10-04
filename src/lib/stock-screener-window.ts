import type { UniverseStock } from './stock-screener-domain';

export const STOCK_SCREENER_POPOUT = 'screener';
export const STOCK_SCREENER_LAYOUT = 'stock-screener';
export const STOCK_SCREENER_CHANNEL = 'sj-stock-screener-bridge-v1';
export const STOCK_SCREENER_PROTOCOL_VERSION = 1;
const DEFAULT_APP_ORIGIN = 'http://127.0.0.1:5173';

export interface ScreenerChartTarget {
    id: string;
    label: string;
}

type BridgeMessage =
    | { version: 1; sourceWindowId: string; type: 'client-ready' | 'targets-request' }
    | { version: 1; sourceWindowId: string; type: 'heartbeat'; targetRevision: string; sentAt: number }
    | { version: 1; sourceWindowId: string; type: 'targets'; targetRevision: string; targets: ScreenerChartTarget[]; sentAt: number }
    | { version: 1; sourceWindowId: string; type: 'pick-request'; requestId: string; targetRevision: string; targetId: string; stock: UniverseStock }
    | { version: 1; sourceWindowId: string; type: 'open-chart-request'; requestId: string; targetRevision: string }
    | { version: 1; sourceWindowId: string; type: 'response'; requestId: string; action: 'pick' | 'open-chart'; ok: boolean; targetId?: string; error?: string };
type OutboundBridgeMessage = BridgeMessage extends infer Message
    ? Message extends BridgeMessage
        ? Omit<Message, 'version' | 'sourceWindowId'>
        : never
    : never;

interface ChannelLike {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
    close(): void;
}

export type ScreenerChannelFactory = (name: string) => ChannelLike;

const defaultChannelFactory: ScreenerChannelFactory = (name) => new BroadcastChannel(name);

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isTarget(value: unknown): value is ScreenerChartTarget {
    const candidate = record(value);
    return Boolean(candidate && nonEmptyString(candidate.id) && nonEmptyString(candidate.label));
}

function isStock(value: unknown): value is UniverseStock {
    const candidate = record(value);
    return Boolean(candidate
        && nonEmptyString(candidate.code)
        && nonEmptyString(candidate.symbol)
        && nonEmptyString(candidate.name)
        && candidate.kind === 'ordinary'
        && (candidate.market === 'TWSE' || candidate.market === 'TPEx'));
}

export function parseScreenerBridgeMessage(value: unknown): BridgeMessage | null {
    const candidate = record(value);
    if (!candidate
        || candidate.version !== STOCK_SCREENER_PROTOCOL_VERSION
        || !nonEmptyString(candidate.sourceWindowId)
        || !nonEmptyString(candidate.type)) return null;

    const base = {
        version: STOCK_SCREENER_PROTOCOL_VERSION,
        sourceWindowId: candidate.sourceWindowId,
    } as const;
    if (candidate.type === 'client-ready' || candidate.type === 'targets-request') {
        return { ...base, type: candidate.type };
    }
    if (candidate.type === 'heartbeat'
        && nonEmptyString(candidate.targetRevision)
        && typeof candidate.sentAt === 'number') {
        return { ...base, type: candidate.type, targetRevision: candidate.targetRevision, sentAt: candidate.sentAt };
    }
    if (candidate.type === 'targets'
        && nonEmptyString(candidate.targetRevision)
        && Array.isArray(candidate.targets)
        && candidate.targets.every(isTarget)
        && typeof candidate.sentAt === 'number') {
        return { ...base, type: candidate.type, targetRevision: candidate.targetRevision, targets: candidate.targets, sentAt: candidate.sentAt };
    }
    if (candidate.type === 'pick-request'
        && nonEmptyString(candidate.requestId)
        && nonEmptyString(candidate.targetRevision)
        && nonEmptyString(candidate.targetId)
        && isStock(candidate.stock)) {
        return { ...base, type: candidate.type, requestId: candidate.requestId, targetRevision: candidate.targetRevision, targetId: candidate.targetId, stock: candidate.stock };
    }
    if (candidate.type === 'open-chart-request'
        && nonEmptyString(candidate.requestId)
        && nonEmptyString(candidate.targetRevision)) {
        return { ...base, type: candidate.type, requestId: candidate.requestId, targetRevision: candidate.targetRevision };
    }
    if (candidate.type === 'response'
        && nonEmptyString(candidate.requestId)
        && (candidate.action === 'pick' || candidate.action === 'open-chart')
        && typeof candidate.ok === 'boolean'
        && (candidate.targetId === undefined || nonEmptyString(candidate.targetId))
        && (candidate.error === undefined || nonEmptyString(candidate.error))) {
        return { ...base, type: candidate.type, requestId: candidate.requestId, action: candidate.action, ok: candidate.ok, targetId: candidate.targetId as string | undefined, error: candidate.error as string | undefined };
    }
    return null;
}

export function createSourceWindowId(cryptoImpl: { randomUUID: () => string } = crypto) {
    return cryptoImpl.randomUUID();
}

export function resolveStockScreenerUrl(
    sourceWindowId?: string,
    appOrigin = DEFAULT_APP_ORIGIN,
) {
    let origin: URL;
    try {
        origin = new URL(appOrigin);
        if (origin.protocol !== 'http:'
            || !['127.0.0.1', 'localhost', '::1'].includes(origin.hostname)
            || origin.port !== '5173'
            || origin.username
            || origin.password) throw new Error('invalid_origin');
    } catch {
        origin = new URL(DEFAULT_APP_ORIGIN);
    }
    const url = new URL('/', origin);
    url.searchParams.set('popout', STOCK_SCREENER_POPOUT);
    if (sourceWindowId) url.searchParams.set('sourceWindowId', sourceWindowId);
    return url.toString();
}

export function openStockScreenerWindow(
    sourceWindowId: string,
    targetWindow: Pick<Window, 'open'> = window,
    appOrigin = window.location.origin,
) {
    return targetWindow.open(
        resolveStockScreenerUrl(sourceWindowId, appOrigin),
        '_blank',
        'noopener',
    );
}

export function resolveStockScreenerLayoutUrl(
    appOrigin = DEFAULT_APP_ORIGIN,
) {
    let origin: URL;
    try {
        origin = new URL(appOrigin);
        if (
            origin.protocol !== 'http:' ||
            !['127.0.0.1', 'localhost', '::1'].includes(origin.hostname) ||
            origin.port !== '5173' ||
            origin.username ||
            origin.password
        ) {
            throw new Error('invalid_origin');
        }
    } catch {
        origin = new URL(DEFAULT_APP_ORIGIN);
    }
    const url = new URL('/', origin);
    url.searchParams.set('layout', STOCK_SCREENER_LAYOUT);
    return url.toString();
}

export function openStockScreenerLayoutWindow(
    targetWindow: Pick<Window, 'open'> = window,
    appOrigin = window.location.origin,
) {
    targetWindow.open(
        resolveStockScreenerLayoutUrl(appOrigin),
        '_blank',
        'noopener',
    );
}

function targetSignature(targets: ScreenerChartTarget[], contextRevision: string | number) {
    return JSON.stringify([
        String(contextRevision),
        targets.map(({ id, label }) => [id, label]),
    ]);
}

export function startScreenerBridgeHost({
    sourceWindowId,
    getTargets,
    getContextRevision = () => '',
    pick,
    openChart,
    channelFactory = defaultChannelFactory,
    heartbeatMs = 2_000,
}: {
    sourceWindowId: string;
    getTargets: () => ScreenerChartTarget[];
    getContextRevision?: () => string | number;
    pick: (stock: UniverseStock, targetId: string, stillOwnsTarget?: () => boolean) => Promise<boolean>;
    openChart: () => string | undefined;
    channelFactory?: ScreenerChannelFactory;
    heartbeatMs?: number;
}) {
    const channel = channelFactory(STOCK_SCREENER_CHANNEL);
    let revisionNumber = 0;
    let previousSignature = '';
    const snapshot = () => {
        const targets = getTargets();
        const signature = targetSignature(targets, getContextRevision());
        const changed = signature !== previousSignature;
        if (signature !== previousSignature) {
            previousSignature = signature;
            revisionNumber += 1;
        }
        return { targets, targetRevision: String(revisionNumber), changed };
    };
    const post = (message: OutboundBridgeMessage) => channel.postMessage({
        version: STOCK_SCREENER_PROTOCOL_VERSION,
        sourceWindowId,
        ...message,
    });
    const publishTargets = () => {
        const current = snapshot();
        post({ type: 'targets', targets: current.targets, targetRevision: current.targetRevision, sentAt: Date.now() });
    };
    const listener = (event: MessageEvent<unknown>) => {
        const message = parseScreenerBridgeMessage(event.data);
        if (!message || message.sourceWindowId !== sourceWindowId) return;
        if (message.type === 'client-ready' || message.type === 'targets-request') {
            publishTargets();
            return;
        }
        if (message.type !== 'pick-request' && message.type !== 'open-chart-request') return;
        const current = snapshot();
        if (message.targetRevision !== current.targetRevision) {
            post({ type: 'response', requestId: message.requestId, action: message.type === 'pick-request' ? 'pick' : 'open-chart', ok: false, error: '圖表清單已更新，請重新選擇' });
            publishTargets();
            return;
        }
        if (message.type === 'open-chart-request') {
            const targetId = openChart();
            post({ type: 'response', requestId: message.requestId, action: 'open-chart', ok: Boolean(targetId), targetId, error: targetId ? undefined : '無法新增日 K 圖' });
            publishTargets();
            return;
        }
        const acceptedRevision = message.targetRevision;
        void pick(
            message.stock,
            message.targetId,
            () => snapshot().targetRevision === acceptedRevision,
        ).then(
            (ok) => post({ type: 'response', requestId: message.requestId, action: 'pick', ok, error: ok ? undefined : '圖表選擇已取消' }),
            (error: unknown) => post({ type: 'response', requestId: message.requestId, action: 'pick', ok: false, error: error instanceof Error ? error.message : '開啟圖表失敗' }),
        );
    };
    channel.addEventListener('message', listener);
    const timer = setInterval(() => {
        const current = snapshot();
        post({ type: 'heartbeat', targetRevision: current.targetRevision, sentAt: Date.now() });
        if (current.changed) publishTargets();
    }, heartbeatMs);
    return () => {
        clearInterval(timer);
        channel.removeEventListener('message', listener);
        channel.close();
    };
}

export interface ScreenerBridgeClientState {
    connected: boolean;
    targets: ScreenerChartTarget[];
    targetRevision: string;
}

export function startScreenerBridgeClient({
    sourceWindowId,
    onState,
    channelFactory = defaultChannelFactory,
    now = Date.now,
    timeoutMs = 7_000,
}: {
    sourceWindowId: string;
    onState: (state: ScreenerBridgeClientState) => void;
    channelFactory?: ScreenerChannelFactory;
    now?: () => number;
    timeoutMs?: number;
}) {
    const channel = channelFactory(STOCK_SCREENER_CHANNEL);
    let state: ScreenerBridgeClientState = { connected: false, targets: [], targetRevision: '' };
    let lastSeen = 0;
    let requestSequence = 0;
    const pending = new Map<string, { action: 'pick' | 'open-chart'; resolve: (value: boolean | string | undefined) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const publishState = (next: ScreenerBridgeClientState) => {
        state = next;
        onState(next);
    };
    const post = (message: OutboundBridgeMessage) => channel.postMessage({
        version: STOCK_SCREENER_PROTOCOL_VERSION,
        sourceWindowId,
        ...message,
    });
    const listener = (event: MessageEvent<unknown>) => {
        const message = parseScreenerBridgeMessage(event.data);
        if (!message || message.sourceWindowId !== sourceWindowId) return;
        if (message.type === 'targets') {
            lastSeen = now();
            publishState({ connected: true, targets: message.targets, targetRevision: message.targetRevision });
            return;
        }
        if (message.type === 'heartbeat') {
            lastSeen = now();
            if (!state.connected) {
                publishState({ ...state, connected: true, targetRevision: message.targetRevision });
                post({ type: 'targets-request' });
            }
            return;
        }
        if (message.type !== 'response') return;
        const request = pending.get(message.requestId);
        if (!request || request.action !== message.action) return;
        pending.delete(message.requestId);
        clearTimeout(request.timer);
        if (!message.ok) request.reject(new Error(message.error ?? '操作失敗'));
        else request.resolve(message.action === 'open-chart' ? message.targetId : true);
    };
    const request = (action: 'pick' | 'open-chart', payload: object) => {
        if (!state.connected || !state.targetRevision) {
            return Promise.reject(new Error('尚未連接主交易頁'));
        }
        const requestId = `${sourceWindowId}:${++requestSequence}`;
        return new Promise<boolean | string | undefined>((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(requestId);
                reject(new Error('主交易頁回應逾時'));
            }, timeoutMs);
            pending.set(requestId, { action, resolve, reject, timer });
            post(action === 'pick'
                ? { type: 'pick-request', requestId, targetRevision: state.targetRevision, ...(payload as { targetId: string; stock: UniverseStock }) }
                : { type: 'open-chart-request', requestId, targetRevision: state.targetRevision });
        });
    };
    channel.addEventListener('message', listener);
    post({ type: 'client-ready' });
    post({ type: 'targets-request' });
    const watchdog = setInterval(() => {
        if (state.connected && now() - lastSeen > timeoutMs) {
            publishState({ connected: false, targets: [], targetRevision: '' });
        }
    }, Math.min(1_000, timeoutMs));

    return {
        pick: (stock: UniverseStock, targetId: string) => request('pick', { stock, targetId }).then(Boolean),
        openChart: () => request('open-chart', {}).then((value) => typeof value === 'string' ? value : undefined),
        cancel() {
            for (const [requestId, item] of pending) {
                pending.delete(requestId);
                clearTimeout(item.timer);
                item.resolve(false);
            }
        },
        close() {
            this.cancel();
            clearInterval(watchdog);
            channel.removeEventListener('message', listener);
            channel.close();
        },
    };
}
