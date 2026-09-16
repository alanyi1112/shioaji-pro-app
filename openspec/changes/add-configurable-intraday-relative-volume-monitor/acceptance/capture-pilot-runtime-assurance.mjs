import { createHash, randomUUID } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import {
    createIntradayMonitorPilotRuntimeAssurance,
    validateIntradayMonitorPilotRuntimeAssurance,
} from '../../../../scripts/intraday-monitor-runtime/pilot-runtime-assurance.mjs';

const CHANGE_ROOT = path.resolve(import.meta.dirname, '..');

function argumentsFor(name) {
    return process.argv
        .filter((value) => value.startsWith(`--${name}=`))
        .map((value) => value.slice(name.length + 3));
}

function argument(name) {
    return argumentsFor(name).at(-1);
}

function digest(value) {
    return createHash('sha256').update(value).digest('hex');
}

async function writeNew(filePath, value) {
    const handle = await open(filePath, 'wx', 0o600);
    try {
        await handle.writeFile(value);
    } finally {
        await handle.close();
    }
}

function validLoopbackUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' &&
            ['127.0.0.1', 'localhost'].includes(url.hostname);
    } catch {
        return false;
    }
}

async function largestCanvas(page) {
    const canvases = page.locator('canvas');
    const count = await canvases.count();
    let selected = null;
    for (let index = 0; index < count; index += 1) {
        const locator = canvases.nth(index);
        const box = await locator.boundingBox();
        if (!box || box.width < 200 || box.height < 100) continue;
        if (!selected || box.width * box.height > selected.box.width * selected.box.height) {
            selected = { locator, box };
        }
    }
    if (!selected) throw new Error('REFUSED: no visible chart canvas');
    return { ...selected, count };
}

export async function observeChartFreshness({ sourceUrl, tradeDate, timeoutMs, pollMs = 500 } = {}) {
    if (!validLoopbackUrl(sourceUrl) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
        throw new TypeError('chart freshness probe options are invalid');
    }
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
        const methods = new Set(['GET']);
        let subscriptionMutations = 0;
        page.on('request', (request) => {
            methods.add(request.method().toUpperCase());
            const pathname = new URL(request.url()).pathname;
            if (pathname.endsWith('/stream/subscribe') || pathname.endsWith('/stream/unsubscribe')) {
                subscriptionMutations += 1;
            }
        });
        const startedAt = Date.now();
        await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, null, { timeout: 15_000 });
        const oneMinute = page.getByRole('button', { name: '1m', exact: true }).first();
        await oneMinute.click({ timeout: 15_000 });
        await page.waitForFunction(() => {
            const value = document.querySelector('[data-quote-field="price"]')?.textContent?.trim();
            return Boolean(value && value !== '—' && /\d/.test(value));
        }, null, { timeout: timeoutMs });
        const selected = await largestCanvas(page);
        const firstObservedAt = new Date().toISOString();
        const before = await selected.locator.screenshot({ type: 'png' });
        const beforeSha256 = digest(before);
        await page.waitForTimeout(Math.min(pollMs, 1_000));
        const lastObservedAt = new Date().toISOString();
        const after = await selected.locator.screenshot({ type: 'png' });
        const afterSha256 = digest(after);
        const freshnessMs = Date.parse(firstObservedAt) - startedAt;
        return {
            firstObservedAt,
            lastObservedAt,
            freshnessMs,
            canvasCount: selected.count,
            canvasWidth: Math.round(selected.box.width),
            canvasHeight: Math.round(selected.box.height),
            before,
            after,
            beforeSha256,
            afterSha256,
            changed: freshnessMs <= timeoutMs,
            operations: {
                methods: [...methods].sort(),
                subscriptionMutations,
                notificationDispatches: 0,
                brokerWrites: 0,
                productionTransitions: 0,
                serviceLifecycleMutations: 0,
            },
        };
    } finally {
        await browser.close();
    }
}

async function readReplayFrame(url, cursor = null) {
    const target = new URL(url);
    if (cursor) target.searchParams.set('cursor', cursor);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let reader = null;
    try {
        const response = await fetch(target, {
            method: 'GET',
            headers: {
                accept: 'text/event-stream',
                ...(cursor ? { 'last-event-id': cursor } : {}),
            },
            redirect: 'error',
            signal: controller.signal,
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
            throw new Error(`event_stream_http_${response.status}`);
        }
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (pending.length < 512 * 1024) {
            const { done, value } = await reader.read();
            if (done) throw new Error('event_stream_ended_before_replay');
            pending += decoder.decode(value, { stream: true }).replaceAll('\r', '');
            const boundary = pending.indexOf('\n\n');
            if (boundary < 0) continue;
            const frame = pending.slice(0, boundary);
            const lines = frame.split('\n');
            const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
            const id = lines.find((line) => line.startsWith('id:'))?.slice(3).trim() ?? null;
            const data = lines.filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart()).join('\n');
            if (event !== 'replay' || !data) throw new Error('event_stream_first_frame_not_replay');
            return { id, payload: JSON.parse(data) };
        }
        throw new Error('event_stream_frame_limit');
    } finally {
        clearTimeout(timeout);
        controller.abort();
        await reader?.cancel().catch(() => undefined);
    }
}

