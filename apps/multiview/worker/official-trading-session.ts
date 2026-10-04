/** Worker-safe, fail-closed TWSE/TPEx calendar authority for daily-candle coverage. */
type Calendar = { year: number; twse: Set<string>; tpex: Set<string>; fetchedAt: number };
export type CompletedSession = { expectedSession: string | null; status: "verified" | "unknown"; reasonCode: string | null };

const calendars = new Map<number, Calendar>();
const inflight = new Map<number, Promise<Calendar>>();
const TTL_MS = 96 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 1024 * 1024;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const cacheKey = (year: number) => `official-trading-calendar-v1|${year}`;

function strictDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error("calendar_schema_mismatch");
  return date.toISOString().slice(0, 10);
}

function stripHtml(value: string) {
  return value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

export function parseTwseClosedDates(payload: unknown, year: number) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const fields = body.fields;
  const data = body.data;
  if (body.stat !== "ok" || body.queryYear !== year || !Array.isArray(fields) || fields.length !== 3
    || fields[0] !== "日期" || fields[1] !== "名稱" || fields[2] !== "說明"
    || !Array.isArray(data) || data.length < 1 || data.length > 128) throw new Error("calendar_schema_mismatch");
  const dates = new Set<string>();
  for (const row of data) {
    if (!Array.isArray(row) || row.length !== 3 || typeof row[0] !== "string" || typeof row[1] !== "string" || typeof row[2] !== "string"
      || !datePattern.test(row[0]) || !row[0].startsWith(`${year}-`) || strictDate(year, Number(row[0].slice(5, 7)), Number(row[0].slice(8, 10))) !== row[0]) throw new Error("calendar_schema_mismatch");
    const explicitlyOpen = /開始交易日|最後交易日/.test(row[1]) && /開始交易|最後交易/.test(`${row[1]} ${row[2]}`);
    if (!explicitlyOpen) dates.add(row[0]);
  }
  return dates;
}

export function parseTwseOpenApiClosedDates(payload: unknown, year: number) {
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > 128) throw new Error("calendar_schema_mismatch");
  const dates = new Set<string>();
  for (const raw of payload) {
    const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    if (typeof row.Date !== "string" || !/^\d{7}$/.test(row.Date) || Number(row.Date.slice(0, 3)) + 1911 !== year
      || typeof row.Name !== "string" || typeof row.Description !== "string" || typeof row.Weekday !== "string") throw new Error("calendar_schema_mismatch");
    const date = strictDate(year, Number(row.Date.slice(3, 5)), Number(row.Date.slice(5, 7)));
    const explicitlyOpen = /開始交易日|最後交易日/.test(row.Name) && /開始交易|最後交易/.test(`${row.Name} ${row.Description}`);
    if (!explicitlyOpen) dates.add(date);
  }
  return dates;
}

