import {
  authenticationFailure,
  authorizeRequestPrincipal,
  requestPrincipal,
  type RequestPrincipal,
} from "./request-principal.ts";

type D1StatementLike = {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
};

export type AccessDatabase = { prepare(query: string): D1StatementLike };
export type AccessRole = "owner" | "member";
export type AccessStatus = "active" | "inactive";
export type AccessUser = {
  id: string;
  email: string;
  role: AccessRole;
  status: AccessStatus;
  createdAt: string;
  updatedAt: string;
};

type AccessUserRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export class AccessControlError extends Error {
  readonly reasonCode: string;
  readonly status: number;

  constructor(reasonCode: string, status = 400) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.status = status;
  }
}

export function normalizeAccessEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AccessControlError("invalid_email", 400);
  }
  return email;
}

function asRole(value: unknown): AccessRole {
  if (value === "owner" || value === "member") return value;
  throw new AccessControlError("invalid_role", 400);
}

function asStatus(value: unknown): AccessStatus {
  if (value === "active" || value === "inactive") return value;
  throw new AccessControlError("invalid_status", 400);
}

function userFromRow(row: AccessUserRow): AccessUser {
  return {
    id: row.id,
    email: row.email,
    role: asRole(row.role),
    status: asStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function changes(result: { meta?: { changes?: number } }) {
  return Number(result.meta?.changes || 0);
}

async function activeAccessUser(db: AccessDatabase, email: string) {
  return db.prepare(`SELECT id, email, role, status, created_at, updated_at
    FROM access_users WHERE email = ? AND status = 'active' LIMIT 1`).bind(email).first<AccessUserRow>();
}

async function appendAudit(
  db: AccessDatabase,
  entry: { actorUserId?: string | null; targetUserId?: string | null; action: string; result: string; before?: unknown; after?: unknown },
) {
  await db.prepare(`INSERT INTO access_audit_log
    (id, actor_user_id, target_user_id, action, result, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
    .bind(
      crypto.randomUUID(),
      entry.actorUserId || null,
      entry.targetUserId || null,
      entry.action,
      entry.result,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
    ).run();
}

async function bootstrapOwner(db: AccessDatabase, email: string) {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO access_users (id, email, role, status, created_by, created_at, updated_at)
    SELECT ?, ?, 'owner', 'active', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (SELECT 1 FROM access_users WHERE role = 'owner' AND status = 'active')
    ON CONFLICT(email) DO UPDATE SET role = 'owner', status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE NOT EXISTS (SELECT 1 FROM access_users WHERE role = 'owner' AND status = 'active')`)
    .bind(id, email).run();
  const row = await activeAccessUser(db, email);
  if (row?.role === "owner") {
    await appendAudit(db, { targetUserId: row.id, action: "bootstrap_owner", result: "success", after: { email: row.email, role: row.role, status: row.status } });
    return row;
  }
  return null;
}

export async function authorizeCloudflarePrincipal(
  request: Request,
  db: AccessDatabase | undefined,
  bootstrapOwnerEmail: string | undefined,
): Promise<Response | null> {
  const principal = requestPrincipal(request);
  if (principal.deploymentTarget !== "cloudflare" || principal.kind === "service") return null;
  if (principal.kind !== "identity" || !principal.userId) return authenticationFailure("authorization_required", 403);
  if (!db) return authenticationFailure("access_database_unavailable", 503);
  try {
    let row = await activeAccessUser(db, principal.userId);
    if (!row && bootstrapOwnerEmail) {
      const bootstrapEmail = normalizeAccessEmail(bootstrapOwnerEmail);
      if (bootstrapEmail === principal.userId) row = await bootstrapOwner(db, principal.userId);
    }
    if (!row) return authenticationFailure("email_not_allowed", 403);
    const role = asRole(row.role);
    authorizeRequestPrincipal(request, { accessUserId: row.id, role });
    return null;
  } catch (error) {
    if (error instanceof AccessControlError && error.reasonCode === "invalid_email") {
      return authenticationFailure("access_configuration_invalid", 503);
    }
    return authenticationFailure("access_database_unavailable", 503);
  }
}

export function requireOwnerPrincipal(request: Request): RequestPrincipal {
  const principal = requestPrincipal(request);
  if (principal.kind !== "user" || principal.accessRole !== "owner" || !principal.accessUserId) {
    throw new AccessControlError("owner_required", 403);
  }
  return principal;
}

export async function listAccessUsers(db: AccessDatabase) {
  const result = await db.prepare(`SELECT id, email, role, status, created_at, updated_at
    FROM access_users ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, email`).all<AccessUserRow>();
  return (result.results || []).map(userFromRow);
}

export async function listAccessAudit(db: AccessDatabase, limit = 50) {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const result = await db.prepare(`SELECT a.id, a.action, a.result, a.created_at,
      actor.email AS actor_email, target.email AS target_email
    FROM access_audit_log a
    LEFT JOIN access_users actor ON actor.id = a.actor_user_id
    LEFT JOIN access_users target ON target.id = a.target_user_id
    ORDER BY a.created_at DESC LIMIT ?`).bind(bounded).all<Record<string, unknown>>();
  return result.results || [];
}

export async function createAccessUser(
  db: AccessDatabase,
  actor: RequestPrincipal,
  input: { email?: unknown; role?: unknown; status?: unknown },
) {
  const email = normalizeAccessEmail(input.email);
  const role = asRole(input.role ?? "member");
  const status = asStatus(input.status ?? "active");
  const id = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO access_users (id, email, role, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(id, email, role, status, actor.accessUserId || null).run();
  } catch {
    throw new AccessControlError("email_already_exists", 409);
  }
  const row = await db.prepare(`SELECT id, email, role, status, created_at, updated_at FROM access_users WHERE id = ?`)
    .bind(id).first<AccessUserRow>();
  if (!row) throw new AccessControlError("access_write_failed", 503);
  const user = userFromRow(row);
  await appendAudit(db, { actorUserId: actor.accessUserId, targetUserId: id, action: "create_user", result: "success", after: user });
  return user;
}

async function accessUserById(db: AccessDatabase, id: string) {
  const row = await db.prepare(`SELECT id, email, role, status, created_at, updated_at FROM access_users WHERE id = ? LIMIT 1`)
    .bind(id).first<AccessUserRow>();
  return row ? userFromRow(row) : null;
}

export async function updateAccessUser(
  db: AccessDatabase,
  actor: RequestPrincipal,
  id: string,
  input: { email?: unknown; role?: unknown; status?: unknown },
) {
  const before = await accessUserById(db, id);
  if (!before) throw new AccessControlError("access_user_not_found", 404);
  const email = input.email === undefined ? before.email : normalizeAccessEmail(input.email);
  const role = input.role === undefined ? before.role : asRole(input.role);
  const status = input.status === undefined ? before.status : asStatus(input.status);
  const removesActiveOwner = before.role === "owner" && before.status === "active" && (role !== "owner" || status !== "active");
  const guard = removesActiveOwner
    ? " AND (SELECT COUNT(*) FROM access_users WHERE role = 'owner' AND status = 'active') > 1"
    : "";
  let result;
  try {
    result = await db.prepare(`UPDATE access_users SET email = ?, role = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?${guard}`)
      .bind(email, role, status, id).run();
  } catch {
    throw new AccessControlError("email_already_exists", 409);
  }
  if (!changes(result)) {
    await appendAudit(db, { actorUserId: actor.accessUserId, targetUserId: id, action: "update_user", result: "last_owner_blocked", before, after: { email, role, status } });
    throw new AccessControlError("last_owner_required", 409);
  }
  const after = await accessUserById(db, id);
  await appendAudit(db, { actorUserId: actor.accessUserId, targetUserId: id, action: "update_user", result: "success", before, after });
  return after;
}

export async function deleteAccessUser(db: AccessDatabase, actor: RequestPrincipal, id: string) {
  const before = await accessUserById(db, id);
  if (!before) throw new AccessControlError("access_user_not_found", 404);
  const guard = before.role === "owner" && before.status === "active"
    ? " AND (SELECT COUNT(*) FROM access_users WHERE role = 'owner' AND status = 'active') > 1"
    : "";
  const result = await db.prepare(`DELETE FROM access_users WHERE id = ?${guard}`).bind(id).run();
  if (!changes(result)) {
    await appendAudit(db, { actorUserId: actor.accessUserId, targetUserId: id, action: "delete_user", result: "last_owner_blocked", before });
    throw new AccessControlError("last_owner_required", 409);
  }
  await appendAudit(db, { actorUserId: actor.accessUserId, targetUserId: id, action: "delete_user", result: "success", before });
  return { id };
}
