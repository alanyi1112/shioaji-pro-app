export type MarketPhase = "preopen" | "open" | "closing" | "closed" | "unknown";

type MarketPhaseInput = {
  marketState?: string | null;
  sessionDate?: string | null;
  sourceQuoteTime?: number | null;
  sourceTimeZone?: string | null;
  hasValidCandle: boolean;
  now?: Date;
};

function zonedParts(value: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value).reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  } catch {
    return null;
  }
}

function zonedDate(value: Date, timeZone: string) {
  const parts = zonedParts(value, timeZone);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

export function inferTaiwanMarketPhase(input: MarketPhaseInput): MarketPhase {
  const state = String(input.marketState || "unknown").trim().toLowerCase();
  const timeZone = input.sourceTimeZone || "Asia/Taipei";
  const now = input.now || new Date();
  const nowParts = zonedParts(now, timeZone);
  const sourceTime = input.sourceQuoteTime == null ? Number.NaN : Number(input.sourceQuoteTime);
  const sourceDate = Number.isFinite(sourceTime) ? zonedDate(new Date(sourceTime * 1000), timeZone) : null;
  const today = nowParts ? `${nowParts.year}-${nowParts.month}-${nowParts.day}` : null;
  const minutes = nowParts ? Number(nowParts.hour) * 60 + Number(nowParts.minute) : -1;
  const weekday = nowParts?.weekday || "";
  const weekdayTradingWindow = !["Sat", "Sun"].includes(weekday) && minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
  const sameTradingDay = Boolean(today && input.sessionDate === today && sourceDate === today && input.hasValidCandle);
  const completedPriorSession = Boolean(
    today
    && input.sessionDate
    && input.sessionDate < today
    && sourceDate === input.sessionDate
    && input.hasValidCandle,
  );
  const sourceAgeSeconds = Number.isFinite(sourceTime) ? now.getTime() / 1000 - sourceTime : Number.POSITIVE_INFINITY;
  const sourceIsCurrent = sourceAgeSeconds >= -300 && sourceAgeSeconds <= 60 * 60;
  const explicitOpen = ["open", "regular", "trading"].includes(state);
  const explicitClosed = ["closed", "close", "post", "postpost", "afterhours", "after-hours"].includes(state);
  const explicitPreopen = ["pre", "prepre", "preopen", "pre-open"].includes(state);

  if (explicitOpen && input.hasValidCandle) return "open";
  if (explicitClosed) {
    if (sameTradingDay && minutes > 13 * 60 + 30 && minutes < 15 * 60) return "closing";
    return "closed";
  }
  if (explicitPreopen) return "preopen";
  if (nowParts && ["Sat", "Sun"].includes(weekday) && input.hasValidCandle) return "closed";
  if (completedPriorSession && minutes >= 0 && minutes < 8 * 60) return "closed";
  if (weekdayTradingWindow && sameTradingDay && sourceIsCurrent) return "open";
  if (sameTradingDay && minutes > 13 * 60 + 30 && minutes < 15 * 60 && sourceAgeSeconds <= 2 * 60 * 60) return "closing";
  if (sameTradingDay && minutes >= 15 * 60) return "closed";
  if (nowParts && !["Sat", "Sun"].includes(weekday) && minutes >= 8 * 60 && minutes < 9 * 60) return "preopen";
  return "unknown";
}

export function inferUnitedStatesMarketPhase(input: MarketPhaseInput): MarketPhase {
  const state = String(input.marketState || "unknown").trim().toLowerCase();
  const timeZone = input.sourceTimeZone || "America/New_York";
  const now = input.now || new Date();
  const nowParts = zonedParts(now, timeZone);
  const sourceTime = input.sourceQuoteTime == null ? Number.NaN : Number(input.sourceQuoteTime);
  const sourceDate = Number.isFinite(sourceTime) ? zonedDate(new Date(sourceTime * 1000), timeZone) : null;
  const today = nowParts ? `${nowParts.year}-${nowParts.month}-${nowParts.day}` : null;
  const minutes = nowParts ? Number(nowParts.hour) * 60 + Number(nowParts.minute) : -1;
  const weekday = nowParts?.weekday || "";
  const weekdayTradingWindow = !["Sat", "Sun"].includes(weekday) && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  const sameTradingDay = Boolean(today && input.sessionDate === today && sourceDate === today && input.hasValidCandle);
  const sourceAgeSeconds = Number.isFinite(sourceTime) ? now.getTime() / 1000 - sourceTime : Number.POSITIVE_INFINITY;
  const sourceIsCurrent = sourceAgeSeconds >= -300 && sourceAgeSeconds <= 60 * 60;
  const explicitOpen = ["open", "regular", "trading"].includes(state);
  const explicitClosed = ["closed", "close", "post", "postpost", "afterhours", "after-hours"].includes(state);
  const explicitPreopen = ["pre", "prepre", "preopen", "pre-open"].includes(state);

  if (explicitOpen && input.hasValidCandle) return "open";
  if (explicitClosed) return "closed";
  if (explicitPreopen) return "preopen";
  if (nowParts && ["Sat", "Sun"].includes(weekday) && input.hasValidCandle) return "closed";
  if (weekdayTradingWindow && sameTradingDay && sourceIsCurrent) return "open";
  if (sameTradingDay && minutes >= 16 * 60 && sourceAgeSeconds <= 2 * 60 * 60) return "closed";
  if (sameTradingDay && minutes >= 4 * 60 && minutes < 9 * 60 + 30 && sourceIsCurrent) return "preopen";
  return "unknown";
}
