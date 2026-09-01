import type { Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
export function stockScreenerGateway(fetcher?: typeof fetch, timeoutMs?: number): Plugin;
export function validateScreenerGatewayRequest(req: Pick<IncomingMessage, 'url' | 'method' | 'headers'>): { status?: number; reason?: string; url?: string } | null;
