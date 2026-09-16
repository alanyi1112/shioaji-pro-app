import { chmod, mkdir, open, rename, stat } from 'node:fs/promises';
import path from 'node:path';

export const INTRADAY_MONITOR_OPERATIONAL_EVENT_SCHEMA =
    'intraday-monitor-operational-event/1';
export const INTRADAY_MONITOR_OPERATIONAL_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const INTRADAY_MONITOR_OPERATIONAL_LOG_GENERATIONS = 5;

function cleanText(value, fallback = 'unknown', maximumLength = 160) {
    if (typeof value !== 'string') return fallback;
    const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return cleaned ? cleaned.slice(0, maximumLength) : fallback;
}

function redact(value, depth = 0) {
    if (depth > 6) return '[REDACTED_DEPTH]';
    if (value === null || typeof value === 'boolean' || Number.isSafeInteger(value)) return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return cleanText(value, '', 512);
    if (Array.isArray(value)) return value.slice(0, 200).map((item) => redact(item, depth + 1));
    if (!value || typeof value !== 'object') return null;
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
        if (/^(?:account|password|token|secret|credential|api[_-]?key)$/i.test(key)) {
            output[key] = '[REDACTED_SECRET]';
        } else {
            output[key] = redact(item, depth + 1);
        }
    }
    return output;
}

export async function appendIntradayMonitorOperationalEvent(logPath, input = {}) {
    if (typeof logPath !== 'string' || !path.isAbsolute(logPath) ||
        !/^[a-z][a-z0-9_]{1,63}$/.test(input.event ?? '')) {
        throw new TypeError('operational event input is invalid');
    }
    await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
    try {
        if ((await stat(logPath)).size >= INTRADAY_MONITOR_OPERATIONAL_LOG_MAX_BYTES) {
            for (let index = INTRADAY_MONITOR_OPERATIONAL_LOG_GENERATIONS - 1;
                index >= 1; index -= 1) {
                await rename(`${logPath}.${index}`, `${logPath}.${index + 1}`).catch(() => {});
            }
            await rename(logPath, `${logPath}.1`);
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    const event = {
        schemaVersion: INTRADAY_MONITOR_OPERATIONAL_EVENT_SCHEMA,
        at: Number.isFinite(Date.parse(input.at ?? '')) ? input.at : new Date().toISOString(),
        event: input.event,
        component: cleanText(input.component, 'unknown', 48),
        tradeDate: /^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate ?? '') ? input.tradeDate : null,
        severity: ['info', 'milestone', 'incident'].includes(input.severity)
            ? input.severity : 'info',
        alertEligible: input.alertEligible === true,
        details: input.details && typeof input.details === 'object' &&
            !Array.isArray(input.details) ? redact(input.details) : {},
        rawOutputSaved: false,
        brokerWriteAuthority: false,
        productionAuthority: false,
    };
    const handle = await open(logPath, 'a', 0o600);
    try { await handle.writeFile(`${JSON.stringify(event)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await chmod(logPath, 0o600);
    return Object.freeze(event);
}
