import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile(new URL("../scripts/candle-continuity-runner.mjs", import.meta.url), "utf8");
const sites = await readFile(new URL("../.github/workflows/sites-daily-candle-continuity.yml", import.meta.url), "utf8");
const cloudflare = await readFile(new URL("../.github/workflows/cloudflare-daily-candle-continuity.yml", import.meta.url), "utf8");
const acceptance = await readFile(new URL("../scripts/verify-daily-candle-continuity.mjs", import.meta.url), "utf8");
const appSource = await readFile(new URL("../worker/app.ts", import.meta.url), "utf8");

test("共用 runner 固定 start/tick/fail、60 ticks、15 分鐘與 90 秒 timeout", () => {
  assert.match(runner, /orchestrator-start/);
  assert.match(runner, /orchestrator-tick/);
  assert.match(runner, /orchestrator-fail/);
  assert.match(runner, /const maximumTicks = 60/);
  assert.match(runner, /15 \* 60 \* 1000/);
  assert.match(runner, /AbortSignal\.timeout\(90_000\)/);
  assert.match(runner, /summary\.status === "retry_waiting" \? 60_000 : 250/);
  assert.match(runner, /health\?\.continuityAudit\?\.automation/);
  assert.match(runner, /commit_sha_mismatch/);
  assert.match(runner, /health_sla_failed/);
  assert.doesNotMatch(runner, /console\.log\([^\n]*(auditSecret|sitesBypassToken|cloudflareClientSecret)/);
});

test("Sites workflow 有獨立單例、台北 23:00、最小權限與 target-specific secret", () => {
  assert.match(sites, /cron: "0 15 \* \* \*"/);
  assert.match(sites, /group: sites-daily-candle-continuity/);
  assert.match(sites, /cancel-in-progress: false/);
  assert.match(sites, /permissions:\n  contents: read/);
  assert.match(sites, /DEPLOYMENT_TARGET: sites/);
  assert.match(sites, /RUN_ID: sites-gha-/);
  assert.match(sites, /SITES_CANDLE_CONTINUITY_AUDIT_SECRET/);
  assert.match(sites, /workflow_dispatch:/);
  assert.match(sites, /timeout-minutes: 20/);
  assert.match(sites, /vars\.SITES_CANDLE_CONTINUITY_SCHEDULE_ENABLED == 'true'/);
});

test("Cloudflare workflow 有獨立單例、台北 23:30、Access principal 與 production environment", () => {
  assert.match(cloudflare, /cron: "30 15 \* \* \*"/);
  assert.match(cloudflare, /group: cloudflare-daily-candle-continuity/);
  assert.match(cloudflare, /environment: cloudflare-production/);
  assert.match(cloudflare, /DEPLOYMENT_TARGET: cloudflare/);
  assert.match(cloudflare, /RUN_ID: cloudflare-gha-/);
  assert.match(cloudflare, /CLOUDFLARE_ACCESS_CLIENT_ID/);
  assert.match(cloudflare, /CLOUDFLARE_ACCESS_CLIENT_SECRET/);
  assert.match(cloudflare, /CLOUDFLARE_CANDLE_CONTINUITY_AUDIT_SECRET/);
  assert.match(cloudflare, /workflow_dispatch:/);
  assert.match(cloudflare, /vars\.CLOUDFLARE_CANDLE_CONTINUITY_SCHEDULE_ENABLED == 'true'/);
});

test("兩環境 workflow 使用不同 schedule、run prefix、concurrency 與 secret context", () => {
  assert.notEqual(sites.match(/cron: "([^"]+)"/)[1], cloudflare.match(/cron: "([^"]+)"/)[1]);
  assert.notEqual(sites.match(/group: ([^\n]+)/)[1], cloudflare.match(/group: ([^\n]+)/)[1]);
  assert.doesNotMatch(sites, /CLOUDFLARE_ACCESS_CLIENT_SECRET/);
  assert.doesNotMatch(cloudflare, /SITES_BYPASS_TOKEN/);
});

test("代表性驗收固定大立光、上櫃、ETF 與新加入商品並核對 160/320 cache reuse", () => {
  assert.match(acceptance, /3008\.TW,5483\.TWO,0050\.TW,4768\.TWO/);
  assert.match(acceptance, /representativeSymbols\.length !== 4/);
  assert.match(acceptance, /for \(const symbol of representativeSymbols\)/);
  assert.match(acceptance, /symbols: \[symbol\], limit: 1/);
  assert.match(acceptance, /acceptancePreparation: true/);
  assert.match(acceptance, /responseAcceptance = await requestAcceptance\(symbol\)/);
  assert.match(acceptance, /auditItemFromAcceptance\(responseAcceptance\)/);
  assert.match(acceptance, /display160\.first/);
  assert.match(acceptance, /display160\.repeat/);
  assert.match(acceptance, /display320\.first/);
  assert.match(acceptance, /display320\.repeat/);
  assert.match(acceptance, /missingSessionCount/);
  assert.match(acceptance, /verifiedThrough/);
});

test("Worker 控制面沿用獨立 audit secret、三個 orchestrator action 與既有 continuity 核心", () => {
  assert.match(appSource, /env\.CANDLE_CONTINUITY_AUDIT_SECRET/);
  assert.match(appSource, /action === "orchestrator-start"/);
  assert.match(appSource, /action === "orchestrator-tick"/);
  assert.match(appSource, /action === "orchestrator-fail"/);
  assert.match(appSource, /candleContinuityTargetCandidates\(request, env\)/);
  assert.match(appSource, /const items = acceptanceItems/);
  assert.match(appSource, /const evidence = item\.display320\.repeat/);
  assert.match(appSource, /candleContinuityAcceptanceFromD1/);
  assert.match(appSource, /body\.acceptancePreparation === true/);
  assert.match(appSource, /readCandleHistory\(env\.DB, identity, displayCount\)/);
  assert.match(appSource, /auditCandleContinuitySymbol\(env, symbol, now\)/);
  assert.match(appSource, /claimCandleContinuityItems\(\{ db: env\.DB, runId, owner, limit: 1, now \}\)/);
  assert.match(appSource, /taiwanDailyContinuityOptions\(env, symbol, "1d", requestNow, 4\)/);
  assert.match(appSource, /taiwanDailyContinuityOptions\(env, symbol, "1d", requestNow\)/);
  assert.match(appSource, /SELECT \* FROM user_instruments WHERE enabled=1/);
  assert.doesNotMatch(appSource, /source: "catalog", enabled: true/);
  assert.match(appSource, /catalogBySymbol\.get\(item\.symbol\)/);
  assert.doesNotMatch(appSource, /console\.log\([^\n]*candleContinuityTargetCandidates/);
});
