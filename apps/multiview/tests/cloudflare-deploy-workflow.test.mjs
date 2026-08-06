import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/deploy-cloudflare-production.yml", import.meta.url), "utf8");

test("Cloudflare deploy 只由 main push 或手動啟動，fork PR 不取得 production environment", () => {
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request|pull_request_target/);
  assert.match(workflow, /environment: cloudflare-production/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
});

test("Cloudflare deploy 固定 singleton gates、exact SHA、protected smoke 與 rollback", () => {
  assert.match(workflow, /group: deploy-cloudflare-production/);
  assert.match(workflow, /cancel-in-progress: false/);
  for (const gate of ["npm run lint", "npm test", "openspec validate --all --strict", "git diff --check", "cloudflare:budget", "deploy --dry-run", "d1 migrations apply", "wrangler deploy", "Protected smoke", "wrangler rollback"]) assert.match(workflow, new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(workflow, /APP_COMMIT_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /\.commitSha == \$sha/);
  assert.match(workflow, /\.\[-1\]\.versions\[0\]\.version_id/);
  assert.match(workflow, /for attempt in \$\(seq 1 12\)/);
  assert.match(workflow, /sleep 5/);
  assert.match(workflow, /commitMatches=/);
  assert.match(workflow, /CF-Access-Client-Id/);
  assert.match(workflow, /CF-Access-Client-Secret/);
  assert.match(workflow, /CLOUDFLARE_SITE_URL: \$\{\{ vars\.CLOUDFLARE_SITE_URL \}\}/);
  assert.match(workflow, /TDCC_HISTORY_AUTOMATION_ENABLED: \$\{\{ vars\.TDCC_HISTORY_AUTOMATION_ENABLED \}\}/);
  assert.match(workflow, /case "\$TDCC_HISTORY_AUTOMATION_ENABLED" in true\|false/);
  assert.doesNotMatch(workflow, /echo\s+"?\$CLOUDFLARE_(?:API_TOKEN|ACCESS_CLIENT_SECRET)/);
});
