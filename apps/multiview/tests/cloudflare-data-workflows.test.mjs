import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tdcc = await readFile(new URL("../.github/workflows/cloudflare-tdcc-continuous-backfill.yml", import.meta.url), "utf8");
const dailyChip = await readFile(new URL("../.github/workflows/cloudflare-taiwan-stock-chip-daily-backfill.yml", import.meta.url), "utf8");
const pe = await readFile(new URL("../.github/workflows/cloudflare-pe-river-continuous-backfill.yml", import.meta.url), "utf8");
const peRunner = await readFile(new URL("../scripts/pe-river-continuous-backfill.mjs", import.meta.url), "utf8");
const tdccRunner = await readFile(new URL("../scripts/tdcc-history-backfill.mjs", import.meta.url), "utf8");

test("Cloudflare 資料排程與 Sites 使用獨立 environment、concurrency、run ID 與 URL", () => {
  for (const workflow of [tdcc, dailyChip, pe]) {
    assert.match(workflow, /environment: cloudflare-production/);
    assert.match(workflow, /vars\.CLOUDFLARE_SITE_URL/);
    assert.match(workflow, /secrets\.CLOUDFLARE_ACCESS_CLIENT_ID/);
    assert.match(workflow, /secrets\.CLOUDFLARE_ACCESS_CLIENT_SECRET/);
    assert.doesNotMatch(workflow, /SITES_BYPASS_TOKEN/);
    assert.doesNotMatch(workflow, /quote-chart-multiview\.alanyi1112\.chatgpt\.site/);
    assert.doesNotMatch(workflow, /set -x|echo\s+.*ACCESS_CLIENT_SECRET/);
    assert.match(workflow + peRunner + tdccRunner, /X-MultiChart-Pipeline-Authorization/);
  }
  assert.match(tdcc, /group: cloudflare-tdcc-continuous-backfill/);
  assert.match(tdcc, /RUN_ID: cloudflare-tdcc-gha-/);
  assert.match(pe, /group: cloudflare-pe-river-continuous-backfill/);
  assert.match(pe, /cloudflare-pe-river-gha-/);
});

test("兩個資料 runner 可選 Sites bypass 或 Cloudflare Access Service Token", () => {
  for (const runner of [peRunner, tdccRunner]) {
    assert.match(runner, /SITES_BYPASS_TOKEN/);
    assert.match(runner, /CLOUDFLARE_ACCESS_CLIENT_ID/);
    assert.match(runner, /CLOUDFLARE_ACCESS_CLIENT_SECRET/);
    assert.match(runner, /CF-Access-Client-Id/);
    assert.match(runner, /CF-Access-Client-Secret/);
    assert.match(runner, /X-MultiChart-Pipeline-Authorization/);
  }
});

test("Cloudflare TDCC 與本益比排程保留既有頻率和安全摘要", () => {
  assert.match(tdcc, /30 14 \* \* 6,0/);
  assert.match(tdcc, /CHIP_BACKFILL_SCOPE: tdcc-weekly/);
  assert.match(tdcc, /orchestrator-start/);
  assert.match(tdcc, /orchestrator-tick/);
  assert.match(tdcc, /orchestrator-fail/);
  assert.match(tdcc, /cloudflare-chip-orchestrator tick=/);
  assert.match(tdcc, /--history-only/);
  assert.match(dailyChip, /30 14 \* \* \*/);
  assert.match(dailyChip, /CHIP_BACKFILL_SCOPE: daily/);
  assert.doesNotMatch(dailyChip, /--history-only|actions\/checkout/);
  assert.match(pe, /30 11 \* \* 1-5/);
  assert.match(pe, /30 15 \* \* 1-5/);
});

test("Cloudflare 資料排程以 Service Token 保存同一 run 的 protected health 安全摘要", () => {
  for (const workflow of [tdcc, dailyChip, pe]) {
    assert.match(workflow, /name: Verify protected health/);
    assert.match(workflow, /CF-Access-Client-Id/);
    assert.match(workflow, /CF-Access-Client-Secret/);
    assert.match(workflow, /\$SITE_URL\/api\/health/);
    assert.match(workflow, /\.deploymentTarget == "cloudflare"/);
    assert.match(workflow, /\.commitSha == \$sha/);
    assert.match(workflow, /\.persistence\.d1 == true/);
    assert.doesNotMatch(workflow, /echo\s+"?\$response/);
  }
  assert.match(pe, /cloudflare-pe-health status=healthy/);
  assert.match(pe, /continuous\.scheduler\.heartbeatAt/);
  assert.match(dailyChip, /backgroundOrchestrator\.runId == \$run/);
  assert.match(dailyChip, /backgroundOrchestrator\.scope == "daily"/);
  assert.match(dailyChip, /cloudflare-chip-daily-health status=healthy/);
  assert.match(tdcc, /shareholderDistributionContinuous\.lastRunId == \$run/);
  assert.match(tdcc, /shareholderDistributionContinuous\.lastRunTrigger == \$trigger/);
  assert.match(tdcc, /shareholderDistributionContinuous\.lastRunStatus == "completed"/);
  assert.doesNotMatch(tdcc, /backgroundOrchestrator\.runId == \$run/);
  assert.match(tdcc, /shareholderDistributionContinuous\.lastHeartbeatAt/);
  assert.match(tdcc, /cloudflare-tdcc-health status=healthy/);
});
