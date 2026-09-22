import type { Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
export function stockScreenerGateway(fetcher?: typeof fetch, timeoutMs?: number): Plugin;
export function validateScreenerGatewayRequest(req: Pick<IncomingMessage, 'url' | 'method' | 'headers'>): { status?: number; reason?: string; url?: string } | null;
export const STOCK_SCREENER_MULTIVIEW_LIST_PATH: string;
export function validateStockScreenerMultiViewListRequest(req: Pick<IncomingMessage, 'url' | 'method' | 'headers' | 'socket'>): { status?: number; reason?: string; url?: string } | null;
export function validateStockScreenerMultiViewListPayload(value: unknown): { symbol: string } | null;