export function parseTpexClosedDates(payload: unknown, year: number) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data as Record<string, unknown> : {};
  const html = data.html;
  if (typeof html !== "string" || html.length < 100 || html.length > 512_000) throw new Error("calendar_schema_mismatch");
  const table = html.match(/<table[^>]*>[\s\S]*?<\/table>/i)?.[0] ?? "";
  const title = stripHtml(table);
  if (!title.includes(String(year - 1911)) || !title.includes("開（休）市日期表")) throw new Error("calendar_schema_mismatch");
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rows.length < 2 || rows.length > 256) throw new Error("calendar_schema_mismatch");
  const dates = new Set<string>();
  for (const row of rows) {
    const rowText = stripHtml(row[1]);
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripHtml(cell[1]));
    if (cells.length < 3) {
      if (!rowText || cells.length === 1 && (rowText.includes("開（休）市日期表") || cells[0] === "農曆春節前債券等殖成交系統（含比對系統）最後交易日")) continue;
      throw new Error("calendar_schema_mismatch");
    }
    const malformedDescription = cells.length === 3 && /放假|市場無交易|休市/.test(rowText) && !/\d{1,2}月\d{1,2}日/.test(cells[0]);
    const rowspannedHoliday = cells.length === 3 && /\d{1,2}月\d{1,2}日/.test(cells[0]);
    const description = malformedDescription ? rowText : cells.at(-1)!;
    const dateCell = malformedDescription ? cells[1] : rowspannedHoliday ? cells[0] : cells.at(-3)!;
    const name = malformedDescription ? cells[0] : rowspannedHoliday ? "" : cells.length >= 4 ? cells.at(-4)! : "";
    if (name.includes("最後交易日")) {
      if (!name.includes("股票交易系統")) continue;
      if (!/市場無交易|停止交易|休市/.test(description)) throw new Error("calendar_schema_mismatch");
    }
    if (name.includes("開始交易日")) continue;
    const closureText = name.includes("最後交易日") ? description : dateCell;
    let count = 0;
    for (const match of closureText.matchAll(/(\d{1,2})月(\d{1,2})日/g)) {
      dates.add(strictDate(year, Number(match[1]), Number(match[2])));
      count++;
    }
    if (count === 0 && /\d/.test(rowText)) throw new Error("calendar_schema_mismatch");
  }
  return dates;
}

async function officialJson(url: string, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try { response = await fetchImpl(url, { signal: controller.signal, redirect: "error", headers: {
      accept: "application/json", "accept-language": "zh-TW,zh;q=0.9,en;q=0.8", "user-agent": "Mozilla/5.0 CodexSites MultiChart",
    } }); }
    catch (error) {
      const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: { code?: unknown } }).cause : null;
      const code = typeof cause?.code === "string" && /^(?:E[A-Z]+|UND_ERR_[A-Z_]+)$/.test(cause.code) ? cause.code.toLowerCase() : "fetch_failed";
      throw new Error(`${url.includes("twse.com.tw") ? "calendar_twse" : "calendar_tpex"}_${code}`);
    }
    if (!response.ok) throw new Error(`${url.includes("twse.com.tw") ? "calendar_twse" : "calendar_tpex"}_http_${response.status}`);
    const text = await response.text();
    if (text.length > MAX_SOURCE_BYTES) throw new Error("calendar_schema_mismatch");
    try { return JSON.parse(text) as unknown; }
    catch { throw new Error("calendar_schema_mismatch"); }
  } finally { clearTimeout(timer); }
}

type CalendarDb = Pick<D1Database, "prepare">;

function calendarFromStored(value: unknown, year: number, now: Date): Calendar | null {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (item.year !== year || !Number.isSafeInteger(item.fetchedAt) || now.getTime() - Number(item.fetchedAt) >= TTL_MS
    || Number(item.fetchedAt) > now.getTime() + 60_000 || !Array.isArray(item.twse) || !Array.isArray(item.tpex)) return null;
  for (const list of [item.twse, item.tpex]) {
    if (list.length < 1 || list.length > 128 || list.some((date) => typeof date !== "string" || !datePattern.test(date) || !date.startsWith(`${year}-`))) return null;
  }
  return { year, twse: new Set(item.twse as string[]), tpex: new Set(item.tpex as string[]), fetchedAt: Number(item.fetchedAt) };
}

