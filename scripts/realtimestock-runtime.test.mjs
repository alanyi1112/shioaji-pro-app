import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(repositoryRoot, "scripts", "realtimestock-runtime");
const watchdogPath = path.join(repositoryRoot, "scripts", "realtimestock-watchdog.mjs");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("RealTimeStock runtime watchdog contract", () => {
  it("runtime shell 維持合法 zsh 語法", () => {
    expect(() => execFileSync("/bin/zsh", ["-n", runtimePath])).not.toThrow();
  });

  it("產生 simulation-only、30 秒且非 KeepAlive 的 watchdog LaunchAgent", async () => {
    const source = await readFile(runtimePath, "utf8");
    const block = source.match(/cat > "\$\{WATCHDOG_PLIST\}" <<EOF([\s\S]*?)\nEOF/)?.[1] || "";
    expect(source).toContain('WATCHDOG_LABEL="com.alanyi.realtimestock.business-session-watchdog"');
    expect(block).toContain("<string>${WATCHDOG_LABEL}</string>");
    expect(block).toContain("<string>watchdog-once</string>");
    expect(block).toContain("<key>RunAtLoad</key><true/>");
    expect(block).toContain("<key>StartInterval</key><integer>30</integer>");
    expect(block).not.toContain("<key>KeepAlive</key>");
    expect(block).not.toMatch(/production|SJ_CA|API_KEY|SECRET/i);
  });

  it("production 切換先停止 watchdog，watchdog action 不呼叫完整 simulation switch", async () => {
    const source = await readFile(runtimePath, "utf8");
    const production = source.match(/switch_production_readonly\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(production.indexOf('bootout_job "${WATCHDOG_LABEL}"')).toBeGreaterThanOrEqual(0);
    expect(production.indexOf('bootout_job "${WATCHDOG_LABEL}"')).toBeLessThan(production.indexOf('bootstrap_job "${PROD_LABEL}"'));
    const once = source.match(/watchdog_once\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(once).toContain("watchdog_environment once");
    expect(once).not.toContain("switch_simulation");
    expect(once).not.toMatch(/MULTIVIEW_LABEL|WEB_LABEL|PIPELINE/);
  });

  it("watchdog module 只使用 info、health、Snapshot 與 simulation job control", async () => {
    const source = await readFile(watchdogPath, "utf8");
    expect(source).toContain('jobLoaded: job.loaded');
    expect(source).toContain("/api/v1/info");
    expect(source).toContain("/api/v1/health");
    expect(source).toContain("/api/v1/data/snapshots");
    expect(source).toContain('["kickstart", "-k", serviceTarget]');
    expect(source).not.toMatch(/\/api\/v1\/(?:order|account|trade|server)/);
    expect(source).not.toMatch(/SJ_CA_PATH|SJ_CA_PASSWD/);
  });

  it("reset 與 status 只輸出去識別化 allowlist 欄位", async () => {
    const appSupport = await mkdtemp(path.join(tmpdir(), "realtimestock-runtime-status-"));
    temporaryDirectories.push(appSupport);
    const environment = { ...process.env, REALTIME_STOCK_APP_SUPPORT: appSupport, HOME: appSupport };
    execFileSync(process.execPath, [watchdogPath, "reset"], { env: environment });
    const output = execFileSync(process.execPath, [watchdogPath, "status"], { env: environment, encoding: "utf8" });
    expect(output.trim().split("\n").map((line) => line.split("=")[0])).toEqual([
      "business_watchdog_state",
      "business_watchdog_consecutive_failures",
      "business_watchdog_restart_count",
      "business_watchdog_last_reason",
      "business_watchdog_next_eligible_at",
    ]);
    expect(output).not.toMatch(/account|response|credential|secret|token|email/i);
  });
});
