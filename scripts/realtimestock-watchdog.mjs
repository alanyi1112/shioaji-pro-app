#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const WATCHDOG_SCHEMA_VERSION = 1;
export const WATCHDOG_PROBE_INTERVAL_MS = 30_000;
export const WATCHDOG_WARMUP_MS = 90_000;
export const WATCHDOG_FAILURE_THRESHOLD = 3;
export const WATCHDOG_MAX_RESTARTS = 3;
export const WATCHDOG_RESTART_DELAYS_MS = [120_000, 300_000];

const WATCHDOG_STATES = new Set([
  "startup-grace",
  "healthy",
  "suspect",
  "recovering",
  "backoff",
  "circuit-open",
  "idle-non-simulation",
]);

const SAFE_REASONS = new Set([
  "unknown",
  "available",
  "session-not-established",
  "initial-session-not-established",
  "listener-unavailable",
  "health-unavailable",
  "mode-mismatch",
  "simulation-job-unavailable",
  "restart-requested",
  "restart-failed",
  "non-simulation",
  "locked",
]);

function safeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function safeGeneration(value) {
  const text = String(value || "");
  return /^\d{1,12}$/.test(text) ? text : "";
}

function safeReason(value) {
  const text = String(value || "unknown");
  if (SAFE_REASONS.has(text)) return text;
  if (/^unavailable-http-(?:\d{3}|000)$/.test(text)) return text;
  return "unknown";
}

export function createWatchdogState(now = Date.now(), generation = "") {
  return {
    schemaVersion: WATCHDOG_SCHEMA_VERSION,
    state: "startup-grace",
    generation: safeGeneration(generation),
    generationStartedAt: safeInteger(now),
    armed: false,
    incidentActive: false,
    consecutiveFailures: 0,
    restartCount: 0,
    lastReason: "unknown",
    lastTransitionAt: safeInteger(now),
    nextEligibleAt: 0,
  };
}

export function sanitizeWatchdogState(value, now = Date.now()) {
  const source = value && typeof value === "object" ? value : {};
  const fallback = createWatchdogState(now);
  return {
    schemaVersion: WATCHDOG_SCHEMA_VERSION,
    state: WATCHDOG_STATES.has(source.state) ? source.state : fallback.state,
    generation: safeGeneration(source.generation),
    generationStartedAt: safeInteger(source.generationStartedAt, safeInteger(now)),
    armed: source.armed === true,
    incidentActive: source.incidentActive === true,
    consecutiveFailures: Math.min(safeInteger(source.consecutiveFailures), WATCHDOG_FAILURE_THRESHOLD),
    restartCount: Math.min(safeInteger(source.restartCount), WATCHDOG_MAX_RESTARTS),
    lastReason: safeReason(source.lastReason),
    lastTransitionAt: safeInteger(source.lastTransitionAt, safeInteger(now)),
    nextEligibleAt: safeInteger(source.nextEligibleAt),
  };
}

function changedState(previous, updates, now) {
  const next = { ...previous, ...updates };
  if (next.state !== previous.state || next.lastReason !== previous.lastReason) {
    next.lastTransitionAt = now;
  }
  return sanitizeWatchdogState(next, now);
}

function restartDelayAfterCount(restartCount) {
  if (restartCount === 1) return WATCHDOG_RESTART_DELAYS_MS[0];
  if (restartCount === 2) return WATCHDOG_RESTART_DELAYS_MS[1];
  return 0;
}

