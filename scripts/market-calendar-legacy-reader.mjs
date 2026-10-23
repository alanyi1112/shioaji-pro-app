// 本機使用者意圖，不是官方公告或簽署權威；import 不建立目錄／DB／網路連線。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

export const SPECIAL_CLOSURE_SCHEMA = 'manual-special-market-closures/1';
export const defaultClosureRoot = () => process.env.REALTIME_STOCK_APP_SUPPORT ??
    path.join(os.homedir(), 'Library/Application Support/RealTimeStock');
export const taipeiClosureDate = now => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const validReason = value => typeof value === 'string' && value === value.trim() &&
    value.length >= 1 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
const filename = revision => `${String(revision).padStart(6, '0')}.json`;
const directory = root => path.join(root, 'IntradayMonitor/special-market-closures');
function privatePath(file, isDirectory) {
    const s = fs.lstatSync(file);
    if (s.isSymbolicLink() || fs.realpathSync(file) !== file || s.uid !== process.getuid() ||
        (s.mode & 0o077) || !(isDirectory ? s.isDirectory() : s.isFile())) fail('special_closure_storage_invalid');
    return s;
}
function clock(now) {
    if (!(now instanceof Date) || !Number.isFinite(+now)) fail('special_closure_clock_invalid');
    return now;
}
function inputValid(input, now) {
    const today = taipeiClosureDate(now);
    const upper = new Date(Date.parse(`${today}T00:00:00Z`) + 366 * 86400000).toISOString().slice(0, 10);
    if (!input || Object.keys(input).sort().join(',') !== 'action,confirmed,date,expectedRevision,reason' ||
        !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
        !['close', 'revoke'].includes(input.action) || input.confirmed !== true ||
        !validDate(input.date) || input.date < today || input.date > upper || !validReason(input.reason)) fail('special_closure_input_invalid');
    if (input.action === 'revoke' && input.date <= today) fail('special_closure_today_immutable');
}

export function readLegacySpecialMarketClosures(root = defaultClosureRoot(), { now = new Date() } = {}) {
    clock(now);
    if (!path.isAbsolute(root)) fail('special_closure_root_invalid');
    let names;
    try { privatePath(directory(root), true); names = fs.readdirSync(directory(root)).sort(); }
    catch (e) { if (e.code === 'ENOENT') return { schemaVersion: SPECIAL_CLOSURE_SCHEMA, revision: 0,
        hash: null, source: 'local_user', entries: [], history: [], today: taipeiClosureDate(now) }; throw e; }
    if (names.length > 1024 || names.some((n, i) => n !== filename(i + 1))) fail('special_closure_history_invalid');
    const active = new Map(), history = [];
    let parentHash = null, lastAt = 0;
    for (const [i, name] of names.entries()) {
        const file = path.join(directory(root), name), stat = privatePath(file, false);
        if (stat.size > 4096) fail('special_closure_history_invalid');
        let value;
        try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('special_closure_history_invalid'); }
        const { hash, ...body } = value ?? {};
        const at = Date.parse(body.recordedAt);
        if (Object.keys(body).sort().join(',') !== 'action,date,parentHash,reason,recordedAt,revision,schemaVersion,source' ||
            body.schemaVersion !== SPECIAL_CLOSURE_SCHEMA || body.source !== 'local_user' ||
            body.revision !== i + 1 || body.parentHash !== parentHash || digest(body) !== hash ||
            !Number.isFinite(at) || at < lastAt || at > +now) fail('special_closure_history_invalid');
        inputValid({ action: body.action, date: body.date, reason: body.reason,
            expectedRevision: i, confirmed: true }, new Date(at));
        if (body.action === 'close') {
            if (active.has(body.date)) fail('special_closure_history_invalid');
            active.set(body.date, { date: body.date, reason: body.reason, recordedAt: body.recordedAt,
                revision: body.revision, markets: ['TSE', 'OTC'], scope: 'full_day', source: 'local_user' });
        } else {
            if (!active.has(body.date)) fail('special_closure_history_invalid');
            active.delete(body.date);
        }
        history.push(value); parentHash = hash; lastAt = at;
    }
    return { schemaVersion: SPECIAL_CLOSURE_SCHEMA, revision: names.length, hash: parentHash,
        source: 'local_user', entries: [...active.values()].sort((a, b) => a.date.localeCompare(b.date)),
        history, today: taipeiClosureDate(now) };
}
