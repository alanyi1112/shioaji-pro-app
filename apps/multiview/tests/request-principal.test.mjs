import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  authorizeCloudflarePrincipal,
  createAccessUser,
  deleteAccessUser,
  listAccessAudit,
  listAccessUsers,
  requireOwnerPrincipal,
  updateAccessUser,
} from "../worker/access-control.ts";
import {
  prepareRequestPrincipal,
  requestPrincipal,
  requestUserId,
} from "../worker/request-principal.ts";

const issuer = "https://multichart-test.cloudflareaccess.com";
const audience = "multichart-production-audience";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = await exportJWK(publicKey);
const jwksFetch = async () => Response.json({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] });
const migration = await readFile(new URL("../drizzle/0017_messy_magik.sql", import.meta.url), "utf8");

function cloudflareEnv(overrides = {}) {
  return {
    DEPLOYMENT_TARGET: "cloudflare",
    ACCESS_TEAM_DOMAIN: issuer,
    ACCESS_AUD: audience,
    ...overrides,
  };
}

async function accessToken({ email, aud = audience, expiresIn = "5m", extra = {} } = {}) {
  let token = new SignJWT({ ...(email ? { email } : {}), ...extra })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(aud)
    .setIssuedAt();
  token = typeof expiresIn === "number" ? token.setExpirationTime(expiresIn) : token.setExpirationTime(expiresIn);
  return token.sign(privateKey);
}

function accessRequest(path, token, headers = {}) {
  return new Request(`https://multichart.example${path}`, {
    headers: { ...headers, ...(token ? { "cf-access-jwt-assertion": token } : {}) },
  });
}

function accessDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
  return {
    sqlite,
    prepare(query) {
      const statement = sqlite.prepare(query);
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return statement.get(...values) || null; },
        async all() { return { results: statement.all(...values) }; },
        async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
  };
}

function ownerPrincipal(id = "owner-1", email = "owner@example.com") {
  return { kind: "user", deploymentTarget: "cloudflare", userId: email, accessUserId: id, accessRole: "owner" };
}

test("Codex Sites 只從平台可信 header 建立使用者 principal", async () => {
  const request = new Request("https://site.example/api/instruments", {
    headers: { "oai-authenticated-user-email": "Alice@Example.com" },
  });
  assert.equal(await prepareRequestPrincipal(request, { DEPLOYMENT_TARGET: "codex-sites" }), null);
  assert.deepEqual(requestPrincipal(request), {
    kind: "user",
    deploymentTarget: "codex-sites",
    userId: "alice@example.com",
  });
});

test("Cloudflare Access JWT 只建立待授權身分，D1 active owner 與 member 通過後才成為使用者", async () => {
  const db = accessDb();
  db.sqlite.prepare("INSERT INTO access_users (id, email, role, status) VALUES (?, ?, 'member', 'active')").run("alice-1", "alice@example.com");
  db.sqlite.prepare("INSERT INTO access_users (id, email, role, status) VALUES (?, ?, 'owner', 'active')").run("owner-1", "owner@example.com");
  const member = accessRequest("/api/instruments", await accessToken({ email: "Alice@Example.com" }));
  assert.equal(await prepareRequestPrincipal(member, cloudflareEnv(), { fetchImpl: jwksFetch }), null);
  assert.equal(requestPrincipal(member).kind, "identity");
  assert.equal(await authorizeCloudflarePrincipal(member, db), null);
  assert.equal(requestUserId(member), "alice@example.com");
  assert.equal(requestPrincipal(member).kind, "user");
  assert.equal(requestPrincipal(member).accessRole, "member");

  const owner = accessRequest("/api/instruments", await accessToken({ email: "Owner@Example.com" }));
  assert.equal(await prepareRequestPrincipal(owner, cloudflareEnv(), { fetchImpl: jwksFetch }), null);
  assert.equal(await authorizeCloudflarePrincipal(owner, db), null);
  assert.equal(requestUserId(owner), "owner@example.com");
  assert.equal(requestPrincipal(owner).kind, "user");
  assert.equal(requestPrincipal(owner).accessRole, "owner");
});

