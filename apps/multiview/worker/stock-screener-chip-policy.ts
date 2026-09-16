import type { ScreenerChipDataset } from "./stock-screener-chip-sources.ts";

export type ChipRetry = { day: string; attempts: number; reason: string; nextAttemptAt: string };
export const chipTaipeiDay = (now: Date) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);

export function chipDownloadDecision(date: string, dataset: ScreenerChipDataset, now: Date, retry?: ChipRetry | null) {
  const opening = `${date}T${dataset === "margin-short" ? "21" : "16"}:00:00+08:00`;
  if (now.getTime() < Date.parse(opening)) return { allowed: false, reason: "publication_window_pending", nextAttemptAt: new Date(opening).toISOString() };
  if (retry && Date.parse(retry.nextAttemptAt) > now.getTime()) return { allowed: false, reason: retry.reason, nextAttemptAt: retry.nextAttemptAt };
  return { allowed: true, reason: null, nextAttemptAt: null };
}

export function chipRetryAfter(_date: string, now: Date, previous: ChipRetry | null, reason: string, retryAfterMs = 0): ChipRetry {
  const day = chipTaipeiDay(now), attempts = previous?.day === day ? previous.attempts + 1 : 1;
  const delay = reason === "empty_report" ? 30 * 60000
    : reason === "rate_limited" ? 3600000
    : /schema|invalid|mismatch|too_large/.test(reason) ? 6 * 3600000
    : Math.min(6 * 3600000, 15 * 60000 * 2 ** Math.min(attempts - 1, 5));
  const nextDay = new Date(Date.parse(`${day}T00:00:00+08:00`) + 86400000);
  return { day, attempts, reason, nextAttemptAt: new Date(Math.max(now.getTime() + delay,
    now.getTime() + retryAfterMs, attempts >= 6 ? nextDay.getTime() : 0)).toISOString() };
}
