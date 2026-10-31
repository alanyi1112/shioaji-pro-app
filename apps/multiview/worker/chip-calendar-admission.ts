import { resolveLocalCompletedSession } from "./local-completed-session.ts";

/** Process-local admission for ONE bounded maintenance request, never accepted from an HTTP body.
 * Verify the signed 30-second ingress proof once; do not confuse its TTL with job duration.
 */
export async function admitChipCalendar(env: { LOCAL_MARKET_CALENDAR_PROOF?: string; LOCAL_PIPELINE_SECRET?: string }, now = new Date()) {
  const result = await resolveLocalCompletedSession(env.LOCAL_MARKET_CALENDAR_PROOF, env.LOCAL_PIPELINE_SECRET, now);
  if (!result.expectedSession || result.status !== "verified") throw new Error(result.reasonCode || "calendar_authority_unavailable");
  const expectedSession = result.expectedSession;
  const admittedAt = +now;
  const deadline = admittedAt + 180_000;
  return () => {
    const current = Date.now();
    if (current < admittedAt || current >= deadline) throw new Error("timeout");
    return expectedSession;
  };
}
