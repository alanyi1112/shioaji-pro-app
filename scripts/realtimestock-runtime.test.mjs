import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { smartOrderModeExecutionLeaseDirectoryForAppSupportRoot } from "./smart-order-runtime/mode-execution-lease.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(repositoryRoot, "scripts", "realtimestock-runtime");
const watchdogPath = path.join(repositoryRoot, "scripts", "realtimestock-watchdog.mjs");
const launchAgentInstallerPath = path.join(
  repositoryRoot,
  "scripts",
  "smart-order-runtime",
  "launchagent-installer.mjs",
);
const packagePath = path.join(repositoryRoot, "package.json");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createSmartOrderStatusFixture({
  apiGeneration = "simulation:11111111-1111-4111-8111-111111111111",
  startedAtEpochMs = Date.now(),
} = {}) {
  const rawRoot = await mkdtemp(path.join(tmpdir(), "realtimestock-runtime-status-contract-"));
  temporaryDirectories.push(rawRoot);
  const appSupport = await realpath(rawRoot);
  const fakeBin = path.join(appSupport, "fake-bin");
  const fakeRepo = path.join(appSupport, "fake-repo");
  const runDirectory = path.join(appSupport, "smart-order", "run");
  const fakeCurlMarker = path.join(appSupport, "fake-curl-invoked");
  await mkdir(fakeBin, { recursive: true, mode: 0o700 });
  await mkdir(fakeRepo, { recursive: true, mode: 0o700 });
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await chmod(appSupport, 0o700);
  await chmod(path.join(appSupport, "smart-order"), 0o700);
  await chmod(runDirectory, 0o700);
  await writeFile(
    path.join(fakeBin, "launchctl"),
    `#!/bin/zsh\n[[ "$*" == *smart-order-sidecar* ]]\n`,
    { mode: 0o700 },
  );
  await writeFile(
    path.join(fakeBin, "curl"),
    `#!/bin/zsh\nif [[ "$*" == *"/__smart-orders/v1/status"* ]]; then\n  print invoked > "$REALTIME_STOCK_FAKE_CURL_MARKER"\n  print -r -- '{"schemaVersion":"smart-order-control-plane-server/2026-08-11.1","runtime":{"role":"primary","state":"starting","repositoryReady":true,"dispatchAllowedByRepository":false},"controlPlane":"loopback_authenticated","secretValuesExposed":false}'\n  exit 0\nfi\nexit 22\n`,
    { mode: 0o700 },
  );
  await writeFile(path.join(appSupport, "runtime-mode"), "simulation\n", { mode: 0o600 });
  await writeFile(path.join(appSupport, "runtime-api-generation"), `${apiGeneration}\n`, { mode: 0o600 });
  const discoveryPath = path.join(runDirectory, "control-plane.json");
  await writeFile(discoveryPath, `${JSON.stringify({
    schemaVersion: "smart-order-local-sidecar/2026-08-11.1",
    host: "127.0.0.1",
    port: 54321,
    runtimeEpochId: "runtime-epoch-test",
    startedAtEpochMs,
  })}\n`, { mode: 0o600 });
  return {
    discoveryPath,
    fakeCurlMarker,
    generationPath: path.join(appSupport, "runtime-api-generation"),
    environment: {
      ...process.env,
      HOME: appSupport,
      PATH: `${fakeBin}:${process.env.PATH}`,
      REALTIME_STOCK_APP_SUPPORT: appSupport,
      REALTIME_STOCK_FAKE_CURL_MARKER: fakeCurlMarker,
      REALTIME_STOCK_REPO_DIR: fakeRepo,
    },
  };
}

