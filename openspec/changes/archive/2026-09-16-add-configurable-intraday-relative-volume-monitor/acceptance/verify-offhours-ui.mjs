import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:5173';
const WORKSPACE_URL = `${BASE_URL}/?layout=intraday-stock-selection`;
const SCREENSHOT_DIR = fileURLToPath(new URL('./screenshots/', import.meta.url));

async function readLeaseCount() {
    const response = await fetch(`${BASE_URL}/api/intraday-monitor/v1/status`, { headers: { Accept: 'application/json' } });
    assert.equal(response.ok, true, `status endpoint returned ${response.status}`);
    const value = await response.json();
    return Number(value.lease?.activeLeaseCount ?? 0);
}

function observe(page) {
    const evidence = { pageErrors: [], consoleErrors: [], badResponses: [] };
    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });
    page.on('response', (response) => {
        if (response.status() >= 400) {
            const url = new URL(response.url());
            evidence.badResponses.push(`${response.status()} ${url.pathname}`);
        }
    });
    return evidence;
}

async function openReadyPage(browser, viewport, { fontScale = 1, offline = false } = {}) {
    const context = await browser.newContext({ viewport, permissions: [] });
    const page = await context.newPage();
    const observed = observe(page);
    if (offline) {
        await page.route('**/api/intraday-monitor/v1/**', (route) => route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ reason: 'acceptance_fixture_offline' }),
        }));
    }
    await page.goto(WORKSPACE_URL, { waitUntil: 'domcontentloaded' });
    if (fontScale !== 1) {
        await page.addStyleTag({ content: `html { font-size: ${fontScale * 100}% !important; }` });
    }
    await page.getByTestId('intraday-monitor-panel').waitFor();
    await page.waitForTimeout(700);
    return { context, page, observed };
}

async function measureWorkspace(page) {
    return page.evaluate(() => {
        const monitor = document.querySelector('[data-testid="intraday-monitor-panel"]');
        const chart = [...document.querySelectorAll('section')].find((element) => element.textContent?.includes('K 線圖 ·'));
        if (!(monitor instanceof Element)) throw new Error('missing monitor panel');
        if (!(chart instanceof Element)) throw new Error('missing chart panel');
        const monitorBox = monitor.getBoundingClientRect();
        const chartBox = chart.getBoundingClientRect();
        return {
            document: {
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
                scrollHeight: document.documentElement.scrollHeight,
                clientHeight: document.documentElement.clientHeight,
            },
            monitor: {
                x: monitorBox.x,
                y: monitorBox.y,
                width: monitorBox.width,
                height: monitorBox.height,
                scrollHeight: monitor.scrollHeight,
                clientHeight: monitor.clientHeight,
            },
            chart: {
                x: chartBox.x,
                y: chartBox.y,
                width: chartBox.width,
                height: chartBox.height,
                scrollWidth: chart.scrollWidth,
                clientWidth: chart.clientWidth,
            },
        };
    });
}

function findUnexpectedConsoleErrors(observed, baselineConsoleErrors, allowed = []) {
    const allowedMessages = new Set([...baselineConsoleErrors, ...allowed]);
    return observed.consoleErrors.filter((message) => !allowedMessages.has(message));
}

