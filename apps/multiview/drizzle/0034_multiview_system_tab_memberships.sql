CREATE TABLE IF NOT EXISTS `user_system_tab_instruments` (
  `user_id` text NOT NULL,
  `system_tab_id` text NOT NULL,
  `symbol` text NOT NULL,
  `item_id` text,
  `name` text NOT NULL,
  `provider` text NOT NULL,
  `group_name` text NOT NULL,
  `market` text NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `sort_order` integer,
  `added_at` text,
  `date_status` text DEFAULT 'legacy_unknown' NOT NULL,
  `date_source` text,
  `recommender` text DEFAULT '' NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`user_id`, `system_tab_id`, `symbol`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_system_tab_instruments_item_idx`
  ON `user_system_tab_instruments` (`user_id`, `item_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_watchlist_mutation_revision` (
  `user_id` text PRIMARY KEY NOT NULL,
  `revision` integer DEFAULT 0 NOT NULL CHECK (`revision` >= 0)
);
--> statement-breakpoint
WITH resolved AS (
  SELECT legacy.*,
    COALESCE(
      CASE legacy.tab_label
        WHEN '台股' THEN 'taiwan-stocks'
        WHEN '美股' THEN 'us-stocks'
        WHEN '匯率債券' THEN 'fx-bonds'
        WHEN '期貨期指' THEN 'index-futures'
      END,
      (SELECT MIN(t.source_tab_id) FROM user_tabs AS t
        WHERE t.user_id=legacy.user_id AND t.label=legacy.tab_label
          AND t.source_tab_id IN ('taiwan-stocks','us-stocks','fx-bonds','index-futures')
        HAVING COUNT(DISTINCT t.source_tab_id)=1)
    ) AS resolved_system_tab_id
  FROM user_instruments AS legacy WHERE legacy.tab_id=''
)
INSERT INTO user_system_tab_instruments
  (user_id,system_tab_id,symbol,item_id,name,provider,group_name,market,enabled,sort_order,added_at,date_status,date_source,recommender,updated_at)
SELECT user_id,resolved_system_tab_id,symbol,
  CASE WHEN item_id IS NULL THEN NULL ELSE 'migrated-system:' || resolved_system_tab_id || ':' || item_id END,
  name,provider,group_name,market,enabled,sort_order,added_at,date_status,date_source,recommender,updated_at
FROM resolved
WHERE resolved_system_tab_id IS NOT NULL
ON CONFLICT(user_id,system_tab_id,symbol) DO NOTHING;
