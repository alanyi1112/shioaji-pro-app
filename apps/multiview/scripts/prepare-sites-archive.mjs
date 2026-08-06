import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const archive = process.argv[2];
if (!archive || !isAbsolute(archive)) throw new Error("sites_archive_absolute_path_required");

const stage = await mkdtemp(join(tmpdir(), "multichart-sites-archive-"));
try {
  execFileSync("tar", ["-xzf", archive, "-C", stage], { stdio: "pipe" });
  const migrationPath = join(stage, "dist/.openai/drizzle/0018_cloudflare_pe_runtime_columns.sql");
  const original = await readFile(migrationPath, "utf8");
  if (!original.includes("ALTER TABLE `taiwan_stock_pe_valuation_daily` ADD `provider`")) {
    throw new Error("sites_pe_runtime_migration_shape_changed");
  }
  await writeFile(migrationPath, `-- Sites 既有 D1 已由 ensurePeRiverPipelineColumns 依 PRAGMA 完成欄位補齊。\n-- 此 target-specific baseline 避免部署 migration 對既有欄位再次 ADD COLUMN；\n-- Cloudflare production 仍使用 source drizzle/0018 的正式 additive migration。\nINSERT INTO runtime_metadata (key,value) VALUES ('sites-pe-runtime-columns-baselined','0018')\nON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP;\n`);
  execFileSync("tar", ["-C", stage, "-czf", archive, "dist"], { stdio: "pipe" });
  process.stdout.write(`${archive}\n`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