export function transitionWatchdogState(previousValue, observation) {
  const now = safeInteger(observation?.now, Date.now());
  const mode = String(observation?.mode || "unknown");
  const generation = safeGeneration(observation?.generation);
  const jobLoaded = observation?.jobLoaded === true;
  const apiSimulation = observation?.apiSimulation;
  const probe = safeReason(observation?.probe);
  let previous = sanitizeWatchdogState(previousValue, now);

  if (mode !== "simulation" || apiSimulation === false) {
    return {
      state: changedState(createWatchdogState(now), {
        state: "idle-non-simulation",
        generation,
        lastReason: mode === "simulation" ? "mode-mismatch" : "non-simulation",
      }, now),
      action: "none",
    };
  }

  if (!jobLoaded || !generation) {
    return {
      state: changedState(previous, {
        state: previous.incidentActive ? previous.state : "startup-grace",
        consecutiveFailures: 0,
        lastReason: "simulation-job-unavailable",
      }, now),
      action: "none",
    };
  }

  if (previous.generation !== generation) {
    if (previous.incidentActive) {
      previous = changedState(previous, {
        state: "recovering",
        generation,
        generationStartedAt: now,
        armed: false,
        consecutiveFailures: 0,
        lastReason: "restart-requested",
      }, now);
    } else {
      previous = createWatchdogState(now, generation);
    }
  }

  if (apiSimulation !== true) {
    return {
      state: changedState(previous, {
        state: previous.armed ? "suspect" : "startup-grace",
        consecutiveFailures: 0,
        lastReason: probe === "unknown" ? "listener-unavailable" : probe,
      }, now),
      action: "none",
    };
  }

  if (probe === "available") {
    return {
      state: changedState(previous, {
        state: "healthy",
        armed: true,
        incidentActive: false,
        consecutiveFailures: 0,
        restartCount: 0,
        lastReason: "available",
        nextEligibleAt: 0,
      }, now),
      action: "none",
    };
  }

  if (previous.incidentActive) {
    if (previous.restartCount >= WATCHDOG_MAX_RESTARTS) {
      return {
        state: changedState(previous, {
          state: "circuit-open",
          consecutiveFailures: 0,
          lastReason: probe,
          nextEligibleAt: 0,
        }, now),
        action: "none",
      };
    }
    if (probe !== "session-not-established") {
      return {
        state: changedState(previous, {
          state: now < previous.nextEligibleAt ? "recovering" : "backoff",
          consecutiveFailures: 0,
          lastReason: probe,
        }, now),
        action: "none",
      };
    }
    if (now < previous.nextEligibleAt) {
      const generationAge = now - previous.generationStartedAt;
      return {
        state: changedState(previous, {
          state: generationAge < WATCHDOG_WARMUP_MS ? "recovering" : "backoff",
          consecutiveFailures: 0,
          lastReason: "session-not-established",
        }, now),
        action: "none",
      };
    }

    const restartCount = previous.restartCount + 1;
    return {
      state: changedState(previous, {
        state: "recovering",
        armed: false,
        consecutiveFailures: 0,
        restartCount,
        lastReason: "restart-requested",
        nextEligibleAt: now + restartDelayAfterCount(restartCount),
      }, now),
      action: "restart-simulation-api",
    };
  }

  if (!previous.armed) {
    return {
      state: changedState(previous, {
        state: "startup-grace",
        consecutiveFailures: 0,
        lastReason: probe === "session-not-established" ? "initial-session-not-established" : probe,
      }, now),
      action: "none",
    };
  }

  if (probe !== "session-not-established") {
    return {
      state: changedState(previous, {
        state: "suspect",
        consecutiveFailures: 0,
        lastReason: probe,
      }, now),
      action: "none",
    };
  }

  const consecutiveFailures = previous.consecutiveFailures + 1;
  if (consecutiveFailures < WATCHDOG_FAILURE_THRESHOLD) {
    return {
      state: changedState(previous, {
        state: "suspect",
        consecutiveFailures,
        lastReason: "session-not-established",
      }, now),
      action: "none",
    };
  }

  return {
    state: changedState(previous, {
      state: "recovering",
      armed: false,
      incidentActive: true,
      consecutiveFailures: 0,
      restartCount: 1,
      lastReason: "restart-requested",
      nextEligibleAt: now + WATCHDOG_RESTART_DELAYS_MS[0],
    }, now),
    action: "restart-simulation-api",
  };
}

export async function readWatchdogState(statePath, now = Date.now()) {
  try {
    return { exists: true, state: sanitizeWatchdogState(JSON.parse(await readFile(statePath, "utf8")), now) };
  } catch {
    return { exists: false, state: createWatchdogState(now) };
  }
}

