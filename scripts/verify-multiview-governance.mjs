import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const appRoot = join(root, "apps", "multiview");
const requiredFiles = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/Apache-2.0.txt",
  "UPSTREAM.md",
  "package-lock.json",
  "public/static/index.html",
];

for (const relativePath of requiredFiles) {
  const info = await stat(join(appRoot, relativePath));
  if (!info.isFile()) throw new Error(`缺少必要檔案：${relativePath}`);
}

const packageJson = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
if (packageJson.license !== "AGPL-3.0-only") {
  throw new Error("MultiView package license 必須是 AGPL-3.0-only");
}
if (packageJson.dependencies?.["lightweight-charts"] !== "5.0.9") {
  throw new Error("lightweight-charts 必須固定為 5.0.9");
}

const packageLock = JSON.parse(await readFile(join(appRoot, "package-lock.json"), "utf8"));
const lockedChart = packageLock.packages?.["node_modules/lightweight-charts"];
if (lockedChart?.version !== "5.0.9" || lockedChart?.license !== "Apache-2.0") {
  throw new Error("package-lock 未固定 Apache-2.0 的 lightweight-charts 5.0.9");
}

const html = await readFile(join(appRoot, "public", "static", "index.html"), "utf8");
if (!html.includes("/vendor/lightweight-charts.standalone.production.js?v=5.0.9")) {
  throw new Error("MultiView 未從本機固定 bundle 載入 Lightweight Charts");
}
if (!html.includes("https://www.tradingview.com/") || !html.includes("noopener noreferrer")) {
  throw new Error("MultiView 缺少安全的 TradingView attribution");
}

const runtimeFiles = [
  "public/static/index.html",
  "public/static/app.js",
  "public/static/chip-panes.js",
];
for (const relativePath of runtimeFiles) {
  const source = await readFile(join(appRoot, relativePath), "utf8");
  if (/https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)/i.test(source)) {
    throw new Error(`runtime 禁止載入第三方圖表 CDN：${relativePath}`);
  }
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolutePath));
    else if (/\.(?:js|mjs|ts|tsx|html)$/.test(entry.name)) files.push(absolutePath);
  }
  return files;
}

const executableRoots = ["app", "db", "public/static", "worker"].map((path) => join(appRoot, path));
const executableFiles = (await Promise.all(executableRoots.map(sourceFiles))).flat();
const forbiddenTradingEndpoint = /\/api\/v1\/(?:trade|accounts?|orders?|ca|token)(?:\/|["'`?]|$)/i;
const forbiddenTradingImport = /(?:from\s*|import\s*\()["'][^"']*(?:src\/lib\/shioaji|lib\/orders?|trading-api)[^"']*["']/i;
const embeddedSecret = /(?:sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|SJ_(?:API_KEY|SEC_KEY|CA_PASSWD)\s*=\s*[^\s"']+)/;

for (const absolutePath of executableFiles) {
  const source = await readFile(absolutePath, "utf8");
  const relativePath = absolutePath.slice(appRoot.length + 1);
  if (forbiddenTradingEndpoint.test(source)) throw new Error(`MultiView runtime 含交易／帳戶 endpoint：${relativePath}`);
  if (forbiddenTradingImport.test(source)) throw new Error(`MultiView runtime 含交易模組 import：${relativePath}`);
  if (embeddedSecret.test(source)) throw new Error(`MultiView runtime 疑似包含秘密值：${relativePath}`);
}

const adapter = await readFile(join(appRoot, "worker", "local-shioaji-adapter.ts"), "utf8");
for (const requiredBoundary of [
  'new Set(["STK", "IND", "WRT"])',
  'route_not_allowed',
  'loopback_origin_required',
  'simulation_required',
  'simulationOnly: true',
  'invalid_request_schema',
  'response_too_large',
]) {
  if (!adapter.includes(requiredBoundary)) throw new Error(`Shioaji data-only adapter 缺少安全邊界：${requiredBoundary}`);
}

const provenance = await readFile(join(appRoot, "UPSTREAM.md"), "utf8");
if (!provenance.includes("d6d7e0d64b928958f6b20523f39d8651ca584bae")) {
  throw new Error("UPSTREAM.md 缺少完整匯入 SHA");
}

const localRuntime = await readFile(join(root, "scripts", "realtimestock-runtime"), "utf8");
for (const requiredBoundary of [
  "MultiView 本階段只支援 simulation",
  'bootout_job "${MULTIVIEW_LABEL}"',
  'if [[ "$(read_mode)" != \'simulation\' ]]',
]) {
  if (!localRuntime.includes(requiredBoundary)) throw new Error(`MultiView runtime 缺少 simulation-only 邊界：${requiredBoundary}`);
}

console.log("MultiView source governance 驗證通過");
