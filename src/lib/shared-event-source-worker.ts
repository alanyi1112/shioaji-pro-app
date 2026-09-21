// One transport per URL across same-origin windows. No persisted messages.
const channels = new Map<string, { source: EventSource; ports: Set<MessagePort> }>();
const events = ['tick_stk', 'tick_fop', 'bidask_stk', 'bidask_fop', 'quote_idx', 'order_event', 'heartbeat', 'contract_event'];
const scope = self as unknown as { onconnect: (event: MessageEvent) => void; location: Location };
scope.onconnect = (event) => {
    const port = event.ports[0]!;
    let attached: string | null = null;
    const detach = () => {
        const channel = attached ? channels.get(attached) : undefined;
        if (channel) {
            channel.ports.delete(port);
            if (!channel.ports.size) { channel.source.close(); channels.delete(attached!); }
        }
        attached = null;
    };
    port.onmessage = ({ data }) => {
        if (data?.action === 'close') { detach(); port.close(); return; }
        if (data?.action !== 'open' || attached || typeof data.url !== 'string') return;
        const url = new URL(data.url, scope.location.href);
        // Sharing is confined to our existing same-origin quote/contract routes.
        if (url.origin !== scope.location.origin || !['/api/v1/stream/data', '/api/v1/stream/data/contract_event'].includes(url.pathname)) return;
        attached = url.href;
        let channel = channels.get(attached);
        if (!channel) {
            const source = new EventSource(attached);
            channel = { source, ports: new Set() };
            channels.set(attached, channel);
            const recipients = channel.ports;
            const emit = (type: string, data = '') => {
                for (const recipient of recipients) recipient.postMessage({ type, data });
            };
            source.onopen = () => emit('open');
            source.onerror = () => emit('error');
            for (const type of events) source.addEventListener(type, event => emit(type, (event as MessageEvent).data));
        }
        channel.ports.add(port);
        if (channel.source.readyState === EventSource.OPEN) port.postMessage({ type: 'open' });
    };
    port.start();
};
export {};