export async function writeWatchdogState(statePath, value, now = Date.now()) {
  const directory = path.dirname(statePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const state = sanitizeWatchdogState(value, now);
  const temporaryPath = path.join(directory, `.state-${process.pid}-${now}.tmp`);
  const handle = await open(temporaryPath, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, statePath);
  await chmod(statePath, 0o600);
  return state;
}

async function acquireLock(lockPath, now) {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(lockPath), 0o700);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.close();
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (attempt > 0) return false;
      try {
        const details = await stat(lockPath);
        if (now - details.mtimeMs <= 120_000) return false;
        await unlink(lockPath);
      } catch (staleError) {
        if (staleError?.code !== "ENOENT") return false;
      }
    }
  }
  return false;
}

async function releaseLock(lockPath) {
  try {
    await unlink(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function fetchResponse(fetchImpl, url, init = {}, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, text, json };
  } catch {
    return { status: 0, text: "", json: null };
  } finally {
    clearTimeout(timer);
  }
}

function validateLoopbackBase(apiBase) {
  const parsed = new URL(apiBase);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) {
    throw new Error("watchdog_api_must_be_loopback");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function createSystemWatchdogDependencies(config = {}) {
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  const launchctl = config.launchctl || "/bin/launchctl";
  const apiBase = validateLoopbackBase(config.apiBase || "http://127.0.0.1:8080");
  const modeFile = config.modeFile;
  const serviceTarget = config.serviceTarget;

  async function readMode() {
    try {
      return (await readFile(modeFile, "utf8")).trim();
    } catch {
      return "unknown";
    }
  }

  function inspectJob() {
    const result = spawnSync(launchctl, ["print", serviceTarget], { encoding: "utf8" });
    if (result.status !== 0) return { loaded: false, generation: "" };
    const generation = String(result.stdout || "").match(/\bpid\s*=\s*(\d+)/)?.[1] || "";
    return { loaded: true, generation: safeGeneration(generation) };
  }

  async function observe() {
    const mode = await readMode();
    const job = inspectJob();
    if (mode !== "simulation") {
      return { mode, jobLoaded: job.loaded, generation: job.generation, apiSimulation: null, probe: "non-simulation" };
    }
    if (!job.loaded || !job.generation) {
      return { mode, jobLoaded: job.loaded, generation: job.generation, apiSimulation: null, probe: "simulation-job-unavailable" };
    }

    const info = await fetchResponse(fetchImpl, `${apiBase}/api/v1/info`);
    if (info.status !== 200 || typeof info.json?.simulation !== "boolean") {
      return { mode, jobLoaded: true, generation: job.generation, apiSimulation: null, probe: "listener-unavailable" };
    }
    if (info.json.simulation !== true) {
      return { mode, jobLoaded: true, generation: job.generation, apiSimulation: false, probe: "mode-mismatch" };
    }

    const health = await fetchResponse(fetchImpl, `${apiBase}/api/v1/health`);
    if (health.status !== 200 || !["healthy", "ok"].includes(String(health.json?.status || "").toLowerCase())) {
      return { mode, jobLoaded: true, generation: job.generation, apiSimulation: true, probe: "health-unavailable" };
    }

    const snapshot = await fetchResponse(fetchImpl, `${apiBase}/api/v1/data/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contracts: [{ security_type: "STK", region: "TW", exchange: "TSE", code: "2330", target_code: null }],
      }),
    });
    if (snapshot.status === 200 && Array.isArray(snapshot.json) && snapshot.json.length > 0) {
      return { mode, jobLoaded: true, generation: job.generation, apiSimulation: true, probe: "available" };
    }
    if (/(^|[^A-Za-z])SessionNotEstablished([^A-Za-z]|$)/.test(snapshot.text)) {
      return { mode, jobLoaded: true, generation: job.generation, apiSimulation: true, probe: "session-not-established" };
    }
    const status = snapshot.status > 0 ? String(snapshot.status).padStart(3, "0") : "000";
    return { mode, jobLoaded: true, generation: job.generation, apiSimulation: true, probe: `unavailable-http-${status}` };
  }

  function restartJob() {
    const result = spawnSync(launchctl, ["kickstart", "-k", serviceTarget], { encoding: "utf8" });
    return result.status === 0;
  }

  return { now: () => Date.now(), readMode, inspectJob, observe, restartJob };
}

export async function runWatchdogOnce(config, dependencies) {
  const now = dependencies.now();
  const locked = await acquireLock(config.lockPath, now);
  if (!locked) return { action: "locked", state: null };
  try {
    const previous = (await readWatchdogState(config.statePath, now)).state;
    const observation = { ...(await dependencies.observe()), now };
    let result = transitionWatchdogState(previous, observation);
    let action = result.action;

    if (action === "restart-simulation-api") {
      const confirmNow = dependencies.now();
      const confirmation = { ...(await dependencies.observe()), now: confirmNow };
      const stillEligible = confirmation.mode === "simulation"
        && confirmation.jobLoaded === true
        && confirmation.generation === observation.generation
        && confirmation.apiSimulation === true
        && confirmation.probe === "session-not-established";
      if (!stillEligible) {
        result = transitionWatchdogState(result.state, confirmation);
        action = "cancelled";
      } else if (!dependencies.restartJob()) {
        result = {
          state: changedState(result.state, { state: "backoff", lastReason: "restart-failed" }, confirmNow),
          action: "none",
        };
        action = "restart-failed";
      }
    }

    const state = await writeWatchdogState(config.statePath, result.state, dependencies.now());
    return { action, state };
  } finally {
    await releaseLock(config.lockPath);
  }
}

export async function resetWatchdog(config, now = Date.now()) {
  return writeWatchdogState(config.statePath, createWatchdogState(now), now);
}

export async function watchdogStatus(config, now = Date.now()) {
  return readWatchdogState(config.statePath, now);
}

function runtimeConfig(environment = process.env) {
  const appSupport = environment.REALTIME_STOCK_APP_SUPPORT
    || path.join(environment.HOME || homedir(), "Library", "Application Support", "RealTimeStock");
  const stateDir = environment.REALTIME_STOCK_WATCHDOG_STATE_DIR || path.join(appSupport, "watchdog");
  const userId = String(process.getuid?.() ?? "");
  return {
    statePath: path.join(stateDir, "state.json"),
    lockPath: path.join(stateDir, "watchdog-once.lock"),
    apiBase: environment.REALTIME_STOCK_WATCHDOG_API_BASE || "http://127.0.0.1:8080",
    modeFile: environment.REALTIME_STOCK_MODE_FILE || path.join(appSupport, "runtime-mode"),
    serviceTarget: environment.REALTIME_STOCK_SIM_SERVICE_TARGET
      || `gui/${userId}/com.alanyi.realtimestock.simulation-api`,
  };
}

async function main() {
  const command = process.argv[2] || "status";
  const config = runtimeConfig();
  if (command === "once") {
    const dependencies = createSystemWatchdogDependencies(config);
    await runWatchdogOnce(config, dependencies);
    return;
  }
  if (command === "reset") {
    await resetWatchdog(config);
    return;
  }
  if (command === "status") {
    const result = await watchdogStatus(config);
    const state = result.state;
    process.stdout.write([
      `business_watchdog_state=${result.exists ? state.state : "not-initialized"}`,
      `business_watchdog_consecutive_failures=${state.consecutiveFailures}`,
      `business_watchdog_restart_count=${state.restartCount}`,
      `business_watchdog_last_reason=${state.lastReason}`,
      `business_watchdog_next_eligible_at=${state.nextEligibleAt}`,
    ].join("\n") + "\n");
    return;
  }
  throw new Error("watchdog_command_invalid");
}

try {
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
  }
} catch (error) {
  process.stderr.write(`${safeReason(error?.message)}\n`);
  process.exitCode = 1;
}
