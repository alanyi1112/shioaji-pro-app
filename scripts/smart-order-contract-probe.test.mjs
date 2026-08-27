import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  accountEvidenceFromEventPayload,
  assertExactLoopbackBase,
  managedSmartOrderReadonlyProbeAppSupportRoot,
  readPrivateSimulationMode,
  runFixtureProbe,
  runOfflineFixtureScenario,
  runOfflineObserverScenario,
  runOfflineTransportScenario,
  runReadOnlyContractProbe,
} from "./smart-order-contract-probe.mjs";
import { SMART_ORDER_CONTRACT_PROBE_TEST_ONLY } from
  "./smart-order-runtime/smart-order-contract-probe-runtime-authority.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

function fixtureAccount(overrides = {}) {
  return {
    broker_id: "sensitive-broker",
    account_id: "sensitive-account",
    account_type: "S",
    signed: true,
    person_id: "sensitive-person",
    username: "sensitive-user",
    ...overrides,
  };
}

function info(overrides = {}) {
  return {
    name: "fixture-shioaji",
    version: "v1.7.1",
    protocols: ["http", "sse"],
    simulation: true,
    ...overrides,
  };
}

function trade(account, overrides = {}) {
  return {
    contract: { code: "2330" },
    order: {
      id: "fixture-trade",
      account: {
        broker_id: account.broker_id,
        account_id: account.account_id,
        account_type: account.account_type,
      },
    },
    status: { status: "Submitted" },
    ...overrides,
  };
}

function position(overrides = {}) {
  return {
    id: 1,
    code: "2330",
    direction: "Buy",
    quantity: 1000,
    price: 100,
    last_price: 101,
    pnl: 1000,
    yd_quantity: 1000,
    ...overrides,
  };
}

function createProbeFixture(options = {}) {
  return {
    serializedScenario: JSON.stringify(options),
    calls: [],
  };
}

async function runProbeFixture(fixture) {
  const execution = await runOfflineFixtureScenario(fixture.serializedScenario);
  fixture.calls.splice(0, fixture.calls.length, ...execution.trace);
  return execution.report;
}

function stockOrderEvent(account, overrides = {}) {
  return {
    state: "StockOrder",
    data: {
      StockOrder: {
        operation: { op_type: "New", op_code: "00" },
        order: {
          id: "event-order",
          account: {
            broker_id: account.broker_id,
            account_id: account.account_id,
            account_type: account.account_type,
          },
        },
        contract: { code: "2330" },
        status: { id: "event-order", exchange_ts: 1_786_550_400.1 },
        ...overrides,
      },
    },
  };
}

