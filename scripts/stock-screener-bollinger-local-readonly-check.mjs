/** 真實本機 HTTP／UI 的唯讀診斷；隔離 browser storage，禁止寫入或 broker 路徑。 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:5173';
const mode = process.argv[3] ?? 'schema-pending';
assert(['schema-pending', 'initialized-disabled', 'published'].includes(mode), 'invalid_readonly_check_mode');
const browser = await chromium.launch({ headless: true });
const requests = [], blocked = [], errors = [], consoleMessages = [];
try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleMessages.push({ text: m.text(), url: m.location().url }); });
    await page.route('**/api/**', async route => {
        const r = route.request(), u = new URL(r.url());
        if (r.method() !== 'GET' || u.origin !== origin || !/^\/api\/stock-screener\/(status|results|daily-profile)$/.test(u.pathname)) {
            blocked.push({ method: r.method(), path: u.pathname }); await route.abort(); return;
        }
        requests.push({ method: r.method(), path: u.pathname, version: u.searchParams.get('version') });
        await route.continue();
    });
    const profilePromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/stock-screener/daily-profile'
        && new URL(r.url()).searchParams.get('version') === '8');
    await page.goto(`${origin}/?popout=screener`);
    const profileResponse = await profilePromise;
    if (mode === 'schema-pending') {
        assert.equal(profileResponse.status(), 503);
        await page.getByText('每日設定接口尚未就緒；不影響舊版選股。', { exact: true }).waitFor({ timeout: 10000 });
    } else if (mode === 'initialized-disabled') {
        assert.equal(profileResponse.status(), 200);
        assert.deepEqual(await profileResponse.json(), { version: 8, profile: null });
    } else {
        assert.equal(profileResponse.status(), 200);
        const saved = await profileResponse.json();
        assert.equal(saved.version, 8); assert.equal(saved.profile.revision, 1); assert.equal(saved.profile.enabled, true);
    }
    await page.getByRole('button', { name: '全部取消', exact: true }).click();
    await page.getByRole('button', { name: /技術型態 0 \/ 11/ }).click();
    await page.getByRole('checkbox', { name: '啟用布林壓縮與突破', exact: true }).check();
    const resultPromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/stock-screener/results'
        && new URL(r.url()).searchParams.get('version') === '8');
    await page.getByRole('button', { name: '開始篩選', exact: true }).click();
    const result = await resultPromise, payload = await result.json();
    console.log(JSON.stringify({ responseStatus: result.status(), responseState: payload.state, responseReason: payload.reason,
        rows: payload.rows?.length, rawConsole: consoleMessages, blocked, pageErrors: errors }));
    if (mode === 'published') console.log(JSON.stringify({ renderedPanel: await page.getByTestId('stock-screener-panel').innerText() }));
    await page.getByRole('region', { name: '布林三階段結果', exact: true }).waitFor();
    assert.equal(payload.version, 8); assert.equal(payload.state, mode === 'published' ? 'ready' : 'pending');
    if (mode !== 'published') assert.equal(payload.reason, mode === 'schema-pending' ? 'schema_pending' : 'v8_preparation_pending');
    console.log(JSON.stringify({ rawConsole: consoleMessages, blocked, pageErrors: errors }));
    if (mode !== 'published') assert.equal(payload.rows.length, 0);
    else { assert.equal(payload.rows.length, 16); assert.equal(payload.counts.total.total, 1977);
        assert.equal(payload.canUseResults, true); assert.equal(payload.effectiveSessionDate, '2026-10-02');
        assert.equal(payload.sourceEvidence.selections.length, 320); }
    assert.equal(blocked.length, 0); assert.equal(errors.length, 0);
    if (mode === 'schema-pending') {
        assert(consoleMessages.every(m => m.text.includes('503') && m.url.includes('/api/stock-screener/daily-profile')));
        assert.equal(await page.getByRole('button', { name: '套用至每日自動篩選', exact: true }).isDisabled(), true);
    } else assert.equal(consoleMessages.length, 0);
    assert.equal(requests.filter(r => r.path.endsWith('/results') && r.version === '8').length, 1);
    const ui = await page.getByRole('region', { name: '布林三階段結果', exact: true }).innerText();
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), scope: `actual-local-readonly-${mode}`,
        status: result.status(), state: payload.state, reason: payload.reason, rows: payload.rows.length,
        requests, nonGet: requests.filter(r => r.method !== 'GET').length, blocked, pageErrors: errors, consoleMessages, ui,
        limitation: mode === 'published' ? '真正發布與唯讀 UI；隔離頁沒有圖表目標，不能代替指定圖表／兩套清單操作驗收'
            : '沒有正式發布；不能代替指定圖表／兩套清單操作或來源驗收' }, null, 2));
    if (process.argv[2]) { await page.getByRole('region', { name: '布林三階段結果', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: process.argv[2], fullPage: false }); }
} finally { await browser.close(); }
