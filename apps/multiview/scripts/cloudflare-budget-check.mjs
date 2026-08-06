import { gzipSync } from "node:zlib";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const serverEntry = resolve(root, "dist/server/index.js");
const assetRoot = resolve(root, "dist/client");
const limits = {
  gzipWorkerBytes: 3 * 1024 * 1024,
  assetFiles: 20_000,
  singleAssetBytes: 25 * 1024 * 1024,
  d1BatchStatements: 40,
  dailyRequests: 100_000,
  dailyD1RowsRead: 5_000_000,
  dailyD1RowsWritten: 100_000,
  safetyDailyRequests: 50_000,
  safetyDailyD1RowsRead: 3_500_000,
  safetyDailyD1RowsWritten: 50_000,
  dailyDurableObjectRequests: 100_000,
  dailyDurableObjectGbSeconds: 13_000,
  safetyDailyDurableObjectRequests: 50_000,
  safetyDailyDurableObjectGbSeconds: 6_500,
};

const privateSmallGroupScenario = {
  members: 3,
  chartsPerPage: 8,
  visibleHoursPerMember: 8,
  openHours: 4.5,
  openPollSeconds: 30,
  closedPollSeconds: 300,
  dailyChartCacheSeconds: 300,
  historyRowsPerChartRead: 160,
  historyFreshnessSeconds: 900,
  d1IndexWriteMultiplier: 2,
  scheduledRowsReadHeadroom: 250_000,
  scheduledRowsWrittenHeadroom: 20_000,
  otherRequestHeadroom: 5_000,
};

const realtimeSingleOwnerScenario = {
  members: 1,
  chartsPerPage: 8,
  activeSymbols: 32,
  openHours: 4.5,
  microbatchSeconds: 1,
  inboundMessagesPerRequest: 20,
  durableObjectMemoryGb: 0.125,
};

function estimatePrivateSmallGroupUsage(scenario) {
  const closedHours = Math.max(0, scenario.visibleHoursPerMember - scenario.openHours);
  const pollsPerMember = Math.ceil(scenario.openHours * 3600 / scenario.openPollSeconds)
    + Math.ceil(closedHours * 3600 / scenario.closedPollSeconds);
  const batchRequests = scenario.members * pollsPerMember;
  const batchMisses = scenario.members * Math.ceil(scenario.visibleHoursPerMember * 3600 / scenario.dailyChartCacheSeconds);
  const historyRefreshes = scenario.members * scenario.chartsPerPage * Math.ceil(scenario.visibleHoursPerMember * 3600 / scenario.historyFreshnessSeconds);
  return {
    requests: batchRequests + scenario.otherRequestHeadroom,
    d1RowsRead: batchRequests
      + batchMisses * scenario.chartsPerPage * (1 + scenario.historyRowsPerChartRead)
      + scenario.scheduledRowsReadHeadroom,
    d1RowsWritten: batchMisses * (scenario.chartsPerPage + 1) * scenario.d1IndexWriteMultiplier
      + historyRefreshes * scenario.d1IndexWriteMultiplier
      + scenario.scheduledRowsWrittenHeadroom,
    batchRequests,
    batchMisses,
    historyRefreshes,
  };
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const workerSource = await readFile(serverEntry);
const gzipWorkerBytes = gzipSync(workerSource).byteLength;
const assets = await walk(assetRoot);
const sizes = await Promise.all(assets.map(async (path) => ({ path, bytes: (await stat(path)).size })));
const largestAsset = sizes.sort((a, b) => b.bytes - a.bytes)[0] || { path: "", bytes: 0 };
const sourceFiles = await walk(resolve(root, "worker"));
const unsafeBatches = [];
for (const path of sourceFiles.filter((item) => item.endsWith(".ts"))) {
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(/index\s*\+=\s*(\d+)/g)) {
    if (Number(match[1]) > limits.d1BatchStatements) unsafeBatches.push(`${relative(root, path)}:${match[1]}`);
  }
}

