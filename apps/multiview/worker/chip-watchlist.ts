/** Same identity sources for foreground eligibility and scheduled chip maintenance.
 * undefined = protected scheduler; null = unidentified foreground, never all users.
 */
export async function readChipWatchlistRows<T>(db: D1Database, userId?: string | null): Promise<T[]> {
  if (userId === null) return [];
  const scoped = typeof userId === "string";
  const filter = scoped ? " AND user_id=?" : "";
  const statement = db.prepare(`SELECT symbol,name,provider,tab_id,tab_label,group_name,market,enabled,sort_order,updated_at
    FROM user_instruments WHERE enabled=1${filter}
    UNION ALL
    SELECT symbol,name,provider,system_tab_id AS tab_id,system_tab_id AS tab_label,group_name,market,enabled,sort_order,updated_at
    FROM user_system_tab_instruments WHERE enabled=1${filter}
    ORDER BY updated_at ASC,symbol ASC`);
  const result = await (scoped ? statement.bind(userId, userId) : statement).all<T>();
  return result.results || [];
}