async function verifyViewport(browser, baselineBadResponses, baselineConsoleErrors, scenario) {
    const opened = await openReadyPage(browser, scenario.viewport, { fontScale: scenario.fontScale });
    const { context, page, observed } = opened;
    try {
        const measurement = await measureWorkspace(page);
        assert.equal(measurement.document.scrollWidth, measurement.document.clientWidth, `${scenario.name}: document overflows horizontally`);
        assert.equal(measurement.document.scrollHeight, measurement.document.clientHeight, `${scenario.name}: document escapes viewport height`);
        assert.equal(await page.getByRole('button', { name: '開啟頁內提示音' }).count(), 1);
        assert.equal(await page.getByRole('button', { name: '開啟系統通知' }).count(), 1);
        assert.equal(await page.getByRole('button', { name: '1D', exact: true }).count(), 1);
        assert.match(await page.locator('body').innerText(), /等待 Gate 0/);
        if (scenario.sideBySide) {
            assert.ok(measurement.chart.x > measurement.monitor.x + measurement.monitor.width, `${scenario.name}: chart is not beside monitor`);
        } else {
            const chart = page.locator('section').filter({ hasText: 'K 線圖 ·' }).last();
            await chart.scrollIntoViewIfNeeded();
            assert.equal(await chart.isVisible(), true, `${scenario.name}: chart is not reachable`);
        }
        assert.deepEqual(observed.pageErrors, [], `${scenario.name}: uncaught page errors`);
        const unexpectedResponses = observed.badResponses.filter((entry) => !baselineBadResponses.has(entry));
        const unexpectedConsoleErrors = findUnexpectedConsoleErrors(observed, baselineConsoleErrors);
        assert.deepEqual(unexpectedResponses, [], `${scenario.name}: new HTTP failures`);
        assert.deepEqual(unexpectedConsoleErrors, [], `${scenario.name}: new console errors`);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/${scenario.name}.png`, fullPage: false });
        return { ...scenario, measurement, observed, unexpectedResponses, unexpectedConsoleErrors };
    } finally {
        await context.close();
    }
}

async function verifyOffline(browser, baselineBadResponses, baselineConsoleErrors) {
    const { context, page, observed } = await openReadyPage(browser, { width: 1280, height: 768 }, { offline: true });
    try {
        const body = await page.locator('body').innerText();
        assert.match(body, /本機監控 API 離線/);
        assert.match(body, /K 線圖 ·/);
        assert.equal(await page.getByRole('button', { name: '1D', exact: true }).count(), 1);
        assert.deepEqual(observed.pageErrors, []);
        const unexpectedResponses = observed.badResponses.filter((entry) =>
            !baselineBadResponses.has(entry) && !entry.includes('/api/intraday-monitor/v1/'));
        const unexpectedConsoleErrors = findUnexpectedConsoleErrors(observed, baselineConsoleErrors, [
            'Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
        ]);
        assert.deepEqual(unexpectedResponses, []);
        assert.deepEqual(unexpectedConsoleErrors, []);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/offline.png`, fullPage: false });
        return { bodyConfirmed: true, observed, unexpectedResponses, unexpectedConsoleErrors };
    } finally {
        await context.close();
    }
}

async function verifyNotificationDenied(browser, baselineBadResponses, baselineConsoleErrors) {
    const { context, page, observed } = await openReadyPage(browser, { width: 1280, height: 768 });
    try {
        await page.getByRole('button', { name: '開啟系統通知' }).click();
        const body = await page.locator('body').innerText();
        assert.match(body, /系統通知：權限已拒絕/);
        assert.match(body, /不會重複要求/);
        assert.equal(await page.getByRole('button', { name: '開啟系統通知' }).getAttribute('aria-pressed'), 'false');
        assert.deepEqual(observed.pageErrors, []);
        assert.deepEqual(observed.badResponses.filter((entry) => !baselineBadResponses.has(entry)), []);
        assert.deepEqual(findUnexpectedConsoleErrors(observed, baselineConsoleErrors), []);
        return { deniedStateVisible: true, observed };
    } finally {
        await context.close();
    }
}

async function verifyPopupBlocked(browser, baselineBadResponses, baselineConsoleErrors) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 768 } });
    await context.addInitScript(() => {
        window.open = () => null;
        window.alert = (message) => { window.__intradayPopupWarning = String(message); };
    });
    const page = await context.newPage();
    const observed = observe(page);
    try {
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: '版面', exact: true }).click();
        await page.locator('button[title="在新分頁開啟盤中監控與連動 K 線，不變更目前版面"]').click();
        const warning = await page.evaluate(() => window.__intradayPopupWarning ?? '');
        assert.match(warning, /請允許彈出視窗後重試/);
        assert.equal(page.url(), `${BASE_URL}/`);
        assert.deepEqual(observed.pageErrors, []);
        assert.deepEqual(observed.badResponses.filter((entry) => !baselineBadResponses.has(entry)), []);
        assert.deepEqual(findUnexpectedConsoleErrors(observed, baselineConsoleErrors), []);
        return { warning, sourceUrlUnchanged: true, observed };
    } finally {
        await context.close();
    }
}

