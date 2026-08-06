import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const required = ["CLOUDFLARE_D1_DATABASE_ID", "CLOUDFLARE_ACCESS_TEAM_DOMAIN", "CLOUDFLARE_ACCESS_AUD"];
const missing = required.filter((name) => !String(process.env[name] || "").trim());
const tdccHistoryAutomationEnabled = String(process.env.TDCC_HISTORY_AUTOMATION_ENABLED || "false").trim().toLowerCase() === "true"
  ? "true"
  : "false";
if (missing.length) {
  console.error(`cloudflare-config: missing ${missing.join(",")}`);
  process.exitCode = 1;
} else {
  const config = {
    $schema: "./node_modules/wrangler/config-schema.json",
    name: String(process.env.CLOUDFLARE_WORKER_NAME || "multichart-production").trim(),
    main: "dist/server/index.js",
    compatibility_date: "2026-07-29",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    workers_dev: true,
    preview_urls: false,
    assets: { directory: "dist/client", binding: "ASSETS" },
    d1_databases: [{
      binding: "DB",
      database_name: String(process.env.CLOUDFLARE_D1_DATABASE_NAME || "multichart-production").trim(),
      database_id: String(process.env.CLOUDFLARE_D1_DATABASE_ID).trim(),
      migrations_dir: "drizzle",
    }],
    durable_objects: {
      bindings: [{
        name: "REALTIME_HUB",
        class_name: "RealtimeMarketHub",
      }],
    },
    migrations: [{
      tag: "realtime-hub-v1",
      new_sqlite_classes: ["RealtimeMarketHub"],
    }],
    vars: {
      DEPLOYMENT_TARGET: "cloudflare",
      APP_COMMIT_SHA: String(process.env.APP_COMMIT_SHA || "local-uncommitted").trim(),
      ACCESS_TEAM_DOMAIN: String(process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN).trim(),
      ACCESS_AUD: String(process.env.CLOUDFLARE_ACCESS_AUD).trim(),
      TDCC_HISTORY_AUTOMATION_ENABLED: tdccHistoryAutomationEnabled,
      PE_RIVER_ACCESS_MODE: "private",
      PE_RIVER_COMMERCIAL_USE: "false",
      PE_RIVER_PROVISIONAL_LATEST_ENABLED: "true",
      SHIOAJI_REALTIME_ENABLED: "false",
    },
    observability: { enabled: true, head_sampling_rate: 0.1 },
  };
  const output = resolve(process.cwd(), ".wrangler.cloudflare.generated.jsonc");
  await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log("cloudflare-config: generated local deployment config");
}
