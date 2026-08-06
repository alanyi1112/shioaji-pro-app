import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, app, styles, worker, accessControl, migration, workflow, docs] = await Promise.all([
  readFile(new URL("../public/static/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/app.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/access-control.ts", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0017_messy_magik.sql", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deploy-cloudflare-production.yml", import.meta.url), "utf8"),
  readFile(new URL("../docs/cloudflare-deployment.md", import.meta.url), "utf8"),
]);

test("owner 才會看到登入名單入口，管理視窗提供新增、修改、停用與刪除操作", () => {
  assert.match(html, /id="access-manage"[^>]*hidden[^>]*>登入名單/);
  assert.match(html, /id="access-dialog"[^>]*aria-labelledby="access-title"/);
  assert.match(html, /id="access-close"[^>]*type="button"/);
  assert.match(html, /id="access-create-email"[^>]*type="email"/);
  assert.match(html, /id="access-create-role"/);
  assert.match(html, /id="access-user-list"/);
  assert.match(html, /修改 email 只會改變日後登入權限，不會自動移轉/);
  assert.match(app, /accessButton\.hidden = !state\.appConfig\.canManageAccess/);
  assert.match(app, /getElementById\("access-close"\)[\s\S]*dialog\?\.close\(\)/);
  assert.match(app, /\/api\/admin\/access-users/);
  assert.match(app, /method: "PATCH"/);
  assert.match(app, /method: "DELETE"/);
  assert.match(styles, /\.access-dialog\s*\{/);
});

test("管理 API 只接受 owner principal 且 config 不把完整名單暴露給一般成員", () => {
  assert.match(worker, /import\s*\{[\s\S]*?createAccessUser,[\s\S]*?\}\s*from "\.\/access-control";/);
  assert.match(worker, /requireOwnerPrincipal\(request\)/);
  assert.match(worker, /path\.startsWith\("\/api\/admin\/access-"\)/);
  assert.match(worker, /canManageAccess: principal\.accessRole === "owner"/);
  assert.match(worker, /await createAccessUser\(env\.DB, owner, input\)/);
  assert.doesNotMatch(worker, /reasonCode: "single_owner_mode"/);
  assert.doesNotMatch(worker, /CLOUDFLARE_ACCESS_ALLOWED_EMAILS/);
  assert.match(accessControl, /principal\.accessRole !== "owner"/);
  assert.match(accessControl, /last_owner_required/);
  assert.match(accessControl, /email_already_exists/);
});

test("D1 migration 與部署設定使用動態名單、稽核及 hosted owner secret", () => {
  assert.match(migration, /CREATE TABLE `access_users`/);
  assert.match(migration, /CREATE UNIQUE INDEX `access_users_email_idx`/);
  assert.match(migration, /CREATE TABLE `access_audit_log`/);
  assert.match(workflow, /CLOUDFLARE_ACCESS_TEAM_DOMAIN/);
  assert.match(workflow, /CLOUDFLARE_ACCESS_AUD/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_ACCESS_OWNER_EMAIL/);
  assert.match(docs, /ACCESS_OWNER_EMAIL.*hosted secret/);
  assert.doesNotMatch(docs, /CLOUDFLARE_ACCESS_ALLOWED_EMAILS/);
});
