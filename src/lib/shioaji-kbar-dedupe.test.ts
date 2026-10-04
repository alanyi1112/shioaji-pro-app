import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    apiPost: vi.fn(),
}));

vi.mock('./api', () => ({
    apiDelete: vi.fn(),
    apiGet: vi.fn(),
    apiPost: mocks.apiPost,
    apiPostWithTimeout: vi.fn(),
    apiPut: vi.fn(),
}));

import { fetchKbars } from './shioaji';
import type { ContractBase } from './types/contract';
import type { KBars } from './types/market';

const contract: ContractBase = {
    security_type: 'STK',
    region: 'TW',
    exchange: 'TSE',
    code: '2330',
    target_code: null,
};

const payload: KBars = {
    datetime: [],
    Open: [],
    High: [],
    Low: [],
    Close: [],
    Volume: [],
    Amount: [],
};

describe('K 線請求 single-flight', () => {
    beforeEach(() => mocks.apiPost.mockReset());

    it('同商品同日期範圍的並行圖表共用一個 API request，完成後允許刷新', async () => {
        let resolveRequest!: (value: KBars) => void;
        mocks.apiPost.mockReturnValueOnce(
            new Promise<KBars>((resolve) => {
                resolveRequest = resolve;
            }),
        );

        const first = fetchKbars(contract, '2026-01-01', '2026-09-23');
        const second = fetchKbars(contract, '2026-01-01', '2026-09-23');

        expect(mocks.apiPost).toHaveBeenCalledTimes(1);
        resolveRequest(payload);
        await expect(first).resolves.toBe(payload);

        mocks.apiPost.mockResolvedValueOnce(payload);
        await fetchKbars(contract, '2026-01-01', '2026-09-23');
        expect(mocks.apiPost).toHaveBeenCalledTimes(2);
    });

    it('快速換股時等最後一個圖表離開才中止共用 request', async () => {
        let resolveRequest!: (value: KBars) => void;
        mocks.apiPost.mockReturnValueOnce(
            new Promise<KBars>((resolve) => {
                resolveRequest = resolve;
            }),
        );
        const firstController = new AbortController();
        const secondController = new AbortController();
        const first = fetchKbars(
            contract,
            '2026-01-01',
            '2026-09-23',
            firstController.signal,
        );
        const second = fetchKbars(
            contract,
            '2026-01-01',
            '2026-09-23',
            secondController.signal,
        );

        firstController.abort();
        await expect(first).rejects.toMatchObject({ name: 'AbortError' });
        expect(
            (mocks.apiPost.mock.calls[0]?.[2] as { signal: AbortSignal }).signal
                .aborted,
        ).toBe(false);

        resolveRequest(payload);
        await expect(second).resolves.toBe(payload);
        expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    });

    it('所有圖表都已換股時中止已無人使用的舊 request', async () => {
        mocks.apiPost.mockImplementationOnce(
            (
                _path: string,
                _body: unknown,
                options: { signal: AbortSignal },
            ) =>
                new Promise<KBars>((_resolve, reject) => {
                    options.signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('aborted', 'AbortError')),
                        { once: true },
                    );
                }),
        );
        const firstController = new AbortController();
        const secondController = new AbortController();
        const first = fetchKbars(
            contract,
            '2026-01-01',
            '2026-09-23',
            firstController.signal,
        );
        const second = fetchKbars(
            contract,
            '2026-01-01',
            '2026-09-23',
            secondController.signal,
        );
        const sharedSignal = (
            mocks.apiPost.mock.calls[0]?.[2] as { signal: AbortSignal }
        ).signal;

        firstController.abort();
        await expect(first).rejects.toMatchObject({ name: 'AbortError' });
        expect(sharedSignal.aborted).toBe(false);

        secondController.abort();
        await expect(second).rejects.toMatchObject({ name: 'AbortError' });
        expect(sharedSignal.aborted).toBe(true);
    });
});
