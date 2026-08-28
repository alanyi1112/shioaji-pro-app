import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile(new URL("../scripts/candle-continuity-runner.mjs", import.meta.url), "utf8");
const sites = await readFile(new URL("../.github/workflows/sites-daily-candle-continuity.yml", import.meta.url), "utf8");
const cloudflare = await readFile(new URL("../.github/workflows/cloudflare-daily-candle-continuity.yml", import.meta.url), "utf8");
const acceptance = await readFile(new URL("../scripts/verify-daily-candle-continuity.mjs", import.meta.url), "utf8");
const officialSeed = await readFile(new URL("../scripts/candle-continuity-official-seed.mjs", import.meta.url), "utf8");
const appSource = await readFile(new URL("../worker/app.ts", import.meta.url), "utf8");

test("共用 runner 固定 start/tick/fail、60 ticks、15 分鐘與 90 秒 timeout", () => {
  assert.match(runner, /orchestrator-start/);
  assert.match(runner, /orchestrator-tick/);
  assert.match(runner, /orchestrator-peek/);
  assert.match(runner, /orchestrator-fail/);
  assert.match(runner, /const maximumTicks = 60/);
  assert.match(runner, /15 \* 60 \* 1000/);
  assert.match(runner, /AbortSignal\.timeout\(90_000\)/);
  assert.match(runner, /summary\.status === "retry_waiting" && !seeded && !auditedItem \? 60_000 : 250/);
  assert.match(runner, /health\?\.continuityAudit\?\.automation/);
  assert.match(runner, /commit_sha_mismatch/);
  assert.match(runner, /health_sla_failed/);
  assert.match(runner, /seedRetryableOfficialItem/);
  assert.match(runner, /retryableOfficialReasons/);
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
  assert.match(acceptance, /seedTaiwanOfficialMonths/);
  assert.match(acceptance, /display160\.first/);
  assert.match(acceptance, /display160\.repeat/);
  assert.match(acceptance, /display320\.first/);
  assert.match(acceptance, /display320\.repeat/);
  assert.match(acceptance, /missingSessionCount/);
  assert.match(acceptance, /verifiedThrough/);
});

test("GitHub runner 官方月資料 fallback 固定 18 個月、二路並行、六筆分批且由 Worker 重驗 payload", () => {
  assert.match(officialSeed, /count = 18/);
  assert.match(officialSeed, /index \+= 2/);
  assert.match(officialSeed, /index \+= 6/);
  assert.match(officialSeed, /finalize = index \+ batch\.length >= entries\.length/);
  assert.match(officialSeed, /acceptance-cache-official-months/);
  assert.match(officialSeed, /AbortSignal\.timeout\(12_000\)/);
  assert.doesNotMatch(officialSeed, /console\.log/);
});

test("Worker 控制面沿用獨立 audit secret、三個 orchestrator action 與既有 continuity 核心", () => {
  assert.match(appSource, /env\.CANDLE_CONTINUITY_AUDIT_SECRET/);
  assert.match(appSource, /action === "orchestrator-start"/);
  assert.match(appSource, /action === "orchestrator-tick"/);
  assert.match(appSource, /action === "orchestrator-peek"/);
  assert.match(appSource, /action === "orchestrator-fail"/);
  assert.match(appSource, /candleContinuityTargetCandidates\(request, env\)/);
  assert.match(appSource, /const items = acceptanceItems/);
  assert.match(appSource, /const evidence = item\.display320\.repeat/);
  assert.match(appSource, /candleContinuityAcceptanceFromD1/);
  assert.match(appSource, /body\.acceptancePreparation === true/);
  assert.match(appSource, /action === "acceptance-cache-official-months"/);
  assert.match(appSource, /cacheTaiwanOfficialMonthPayload/);
  assert.match(appSource, /upsertCandleHistory\(env\.DB, identity, seededRows, "official-month-seed", now\)/);
  assert.match(appSource, /body\.finalize !== true/);
  assert.match(appSource, /persistCandleHistoryContinuity/);
  assert.match(appSource, /preferPersisted === true/);
  assert.match(appSource, /requiredRows: Math\.min\(320, Math\.max\(1, historyRows\.length\)\)/);
  assert.match(appSource, /body\.acceptancePreparation === true \? 320 : 160/);
  assert.match(appSource, /readCandleHistory\(env\.DB, identity, displayCount\)/);
  assert.match(appSource, /auditCandleContinuitySymbol\(env, symbol, now, 160, body\.preferPersisted === true\)/);
  assert.match(appSource, /claimCandleContinuityItems\(\{ db: env\.DB, runId, owner, limit: 1, now \}\)/);
  assert.match(appSource, /taiwanDailyContinuityOptions\(env, symbol, "1d", requestNow, 4\)/);
  assert.match(appSource, /taiwanDailyContinuityOptions\(env, symbol, "1d", requestNow\)/);
  assert.match(appSource, /SELECT \* FROM user_instruments WHERE enabled=1/);
  assert.doesNotMatch(appSource, /source: "catalog", enabled: true/);
  assert.match(appSource, /catalogBySymbol\.get\(item\.symbol\)/);
  assert.doesNotMatch(appSource, /console\.log\([^\n]*candleContinuityTargetCandidates/);
});
