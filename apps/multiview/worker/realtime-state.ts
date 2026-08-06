export type RealtimeGatewayState = "live" | "degraded" | "stale" | "unavailable";
export type RealtimeDisplayState = RealtimeGatewayState | "fallback" | "closing" | "closed";

export function taiwanRealtimeMarketPhase(now = new Date()): "open" | "closing" | "closed" {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  if (["Sat", "Sun"].includes(parts.weekday || "")) return "closed";
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes >= 9 * 60 && minutes <= 13 * 60 + 30) return "open";
  if (minutes > 13 * 60 + 30 && minutes < 15 * 60) return "closing";
  return "closed";
}

export type RealtimeStateInput = {
  enabled: boolean;
  gatewayConnected: boolean;
  sourceAgeMs: number | null;
  marketPhase: "open" | "closing" | "closed";
  fallbackAvailable: boolean;
  degradedAfterMs?: number;
  staleAfterMs?: number;
};

export function resolveRealtimeState(input: RealtimeStateInput): RealtimeDisplayState {
  if (input.marketPhase === "closed") return "closed";
  if (input.marketPhase === "closing") return "closing";
  if (!input.enabled || !input.gatewayConnected || input.sourceAgeMs === null) {
    return input.fallbackAvailable ? "fallback" : "unavailable";
  }
  const degradedAfterMs = input.degradedAfterMs ?? 5_000;
  const staleAfterMs = input.staleAfterMs ?? 15_000;
  if (input.sourceAgeMs > staleAfterMs) return input.fallbackAvailable ? "fallback" : "stale";
  if (input.sourceAgeMs > degradedAfterMs) return "degraded";
  return "live";
}

export function safeSourceAge(sourceTime: string | null, now = Date.now()) {
  if (!sourceTime) return null;
  const timestamp = Date.parse(sourceTime);
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
}
