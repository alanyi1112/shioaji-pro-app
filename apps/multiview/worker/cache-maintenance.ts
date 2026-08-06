export const CACHE_CLEANUP_BATCH_SIZE = 40;

type CacheMaintenanceRow = {
  last_run_at?: string | null;
  deleted_rows?: number | null;
  remaining_rows?: number | null;
  status?: string | null;
  reason_code?: string | null;
};

export async function cleanupExpiredCandleCache(db: D1Database | undefined, now = new Date(), limit = CACHE_CLEANUP_BATCH_SIZE) {
  if (!db) return { status: "unavailable", lastRunAt: null, deletedRows: 0, remainingRows: 0, reasonCode: "d1_unavailable" };
  const boundedLimit = Math.max(1, Math.min(CACHE_CLEANUP_BATCH_SIZE, Math.trunc(limit)));
  const epoch = Math.floor(now.getTime() / 1000);
  try {
    const deletion = await db.prepare("DELETE FROM candle_cache WHERE cache_key IN (SELECT cache_key FROM candle_cache WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)").bind(epoch, boundedLimit).run();
    const remaining = await db.prepare("SELECT COUNT(*) AS rows FROM candle_cache WHERE expires_at <= ?").bind(epoch).first<{ rows?: number | null }>();
    const deletedRows = Number(deletion.meta?.changes || 0);
    const remainingRows = Number(remaining?.rows || 0);
    await db.prepare(`INSERT INTO cache_maintenance_state (maintenance_key,last_run_at,deleted_rows,remaining_rows,status,reason_code)
      VALUES ('candle-cache',?,?,?,?,NULL)
      ON CONFLICT(maintenance_key) DO UPDATE SET last_run_at=excluded.last_run_at,deleted_rows=excluded.deleted_rows,remaining_rows=excluded.remaining_rows,status=excluded.status,reason_code=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(now.toISOString(), deletedRows, remainingRows, "healthy").run();
    return { status: "healthy", lastRunAt: now.toISOString(), deletedRows, remainingRows, reasonCode: null };
  } catch {
    return { status: "degraded", lastRunAt: now.toISOString(), deletedRows: 0, remainingRows: null, reasonCode: "cache_cleanup_failed" };
  }
}

export async function readCandleCacheMaintenance(db?: D1Database) {
  if (!db) return { status: "unavailable", lastRunAt: null, deletedRows: 0, remainingRows: 0, reasonCode: "d1_unavailable" };
  try {
    const row = await db.prepare("SELECT last_run_at,deleted_rows,remaining_rows,status,reason_code FROM cache_maintenance_state WHERE maintenance_key='candle-cache'").first<CacheMaintenanceRow>();
    return {
      status: row?.status || "not_run",
      lastRunAt: row?.last_run_at || null,
      deletedRows: Number(row?.deleted_rows || 0),
      remainingRows: Number(row?.remaining_rows || 0),
      reasonCode: row?.reason_code || null,
    };
  } catch {
    return { status: "degraded", lastRunAt: null, deletedRows: 0, remainingRows: null, reasonCode: "cache_health_unavailable" };
  }
}