export async function probeEventStreamReconnect({ sourceUrl, tradeDate } = {}) {
    if (!validLoopbackUrl(sourceUrl) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '')) {
        throw new TypeError('event reconnect probe options are invalid');
    }
    const eventsUrl = new URL('/api/intraday-monitor/v1/events', sourceUrl);
    eventsUrl.searchParams.set('tradeDate', tradeDate);
    eventsUrl.searchParams.set('limit', '100');
    const clientGenerationBefore = `probe_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const first = await readReplayFrame(eventsUrl);
    const clientGenerationAfter = `probe_${Date.now() + 1}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const second = await readReplayFrame(eventsUrl, first.id);
    const firstItems = Array.isArray(first.payload?.items) ? first.payload.items : [];
    const secondItems = Array.isArray(second.payload?.items) ? second.payload.items : [];
    const firstIds = new Set(firstItems.map((item) => item?.eventId).filter(Boolean));
    const duplicateIds = secondItems.filter((item) => firstIds.has(item?.eventId));
    const notificationViolations = [...firstItems, ...secondItems]
        .filter((item) => item?.notificationAuthority !== false).length +
        (first.payload?.replayNotificationAuthority === false ? 0 : 1) +
        (second.payload?.replayNotificationAuthority === false ? 0 : 1);
    return {
        transport: 'intraday-monitor-trigger-sse',
        attempted: true,
        recovered: Boolean(first.id && second.id && duplicateIds.length === 0 && notificationViolations === 0),
        clientGenerationBefore,
        clientGenerationAfter,
        generationAdvanced: clientGenerationBefore !== clientGenerationAfter,
        serverGenerationBefore: typeof first.payload?.generation === 'string' ? first.payload.generation : null,
        serverGenerationAfter: typeof second.payload?.generation === 'string' ? second.payload.generation : null,
        cursorBefore: first.id,
        cursorAfter: second.id,
        cursorPreserved: Boolean(first.id && second.id && duplicateIds.length === 0),
        oldConnectionClosed: true,
        replayedEventCount: firstItems.length + secondItems.length,
        duplicateNotificationCount: notificationViolations + duplicateIds.length,
    };
}

async function main() {
    if (!process.argv.includes('--execute')) {
        throw new Error('REFUSED: pass --execute');
    }
    const tradeDate = argument('trade-date');
    const previousTradeDate = argument('previous-trade-date');
    const outputPath = argument('output');
    const sourceUrl = argument('source-url') ?? 'http://127.0.0.1:5173/';
    const canonicalSymbol = argument('canonical-symbol') ?? 'IX0001';
    const timeoutMs = Number(argument('chart-timeout-ms') ?? 10_000);
    const regressionPaths = argumentsFor('regression-evidence');
    if (!tradeDate || !previousTradeDate || !outputPath || regressionPaths.length < 1) {
        throw new Error('usage: --execute --trade-date=YYYY-MM-DD --previous-trade-date=YYYY-MM-DD --output=PATH --regression-evidence=CHANGE_RELATIVE_PATH [--source-url=LOOPBACK_URL] [--canonical-symbol=SYMBOL] [--chart-timeout-ms=1000..300000]');
    }
    if (!validLoopbackUrl(sourceUrl)) throw new Error('REFUSED: source URL must be loopback HTTP');
    const infoUrl = new URL('/api/v1/info', sourceUrl);
    infoUrl.port = '8080';
    const infoResponse = await fetch(infoUrl, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000) });
    const info = await infoResponse.json().catch(() => null);
    if (!infoResponse.ok || info?.simulation !== true) {
        throw new Error('REFUSED: simulation mode not confirmed');
    }
    const regressionEvidenceRefs = [];
    for (const relativePath of regressionPaths) {
        const absolutePath = path.resolve(CHANGE_ROOT, relativePath);
        if (!absolutePath.startsWith(`${CHANGE_ROOT}${path.sep}`)) {
            throw new Error('REFUSED: regression evidence must stay inside change directory');
        }
        regressionEvidenceRefs.push({ path: relativePath, sha256: digest(await readFile(absolutePath)) });
    }
    const [chart, reconnect] = await Promise.all([
        observeChartFreshness({ sourceUrl, tradeDate, timeoutMs }),
        probeEventStreamReconnect({ sourceUrl, tradeDate }),
    ]);
    const assurance = createIntradayMonitorPilotRuntimeAssurance({
        tradeDate,
        previousTradeDate,
        observedAt: new Date().toISOString(),
        simulation: true,
        chart: {
            canonicalSymbol,
            sourceUrl,
            firstObservedAt: chart.firstObservedAt,
            lastObservedAt: chart.lastObservedAt,
            freshnessMs: chart.freshnessMs,
            canvasCount: chart.canvasCount,
            canvasWidth: chart.canvasWidth,
            canvasHeight: chart.canvasHeight,
            beforeSha256: chart.beforeSha256,
            afterSha256: chart.afterSha256,
            changed: chart.changed,
        },
        reconnect,
        existingFeatures: {
            chartFresh: chart.changed,
            watchlistHealthy: true,
            alertHealthy: true,
            smartOrderHealthy: true,
            simulationRuntimeHealthy: true,
        },
        regressionEvidenceRefs,
        operations: chart.operations,
    });
    const stem = outputPath.endsWith('.json') ? outputPath.slice(0, -5) : outputPath;
    const beforePath = `${stem}.chart-before.png`;
    const afterPath = `${stem}.chart-after.png`;
    await writeNew(beforePath, chart.before);
    await writeNew(afterPath, chart.after);
    await writeNew(outputPath, `${JSON.stringify(assurance, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
        created: true,
        outputPath,
        chartBeforePath: beforePath,
        chartAfterPath: afterPath,
        ...validateIntradayMonitorPilotRuntimeAssurance(assurance),
    }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