async function verifyMultiTabLease(browser, baselineBadResponses, baselineConsoleErrors) {
    const before = await readLeaseCount();
    const context = await browser.newContext({ viewport: { width: 1280, height: 768 } });
    const first = await context.newPage();
    const second = await context.newPage();
    const firstObserved = observe(first);
    const secondObserved = observe(second);
    await Promise.all([
        first.goto(WORKSPACE_URL, { waitUntil: 'domcontentloaded' }),
        second.goto(WORKSPACE_URL, { waitUntil: 'domcontentloaded' }),
    ]);
    await Promise.all([
        first.getByTestId('intraday-monitor-panel').waitFor(),
        second.getByTestId('intraday-monitor-panel').waitFor(),
    ]);
    await first.waitForTimeout(700);
    const during = await readLeaseCount();
    assert.ok(during >= before + 2, `expected two additional leases: before=${before}, during=${during}`);
    assert.deepEqual(firstObserved.pageErrors, []);
    assert.deepEqual(secondObserved.pageErrors, []);
    assert.deepEqual(firstObserved.badResponses.filter((entry) => !baselineBadResponses.has(entry)), []);
    assert.deepEqual(secondObserved.badResponses.filter((entry) => !baselineBadResponses.has(entry)), []);
    assert.deepEqual(findUnexpectedConsoleErrors(firstObserved, baselineConsoleErrors), []);
    assert.deepEqual(findUnexpectedConsoleErrors(secondObserved, baselineConsoleErrors), []);
    await context.close();
    await new Promise((resolve) => setTimeout(resolve, 16_000));
    const afterTtl = await readLeaseCount();
    assert.ok(afterTtl <= before, `lease TTL did not recover: before=${before}, after=${afterTtl}`);
    return { before, during, afterTtl };
}

async function main() {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
        const baselineContext = await browser.newContext({ viewport: { width: 1280, height: 768 } });
        const baselinePage = await baselineContext.newPage();
        const baselineObserved = observe(baselinePage);
        await baselinePage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        await baselinePage.waitForTimeout(700);
        const baselineBadResponses = new Set(baselineObserved.badResponses);
        const baselineConsoleErrors = new Set(baselineObserved.consoleErrors);
        await baselineContext.close();

        const viewports = [];
        for (const scenario of [
            { name: 'desktop-1440x900', viewport: { width: 1440, height: 900 }, fontScale: 1, sideBySide: true },
            { name: 'short-1024x600', viewport: { width: 1024, height: 600 }, fontScale: 1, sideBySide: true },
            { name: 'height-900x768', viewport: { width: 900, height: 768 }, fontScale: 1, sideBySide: true },
            { name: 'narrow-390x844', viewport: { width: 390, height: 844 }, fontScale: 1, sideBySide: false },
            { name: 'large-font-1024x600', viewport: { width: 1024, height: 600 }, fontScale: 1.5, sideBySide: true },
        ]) {
            viewports.push(await verifyViewport(browser, baselineBadResponses, baselineConsoleErrors, scenario));
        }

        const result = {
            schemaVersion: 'intraday-monitor-offhours-ui-acceptance/1',
            observedAt: new Date().toISOString(),
            target: WORKSPACE_URL,
            baselineBadResponses: [...baselineBadResponses],
            baselineConsoleErrors: [...baselineConsoleErrors],
            viewports,
            offline: await verifyOffline(browser, baselineBadResponses, baselineConsoleErrors),
            notificationDenied: await verifyNotificationDenied(browser, baselineBadResponses, baselineConsoleErrors),
            popupBlocked: await verifyPopupBlocked(browser, baselineBadResponses, baselineConsoleErrors),
            multiTabLease: await verifyMultiTabLease(browser, baselineBadResponses, baselineConsoleErrors),
            brokerWriteAttempts: 0,
            serviceLifecycleMutations: 0,
            productionSwitches: 0,
        };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
        await browser.close();
    }
}

await main();