describe("RealTimeStock runtime watchdog contract", () => {
  it("runtime shell 維持合法 zsh 語法", () => {
    expect(() => execFileSync("/bin/zsh", ["-n", runtimePath])).not.toThrow();
  });

  it("Task 13.2 evidence aggregation 使用persisted Node且不取得broker authority", async () => {
    const source = await readFile(runtimePath, "utf8");
    const body = source.match(/run_smart_order_task13_2_evidence\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    expect(source).toContain("task13-2-evidence)");
    expect(source).toContain("SMART_ORDER_TASK_13_2_EVIDENCE=");
    expect(body).toContain("preflight_persisted_smart_order_runtime_contract");
    expect(body).toContain("env -i");
    expect(body).toContain('REALTIME_STOCK_APP_SUPPORT="${APP_SUPPORT}"');
    expect(body).not.toMatch(/curl|job_loaded|place_order|update_|cancel_order/);
    expect(packageJson.scripts?.["verify:smart-order-task13-2-evidence"]).toBe(
      "scripts/realtimestock-runtime task13-2-evidence",
    );
  });

  it("Task 0.4／0.6 probe 只在current simulation sidecar與generation下接到production wrapper", async () => {
    const source = await readFile(runtimePath, "utf8");
    const body = source.match(/run_smart_order_task0_4_0_6_probe\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(source).toContain("task0-4-0-6-probe)");
    expect(source).toContain("SMART_ORDER_TASK_0_4_0_6_PROBE=");
    expect(body).toContain("preflight_persisted_smart_order_runtime_contract");
    expect(body).toContain('job_loaded "${SMART_ORDER_LABEL}"');
    expect(body).toContain("strict_smart_order_discovery_epoch");
    expect(body).toContain("read_private_runtime_mode_contract");
    expect(body).toContain("read_private_api_generation_contract simulation");
    expect(body).toContain('"${NODE_BIN}" "${SMART_ORDER_TASK_0_4_0_6_PROBE}" "$@"');
    expect(body).not.toMatch(/bootout_job|bootstrap_job|production-readonly|CA_/);
  });

  it("逐項 drain CLI 保持 prepared、broker cancel 與雙確認 relinquish 分離", async () => {
    const source = await readFile(runtimePath, "utf8");
    const typedDrain = source.match(/run_smart_order_typed_drain_action\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(source).toContain("drain-prepared <strategy-id> <revision>");
    expect(source).toContain("strategy-cancel <strategy-id> <revision>");
    expect(source).toContain("cancel-broker-order <strategy-id> <revision>");
    expect(source).toContain("relinquish-protection-prepare <strategy-id> <revision>");
    expect(source).toContain("relinquish-protection-commit <strategy-id> <revision> <challenge-id>");
    expect(typedDrain).toContain("strict_smart_order_discovery_epoch");
    expect(typedDrain).toContain("read_private_api_generation_contract simulation");
    expect(typedDrain).toContain("第二次確認需要第一次回傳的 challenge-id");
    expect(typedDrain).toContain('"${SMART_ORDER_DIAGNOSTICS}"');
    expect(typedDrain).not.toMatch(/bootout_job|placeQuickOrder|\/api\/v1\/trades/);
    expect(source).toContain(
      "strategy-cancel|cancel-broker-order|drain-prepared|relinquish-protection-prepare|relinquish-protection-commit)",
    );
  });

  it("Gate probe 只經獨立互動 CLI prepare，且不取得broker write authority", async () => {
    const source = await readFile(runtimePath, "utf8");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    const body = source.match(/run_smart_order_gate_probe_prepare\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(source).toContain("gate-probe-prepare <absolute-private-envelope-json>");
    expect(source).toContain("gate-probe-prepare)");
    expect(body).toContain("preflight_persisted_smart_order_runtime_contract");
    expect(body).toContain("strict_smart_order_discovery_epoch");
    expect(body).toContain("read_private_runtime_mode_contract");
    expect(body).toContain("read_private_api_generation_contract simulation");
    expect(body).toContain('"${NODE_BIN}" "${SMART_ORDER_GATE_PROBE_CLI}"');
    expect(body).not.toMatch(/place_order|update_(?:price|qty)|cancel_order|bootout_job|bootstrap_job/);
    expect(packageJson.scripts?.["probe:smart-order-gate"]).toBe(
      "scripts/realtimestock-runtime gate-probe-prepare",
    );
  });

  it("sidecar-only 啟動入口只原子安裝智慧下單 plist，且拒絕重啟已載入 job", async () => {
    const source = await readFile(runtimePath, "utf8");
    const writer = source.match(/write_smart_order_plist\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    const starter = source.match(/start_smart_order_sidecar_only\(\) \{([\s\S]*?)\n\}/)?.[1] || "";

    expect(source).toContain("smart-order-start      只安裝／啟動simulation智慧下單sidecar；不觸碰其他服務");
    expect(source).toContain("smart-order-start) run_smart_order_sidecar_start_with_shared_mode_execution_lease");
    expect(source).toContain("smart-order-task0-3c-stop) stop_smart_order_sidecar_for_lifecycle graceful_stop");
    expect(writer).toContain('"${SMART_ORDER_LAUNCH_AGENT_INSTALLER}"');
    expect(writer).toContain('"${INSTALLED_SCRIPT}"');
    expect(writer).toContain('"${SMART_ORDER_RUNTIME_SOURCE}"');
    expect(writer).toContain('smart-order-launchagent-installer/2026-08-22.3');
    expect(writer).toContain('smart_order_platform_supported');
    expect(writer).toContain('remove_unsupported_smart_order_launchagent_artifact');
    expect(writer).toContain('native-apple-silicon-arm64');
    expect(writer).toContain('.installedBundleSha256');
    expect(writer).not.toMatch(/cat >|\.tmp\.\$\$|mv -f/);
    const verifier = source.match(/verify_smart_order_plist_binding\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(verifier).toContain('--verify "${SMART_ORDER_PLIST}"');
    expect(verifier).toContain('"${INSTALLED_SCRIPT}"');
    expect(verifier).toContain('"${SMART_ORDER_RUNTIME_SOURCE}"');
    expect(verifier).toContain('.verified == true');
    expect(verifier).toContain('.installedBundleSha256');
    expect(starter).toContain('job_loaded "${SMART_ORDER_LABEL}"');
    expect(starter).toContain("拒絕以 sidecar-only 入口重啟");
    expect(starter).toContain('job_loaded "${SIM_LABEL}"');
    expect(starter).toContain("不會代為啟動或重啟");
    expect(starter).toContain("read_private_runtime_mode_contract");
    expect(starter).toContain("read_private_api_generation_contract simulation");
    expect(starter).toContain("不得事後補造或重啟 API");
    expect(starter).toContain("write_smart_order_plist");
    expect(starter).toContain("start_smart_order_sidecar");
    expect(starter.indexOf("write_smart_order_plist")).toBeGreaterThan(
      starter.indexOf("read_private_api_generation_contract simulation"),
    );
    expect(starter).not.toMatch(/bootout_job|WATCHDOG_LABEL|WEB_LABEL|MULTIVIEW_LABEL|write_(?:mode|api_generation)/);
    const start = source.match(/start_smart_order_sidecar\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(start).toContain('smart_order_platform_supported');
    expect(start).toContain('未取得 broker authority');
    const bootstrap = start.indexOf('launchctl bootstrap "${LAUNCH_DOMAIN}" "${SMART_ORDER_PLIST}"');
    expect(start.lastIndexOf("verify_smart_order_plist_binding", bootstrap)).toBeGreaterThanOrEqual(0);
    expect(start.indexOf("verify_smart_order_plist_binding", bootstrap)).toBeGreaterThan(bootstrap);
    const wrapper = source.match(/run_smart_order_sidecar_start_with_shared_mode_execution_lease\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(wrapper).toContain('"${SMART_ORDER_MODE_LEASE_HOLDER}"');
    expect(wrapper).toContain('"${completion_file}" shared');
    expect(wrapper).toContain('.mode == "shared"');
    expect(wrapper).toContain("start_smart_order_sidecar_only");
    expect(wrapper).not.toMatch(/bootout_job|kickstart|write_(?:mode|api_generation)/);
  });

  it("sidecar-only 缺少 current API generation 時不建立 LaunchAgent plist", async () => {
    const rawRoot = await mkdtemp(path.join(tmpdir(), "realtimestock-sidecar-only-"));
    temporaryDirectories.push(rawRoot);
    const root = await realpath(rawRoot);
    const appSupport = path.join(root, "app-support");
    const fakeHome = path.join(root, "home");
    const fakeBin = path.join(root, "fake-bin");
    const fakeNode = path.join(fakeBin, "node24");
    const fakeLaunchctl = path.join(fakeBin, "launchctl");
    await mkdir(appSupport, { recursive: true, mode: 0o700 });
    await mkdir(fakeHome, { recursive: true, mode: 0o700 });
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await chmod(appSupport, 0o700);
    await writeFile(fakeNode, "#!/bin/zsh\nexit 0\n", { mode: 0o700 });
    await writeFile(
      fakeLaunchctl,
      '#!/bin/zsh\n[[ "$*" == *com.alanyi.realtimestock.simulation-api* ]]\n',
      { mode: 0o700 },
    );
    await writeFile(path.join(appSupport, "node-runtime-path"), `${fakeNode}\n`, { mode: 0o600 });
    await writeFile(path.join(appSupport, "runtime-mode"), "simulation\n", { mode: 0o600 });

    expect(() =>
      execFileSync("/bin/zsh", [
        "-c",
        `source <(awk '/^command_name=/{exit} {print}' "$1")
start_smart_order_sidecar_only`,
        "sidecar-only-no-generation-test",
        runtimePath,
      ], {
        env: {
          ...process.env,
          HOME: fakeHome,
          PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
          REALTIME_STOCK_APP_SUPPORT: appSupport,
          REALTIME_STOCK_REPO_DIR: repositoryRoot,
        },
        stdio: "pipe",
      }),
    ).toThrow(/缺少 current simulation API generation/);
    await expect(
      lstat(
        path.join(
          fakeHome,
          "Library",
          "LaunchAgents",
          "com.alanyi.realtimestock.smart-order-sidecar.plist",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("不支援平台安裝一般 Runtime 時移除舊智慧下單 plist 且保留一般 plist", async () => {
    const rawRoot = await mkdtemp(path.join(tmpdir(), "realtimestock-unsupported-platform-install-"));
    temporaryDirectories.push(rawRoot);
    const root = await realpath(rawRoot);
    const appSupport = path.join(root, "app-support");
    const fakeHome = path.join(root, "home");
    const fakeRepo = path.join(root, "repo");
    const fakeBin = path.join(root, "fake-bin");
    const fakeNode = path.join(fakeBin, "node24");
    const launchAgents = path.join(fakeHome, "Library", "LaunchAgents");
    const staleSmartOrderPlist = path.join(
      launchAgents,
      "com.alanyi.realtimestock.smart-order-sidecar.plist",
    );
    await mkdir(appSupport, { recursive: true, mode: 0o700 });
    await mkdir(fakeRepo, { recursive: true, mode: 0o700 });
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await mkdir(launchAgents, { recursive: true, mode: 0o700 });
    await chmod(appSupport, 0o700);
    await writeFile(fakeNode, "#!/bin/zsh\nexit 1\n", { mode: 0o700 });
    await writeFile(path.join(appSupport, "node-runtime-path"), `${fakeNode}\n`, {
      mode: 0o600,
    });
    await writeFile(staleSmartOrderPlist, "stale unsupported smart-order plist\n", {
      mode: 0o600,
    });

    execFileSync(
      "/bin/zsh",
      [
        "-c",
        `source <(awk '/^command_name=/{exit} {print}' "$1")
write_plists`,
        "unsupported-platform-install-test",
        runtimePath,
      ],
      {
        env: {
          ...process.env,
          HOME: fakeHome,
          PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
          REALTIME_STOCK_APP_SUPPORT: appSupport,
          REALTIME_STOCK_REPO_DIR: fakeRepo,
        },
        stdio: "pipe",
      },
    );

    await expect(lstat(staleSmartOrderPlist)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      lstat(path.join(launchAgents, "com.alanyi.realtimestock.simulation-api.plist")),
    ).resolves.toMatchObject({ mode: expect.any(Number) });
    await expect(
      lstat(path.join(launchAgents, "com.alanyi.realtimestock.web.plist")),
    ).resolves.toMatchObject({ mode: expect.any(Number) });
  });

  it("拒絕把智慧下單 Application Support 放在 source repository 內", async () => {
    const forbiddenRoot = path.join(
      repositoryRoot,
      `.forbidden-smart-order-private-root-${process.pid}-${Date.now()}`,
    );
    temporaryDirectories.push(forbiddenRoot);
    expect(() =>
      execFileSync("/bin/zsh", [
        "-c",
        `source <(sed '/^command_name=/,$d' "$1")
ensure_private_app_support_root`,
        "runtime-private-root-test",
        runtimePath,
      ], {
        env: {
          ...process.env,
          REALTIME_STOCK_APP_SUPPORT: forbiddenRoot,
          REALTIME_STOCK_REPO_DIR: repositoryRoot,
        },
        stdio: "pipe",
      }),
    ).toThrow(/必須位於 RealTimeStock source repository 外/);
    await expect(realpath(forbiddenRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("智慧下單 Node contract 固定 LTS 24.15 範圍並保存 resolved absolute path", async () => {
    const source = await readFile(runtimePath, "utf8");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

    expect(packageJson.engines?.node).toBe(">=24.15.0 <25");
    expect(source).toContain('NODE_RUNTIME_FILE="${APP_SUPPORT}/node-runtime-path"');
    expect(source).toContain('candidate="${candidate:A}"');
    expect(source).toContain('chmod 600 "${tmp_file}"');
    expect(source).toContain('persist_node_runtime_contract');
    expect(source).toContain('preflight_persisted_smart_order_runtime_contract');
    expect(source).toContain('current_user_private_file "${NODE_RUNTIME_FILE}"');
    expect(source).toContain("== '600'");
    expect(source).toContain("== '700'");
    expect(source).toContain('[[ "${candidate}" != "${resolved}"');
    expect(source).toContain('typeof process.release.lts === "string"');
    expect(source).not.toContain('NODE_BIN="/opt/homebrew/bin/node"');
  });

  it("Node SQLite probe只用persisted Node與去環境離線入口，不觸碰服務或broker", async () => {
    const source = await readFile(runtimePath, "utf8");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    const body = source.match(/probe_smart_order_node_sqlite\(\) \{([\s\S]*?)\n\}/)?.[1] || "";

    expect(source).toContain("node-sqlite-probe) probe_smart_order_node_sqlite");
    expect(body).toContain("preflight_persisted_smart_order_runtime_contract");
    expect(body).toContain('"${NODE_BIN}" "${SMART_ORDER_NODE_SQLITE_PROBE}"');
    expect(body).toContain("exec env -i");
    expect(body).toContain("REALTIME_STOCK_NODE_SQLITE_APP_SUPPORT");
    expect(body).toContain("REALTIME_STOCK_NODE_SQLITE_LAUNCHAGENT_PLIST");
    expect(body).toContain("REALTIME_STOCK_NODE_SQLITE_INSTALLED_RUNTIME");
    expect(body).not.toMatch(/launchctl|bootout_job|bootstrap_job|curl|shioaji|8080/);
    expect(packageJson.scripts?.["probe:smart-order-node-sqlite"]).toBe(
      "scripts/realtimestock-runtime node-sqlite-probe",
    );
  });

  it("simulation 與 production-readonly 在任何 service/mode mutation 前完成 persisted Node preflight", async () => {
    const source = await readFile(runtimePath, "utf8");
    for (const functionName of ["switch_simulation", "switch_production_readonly"]) {
      const body = source.match(new RegExp(`${functionName}\\(\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] || "";
      const preflight = body.indexOf("preflight_persisted_smart_order_runtime_contract");
      const firstMutation = [
        body.indexOf("stop_smart_order_sidecar_for_lifecycle"),
        body.indexOf("bootout_job"),
        body.indexOf("write_api_generation"),
        body.indexOf("write_mode"),
      ].filter((index) => index >= 0).sort((left, right) => left - right)[0];
      expect(preflight).toBeGreaterThanOrEqual(0);
      expect(firstMutation).toBeGreaterThan(preflight);
    }
    for (const functionName of ["service_api_simulation", "service_api_production_readonly"]) {
      const body = source.match(new RegExp(`${functionName}\\(\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] || "";
      expect(body.indexOf("preflight_persisted_smart_order_runtime_contract")).toBeGreaterThanOrEqual(0);
      expect(body.indexOf("preflight_persisted_smart_order_runtime_contract")).toBeLessThan(body.indexOf("write_mode"));
      const expectedMode = functionName === "service_api_simulation" ? "simulation" : "production-readonly";
      const generationWrite = body.indexOf(`write_api_generation ${expectedMode}`);
      expect(generationWrite).toBeGreaterThan(body.indexOf("preflight_persisted_smart_order_runtime_contract"));
      expect(generationWrite).toBeLessThan(body.indexOf("write_mode"));
      expect(generationWrite).toBeLessThan(body.indexOf("exec env"));
    }
  });

  it("每次 API service process 啟動都先旋轉 generation，涵蓋 KeepAlive 與 watchdog restart", async () => {
    const source = await readFile(runtimePath, "utf8");
    const watchdogSource = await readFile(watchdogPath, "utf8");
    const simulationService = source.match(/service_api_simulation\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    const productionService = source.match(/service_api_production_readonly\(\) \{([\s\S]*?)\n\}/)?.[1] || "";

    expect(simulationService).toContain("write_api_generation simulation");
    expect(productionService).toContain("write_api_generation production-readonly");
    expect(watchdogSource).toContain('spawnSync(launchctl, ["kickstart", "-k", serviceTarget]');
    expect(watchdogSource).not.toContain("runtime-api-generation");
  });

  it("不安全 persisted Node 權限會在 simulation 與 production-readonly mutation 前 fail closed", async () => {
    const rawRoot = await mkdtemp(path.join(tmpdir(), "realtimestock-runtime-preflight-"));
    temporaryDirectories.push(rawRoot);
    const appSupport = await realpath(rawRoot);
    await chmod(appSupport, 0o700);
    const nodeRuntimePath = path.join(appSupport, "node-runtime-path");
    const modePath = path.join(appSupport, "runtime-mode");
    await writeFile(nodeRuntimePath, `${process.execPath}\n`, { mode: 0o644 });
    await writeFile(modePath, "sentinel-mode\n", { mode: 0o600 });
    const environment = {
      ...process.env,
      HOME: appSupport,
      REALTIME_STOCK_APP_SUPPORT: appSupport,
      REALTIME_STOCK_NODE_BIN: process.execPath,
    };

    for (const command of ["simulation", "production-readonly"]) {
      expect(() => execFileSync("/bin/zsh", [runtimePath, command], {
        env: environment,
        stdio: "pipe",
      })).toThrow();
      expect(await readFile(modePath, "utf8")).toBe("sentinel-mode\n");
    }
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

  it("產生只允許 simulation 的智慧下單 observe-only sidecar LaunchAgent", async () => {
    const source = await readFile(runtimePath, "utf8");
    const block = await readFile(launchAgentInstallerPath, "utf8");
    expect(source).toContain('SMART_ORDER_LABEL="com.alanyi.realtimestock.smart-order-sidecar"');
    expect(block).toContain("<key>Label</key><string>${LABEL}</string>");
    expect(block).toContain("<string>service-smart-order-sidecar</string>");
    expect(block).toContain("<key>REALTIME_STOCK_APP_SUPPORT</key><string>${xml(appSupportRoot)}</string>");
    expect(block).toContain("<key>RunAtLoad</key><true/>");
    expect(block).toContain("<key>KeepAlive</key><true/>");
    expect(block).not.toMatch(/production|SJ_CA|SJ_PRODUCTION|API_KEY|SECRET/i);

    const service = source.match(/service_smart_order_sidecar\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(service).toContain("!= 'simulation'");
    expect(service.trimStart().startsWith("local persisted_node mode_state\n    preflight_persisted_smart_order_runtime_contract")).toBe(true);
    expect(service).toContain('persisted_node="${NODE_BIN}"');
    expect(service).toContain('read_private_api_generation_contract simulation');
    expect(service).toContain('REALTIME_STOCK_APP_SUPPORT="${APP_SUPPORT}"');
    expect(service).not.toMatch(/shioaji|place_order|update_order|cancel_order/i);
  });

  it("service-web 與 sidecar 都取得相同的私有 app support root", async () => {
    const source = await readFile(runtimePath, "utf8");
    const webBlock = source.match(/cat > "\$\{WEB_PLIST\}" <<EOF([\s\S]*?)\nEOF/)?.[1] || "";
    const sidecarBlock = await readFile(launchAgentInstallerPath, "utf8");
    const webService = source.match(/service_web\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(webBlock).toContain("<key>REALTIME_STOCK_APP_SUPPORT</key><string>${APP_SUPPORT}</string>");
    expect(sidecarBlock).toContain("<key>REALTIME_STOCK_APP_SUPPORT</key><string>${xml(appSupportRoot)}</string>");
    expect(webService).toContain('REALTIME_STOCK_APP_SUPPORT="${APP_SUPPORT}"');
  });

  it("應用服務與智慧下單安全核心使用分離的 Node runtime", async () => {
    const source = await readFile(runtimePath, "utf8");
    const webService = source.match(/service_web\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    const sidecarService = source.match(/service_smart_order_sidecar\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    const watchdogService = source.match(/watchdog_environment\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    const multiviewService = source.match(/service_multiview\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    const dailyService = source.match(/service_multiview_daily_pipeline\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    const tdccService = source.match(/service_multiview_tdcc_pipeline\(\) \{([\s\S]*?)\n\}/)?.[1] || "";

    expect(source).toContain('APP_NODE_BIN="${REALTIME_STOCK_APP_NODE_BIN:-}"');
    expect(source).toContain('APP_NODE_BIN="$(command -v node 2>/dev/null || true)"');
    expect(webService).toContain('"${APP_NODE_BIN}" "${VITE_BIN}"');
    expect(watchdogService).toContain('"${APP_NODE_BIN}" "${WATCHDOG_SCRIPT}"');
    expect(multiviewService).toContain('"${APP_NODE_BIN}" "${MULTIVIEW_CLI}"');
    expect(dailyService).toContain('"${APP_NODE_BIN}" scripts/pe-river-continuous-backfill.mjs');
    expect(tdccService).toContain('"${APP_NODE_BIN}" scripts/tdcc-history-backfill.mjs');
    expect(sidecarService).toContain('persisted_node="${NODE_BIN}"');
    expect(sidecarService).not.toContain("APP_NODE_BIN");
  });

  it("production-readonly 在停止 simulation API 前先安全停止 sidecar", async () => {
    const source = await readFile(runtimePath, "utf8");
    const production = source.match(/switch_production_readonly\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    const sidecarStop = production.indexOf("stop_smart_order_sidecar_for_lifecycle");
    const simulationStop = production.indexOf('bootout_job "${SIM_LABEL}"');
    const productionStart = production.indexOf('bootstrap_job "${PROD_LABEL}"');
    expect(sidecarStop).toBeGreaterThanOrEqual(0);
    expect(sidecarStop).toBeLessThan(simulationStop);
    expect(sidecarStop).toBeLessThan(productionStart);
    expect(production).toContain(
      "stop_smart_order_sidecar_for_lifecycle production_readonly",
    );
    expect(production).toContain("write_api_generation production-readonly");
    const sidecarShutdown = source.match(/stop_smart_order_sidecar_for_lifecycle\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(sidecarShutdown).toContain("quiesce_smart_order_sidecar_for_lifecycle");
    expect(sidecarShutdown).toContain(
      "graceful_stop|production_readonly|uninstall",
    );
    expect(sidecarShutdown).toContain('SMART_ORDER_DIAGNOSTICS}" stop "${operation}"');
    expect(sidecarShutdown).toContain('smart-order-runtime-stop-result/2026-08-12.1');
    expect(sidecarShutdown).toContain('.repositoryClosed == true');
    expect(sidecarShutdown).toContain('.controlPlaneUnpublished == true');
    expect(sidecarShutdown).toContain('.runtimeLeaseReleased == true');
    const stopResult = sidecarShutdown.indexOf(
      'smart-order-runtime-stop-result/2026-08-12.1',
    );
    const bootout = sidecarShutdown.lastIndexOf(
      'bootout_job "${SMART_ORDER_LABEL}"',
    );
    expect(stopResult).toBeLessThan(bootout);
    const unloadedCheck = sidecarShutdown.indexOf(
      'job_loaded "${SMART_ORDER_LABEL}"',
      bootout + 1,
    );
    const finalize = sidecarShutdown.lastIndexOf(
      'SMART_ORDER_DIAGNOSTICS}" finalize-stop',
    );
    expect(unloadedCheck).toBeGreaterThan(bootout);
    expect(finalize).toBeGreaterThan(unloadedCheck);
    expect(sidecarShutdown).toContain(
      'REALTIME_STOCK_LIFECYCLE_STOP_BINDING',
    );
    expect(sidecarShutdown).toContain('handoff barrier 保留');
    expect(sidecarShutdown).toContain('SMART_ORDER_DIAGNOSTICS}" pending-stop');
    expect(sidecarShutdown).toContain(
      'smart-order-runtime-stop-pending/2026-08-12.1',
    );
    const pendingStop = sidecarShutdown.indexOf(
      'SMART_ORDER_DIAGNOSTICS}" pending-stop',
    );
    const firstFinalize = sidecarShutdown.indexOf(
      'SMART_ORDER_DIAGNOSTICS}" finalize-stop',
    );
    expect(pendingStop).toBeLessThan(firstFinalize);
    expect(firstFinalize).toBeLessThan(
      sidecarShutdown.indexOf('quiesce_smart_order_sidecar_for_lifecycle'),
    );
    expect(sidecarShutdown).toContain('! -L "${SMART_ORDER_DISCOVERY_PATH}"');
  });

  it("public mode switch 在任何 service mutation 前持有 canonical exclusive execution lease", async () => {
    const rawRoot = await mkdtemp(path.join(tmpdir(), "realtimestock-exclusive-mode-switch-"));
    temporaryDirectories.push(rawRoot);
    const appSupport = await realpath(rawRoot);
    await chmod(appSupport, 0o700);
    const leaseDirectory = smartOrderModeExecutionLeaseDirectoryForAppSupportRoot(appSupport);
    temporaryDirectories.push(path.dirname(leaseDirectory));
    const output = execFileSync(
      "/bin/zsh",
      [
        "-c",
        `source <(sed '/^command_name=/,$d' "$1")
preflight_persisted_smart_order_runtime_contract() { : }
switch_simulation() {
  [[ -S "$REALTIME_STOCK_EXPECTED_MODE_LEASE/exclusive.sock" ]] || return 9
  print -r -- mutation-under-exclusive-lease
}
run_with_exclusive_mode_execution_lease simulation`,
        "runtime-exclusive-mode-switch-test",
        runtimePath,
      ],
      {
        env: {
          ...process.env,
          REALTIME_STOCK_APP_SUPPORT: appSupport,
          REALTIME_STOCK_NODE_BIN: process.execPath,
          REALTIME_STOCK_REPO_DIR: repositoryRoot,
          REALTIME_STOCK_EXPECTED_MODE_LEASE: leaseDirectory,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(output.trim()).toBe("mutation-under-exclusive-lease");
    await expect(lstat(path.join(leaseDirectory, "exclusive.sock"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const source = await readFile(runtimePath, "utf8");
    expect(source).toContain(
      'simulation) run_with_exclusive_mode_execution_lease simulation ;;',
    );
    expect(source).toContain(
      'production-readonly) run_with_exclusive_mode_execution_lease production-readonly ;;',
    );
  });

  it("completion 已落盤但 caller 當機時，續跑會先驗證、卸載 job，再 single-consume", async () => {
    const rawRoot = await mkdtemp(
      path.join(tmpdir(), "realtimestock-runtime-pending-stop-"),
    );
    temporaryDirectories.push(rawRoot);
    const appSupport = await realpath(rawRoot);
    const smartOrderRun = path.join(appSupport, "smart-order", "run");
    const fakeNode = path.join(appSupport, "fake-node");
    const callLog = path.join(appSupport, "calls.log");
    const unloadedMarker = path.join(appSupport, "job-unloaded");
    await mkdir(smartOrderRun, { recursive: true, mode: 0o700 });
    await chmod(appSupport, 0o700);
    await chmod(path.join(appSupport, "smart-order"), 0o700);
    await chmod(smartOrderRun, 0o700);
    await writeFile(
      path.join(smartOrderRun, "lifecycle-stop-completion.json"),
      "fixture-completion\n",
      { mode: 0o600 },
    );
    await writeFile(
      path.join(smartOrderRun, "lifecycle-stop-barrier.json"),
      "fixture-barrier\n",
      { mode: 0o600 },
    );
    await writeFile(
      fakeNode,
      `#!/bin/zsh
print -r -- "$2" >> "$REALTIME_STOCK_FAKE_CALL_LOG"
case "$2" in
  pending-stop)
    print -r -- '{"schemaVersion":"smart-order-runtime-stop-pending/2026-08-12.1","operation":"graceful_stop","stopRevision":9,"completionBinding":{"operation":"graceful_stop","runtimeEpochIdSha256":"sha256:${"1".repeat(64)}","apiGenerationSha256":"sha256:${"2".repeat(64)}","stopRevision":9,"completionNonceSha256":"sha256:${"3".repeat(64)}","requestIdSha256":"sha256:${"4".repeat(64)}"},"repositoryClosed":true,"controlPlaneUnpublished":true,"runtimeLeaseReleased":true,"dispatchAllowed":false,"writeMaster":"disabled","brokerWriteAttempted":false,"secretValuesExposed":false}'
    ;;
  finalize-stop)
    print -r -- "$REALTIME_STOCK_LIFECYCLE_STOP_BINDING" >> "$REALTIME_STOCK_FAKE_CALL_LOG"
    print -r -- '{"schemaVersion":"smart-order-runtime-stop-finalized/2026-08-12.1","operation":"graceful_stop","stopRevision":9,"finalized":true,"dispatchAllowed":false,"writeMaster":"disabled","brokerWriteAttempted":false,"secretValuesExposed":false}'
    ;;
  *) exit 64 ;;
esac
`,
      { mode: 0o700 },
    );
    const output = execFileSync(
      "/bin/zsh",
      [
        "-c",
        `source <(sed '/^command_name=/,$d' "$1")
job_loaded() { [[ ! -e "$REALTIME_STOCK_FAKE_UNLOADED_MARKER" ]] }
bootout_job() {
  print -r -- bootout >> "$REALTIME_STOCK_FAKE_CALL_LOG"
  : > "$REALTIME_STOCK_FAKE_UNLOADED_MARKER"
}
stop_smart_order_sidecar_for_lifecycle graceful_stop`,
        "runtime-pending-stop-test",
        runtimePath,
      ],
      {
        env: {
          ...process.env,
          REALTIME_STOCK_APP_SUPPORT: appSupport,
          REALTIME_STOCK_FAKE_CALL_LOG: callLog,
          REALTIME_STOCK_FAKE_UNLOADED_MARKER: unloadedMarker,
          REALTIME_STOCK_NODE_BIN: fakeNode,
          REALTIME_STOCK_REPO_DIR: repositoryRoot,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(output).toBe("");
    const calls = (await readFile(callLog, "utf8")).trim().split("\n");
    expect(calls[0]).toBe("pending-stop");
    expect(calls[1]).toBe("bootout");
    expect(calls[2]).toBe("finalize-stop");
    expect(calls[3]).toContain('"operation":"graceful_stop"');
    expect(calls[3]).toContain('"stopRevision":9');
  });

  it("production-readonly 已完成 stop 時允許返回 simulation，但未知 crash handoff 仍 fail closed", async () => {
    const rawRoot = await mkdtemp(
      path.join(tmpdir(), "realtimestock-simulation-return-"),
    );
    temporaryDirectories.push(rawRoot);
    const appSupport = await realpath(rawRoot);
    const smartOrderRun = path.join(appSupport, "smart-order", "run");
    const fallbackMarker = path.join(appSupport, "fallback-stop-called");
    await mkdir(smartOrderRun, { recursive: true, mode: 0o700 });
    await chmod(appSupport, 0o700);
    await chmod(path.join(appSupport, "smart-order"), 0o700);
    await chmod(smartOrderRun, 0o700);
    await writeFile(path.join(appSupport, "runtime-mode"), "production-readonly\n", {
      mode: 0o600,
    });
    await writeFile(
      path.join(appSupport, "runtime-api-generation"),
      "production-readonly:11111111-2222-4333-8444-555555555555\n",
      { mode: 0o600 },
    );
    const runHelper = () =>
      execFileSync(
        "/bin/zsh",
        [
          "-c",
          `source <(sed '/^command_name=/,$d' "$1")
job_loaded() { return 1 }
stop_smart_order_sidecar_for_lifecycle() {
  : > "$REALTIME_STOCK_FALLBACK_MARKER"
  return 91
}
prepare_smart_order_sidecar_for_simulation_return
print -r -- already-stopped-safe`,
          "simulation-return-test",
          runtimePath,
        ],
        {
          env: {
            ...process.env,
            HOME: appSupport,
            REALTIME_STOCK_APP_SUPPORT: appSupport,
            REALTIME_STOCK_FALLBACK_MARKER: fallbackMarker,
            REALTIME_STOCK_REPO_DIR: repositoryRoot,
          },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

    expect(runHelper().trim()).toBe("already-stopped-safe");
    await expect(lstat(fallbackMarker)).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(
      path.join(smartOrderRun, "lifecycle-stop-barrier.json"),
      "unfinished-handoff\n",
      { mode: 0o600 },
    );
    expect(runHelper).toThrow();
    await expect(lstat(fallbackMarker)).resolves.toMatchObject({
      mode: expect.any(Number),
    });

    await rm(path.join(smartOrderRun, "lifecycle-stop-barrier.json"));
    await rm(fallbackMarker);
    await writeFile(
      path.join(appSupport, "runtime-api-generation"),
      "simulation:11111111-2222-4333-8444-555555555555\n",
      { mode: 0o600 },
    );
    expect(runHelper).toThrow();
    await expect(lstat(fallbackMarker)).resolves.toMatchObject({
      mode: expect.any(Number),
    });
  });

  it("simulation 產生新 generation 後才啟動 write-disabled sidecar", async () => {
    const source = await readFile(runtimePath, "utf8");
    const simulation = source.match(/switch_simulation\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(simulation).toContain(
      "prepare_smart_order_sidecar_for_simulation_return",
    );
    const simulationReturn = source.match(
      /prepare_smart_order_sidecar_for_simulation_return\(\) \{([\s\S]*?)\n\}/,
    )?.[1] || "";
    expect(simulationReturn).toContain("read_private_runtime_mode_contract");
    expect(simulationReturn).toContain(
      "read_private_api_generation_contract production-readonly",
    );
    expect(simulationReturn).toContain("SMART_ORDER_LIFECYCLE_STOP_COMPLETION_PATH");
    expect(simulationReturn).toContain("SMART_ORDER_LIFECYCLE_STOP_BARRIER_PATH");
    expect(simulationReturn).toContain(
      "stop_smart_order_sidecar_for_lifecycle graceful_stop",
    );
    expect(simulation.indexOf("write_api_generation simulation")).toBeGreaterThanOrEqual(0);
    expect(simulation.indexOf("write_api_generation simulation")).toBeLessThan(simulation.indexOf("start_smart_order_sidecar"));
    expect(source).toContain("smart_order_write_master=disabled");
    expect(source).not.toContain("smart_order_sidecar_readiness=observe-only");
  });

  it("install 只以 strict graceful-stop drain 既有 sidecar，且不保留 generic mode-switch alias", async () => {
    const source = await readFile(runtimePath, "utf8");
    const install = source.match(/install_runtime\(\) \{([\s\S]*?)\n\}/)?.[1] || "";

    expect(install).toContain(
      "stop_smart_order_sidecar_for_lifecycle graceful_stop",
    );
    expect(source).not.toContain("mode_switch");
  });

  it("智慧下單 status 只輸出去識別化 allowlist 摘要", async () => {
    const source = await readFile(runtimePath, "utf8");
    const status = source.match(/smart_order_sidecar_status\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    const outputKeys = [...status.matchAll(/print (?:"|')?(smart_order_[a-z_]+)=/g)].map((match) => match[1]);
    expect(outputKeys).toEqual([
      "smart_order_sidecar_job",
      "smart_order_sidecar_health",
      "smart_order_sidecar_discovery",
      "smart_order_sidecar_readiness",
      "smart_order_mode_generation",
      "smart_order_repository",
      "smart_order_reconciliation",
      "smart_order_lifecycle_blockers",
      "smart_order_unprotected_remainder_state",
      "smart_order_unprotected_remainder_max_shares",
      "smart_order_active_obligations",
      "smart_order_drain_items",
      "smart_order_drain_records",
      "smart_order_write_master",
    ]);
    expect(status).not.toMatch(
      /\.account(?:Id|Broker)Ref|\.strategyId|\.identityGroupId|\.definitionJson|\.capability|smart_order_[a-z_]*port=/i,
    );
    expect(status).toContain('.accountIdentifiersExposed == false');
    expect(status).toContain('.entityIdentifiersExposed == false');
    expect(status).toContain('.secretValuesExposed == false');
    expect(status).toContain('[.drainItems[] | select(.count > 0) | {kind, count, disposition}]');
    expect(status).toContain('[.drainRecords[] | {ordinal, kind, state, quantityShares, quantityState, disposition}]');
    expect(status).toContain('smart-order-runtime-diagnostics/2026-08-12.2');
    expect(status).not.toContain("authenticated_smart_order_status");
    expect(status).toContain("readiness_state='not-ready'");
    expect(status).toContain("health_state='authenticated'");
    expect(status).toContain('SMART_ORDER_DIAGNOSTICS');
    expect(status).toContain('REALTIME_STOCK_EXPECTED_API_GENERATION');
    expect(status).not.toMatch(/readiness_state='ready'|health_state='loopback-observe-only'/);
    const discovery = source.match(/strict_smart_order_discovery_epoch\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(discovery).toContain("current_user_private_directory");
    expect(discovery).toContain("current_user_private_file");
    expect(discovery).toContain("smart-order-local-sidecar/2026-08-11.1");
    expect(discovery).toContain("runtimeEpochId");
    expect(discovery).toContain("minimum_started_at_epoch_ms");
    expect(discovery).toContain(". >= $minimum_started_at_epoch_ms");
    const waitForStart = source.match(/wait_smart_order_sidecar_started\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(waitForStart).toContain('job_pid "${SIM_LABEL}"');
    expect(waitForStart).toContain('job_pid "${SMART_ORDER_LABEL}"');
    expect(waitForStart).toContain('strict_smart_order_discovery_epoch "${minimum_started_at_epoch_ms}"');
    expect(waitForStart).toContain('lsof -nP -a -p "${sidecar_pid}"');
    expect(waitForStart).toContain('REALTIME_STOCK_EXPECTED_API_GENERATION="${expected_api_generation}"');
    expect(waitForStart).toContain('.authenticated == true');
    expect(waitForStart).toContain('.writeMaster == "disabled"');
  });

  it("任意 5173 port impostor 回傳正確外觀 JSON 也不會被標成 authenticated", async () => {
    const fixture = await createSmartOrderStatusFixture();
    const output = execFileSync("/bin/zsh", [runtimePath, "status"], {
      env: fixture.environment,
      encoding: "utf8",
    });
    expect(output).toContain("smart_order_sidecar_job=loaded");
    expect(output).toContain("smart_order_sidecar_discovery=valid-private");
    expect(output).toContain("smart_order_sidecar_health=unverified");
    expect(output).toContain("smart_order_sidecar_readiness=not-ready");
    expect(output).not.toContain("smart_order_sidecar_health=authenticated");
    await expect(readFile(fixture.fakeCurlMarker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stale discovery epoch 即使檔案私有且 schema 合法也只會顯示 unverified", async () => {
    const fixture = await createSmartOrderStatusFixture({ startedAtEpochMs: 0 });
    const output = execFileSync("/bin/zsh", [runtimePath, "status"], {
      env: fixture.environment,
      encoding: "utf8",
    });
    expect(output).toContain("smart_order_sidecar_discovery=valid-private");
    expect(output).toContain("smart_order_sidecar_health=unverified");
    expect(output).toContain("smart_order_sidecar_readiness=not-ready");
    expect(output).not.toContain("smart_order_sidecar_health=authenticated");
  });

  it("startup wait 的最小 epoch 會拒絕前一次 crash 殘留 discovery", async () => {
    const minimumStartedAtEpochMs = Date.now();
    const fixture = await createSmartOrderStatusFixture({
      startedAtEpochMs: minimumStartedAtEpochMs - 1,
    });
    expect(() =>
      execFileSync(
        "/bin/zsh",
        [
          "-c",
          `source <(awk '/^command_name=/{exit} {print}' "$1")
strict_smart_order_discovery_epoch "$2"`,
          "stale-sidecar-discovery-test",
          runtimePath,
          String(minimumStartedAtEpochMs),
        ],
        { env: fixture.environment, stdio: "pipe" },
      ),
    ).toThrow();
  });

  it("mode 與 API generation 不一致時 status 維持 unverified 且 generation invalid", async () => {
    const fixture = await createSmartOrderStatusFixture({
      apiGeneration: "production-readonly:11111111-1111-4111-8111-111111111111",
    });
    const output = execFileSync("/bin/zsh", [runtimePath, "status"], {
      env: fixture.environment,
      encoding: "utf8",
    });
    expect(output).toContain("smart_order_mode_generation=unsafe-or-invalid");
    expect(output).toContain("smart_order_sidecar_health=unverified");
    expect(output).toContain("smart_order_sidecar_readiness=not-ready");
    expect(output).not.toContain("smart_order_sidecar_health=authenticated");
  });

  it("uninstall 在任何 service mutation 前要求 exact durable stop completion 並保留資料庫", async () => {
    const source = await readFile(runtimePath, "utf8");
    const uninstall = source.match(/uninstall_runtime\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(uninstall.trimStart().startsWith("assert_smart_order_uninstall_safe")).toBe(true);
    expect(uninstall).toContain('command rm -f "${SMART_ORDER_CAPABILITY_PATH}"');
    expect(uninstall).not.toMatch(/SMART_ORDER_DATABASE_PATH.*rm|SMART_ORDER_ROOT.*rm|backups.*rm/i);
    const guard = source.match(/assert_smart_order_uninstall_safe\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(guard).toContain("stop_smart_order_sidecar_for_lifecycle uninstall");
    const quiesce = source.match(/quiesce_smart_order_sidecar_for_lifecycle\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(quiesce).toContain('SMART_ORDER_DIAGNOSTICS');
    expect(quiesce).toContain('quiesce "${operation}"');
    expect(quiesce).toContain('.drainAllowed == true');
    expect(quiesce).toContain('.blockerCount');
    expect(quiesce).toContain('本次未停止任何服務');
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
