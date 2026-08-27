import { describe, expect, it } from 'vitest';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import { startSmartOrderTask0406LiveObserver } from './task0-4-0-6-live-observer.mjs';

const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});

function withIdentity(response, url) {
    Object.defineProperty(response, 'url', { value: url });
    Object.defineProperty(response, 'redirected', { value: false });
    return response;
}

function fixture({ subscriptionAccount = account } = {}) {
    const traces = [];
    const streams = [];
    const fetchImpl = async (url, init = {}) => {
        traces.push({ url, method: init.method, body: init.body });
        if (url.endsWith('/api/v1/auth/subscribe_trade')) {
            return withIdentity(
                new Response(
                    JSON.stringify({
                        subscribe_trade: true,
                        account: subscriptionAccount,
                    }),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
                url,
            );
        }
        if (url.endsWith('/api/v1/stream/data/order_event')) {
            let controller;
            const stream = new ReadableStream({
                start(value) {
                    controller = value;
                },
            });
            streams.push(controller);
            return withIdentity(
                new Response(stream, {
                    status: 200,
                    headers: { 'content-type': 'text/event-stream' },
                }),
                url,
            );
        }
        throw new Error('unexpected observer fixture request');
    };
    return { fetchImpl, streams, traces };
}

function sse(payload) {
    return new TextEncoder().encode(
        `event: order_event\ndata: ${JSON.stringify(payload)}\n\n`,
    );
}

describe('Task 0.4/0.6 observer-before-authorization barrier', () => {
    it('keeps a healthy stream eligible for the five-minute envelope but still expires fail-closed', async () => {
        const current = fixture();
        let nowEpochMs = Date.parse('2026-08-26T04:00:00.000Z');
        const observer = await startSmartOrderTask0406LiveObserver({
            account,
            accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account),
            fetchImpl: current.fetchImpl,
            now: () => nowEpochMs,
        });
        try {
            nowEpochMs += 61_000;
            await expect(
                observer.revalidateReady({ minimumRemainingMs: 15_000 }),
            ).resolves.toMatchObject({ current: true });
            nowEpochMs += 225_000;
            await expect(
                observer.revalidateReady({ minimumRemainingMs: 15_000 }),
            ).rejects.toThrow('not current');
        } finally {
            await observer.close();
        }
    });

    it('opens pre-subscription stream, binds the fixed account, then collects only post-boundary events', async () => {
        const current = fixture();
        const observer = await startSmartOrderTask0406LiveObserver({
            account,
            accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account),
            fetchImpl: current.fetchImpl,
        });
        try {
            expect(current.traces.map((trace) => trace.method)).toEqual([
                'GET',
                'POST',
                'GET',
            ]);
            expect(JSON.parse(current.traces[1].body)).toEqual(account);
            expect(await observer.revalidateReady({ minimumRemainingMs: 1_000 })).toMatchObject({
                current: true,
                brokerAuthority: false,
            });
            const boundary = observer.markDispatchBoundary();
            current.streams[1].enqueue(sse({ state: 'StockOrder', data: {} }));
            current.streams[1].enqueue(sse({ state: 'StockDeal', data: {} }));
            const events = await observer.collect({
                afterIndex: boundary,
                minimumEvents: 2,
                settleMs: 0,
                timeoutMs: 1_000,
            });
            expect(events.map((event) => event.state)).toEqual([
                'StockOrder',
                'StockDeal',
            ]);
        } finally {
            await observer.close();
        }
    });

  it('fails closed before readiness on subscription account drift', async () => {
        const current = fixture({
            subscriptionAccount: { ...account, account_id: 'OTHER' },
        });
        await expect(
            startSmartOrderTask0406LiveObserver({
                account,
                accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account),
                fetchImpl: current.fetchImpl,
            }),
        ).rejects.toThrow('account-bound');
    expect(current.traces).toHaveLength(2);
  });

  it('does not finish a Filled profile on unrelated/order-only events before the exact deal arrives', async () => {
    const current = fixture();
    const observer = await startSmartOrderTask0406LiveObserver({
      account,
      accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account),
      fetchImpl: current.fetchImpl,
    });
    try {
      const boundary = observer.markDispatchBoundary();
      const collected = observer.collectExact({
        afterIndex: boundary,
        expectedCustomField: 'ABC123',
        expectedDeal: true,
        expectedSeqno: 'SEQ-1',
        expectedTradeId: 'TRADE-1',
        settleMs: 0,
        timeoutMs: 1_000,
      });
      current.streams[1].enqueue(sse({
        state: 'StockOrder',
        data: { StockOrder: { order: { id: 'OTHER', seqno: 'SEQ-X' } } },
      }));
      current.streams[1].enqueue(sse({
        state: 'StockOrder',
        data: {
          StockOrder: {
            order: { id: 'TRADE-1', seqno: 'SEQ-1', custom_field: 'ABC123' },
          },
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 5));
      current.streams[1].enqueue(sse({
        state: 'StockDeal',
        data: { StockDeal: { trade_id: 'TRADE-1', seqno: 'SEQ-1' } },
      }));
      const result = await collected;
      expect(result).toMatchObject({
        complete: true,
        orderObserved: true,
        dealObserved: true,
        brokerAuthority: false,
      });
      expect(result.events).toHaveLength(3);
    } finally {
      await observer.close();
    }
  });
});
