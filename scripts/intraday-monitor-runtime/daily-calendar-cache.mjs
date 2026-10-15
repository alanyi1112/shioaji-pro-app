import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildOfficialMarketCalendarSnapshot, parseTwseOfficialCalendar,
    parseTpexOfficialCalendar } from '../smart-order-runtime/official-market-calendar-core.mjs';

const SCHEMA = 'intraday-monitor-official-calendar-cache/1';
const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const hash = body => createHash('sha256').update(JSON.stringify(body)).digest('hex');
const directory = root => path.join(root, 'IntradayMonitor', 'official-calendar-cache');
const trading = row => row.TSE === 'scheduled_trading' && row.OTC === 'scheduled_trading';

export function verifyDailyCalendarCache(value, now = new Date()) {
    if (!value || value.schemaVersion !== SCHEMA || !['postclose', 'operator-repair'].includes(value.trigger) ||
        !day(value.sourceTradeDate) || !day(value.targetTradeDate) ||
        value.sourceTradeDate >= value.targetTradeDate ||
        value.sourceTradeDate.slice(0, 4) !== value.targetTradeDate.slice(0, 4) ||
        !Number.isFinite(Date.parse(value.fetchedAt)) || Date.parse(value.fetchedAt) > now.valueOf() ||
        now.valueOf() - Date.parse(value.fetchedAt) > 30 * 86400000 ||
        value.brokerWriteAuthority !== false || value.notificationAuthority !== false) {
        throw new Error('daily_calendar_cache_invalid_or_stale');
    }
    const { evidenceHash, ...body } = value;
    if (evidenceHash !== hash(body)) throw new Error('daily_calendar_cache_hash_mismatch');
    const year = Number(value.sourceTradeDate.slice(0, 4));
    const snapshot = buildOfficialMarketCalendarSnapshot({
        twse: parseTwseOfficialCalendar(value.twse, year),
        tpex: parseTpexOfficialCalendar(value.tpex, year),
        fetchedAtEpochMs: Date.parse(value.fetchedAt),
    });
    const source = snapshot.days.find(row => row.tradeDate === value.sourceTradeDate);
    const next = snapshot.days.find(row => row.tradeDate > value.sourceTradeDate && trading(row));
    if (!source || !trading(source) || next?.tradeDate !== value.targetTradeDate ||
        snapshot.calendarVersion !== value.calendarVersion) throw new Error('daily_calendar_cache_identity_mismatch');
    return snapshot;
}

export async function saveDailyCalendarCache({ root, calendar, fetchedAt,
    trigger = 'postclose' } = {}) {
    if (!path.isAbsolute(root ?? '')) throw new TypeError('daily_calendar_root_invalid');
    const body = { schemaVersion: SCHEMA, trigger, sourceTradeDate: calendar.tradeDate,
        targetTradeDate: calendar.targetTradeDate, fetchedAt,
        calendarVersion: calendar.calendarSourceVersion, twse: calendar.twse, tpex: calendar.tpex,
        brokerWriteAuthority: false, notificationAuthority: false };
    const value = { ...body, evidenceHash: hash(body) };
    verifyDailyCalendarCache(value, new Date(fetchedAt));
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > 256 * 1024) throw new Error('daily_calendar_cache_too_large');
    const dir = directory(root);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${new Date(fetchedAt).toISOString().replace(/[:.]/g, '-')}-${value.evidenceHash}.json`);
    let handle;
    try { handle = await open(file, 'wx', 0o600); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (await readFile(file, 'utf8') !== bytes) throw new Error('daily_calendar_cache_conflict');
        return { file, evidenceHash: value.evidenceHash, alreadyPresent: true };
    }
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    return { file, evidenceHash: value.evidenceHash, alreadyPresent: false };
}

export async function readDailyCalendarCache({ root, now = new Date(), tradeDate } = {}) {
    if (!path.isAbsolute(root ?? '') || !day(tradeDate)) throw new TypeError('daily_calendar_read_invalid');
    let names;
    try { names = await readdir(directory(root)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (names.length > 1024) throw new Error('daily_calendar_cache_inventory_limit');
    names = names.filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{64}\.json$/.test(name)).sort().reverse();
    if (!names.length) return null;
    const file = path.join(directory(root), names[0]);
    const bytes = await readFile(file);
    if (bytes.length > 256 * 1024) throw new Error('daily_calendar_cache_too_large');
    const value = JSON.parse(bytes.toString('utf8'));
    const snapshot = verifyDailyCalendarCache(value, now);
    if (value.targetTradeDate < tradeDate && now.valueOf() - Date.parse(value.fetchedAt) > 7 * 86400000) {
        throw new Error('daily_calendar_cache_invalid_or_stale');
    }
    return { snapshot, value, file };
}
