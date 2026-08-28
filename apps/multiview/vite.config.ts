import vinext from "vinext";
import { defineConfig } from "vite";
import { homedir } from "node:os";
import { resolve } from "node:path";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";
import { localShioajiTransportPlugin } from "./build/local-shioaji-transport-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const realtimeLocalTest = process.env.ENABLE_REALTIME_LOCAL_TEST === "true";
const defaultStateDirectory = resolve(homedir(), "Library/Application Support/RealTimeStock/MultiView");
const stateDirectory = resolve(process.env.MULTIVIEW_STATE_DIR || defaultStateDirectory);

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
  ...(realtimeLocalTest
    ? {
        durable_objects: {
          bindings: [{ name: "REALTIME_HUB", class_name: "RealtimeMarketHub" }],
        },
        migrations: [{ tag: "realtime-hub-v1", new_sqlite_classes: ["RealtimeMarketHub"] }],
      }
    : {}),
  vars: {
    ...(realtimeLocalTest
      ? { DEPLOYMENT_TARGET: "local", SHIOAJI_REALTIME_ENABLED: "true", REALTIME_LOCAL_TEST: "true" }
      : { DEPLOYMENT_TARGET: "local" }),
    SHIOAJI_API_TARGET: "http://127.0.0.1:8080",
    REALTIME_STOCK_WEB_URL: "http://127.0.0.1:5173",
    MULTIVIEW_STATE_DIR: stateDirectory,
    MULTIVIEW_SCHEMA_REVISION: "0025",
    LOCAL_PIPELINE_SECRET: process.env.MULTIVIEW_LOCAL_PIPELINE_SECRET || "",
    TDCC_HISTORY_INGEST_SECRET: process.env.MULTIVIEW_LOCAL_PIPELINE_SECRET || "",
    TDCC_CONTINUOUS_BACKFILL_SECRET: process.env.MULTIVIEW_LOCAL_PIPELINE_SECRET || "",
    TDCC_HISTORY_AUTOMATION_ENABLED: "true",
    PE_RIVER_INGEST_SECRET: process.env.MULTIVIEW_LOCAL_PIPELINE_SECRET || "",
    PE_RIVER_BACKFILL_SECRET: process.env.MULTIVIEW_LOCAL_PIPELINE_SECRET || "",
    PE_RIVER_ACCESS_MODE: "private",
    PE_RIVER_COMMERCIAL_USE: "false",
    PE_RIVER_PROVISIONAL_LATEST_ENABLED: "false",
  },
};

export default defineConfig(async () => {
  // Runtime state is intentionally outside the Git checkout. Application
  // secrets remain in ignored local environment files and are never copied.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= resolve(stateDirectory, "logs/wrangler.log");
  process.env.MINIFLARE_REGISTRY_PATH ??= resolve(stateDirectory, "registry");

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      localShioajiTransportPlugin({
        upstream: "http://127.0.0.1:8080",
        webTarget: "http://127.0.0.1:5173",
      }),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
        persistState: { path: resolve(stateDirectory, "state") },
      }),
    ],
  };
});