test("Cloudflare 模式不信任偽造的 Codex Sites email header", async () => {
  const request = accessRequest("/api/instruments", "", { "oai-authenticated-user-email": "alice@example.com" });
  const response = await prepareRequestPrincipal(request, cloudflareEnv(), { fetchImpl: jwksFetch });
  assert.equal(response?.status, 403);
  assert.deepEqual(await response?.json(), { ok: false, reasonCode: "missing_access_token" });
});

test("Cloudflare Access 拒絕錯誤 audience 與過期 token", async () => {
  const cases = [
    accessToken({ email: "alice@example.com", aud: "wrong-audience" }),
    accessToken({ email: "alice@example.com", expiresIn: Math.floor(Date.now() / 1000) - 60 }),
  ];
  for (const promise of cases) {
    const request = accessRequest("/api/instruments", await promise);
    const response = await prepareRequestPrincipal(request, cloudflareEnv(), { fetchImpl: jwksFetch });
    assert.equal(response?.status, 403);
    assert.equal((await response?.json()).ok, false);
  }
});

test("未列名或 inactive Google 身分 fail closed 且不建立個人資料", async () => {
  const db = accessDb();
  db.sqlite.prepare("INSERT INTO access_users (id, email, role, status) VALUES (?, ?, 'member', 'inactive')").run("inactive-1", "inactive@example.com");
  for (const email of ["unknown@example.com", "inactive@example.com"]) {
    const request = accessRequest("/api/instruments", await accessToken({ email }));
    await prepareRequestPrincipal(request, cloudflareEnv(), { fetchImpl: jwksFetch });
    const response = await authorizeCloudflarePrincipal(request, db);
    assert.equal(response?.status, 403);
    assert.deepEqual(await response?.json(), { ok: false, reasonCode: "email_not_allowed" });
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM access_users").get().count, 1);
});

test("hosted secret 只在沒有 active owner 時 bootstrap 精確相符的第一位擁有者", async () => {
  const db = accessDb();
  const request = accessRequest("/", await accessToken({ email: "Owner@Example.com" }));
  await prepareRequestPrincipal(request, cloudflareEnv(), { fetchImpl: jwksFetch });
  assert.equal(await authorizeCloudflarePrincipal(request, db, " owner@example.com "), null);
  assert.equal(requestPrincipal(request).accessRole, "owner");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM access_users WHERE role = 'owner' AND status = 'active'").get().count, 1);

  const other = accessRequest("/", await accessToken({ email: "other@example.com" }));
  await prepareRequestPrincipal(other, cloudflareEnv(), { fetchImpl: jwksFetch });
  const denied = await authorizeCloudflarePrincipal(other, db, "other@example.com");
  assert.equal(denied?.status, 403);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM access_users").get().count, 1);
});

test("Cloudflare service principal 僅能通過 health 與 internal 路徑的 Access 層且不依賴人員名單", async () => {
  const token = await accessToken({ extra: { common_name: "github-deploy" } });
  const health = accessRequest("/api/health", token);
  assert.equal(await prepareRequestPrincipal(health, cloudflareEnv(), { fetchImpl: jwksFetch }), null);
  assert.equal(await authorizeCloudflarePrincipal(health, undefined), null);
  assert.equal(requestPrincipal(health).kind, "service");

  const internal = accessRequest("/api/internal/pe-river/tick", token);
  assert.equal(await prepareRequestPrincipal(internal, cloudflareEnv(), { fetchImpl: jwksFetch }), null);
  assert.equal(requestPrincipal(internal).kind, "service");

  const personal = accessRequest("/api/instruments", token);
  const response = await prepareRequestPrincipal(personal, cloudflareEnv(), { fetchImpl: jwksFetch });
  assert.equal(response?.status, 403);
  assert.deepEqual(await response?.json(), { ok: false, reasonCode: "user_email_missing" });
});

test("Cloudflare production 缺少 Access 設定時 fail closed", async () => {
  const request = accessRequest("/api/health", await accessToken({ email: "alice@example.com" }));
  const response = await prepareRequestPrincipal(request, { DEPLOYMENT_TARGET: "cloudflare" }, { fetchImpl: jwksFetch });
  assert.equal(response?.status, 503);
  assert.deepEqual(await response?.json(), { ok: false, reasonCode: "access_configuration_missing" });
});

test("owner 可增改停用刪除名單，email 正規化唯一且管理動作保留稽核", async () => {
  const db = accessDb();
  db.sqlite.prepare("INSERT INTO access_users (id, email, role, status) VALUES (?, ?, 'owner', 'active')").run("owner-1", "owner@example.com");
  const actor = ownerPrincipal();
  const created = await createAccessUser(db, actor, { email: " Member@Example.com ", role: "member", status: "active" });
  assert.equal(created.email, "member@example.com");
  await assert.rejects(createAccessUser(db, actor, { email: "MEMBER@example.com" }), (error) => error.reasonCode === "email_already_exists");
  const updated = await updateAccessUser(db, actor, created.id, { email: "next@example.com", status: "inactive" });
  assert.equal(updated.email, "next@example.com");
  assert.equal(updated.status, "inactive");
  await deleteAccessUser(db, actor, created.id);
  assert.deepEqual((await listAccessUsers(db)).map((user) => user.email), ["owner@example.com"]);
  assert.deepEqual((await listAccessAudit(db)).map((entry) => entry.action), ["delete_user", "update_user", "create_user"]);
});

test("相同 email 重新加入後沿用既有個人資料鍵，不以新的 access row id 建立空白身分", async () => {
  const db = accessDb();
  db.sqlite.exec("CREATE TABLE user_tabs (user_id TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY(user_id,id))");
  db.sqlite.prepare("INSERT INTO access_users (id, email, role, status) VALUES (?, ?, 'owner', 'active')").run("owner-1", "owner@example.com");
  db.sqlite.prepare("INSERT INTO user_tabs (user_id, id, label) VALUES (?, ?, ?)").run("member@example.com", "saved-tab", "保留清單");
  const first = await createAccessUser(db, ownerPrincipal(), { email: "member@example.com", role: "member", status: "active" });
  await deleteAccessUser(db, ownerPrincipal(), first.id);
  const recreated = await createAccessUser(db, ownerPrincipal(), { email: " Member@Example.com ", role: "member", status: "active" });
  assert.notEqual(recreated.id, first.id);

  const request = accessRequest("/api/instruments", await accessToken({ email: "MEMBER@example.com" }));
  assert.equal(await prepareRequestPrincipal(request, cloudflareEnv(), { fetchImpl: jwksFetch }), null);
  assert.equal(await authorizeCloudflarePrincipal(request, db), null);
  assert.equal(requestUserId(request), "member@example.com");
  assert.equal(requestPrincipal(request).accessUserId, recreated.id);
  const savedTab = db.sqlite.prepare("SELECT id, label FROM user_tabs WHERE user_id = ?").get(requestUserId(request));
  assert.equal(savedTab.id, "saved-tab");
  assert.equal(savedTab.label, "保留清單");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM user_tabs WHERE user_id = ?").get(recreated.id).count, 0);
});

test("最後一位 active owner 無法被停用、降級或刪除，一般 member 無管理權", async () => {
  const db = accessDb();
  db.sqlite.prepare("INSERT INTO access_users (id, email, role, status) VALUES (?, ?, 'owner', 'active')").run("owner-1", "owner@example.com");
  const actor = ownerPrincipal();
  await assert.rejects(updateAccessUser(db, actor, "owner-1", { status: "inactive" }), (error) => error.reasonCode === "last_owner_required");
  await assert.rejects(updateAccessUser(db, actor, "owner-1", { role: "member" }), (error) => error.reasonCode === "last_owner_required");
  await assert.rejects(deleteAccessUser(db, actor, "owner-1"), (error) => error.reasonCode === "last_owner_required");
  assert.equal(db.sqlite.prepare("SELECT role, status FROM access_users WHERE id = 'owner-1'").get().role, "owner");
  assert.throws(() => requireOwnerPrincipal({ ...actor, accessRole: "member" }), (error) => error.reasonCode === "owner_required");
  assert.equal((await listAccessAudit(db)).every((entry) => entry.result === "last_owner_blocked"), true);
});
