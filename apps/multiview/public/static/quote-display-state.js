(function registerQuoteDisplayState(root) {
  function zonedParts(value, timeZone) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
      }).formatToParts(date).reduce((result, part) => {
        if (part.type !== "literal") result[part.type] = part.value;
        return result;
      }, {});
    } catch {
      return null;
    }
  }

  function isTaiwanMarketClosedDay(quote, now = new Date()) {
    const value = quote && typeof quote === "object" ? quote : {};
    if (String(value.sourceTimeZone || "") !== "Asia/Taipei") return false;
    const parts = zonedParts(now, "Asia/Taipei");
    if (!parts) return false;
    if (["Sat", "Sun"].includes(parts.weekday)) return true;
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    return value.marketPhase === "closed" && /^\d{4}-\d{2}-\d{2}$/.test(String(value.sessionDate || "")) && value.sessionDate !== today;
  }

  root.MultiChartQuoteDisplayState = Object.freeze({ isTaiwanMarketClosedDay });
})(globalThis);
