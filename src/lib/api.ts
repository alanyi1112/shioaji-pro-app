// src/lib/api.ts

import { getApiBase, isTauri } from './runtime';
import { assertRuntimeAllowsRequest } from './runtime-mode';

// resolved per request — the server port can move at runtime (e.g. the boot
// flow discovers the default port occupied and starts on a fallback), and a
// module-load-time capture kept every request on the dead old port
// (the stuck-at-載入交易終端 bug)
const base = () => getApiBase();

// The desktop webview enforces CORS but the shioaji server doesn't answer
// preflight OPTIONS (405) — route requests through Tauri's Rust-side fetch,
// which has no CORS, when running in the app.
async function doFetch(url: string, init?: RequestInit): Promise<Response> {
    if (isTauri) {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        return tauriFetch(url, init);
    }
    return fetch(url, init);
}

// shioaji errors come back as JSON: {"code":400,"message":"...","details":...}
// surface that message instead of a bare "400 Bad Request" — the message is
// what tells you it's CA / unsigned account / bad params (issue #1 support)
async function throwApiError(res: Response): Promise<never> {
    let detail = '';
    try {
        const data = (await res.json()) as {
            message?: string;
            details?: unknown;
        };
        detail =
            data.message ??
            (typeof data.details === 'string' ? data.details : '');
        if (data.details && typeof data.details !== 'string') {
            detail += ` ${JSON.stringify(data.details)}`;
        }
    } catch {
        // non-JSON body — fall back to status text
    }
    throw new Error(
        `${res.status} ${detail || res.statusText}`.trim(),
    );
}

export async function apiGet<T>(path: string): Promise<T> {
    const res = await doFetch(base() + path);
    if (!res.ok) await throwApiError(res);
    return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
    assertRuntimeAllowsRequest(path, 'POST');
    const res = await doFetch(base() + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) await throwApiError(res);
    return res.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
    assertRuntimeAllowsRequest(path, 'PUT');
    const res = await doFetch(base() + path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) await throwApiError(res);
    return res.json() as Promise<T>;
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
    assertRuntimeAllowsRequest(path, 'DELETE');
    const res = await doFetch(base() + path, {
        method: 'DELETE',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) await throwApiError(res);
    return res.json() as Promise<T>;
}

export class BoundedApiError extends Error {
    constructor(public readonly status: number, public readonly retryAfterMs: number | null) {
        super(`歷史成交查詢失敗 (${status})`);
        this.name = 'BoundedApiError';
    }
}

function retryAfterMs(response: Response): number | null {
    const value = response.headers.get('retry-after');
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const at = Date.parse(value);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

// Bounded historical payloads: timeout covers headers AND body consumption.
export async function apiPostBounded<T>(path: string, body: unknown, maxBytes: number, timeoutMs: number): Promise<T> {
    assertRuntimeAllowsRequest(path, 'POST');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const request = async () => {
        const response = await doFetch(base() + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: controller.signal,
        });
        if (!response.ok) {
            void response.body?.cancel().catch(() => undefined);
            throw new BoundedApiError(response.status, retryAfterMs(response));
        }
        if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('歷史成交超過回應容量預算');
        if (!response.body) throw new Error('歷史成交回應沒有內容串流');
        const reader = response.body.getReader();
        activeReader = reader;
        const decoder = new TextDecoder();
        const parts: string[] = [];
        let bytes = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > maxBytes) throw new Error('歷史成交超過回應容量預算');
                parts.push(decoder.decode(value, { stream: true }));
            }
            parts.push(decoder.decode());
            return JSON.parse(parts.join('')) as T;
        } finally { void reader.cancel().catch(() => undefined); }
    };
    try {
        return await Promise.race([request(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('歷史成交查詢逾時')); }, timeoutMs);
        })]);
    } finally { clearTimeout(timer!); controller.abort(); void activeReader?.cancel().catch(() => undefined); }
}
