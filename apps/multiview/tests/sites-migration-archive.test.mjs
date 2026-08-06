import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Sites archive 將既有 runtime 欄位 migration 轉為 target-specific baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "sites-archive-test-"));
  try {
    const migrationDir = join(root, "fixture/dist/.openai/drizzle");
    await mkdir(migrationDir, { recursive: true });
    await writeFile(join(migrationDir, "0018_cloudflare_pe_runtime_columns.sql"), "ALTER TABLE `taiwan_stock_pe_valuation_daily` ADD `provider` text DEFAULT 'official' NOT NULL;\n");
    await writeFile(join(root, "fixture/dist/server.js"), "export default {};\n", { flag: "w" });
    const archive = join(root, "site.tar");
    execFileSync("tar", ["-C", join(root, "fixture"), "-czf", archive, "dist"]);
    execFileSync(process.execPath, ["scripts/prepare-sites-archive.mjs", archive], { cwd: process.cwd() });
    const unpacked = join(root, "unpacked");
    await mkdir(unpacked);
    execFileSync("tar", ["-xzf", archive, "-C", unpacked]);
    const prepared = await readFile(join(unpacked, "dist/.openai/drizzle/0018_cloudflare_pe_runtime_columns.sql"), "utf8");
    assert.match(prepared, /sites-pe-runtime-columns-baselined/);
    assert.doesNotMatch(prepared, /ALTER TABLE/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
