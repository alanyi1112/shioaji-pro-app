import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WATCHDOG_RESTART_DELAYS_MS,
  createWatchdogState,
  runWatchdogOnce,
  transitionWatchdogState,
  writeWatchdogState,
} from "./realtimestock-watchdog.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
function observe(state, input) {
  return transitionWatchdogState(state, {
    now: input.now,
    mode: input.mode ?? "simulation",
    jobLoaded: input.jobLoaded ?? true,
    generation: input.generation ?? "1234",
    apiSimulation: input.apiSimulation ?? true,
    probe: input.probe,
  });
}

describe("simulation business-session watchdog", () => {
  it("初始 generation 從未成功時維持 unarmed，不因 SessionNotEstablished 重啟", () => {
    let state = createWatchdogState(0);
    for (const now of [0, 30_000, 60_000, 120_000, 180_000]) {
      const result = observe(state, { now, probe: "session-not-established" });
      state = result.state;
      expect(result.action).toBe("none");
    }
    expect(state.state).toBe("startup-grace");
    expect(state.armed).toBe(false);
    expect(state.lastReason).toBe("initial-session-not-established");
  });

  it("成功後 armed，連續三次 session failure 才要求重啟", () => {
    let result = observe(createWatchdogState(0), { now: 1_000, probe: "available" });
    expect(result.state.armed).toBe(true);
    for (const now of [31_000, 61_000]) {
      result = observe(result.state, { now, probe: "session-not-established" });
      expect(result.action).toBe("none");
    }
    result = observe(result.state, { now: 91_000, probe: "session-not-established" });
    expect(result.action).toBe("restart-simulation-api");
    expect(result.state.restartCount).toBe(1);
    expect(result.state.nextEligibleAt).toBe(91_000 + WATCHDOG_RESTART_DELAYS_MS[0]);
  });

  it("任一次 Snapshot 成功會清除 failure 與 recovery incident", () => {
    let result = observe(createWatchdogState(0), { now: 1_000, probe: "available" });
    result = observe(result.state, { now: 31_000, probe: "session-not-established" });
    expect(result.state.consecutiveFailures).toBe(1);
    result = observe(result.state, { now: 61_000, probe: "available" });
    expect(result.state.state).toBe("healthy");
    expect(result.state.consecutiveFailures).toBe(0);
    expect(result.state.restartCount).toBe(0);
    expect(result.state.incidentActive).toBe(false);
  });

  it("generic error、listener down、mode mismatch 與 non-simulation 不重啟", () => {
    let state = observe(createWatchdogState(0), { now: 1_000, probe: "available" }).state;
    for (const probe of ["unavailable-http-500", "listener-unavailable", "health-unavailable"]) {
      const result = observe(state, { now: state.lastTransitionAt + 30_000, probe });
      expect(result.action).toBe("none");
      expect(result.state.consecutiveFailures).toBe(0);
      state = result.state;
    }
    const mismatch = observe(state, { now: 200_000, probe: "mode-mismatch", apiSimulation: false });
    expect(mismatch.action).toBe("none");
    expect(mismatch.state.state).toBe("idle-non-simulation");
    const production = observe(state, { now: 230_000, probe: "non-simulation", mode: "production-readonly", apiSimulation: null });
    expect(production.action).toBe("none");
    expect(production.state.state).toBe("idle-non-simulation");
  });

  it("recovery 依 2／5 分鐘退避且第三次後 circuit-open", () => {
    let result = observe(createWatchdogState(0), { now: 1_000, probe: "available" });
    for (const now of [31_000, 61_000, 91_000]) result = observe(result.state, { now, probe: "session-not-established" });
    expect(result.state.restartCount).toBe(1);

    result = observe(result.state, { now: 92_000, generation: "2345", probe: "session-not-established" });
    expect(result.state.state).toBe("recovering");
    result = observe(result.state, { now: 91_000 + WATCHDOG_RESTART_DELAYS_MS[0], generation: "2345", probe: "session-not-established" });
    expect(result.action).toBe("restart-simulation-api");
    expect(result.state.restartCount).toBe(2);

    result = observe(result.state, { now: 220_000, generation: "3456", probe: "session-not-established" });
    expect(result.action).toBe("none");
    result = observe(result.state, { now: 91_000 + WATCHDOG_RESTART_DELAYS_MS[0] + WATCHDOG_RESTART_DELAYS_MS[1], generation: "3456", probe: "session-not-established" });
    expect(result.action).toBe("restart-simulation-api");
    expect(result.state.restartCount).toBe(3);
    result = observe(result.state, { now: 800_000, generation: "4567", probe: "session-not-established" });
    expect(result.action).toBe("none");
    expect(result.state.state).toBe("circuit-open");
  });

  it("runWatchdogOnce 可注入 clock、API、generation 與 restart adapter，並原子保存 allowlist state", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "realtimestock-watchdog-"));
    temporaryDirectories.push(directory);
    const config = { statePath: path.join(directory, "watchdog", "state.json"), lockPath: path.join(directory, "watchdog", "once.lock") };
    let now = 1_000;
    let restarts = 0;
    let observation = { mode: "simulation", jobLoaded: true, generation: "1234", apiSimulation: true, probe: "available" };
    const dependencies = {
      now: () => now,
      observe: async () => observation,
      restartJob: () => { restarts += 1; return true; },
    };

    await runWatchdogOnce(config, dependencies);
    for (const nextNow of [31_000, 61_000, 91_000]) {
      now = nextNow;
      observation = { ...observation, probe: "session-not-established" };
      await runWatchdogOnce(config, dependencies);
    }
    expect(restarts).toBe(1);
    const saved = JSON.parse(await readFile(config.statePath, "utf8"));
    expect(Object.keys(saved).sort()).toEqual([
      "armed", "consecutiveFailures", "generation", "generationStartedAt", "incidentActive", "lastReason",
      "lastTransitionAt", "nextEligibleAt", "restartCount", "schemaVersion", "state",
    ].sort());
    expect(saved).not.toHaveProperty("responseBody");
    expect((await stat(path.dirname(config.statePath))).mode & 0o777).toBe(0o700);
    expect((await stat(config.statePath)).mode & 0o777).toBe(0o600);
  });

  it("state sanitizer 不保存任意欄位或任意 reason", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "realtimestock-watchdog-state-"));
    temporaryDirectories.push(directory);
    const statePath = path.join(directory, "watchdog", "state.json");
    await writeWatchdogState(statePath, {
      ...createWatchdogState(1_000, "1234"),
      lastReason: "secret-response-body",
      account: "should-not-persist",
      responseBody: "should-not-persist",
    }, 1_000);
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    expect(saved.lastReason).toBe("unknown");
    expect(saved.account).toBeUndefined();
    expect(saved.responseBody).toBeUndefined();
  });
});
