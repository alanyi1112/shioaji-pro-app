import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = require.resolve("lightweight-charts/package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

if (packageJson.version !== "5.0.9") {
  throw new Error(`lightweight-charts 版本必須固定為 5.0.9，目前為 ${packageJson.version}`);
}

const source = join(dirname(packageJsonPath), "dist", "lightweight-charts.standalone.production.js");
const outputDir = join(root, "public", "vendor");
const destination = join(outputDir, "lightweight-charts.standalone.production.js");

await mkdir(outputDir, { recursive: true });
await copyFile(source, destination);
console.log("已準備本機 Lightweight Charts v5.0.9 bundle");
