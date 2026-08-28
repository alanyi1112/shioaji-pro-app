export const LARGAN_SYMBOL = "3008.TW";
export const LARGAN_OFFICIAL_SOURCE_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=20260801&stockNo=3008&response=json";

export const LARGAN_AUGUST_2026_MISSING_ROWS = Object.freeze([
  { sessionDate: "2026-08-03", open: 3970, high: 4030, low: 3910, close: 3960, volume: 1846958 },
  { sessionDate: "2026-08-04", open: 4030, high: 4355, low: 4010, close: 4355, volume: 1870025 },
  { sessionDate: "2026-08-05", open: 4410, high: 4730, low: 4340, close: 4575, volume: 4740431 },
  { sessionDate: "2026-08-06", open: 4525, high: 4770, low: 4515, close: 4625, volume: 2304539 },
  { sessionDate: "2026-08-07", open: 4605, high: 4625, low: 4380, close: 4385, volume: 1666019 },
  { sessionDate: "2026-08-10", open: 4480, high: 4565, low: 4345, close: 4400, volume: 1949566 },
  { sessionDate: "2026-08-11", open: 4355, high: 4420, low: 4230, close: 4355, volume: 1547540 },
  { sessionDate: "2026-08-12", open: 4390, high: 4685, low: 4355, close: 4585, volume: 2154833 },
  { sessionDate: "2026-08-13", open: 4655, high: 4825, low: 4545, close: 4660, volume: 2186337 },
  { sessionDate: "2026-08-14", open: 4700, high: 4920, low: 4590, close: 4610, volume: 1840365 },
]);

export function taipeiSessionTime(sessionDate) {
  return Math.floor(Date.parse(`${sessionDate}T09:00:00+08:00`) / 1000);
}

export function officialLarganCandles() {
  return LARGAN_AUGUST_2026_MISSING_ROWS.map((row) => ({
    time: taipeiSessionTime(row.sessionDate),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    quoteTime: Math.floor(Date.parse(`${row.sessionDate}T13:30:00+08:00`) / 1000),
    source: "twse-official",
    sourceUpdatedAt: "2026-08-28T07:00:00.000Z",
    marketSession: "closed",
    sourceTimeZone: "Asia/Taipei",
  }));
}

function weekdaysThrough(endDate, count) {
  const dates = [];
  const cursor = new Date(`${endDate}T00:00:00Z`);
  while (dates.length < count) {
    if (![0, 6].includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

export function larganGapHistoryFixture() {
  const missing = new Set(LARGAN_AUGUST_2026_MISSING_ROWS.map((row) => row.sessionDate));
  const rows = weekdaysThrough("2026-08-28", 330)
    .filter((sessionDate) => !missing.has(sessionDate))
    .map((sessionDate, index) => {
      const close = 3000 + index;
      return {
        time: taipeiSessionTime(sessionDate),
        open: close - 10,
        high: close + 20,
        low: close - 20,
        close,
        volume: 1000000 + index,
        source: "yahoo-chart",
        sourceTimeZone: "Asia/Taipei",
      };
    });
  return {
    symbol: LARGAN_SYMBOL,
    rows,
    state: {
      fullWindowComplete: true,
      coverageStart: rows[0].time,
      coverageEnd: rows.at(-1).time,
      availableRows: rows.length,
      continuityStatus: "unknown",
    },
    missingSessionDates: [...missing],
    officialRows: officialLarganCandles(),
  };
}
