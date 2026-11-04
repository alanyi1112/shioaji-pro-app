/** 本機 Vite 的互動式 K 線不與盤中監控 SSE 爭用同一 HTTP/1.1 連線池。 */
export function kbarRequestBase(
    apiBase: string,
    pageOrigin: string,
    useDevProxy: boolean,
    packaged: boolean,
): string {
    if (apiBase || !useDevProxy || packaged || !pageOrigin) return apiBase;
    const url = new URL(pageOrigin);
    // 僅使用既有 Vite listener 的等價 loopback hostname，不改 port／來源服務。
    if (url.protocol !== 'http:' || url.username || url.password) return apiBase;
    if (url.hostname === '127.0.0.1') url.hostname = 'localhost';
    else if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    else return apiBase;
    return url.origin;
}
