-- 持久共用額度；僅新增表，不改既有監控／來源收據。
CREATE TABLE broker_bandwidth_observations (
  scope TEXT NOT NULL,
  quota_epoch TEXT NOT NULL,
  generation TEXT NOT NULL,
  used_bytes INTEGER NOT NULL CHECK(used_bytes >= 0),
  limit_bytes INTEGER NOT NULL CHECK(limit_bytes > 0),
  observed_at TEXT NOT NULL,
  PRIMARY KEY(scope, quota_epoch)
);
--> statement-breakpoint
CREATE TABLE broker_bandwidth_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  quota_epoch TEXT NOT NULL,
  generation TEXT NOT NULL,
  job_key TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved','dispatched','charged','quarantined','released')),
  estimated_bytes INTEGER NOT NULL CHECK(estimated_bytes > 0),
  usage_before INTEGER NOT NULL,
  response_bytes INTEGER,
  usage_after INTEGER,
  policy_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX broker_bandwidth_reserved_idx ON broker_bandwidth_reservations(scope,quota_epoch,status);
--> statement-breakpoint
CREATE TABLE broker_bandwidth_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  reservation_id TEXT,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