const usage = estimatePrivateSmallGroupUsage(privateSmallGroupScenario);
const realtimeUsage = {
  inboundMessages: Math.ceil(realtimeSingleOwnerScenario.openHours * 3600 / realtimeSingleOwnerScenario.microbatchSeconds),
  durableObjectRequests: Math.ceil(
    Math.ceil(realtimeSingleOwnerScenario.openHours * 3600 / realtimeSingleOwnerScenario.microbatchSeconds)
      / realtimeSingleOwnerScenario.inboundMessagesPerRequest,
  ) + realtimeSingleOwnerScenario.members * 2,
  durableObjectGbSeconds: realtimeSingleOwnerScenario.openHours * 3600 * realtimeSingleOwnerScenario.durableObjectMemoryGb,
  d1TickWrites: 0,
};
const realtimeSources = await Promise.all([
  readFile(resolve(root, "worker/realtime-hub.ts"), "utf8"),
  readFile(resolve(root, "worker/realtime-routing.ts"), "utf8"),
]);
const realtimeD1Writes = realtimeSources.some((source) => /\bDB\s*\.\s*prepare\s*\(/.test(source));

const checks = [
  ["worker gzip", gzipWorkerBytes <= limits.gzipWorkerBytes, gzipWorkerBytes, limits.gzipWorkerBytes],
  ["asset count", assets.length <= limits.assetFiles, assets.length, limits.assetFiles],
  ["largest asset", largestAsset.bytes <= limits.singleAssetBytes, largestAsset.bytes, limits.singleAssetBytes],
  ["estimated daily requests", usage.requests <= limits.safetyDailyRequests, usage.requests, limits.safetyDailyRequests],
  ["estimated daily D1 rows read", usage.d1RowsRead <= limits.safetyDailyD1RowsRead, usage.d1RowsRead, limits.safetyDailyD1RowsRead],
  ["estimated daily D1 rows written", usage.d1RowsWritten <= limits.safetyDailyD1RowsWritten, usage.d1RowsWritten, limits.safetyDailyD1RowsWritten],
  ["D1 batch source scan", unsafeBatches.length === 0, unsafeBatches.length, 0],
  ["estimated daily Durable Object requests", realtimeUsage.durableObjectRequests <= limits.safetyDailyDurableObjectRequests, realtimeUsage.durableObjectRequests, limits.safetyDailyDurableObjectRequests],
  ["estimated daily Durable Object GB-s", realtimeUsage.durableObjectGbSeconds <= limits.safetyDailyDurableObjectGbSeconds, realtimeUsage.durableObjectGbSeconds, limits.safetyDailyDurableObjectGbSeconds],
  ["realtime D1 tick writes", !realtimeD1Writes && realtimeUsage.d1TickWrites === 0, realtimeD1Writes ? 1 : 0, 0],
];
for (const [label, ok, actual, limit] of checks) console.log(`cloudflare-budget: ${ok ? "pass" : "fail"} ${label} actual=${actual} limit=${limit}`);
console.log(`cloudflare-budget: scenario members=${privateSmallGroupScenario.members} charts=${privateSmallGroupScenario.chartsPerPage} visible_hours=${privateSmallGroupScenario.visibleHoursPerMember} batch_requests=${usage.batchRequests} batch_misses=${usage.batchMisses} history_refreshes=${usage.historyRefreshes}`);
console.log(`cloudflare-budget: official-free requests=${limits.dailyRequests} d1_rows_read=${limits.dailyD1RowsRead} d1_rows_written=${limits.dailyD1RowsWritten}`);
console.log(`cloudflare-budget: realtime members=${realtimeSingleOwnerScenario.members} charts=${realtimeSingleOwnerScenario.chartsPerPage} active_symbols=${realtimeSingleOwnerScenario.activeSymbols} inbound_messages=${realtimeUsage.inboundMessages} do_requests=${realtimeUsage.durableObjectRequests} do_gb_seconds=${realtimeUsage.durableObjectGbSeconds} d1_tick_writes=${realtimeUsage.d1TickWrites}`);
console.log(`cloudflare-budget: official-free do_requests=${limits.dailyDurableObjectRequests} do_gb_seconds=${limits.dailyDurableObjectGbSeconds}`);
console.log("cloudflare-budget: cpu=requires-production-observation static_guard=batch-cache-and-bounded-work");
if (largestAsset.path) console.log(`cloudflare-budget: largest=${relative(root, largestAsset.path)}`);
if (unsafeBatches.length) console.error(`cloudflare-budget: unsafe batches ${unsafeBatches.join(",")}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