describe("smart-order simulation read-only contract probe", () => {
  it("fixture 永遠是 test_only，且機械性排除 task 0.3 與 Gate manifest", async () => {
    const report = await runFixtureProbe();
    const serialized = JSON.stringify(report);
    expect(report).toMatchObject({
      executionMode: "fixture",
      evidenceClass: "test_fixture",
      evidenceEligible: false,
      eligibleForTask0_3: false,
      eligibleForGateManifest: false,
      overall: "test_only",
      testOutcome: "inconclusive",
      requiredLiveChecksComplete: false,
    });
    expect(report.codeRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.fingerprint.probeSourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.network).toMatchObject({
      requestCount: 8,
      observationControlMutations: 1,
      subscriptionRequests: 1,
      subscriptionsCreatedOrConfirmed: 1,
      brokerWritesAttempted: 0,
      brokerWritesNetworked: 0,
    });
    expect(serialized).not.toMatch(/fixture-(?:broker|account|person|user)/);
    expect(serialized).not.toMatch(/broker_id|account_id|person_id|username/);
    expect(report.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("只接受固定受管 127.0.0.1:8080 base", () => {
    expect(assertExactLoopbackBase("http://127.0.0.1:8080")).toBe(
      "http://127.0.0.1:8080",
    );
    for (const value of [
      "http://localhost:8080",
      "http://127.0.0.1:8081",
      "https://127.0.0.1:8080",
      "http://127.0.0.1:8080/api",
      "http://user@127.0.0.1:8080",
      "http://192.168.1.5:8080",
    ]) {
      expect(() => assertExactLoopbackBase(value)).toThrow();
    }
  });

  it("mode marker 必須是 owner-only regular simulation 檔且拒絕 symlink", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "smart-order-probe-mode-"));
    temporaryDirectories.push(directory);
    const modeFile = path.join(directory, "runtime-mode");
    await writeFile(modeFile, "simulation\n", { mode: 0o600 });
    expect(await readPrivateSimulationMode(modeFile)).toBe("simulation");
    await chmod(modeFile, 0o644);
    await expect(readPrivateSimulationMode(modeFile)).rejects.toThrow();
    await chmod(modeFile, 0o600);
    const link = path.join(directory, "runtime-mode-link");
    await symlink(modeFile, link);
    await expect(readPrivateSimulationMode(link)).rejects.toThrow();
  });

  it("mode 未知時在任何 HTTP request 前停止", async () => {
    const fixture = createProbeFixture({ mode: "unknown" });
    const report = await runProbeFixture(fixture);
    expect(report.testOutcome).toBe("blocked");
    expect(fixture.calls).toHaveLength(0);
    expect(report.network.requestCount).toBe(0);
  });

  it("exported fixture 只接受 JSON data；wrapper、bind與額外dependency皆無法碰網路", async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    const trackedFetch = async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    };
    globalThis.fetch = trackedFetch;
    try {
      const wrapper = (...args) => globalThis.fetch(...args);
      const bound = globalThis.fetch.bind(globalThis);
      await expect(runReadOnlyContractProbe(wrapper)).rejects.toThrow(
        "blocked_managed_runtime_unverified",
      );
      await expect(runReadOnlyContractProbe(bound)).rejects.toThrow(
        "blocked_managed_runtime_unverified",
      );
      const report = await runReadOnlyContractProbe("{}", {
        fetchImpl: wrapper,
        readMode: async () => "simulation",
      });
      expect(report).toMatchObject({
        executionMode: "fixture",
        overall: "test_only",
        network: { requestCount: 8 },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalls).toBe(0);
  });

  it("低階 transport 情境在 fetch 前拒絕 broker write path並量測 attempt", async () => {
    const result = await runOfflineTransportScenario(JSON.stringify({ kind: "brokerWrite" }));
    expect(result).toMatchObject({
      reason: "blocked_readonly_endpoint_unavailable",
      fetchCalls: 0,
      metrics: {
        brokerWritesAttempted: 1,
        brokerWritesNetworked: 0,
        requestCount: 0,
      },
    });
  });

  it("只選一個固定股票帳號，所有 account request 使用精確 tuple 與 Share unit", async () => {
    const selected = fixtureAccount({ account_id: "a-selected" });
    const second = fixtureAccount({ account_id: "z-second" });
    const fixture = createProbeFixture({ account: selected, accounts: [second, selected] });
    const report = await runProbeFixture(fixture);
    expect(report.signedStockAccountCount).toBe(2);
    const scoped = fixture.calls.filter((call) => call.method === "POST");
    expect(scoped).toHaveLength(3);
    for (const call of scoped) {
      expect(call.accountRef).toBe("stock-account-1");
      expect(call.redirect).toBe("error");
    }
    expect(scoped.find((call) => call.endpoint.endsWith("position_unit")).unit).toBe("Share");
  });

  it("subscribe 或 trades內建update-status能力缺少官方schema時會阻擋", async () => {
    for (const scenario of [
      { subscribe204: true },
      { openApiContractInvalid: true },
    ]) {
      const fixture = createProbeFixture(scenario);
      const report = await runProbeFixture(fixture);
      expect(report.testOutcome).toBe("blocked");
      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "probe-execution",
          status: "blocked",
          reason: "blocked_response_schema_invalid",
        }),
      ]));
    }
  });

  it("307/308 redirect 一律禁止跟隨，也不會產生第二個 request", async () => {
    for (const status of [307, 308]) {
      const fixture = createProbeFixture({
        fault: status === 307 ? "redirect307" : "redirect308",
      });
      const report = await runProbeFixture(fixture);
      expect(report.testOutcome).toBe("blocked");
      expect(fixture.calls).toHaveLength(1);
      expect(fixture.calls[0].redirect).toBe("error");
    }
  });

  it("response.redirected 或 final URL 不符時以 blocked_redirect 拒絕", async () => {
    for (const mode of ["redirected", "url-mismatch"]) {
      const fixture = createProbeFixture({
        fault: mode === "redirected" ? "responseRedirected" : "urlMismatch",
      });
      const report = await runProbeFixture(fixture);
      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ reason: "blocked_redirect" }),
      ]));
    }
  });

  it("錯 Content-Type 與明確 API error envelope 不得當成功", async () => {
    const wrongType = createProbeFixture({ fault: "wrongContentType" });
    const wrongTypeReport = await runProbeFixture(wrongType);
    expect(wrongTypeReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "blocked_content_type_invalid" }),
    ]));

    const errorEnvelope = createProbeFixture({ subscribeResponse: { success: false } });
    const errorReport = await runProbeFixture(errorEnvelope);
    expect(errorReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "blocked_api_error_envelope" }),
    ]));
  });

  it("header 後卡住的 JSON body 仍受同一 timeout 約束", async () => {
    const fixture = createProbeFixture({
      requestTimeoutMs: 20,
      fault: "stallJson",
    });
    const report = await runProbeFixture(fixture);
    expect(report.testOutcome).toBe("blocked");
    expect(report.network.requestCount).toBe(1);
  });

  it("chunked JSON 超過 byte 上限時在解析前阻擋且不輸出內容", async () => {
    const fixture = createProbeFixture({ fault: "oversizedJson" });
    const report = await runProbeFixture(fixture);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "blocked_response_too_large" }),
    ]));
    expect(JSON.stringify(report)).not.toContain("oversized-secret");
  });

  it("trades 只認 order.account；metadata echo 不得掩蓋 foreign account", async () => {
    const account = fixtureAccount();
    const foreign = fixtureAccount({ broker_id: "foreign", account_id: "foreign" });
    const fixture = createProbeFixture({
      account,
      trades: [
        trade(account),
        trade(foreign, { metadata: { account } }),
      ],
    });
    const report = await runProbeFixture(fixture);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "blocked_account_mismatch" }),
    ]));
    expect(JSON.stringify(report)).not.toContain("foreign");
  });

  it("官方 account-scoped trades 空集合可通過；非空列缺 canonical account 則 inconclusive", async () => {
    const empty = createProbeFixture({ trades: [] });
    const emptyReport = await runProbeFixture(empty);
    expect(emptyReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "trades-account-scope",
        status: "pass",
      }),
    ]));

    const account = fixtureAccount();
    const missing = createProbeFixture({
      account,
      trades: [trade(account, { order: { id: "missing-account" } })],
    });
    const missingReport = await runProbeFixture(missing);
    expect(missingReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "trades-account-scope",
        status: "inconclusive",
      }),
    ]));
  });

  it("官方 account-scoped StockPosition shape 通過；fractional Share 直接阻擋", async () => {
    const valid = createProbeFixture({ positions: [position()] });
    const validReport = await runProbeFixture(valid);
    expect(validReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "positions-response-shape", status: "pass" }),
      expect.objectContaining({ id: "positions-account-scope", status: "pass" }),
    ]));

    const invalid = createProbeFixture({ positions: [position({ quantity: 1.5 })] });
    const invalidReport = await runProbeFixture(invalid);
    expect(invalidReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "blocked_response_schema_invalid" }),
    ]));
  });

  it("event 只接受 canonical StockOrder account；Futures、StockDeal與metadata均不算", () => {
    const account = fixtureAccount();
    expect(accountEvidenceFromEventPayload(stockOrderEvent(account), [account])).toMatchObject({
      observed: true,
      matchedCount: 1,
      accountAbsent: false,
      mismatch: false,
    });
    for (const payload of [
      { state: "FuturesOrder", data: { FuturesOrder: { order: { account } } } },
      { state: "StockDeal", data: { StockDeal: { account } } },
      { account, state: "message", data: {} },
    ]) {
      expect(accountEvidenceFromEventPayload(payload, [account]).observed).toBe(false);
    }
    const missing = stockOrderEvent(account);
    delete missing.data.StockOrder.order.account;
    expect(accountEvidenceFromEventPayload(missing, [account]).accountAbsent).toBe(true);
    expect(
      accountEvidenceFromEventPayload(
        stockOrderEvent(account, { operation: undefined }),
        [account],
      ),
    ).toMatchObject({ observed: true, matchedCount: 1, schemaInvalid: false });
  });

  it("官方 StockOrder callback status 以 id/exchange_ts 關聯，不要求 refreshed Trade 才有的 status.status", () => {
    const account = fixtureAccount();
    const officialCallback = stockOrderEvent(account);
    expect(officialCallback.data.StockOrder.status).toEqual({
      id: "event-order",
      exchange_ts: 1_786_550_400.1,
    });
    expect(accountEvidenceFromEventPayload(officialCallback, [account])).toMatchObject({
      observed: true,
      matchedCount: 1,
      schemaInvalid: false,
    });
  });

  it("malformed StockOrder wrapper 一律標成 schemaInvalid，後續 valid event 不得掩蓋", async () => {
    const account = fixtureAccount();
    const malformed = [
      { state: "StockOrder", data: {} },
      { state: "StockOrder", data: { StockOrder: { status: {} } } },
      stockOrderEvent(account, { status: { id: "different-order", exchange_ts: 1_786_550_400.1 } }),
      stockOrderEvent(account, { status: { id: "event-order", exchange_ts: "invalid" } }),
      stockOrderEvent(account, { status: { id: "event-order", exchange_ts: 0 } }),
    ];
    for (const payload of malformed) {
      expect(accountEvidenceFromEventPayload(payload, [account])).toMatchObject({
        observed: true,
        matchedCount: 0,
        schemaInvalid: true,
      });
    }

    const { evidence } = await runOfflineObserverScenario(JSON.stringify({
      kind: "schemaInvalidThenValid",
    }));
    expect(evidence).toMatchObject({ matchedCount: 0, schemaInvalid: true });
  });

  it("pre-subscription SSE observer 永遠不接受 queued event，即使之後標記 response", async () => {
    const { evidence } = await runOfflineObserverScenario(JSON.stringify({
      kind: "preQueued",
    }));
    expect(evidence).toMatchObject({
      matchedCount: 0,
      ignoredBeforeSubscription: 1,
    });
  });

  it("subscription response 後的 canonical StockOrder event 才能形成證據", async () => {
    const { evidence } = await runOfflineObserverScenario(JSON.stringify({
      kind: "postCanonical",
    }));
    expect(evidence).toMatchObject({ matchedCount: 1, mismatch: false });
  });

  it("SSE 單一 event 超過上限時阻擋並 cancel reader", async () => {
    const result = await runOfflineObserverScenario(JSON.stringify({ kind: "oversized" }));
    expect(result.reason).toBe("blocked_response_too_large");
    expect(result.cancelled).toBe(true);

    const preStop = await runOfflineObserverScenario(JSON.stringify({
      kind: "preOversizedStopOnly",
    }));
    expect(preStop.reason).toBe("blocked_response_too_large");
    expect(preStop.cancelled).toBe(true);
  });

  it("final info fingerprint 或 service PID 改變時 fail closed", async () => {
    const fingerprintChanged = createProbeFixture({
      finalInfo: info({ protocols: ["http"] }),
    });
    const firstReport = await runProbeFixture(fingerprintChanged);
    expect(firstReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "blocked_generation_changed" }),
    ]));

    const generationChanged = createProbeFixture({
      generations: ["generation-a", "generation-a", "generation-b"],
    });
    const secondReport = await runProbeFixture(generationChanged);
    expect(secondReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "blocked_generation_changed" }),
    ]));
  });

  it("unknown 或 mismatched server version 無法通過", async () => {
    for (const value of [undefined, "v9.9.9"]) {
      const fixture = createProbeFixture(value === undefined
        ? { omitInfoVersion: true }
        : { info: { version: value } });
      const report = await runProbeFixture(fixture);
      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ reason: "blocked_server_version_mismatch" }),
      ]));
    }
  });

  it("stateful toString 不得在 allowlist 與 fetch 間改寫 endpoint 或 method", async () => {
    const endpoint = await runOfflineTransportScenario(JSON.stringify({
      kind: "mutableEndpoint",
    }));
    const method = await runOfflineTransportScenario(JSON.stringify({
      kind: "mutableMethod",
    }));
    expect(endpoint).toMatchObject({
      reason: "blocked_readonly_endpoint_unavailable",
      endpointReads: 0,
      fetchCalls: 0,
      metrics: { requestCount: 0 },
    });
    expect(method).toMatchObject({
      reason: "blocked_readonly_endpoint_unavailable",
      fetchCalls: 0,
      metrics: { requestCount: 0 },
    });
  });

  it("redaction scan 會攔截嵌在 report string leaf 內的帳號片段", async () => {
    const account = fixtureAccount({ account_id: "account-1" });
    const fixture = createProbeFixture({ account });
    const report = await runProbeFixture(fixture);
    expect(report).toMatchObject({
      redactionScan: "blocked",
      testOutcome: "blocked",
      checks: [expect.objectContaining({ id: "redaction-scan", status: "blocked" })],
    });
    expect(JSON.stringify(report)).not.toContain("sensitive-broker");
  });

  it("production live authority沒有Vitest issuer，且環境變數不能改寫canonical root", () => {
    const original = process.env.REALTIME_STOCK_APP_SUPPORT;
    process.env.REALTIME_STOCK_APP_SUPPORT = "/private/tmp/forged-smart-order-root";
    try {
      expect(SMART_ORDER_CONTRACT_PROBE_TEST_ONLY).toBeUndefined();
      expect(managedSmartOrderReadonlyProbeAppSupportRoot()).toBe(path.join(
        homedir(),
        "Library",
        "Application Support",
        "RealTimeStock",
      ));
    } finally {
      if (original === undefined) delete process.env.REALTIME_STOCK_APP_SUPPORT;
      else process.env.REALTIME_STOCK_APP_SUPPORT = original;
    }
  });

  it("confirmed live-readonly CLI只建立module-issued coordinator並在完成後關閉", async () => {
    const [source, writeAdmissionSource] = await Promise.all([
      readFile(
        fileURLToPath(new URL("./smart-order-contract-probe.mjs", import.meta.url)),
        "utf8",
      ),
      readFile(
        fileURLToPath(new URL(
          "./smart-order-runtime/mode-write-admission.mjs",
          import.meta.url,
        )),
        "utf8",
      ),
    ]);
    expect(source).toMatch(
      /async function runManagedLiveReadOnlyProbe\(\) \{[\s\S]*?createSmartOrderResourceCoordinator\(\)[\s\S]*?runManagedLiveReadOnlyPreflight\(\{ resourceCoordinator \}\)[\s\S]*?finally \{[\s\S]*?resourceCoordinator\.close\(\)/,
    );
    expect(source).toContain(
      "if (!isIssuedSmartOrderResourceCoordinator(resourceCoordinator))",
    );
    expect(source).toContain('"read_only_attested_process_epoch"');
    expect(source).toContain("(metadata.mode & 0o022) !== 0");
    expect(source).toContain(
      "processAfter.processStartIdentitySha256 !==\n          processBefore.processStartIdentitySha256",
    );
    expect(source).toContain(
      "export const EXTERNAL_ORDER_EVENT_OBSERVATION_TIMEOUT_MS = 360_000",
    );
    expect(source).toContain(
      "export const TASK_0_3_EVENT_TIMEOUT_MS = 360_000",
    );
    expect(source).toContain(
      "observationAbortSignal:\n          task03Coordination?.observationAbortSignal",
    );
    expect(source).toContain(
      'observationAbortSignal?.addEventListener("abort", abortFromCoordination',
    );
    expect(source).toContain(
      "eventTimeoutMs !== EXTERNAL_ORDER_EVENT_OBSERVATION_TIMEOUT_MS",
    );
    expect(writeAdmissionSource).toContain("'runtime-api-generation'");
    expect(writeAdmissionSource).not.toContain(
      "read_only_attested_process_epoch",
    );
  });

  it("fixture CLI 即使harness正常也以非零狀態防止naive pipeline誤收", () => {
    const scriptPath = fileURLToPath(new URL("./smart-order-contract-probe.mjs", import.meta.url));
    const fixture = spawnSync(process.execPath, [scriptPath, "fixture"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(fixture.status).toBe(3);
    const report = JSON.parse(fixture.stdout);
    expect(report).toMatchObject({
      executionMode: "fixture",
      overall: "test_only",
      evidenceEligible: false,
    });

    const invalid = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(invalid.status).toBe(2);
    expect(invalid.stdout).toBe("");

    const extraConfirmation = spawnSync(process.execPath, [
      scriptPath,
      "live-readonly",
      "--confirm=I_CONFIRM_SIMULATION_READONLY_SESSION_PROBE",
      "extra",
    ], {
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(extraConfirmation.status).toBe(2);
    expect(extraConfirmation.stdout).toBe("");
  });
});