export async function seedOfficialTradingCalendar(db: CalendarDb, year: number, twsePayload: unknown, tpexPayload: unknown, now = new Date()) {
  if (!Number.isInteger(year) || year < 2020 || year > 2200) throw new Error("calendar_year_unsupported");
  const twse = parseTwseClosedDates(twsePayload, year);
  const tpex = parseTpexClosedDates(tpexPayload, year);
  for (const date of new Set([...twse, ...tpex])) if (twse.has(date) !== tpex.has(date)) throw new Error("calendar_market_conflict");
  const fetchedAt = now.getTime();
  const payload = JSON.stringify({ year, twse: [...twse].sort(), tpex: [...tpex].sort(), fetchedAt });
  await db.prepare(`INSERT INTO candle_cache (cache_key,payload,expires_at) VALUES (?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(cacheKey(year), payload, Math.floor((fetchedAt + TTL_MS) / 1000)).run();
  calendars.set(year, { year, twse, tpex, fetchedAt });
  return { year, fetchedAt: now.toISOString(), closedDays: twse.size };
}

async function calendarForYear(year: number, now: Date, fetchImpl: typeof fetch, db?: CalendarDb) {
  if (!Number.isInteger(year) || year < 2020 || year > 2200) throw new Error("calendar_year_unsupported");
  const cached = calendars.get(year);
  if (cached && cached.fetchedAt <= now.getTime() + 60_000 && now.getTime() - cached.fetchedAt < TTL_MS) return cached;
  if (db) {
    try {
      const row = await db.prepare("SELECT payload FROM candle_cache WHERE cache_key=? AND expires_at>?")
        .bind(cacheKey(year), Math.floor(now.getTime() / 1000)).first<{ payload?: string }>();
      const stored = row?.payload ? calendarFromStored(JSON.parse(row.payload), year, now) : null;
      if (stored) { calendars.set(year, stored); return stored; }
    } catch { /* Cache is optional; source failure remains unknown. */ }
  }
  const existing = inflight.get(year);
  if (existing) return existing;
  const pending = (async () => {
    const twse = await officialJson(`https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&queryYear=${year - 1911}`, fetchImpl)
      .then((payload) => parseTwseClosedDates(payload, year))
      .catch(async (error) => {
        if (error instanceof Error && error.message === "calendar_schema_mismatch") throw error;
        return parseTwseOpenApiClosedDates(await officialJson("https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule", fetchImpl), year);
      });
    const tpexPayload = await officialJson(`https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=${year}`, fetchImpl);
    const value = { year, twse, tpex: parseTpexClosedDates(tpexPayload, year), fetchedAt: now.getTime() };
    for (const date of new Set([...value.twse, ...value.tpex])) if (value.twse.has(date) !== value.tpex.has(date)) throw new Error("calendar_market_conflict");
    calendars.set(year, value);
    return value;
  })().finally(() => inflight.delete(year));
  inflight.set(year, pending);
  return pending;
}

export async function resolveOfficialCompletedSession(now = new Date(), fetchImpl: typeof fetch = fetch, db?: CalendarDb): Promise<CompletedSession> {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const clock = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const today = `${clock.year}-${clock.month}-${clock.day}`;
  const afterClose = Number(clock.hour) * 60 + Number(clock.minute) >= 15 * 60;
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!afterClose) cursor.setUTCDate(cursor.getUTCDate() - 1);
  try {
    for (let day = 0; day < 14; day++) {
      const date = cursor.toISOString().slice(0, 10);
      const weekday = cursor.getUTCDay();
      if (weekday !== 0 && weekday !== 6) {
        const calendar = await calendarForYear(cursor.getUTCFullYear(), now, fetchImpl, db);
        const twseClosed = calendar.twse.has(date);
        const tpexClosed = calendar.tpex.has(date);
        if (twseClosed !== tpexClosed) return { expectedSession: null, status: "unknown", reasonCode: "calendar_market_conflict" };
        if (!twseClosed) return { expectedSession: date, status: "verified", reasonCode: null };
      }
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return { expectedSession: null, status: "unknown", reasonCode: "calendar_coverage_unavailable" };
  } catch (error) {
    const code = error instanceof Error ? error.message : "calendar_source_unavailable";
    return { expectedSession: null, status: "unknown", reasonCode: ["calendar_schema_mismatch", "calendar_year_unsupported", "calendar_market_conflict"].includes(code) || /^calendar_(?:twse|tpex)_(?:fetch_failed|e[a-z]+|und_err_[a-z_]+|http_\d{3})$/.test(code) ? code : "calendar_source_unavailable" };
  }
}

export function clearOfficialSessionRuntimeState() {
  calendars.clear();
  inflight.clear();
}
