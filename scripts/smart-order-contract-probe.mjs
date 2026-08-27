import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalJson } from "./smart-order-runtime/canonical-json.mjs";
import { assertRepoExternalRoot } from "./smart-order-runtime/repo-external-root.mjs";
import {
  takeSmartOrderContractProbeRuntimeAuthority,
} from "./smart-order-runtime/smart-order-contract-probe-runtime-authority.mjs";
import {
  createSmartOrderResourceCoordinator,
  isIssuedSmartOrderResourceCoordinator,
} from "./smart-order-runtime/resource-coordinator.mjs";
import {
  prepareSmartOrderModeExecutionLeaseDirectoryForAppSupportRoot,
} from "./smart-order-runtime/mode-execution-lease.mjs";
import { smartOrderGateProbeAccountScopeSha256 } from "./smart-order-runtime/gate-probe-safety-envelope.mjs";
import {
  isIssuedTask03ObservationCoordination,
  task03TradeIdentitySha256,
} from "./smart-order-runtime/task0-3-observation-coordination.mjs";

export const SMART_ORDER_READONLY_PROBE_SCHEMA =
  "realtimestock.smart-order-readonly-contract-probe/v2";
export const SMART_ORDER_READONLY_PROBE_VERSION = "2026-08-22.1";

const PROBE_SOURCE_SHA256 = createHash("sha256")
  .update(await readFile(fileURLToPath(import.meta.url)))
  .digest("hex");

const LIVE_CONFIRMATION = "I_CONFIRM_SIMULATION_READONLY_SESSION_PROBE";
const MANAGED_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_EVENT_TIMEOUT_MS = 3_000;
export const EXTERNAL_ORDER_EVENT_OBSERVATION_TIMEOUT_MS = 360_000;
const MAX_EVENT_TIMEOUT_MS = EXTERNAL_ORDER_EVENT_OBSERVATION_TIMEOUT_MS;
export const TASK_0_3_EVENT_TIMEOUT_MS = 360_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_ACCOUNT_ROWS = 32;
const MAX_SSE_TOTAL_BYTES = 256 * 1024;
const MAX_SSE_EVENT_BYTES = 64 * 1024;
const MAX_SSE_EVENTS = 256;
const MAX_FINGERPRINT_FILES = 1_024;
const MAX_FINGERPRINT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_FINGERPRINT_TOTAL_BYTES = 64 * 1024 * 1024;

const ADAPTER_FINGERPRINT_FILES = Object.freeze([
  "scripts/smart-order-runtime/account-reconciliation-coordinator.mjs",
  "scripts/smart-order-runtime/managed-api-process-attestor.mjs",
  "scripts/smart-order-runtime/mode-execution-lease.mjs",
  "scripts/smart-order-runtime/shioaji-broker-event-mapper.mjs",
  "scripts/smart-order-runtime/shioaji-trade-observer.mjs",
  "scripts/smart-order-runtime/smart-order-contract-probe-runtime-authority.mjs",
  "scripts/smart-order-runtime/task0-3-observation-coordination.mjs",
  "scripts/smart-order-runtime/trade-subscription-coordinator.mjs",
]);

const ENDPOINTS = Object.freeze({
  openApi: "/openapi.json",
  info: "/api/v1/info",
  accounts: "/api/v1/auth/accounts",
  subscribeTrade: "/api/v1/auth/subscribe_trade",
  trades: "/api/v1/order/trades",
  positions: "/api/v1/portfolio/position_unit",
  stream: "/api/v1/stream/data/order_event",
});

const REQUEST_POLICY = new Map([
  [`GET ${ENDPOINTS.openApi}`, "accounting_read"],
  [`GET ${ENDPOINTS.info}`, "accounting_read"],
  [`GET ${ENDPOINTS.accounts}`, "accounting_read"],
  [`POST ${ENDPOINTS.subscribeTrade}`, "observation_control"],
  [`POST ${ENDPOINTS.trades}`, "accounting_read"],
  [`POST ${ENDPOINTS.positions}`, "accounting_read"],
  [`GET ${ENDPOINTS.stream}`, "observation_stream"],
]);

const BROKER_WRITE_PATHS = new Set([
  "/api/v1/order/place_order",
  "/api/v1/order/cancel_order",
  "/api/v1/order/update_price",
  "/api/v1/order/update_qty",
  "/api/v1/order/place_comboorder",
  "/api/v1/order/cancel_comboorder",
]);
const PLACE_ORDER_PATH_FOR_OFFLINE_TEST = "/api/v1/order/place_order";

const REASON_CODES = new Set([
  "blocked_account_ambiguous",
  "blocked_account_mismatch",
  "blocked_account_missing",
  "blocked_api_error_envelope",
  "blocked_content_type_invalid",
  "blocked_event_account_mismatch",
  "blocked_event_account_missing",
  "blocked_generation_changed",
  "blocked_managed_runtime_unverified",
  "blocked_mode_unknown",
  "blocked_non_simulation",
  "blocked_readonly_endpoint_unavailable",
  "blocked_readonly_request_failed",
  "blocked_redirect",
  "blocked_response_schema_invalid",
  "blocked_response_too_large",
  "blocked_server_version_mismatch",
  "blocked_shared_mode_lease_unavailable",
  "inconclusive_account_scope",
  "inconclusive_event_unobserved",
  "inconclusive_subscription_contract",
]);

const REQUIRED_LIVE_CHECK_IDS = Object.freeze([
  "mode-marker-before",
  "runtime-generation-evidence-before",
  "service-pid-before",
  "managed-runtime-binding-before",
  "api-simulation-before",
  "fixed-stock-account-selection",
  "trade-event-stream-ready",
  "trade-event-stream-reopened-after-subscription",
  "subscribe-request-account-bound",
  "trade-subscription-contract",
  "update-status-via-trades-capability",
  "update-status-via-trades-account-bound",
  "update-status-via-trades-account-scope",
  "trades-request-account-bound",
  "trades-account-scope",
  "positions-request-account-bound",
  "positions-response-shape",
  "positions-account-scope",
  "order-event-account",
  "api-fingerprint-after",
  "mode-marker-after",
  "runtime-generation-evidence-after",
  "service-pid-after",
  "managed-runtime-binding-after",
]);

class ProbeError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProbeError";
    this.code = REASON_CODES.has(code) ? code : "blocked_readonly_request_failed";
  }
}

function repositoryRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function readExpectedShioajiVersion() {
  const raw = (await readFile(path.join(repositoryRoot(), "SHIOAJI_VERSION"), "utf8")).trim();
  if (!/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(raw)) {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  return raw;
}

function defaultModeFile() {
  return path.join(
    homedir(),
    "Library",
    "Application Support",
    "RealTimeStock",
    "runtime-mode",
  );
}

export function managedSmartOrderReadonlyProbeAppSupportRoot() {
  return path.join(
    homedir(),
    "Library",
    "Application Support",
    "RealTimeStock",
  );
}

async function assertOwnerControlledCanonicalAppSupportRoot(value) {
  const normalized = await assertRepoExternalRoot(value, "read-only probe app support root");
  const metadata = await lstat(normalized);
  const ownerMatches =
    typeof process.getuid !== "function" || metadata.uid === process.getuid();
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !ownerMatches ||
    (metadata.mode & 0o022) !== 0 ||
    (await realpath(normalized)) !== normalized
  ) {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  return normalized;
}

async function createManagedReadonlyGenerationReader({
  generationPath,
  processAttestor,
  isManagedAttestation,
}) {
  try {
    await lstat(generationPath);
    return Object.freeze({
      evidenceClass: "pre_listener_private_marker",
      readGeneration: () => readPrivateToken(
        generationPath,
        256,
        "blocked_generation_changed",
      ),
    });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new ProbeError("blocked_generation_changed");
    }
  }
  return Object.freeze({
    evidenceClass: "read_only_attested_process_epoch",
    async readGeneration() {
      try {
        await lstat(generationPath);
        throw new ProbeError("blocked_generation_changed");
      } catch (error) {
        if (error instanceof ProbeError) throw error;
        if (error?.code !== "ENOENT") {
          throw new ProbeError("blocked_generation_changed");
        }
      }
      const attestation = await processAttestor.attest();
      if (
        !isManagedAttestation(attestation) ||
        !/^[a-f0-9]{64}$/.test(
          attestation?.processStartIdentitySha256 || "",
        )
      ) {
        throw new ProbeError("blocked_managed_runtime_unverified");
      }
      return attestation.processStartIdentitySha256;
    },
  });
}

async function readPrivateToken(filePath, maximumBytes, reason) {
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    throw new ProbeError(reason);
  }
  try {
    const metadata = await handle.stat();
    const ownerMatches =
      typeof process.getuid !== "function" || metadata.uid === process.getuid();
    if (
      !metadata.isFile() ||
      !ownerMatches ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size < 1 ||
      metadata.size > maximumBytes
    ) {
      throw new ProbeError(reason);
    }
    const value = (await handle.readFile("utf8")).trim();
    const metadataAfter = await handle.stat();
    if (
      metadataAfter.dev !== metadata.dev ||
      metadataAfter.ino !== metadata.ino ||
      metadataAfter.size !== metadata.size ||
      metadataAfter.mtimeMs !== metadata.mtimeMs ||
      value.length < 1 ||
      value.length > maximumBytes ||
      !/^[A-Za-z0-9._:-]+$/.test(value)
    ) {
      throw new ProbeError(reason);
    }
    return value;
  } finally {
    await handle.close();
  }
}

async function fingerprintFile(relativePath) {
  const root = repositoryRoot();
  const absolutePath = path.join(root, relativePath);
  const metadata = await lstat(absolutePath);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size < 1 ||
    metadata.size > MAX_FINGERPRINT_FILE_BYTES
  ) {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  const bytes = await readFile(absolutePath);
  const metadataAfter = await lstat(absolutePath);
  if (
    bytes.byteLength !== metadata.size ||
    metadataAfter.dev !== metadata.dev ||
    metadataAfter.ino !== metadata.ino ||
    metadataAfter.size !== metadata.size ||
    metadataAfter.mtimeMs !== metadata.mtimeMs
  ) {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  return Object.freeze({
    path: relativePath,
    bytes: metadata.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

async function collectBuildFiles(directoryPath, relativeDirectory = "") {
  const rows = [];
  const entries = await readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new ProbeError("blocked_managed_runtime_unverified");
    }
    const absolutePath = path.join(directoryPath, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      rows.push(...await collectBuildFiles(absolutePath, relativePath));
      continue;
    }
    if (!entry.isFile()) {
      throw new ProbeError("blocked_managed_runtime_unverified");
    }
    rows.push(await fingerprintFile(path.posix.join("dist", relativePath)));
    if (rows.length > MAX_FINGERPRINT_FILES) {
      throw new ProbeError("blocked_managed_runtime_unverified");
    }
  }
  return rows;
}

function digestFingerprintRows(rows) {
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  if (
    rows.length < 1 ||
    rows.length > MAX_FINGERPRINT_FILES ||
    totalBytes > MAX_FINGERPRINT_TOTAL_BYTES
  ) {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  return createHash("sha256").update(canonicalJson(rows)).digest("hex");
}

export async function currentSmartOrderReadonlyProbeFingerprints() {
  const buildRows = await collectBuildFiles(path.join(repositoryRoot(), "dist"));
  const adapterRows = [];
  for (const relativePath of ADAPTER_FINGERPRINT_FILES) {
    adapterRows.push(await fingerprintFile(relativePath));
  }
  return Object.freeze({
    appBuildSha256: digestFingerprintRows(buildRows),
    adapterSha256: digestFingerprintRows(adapterRows),
  });
}

export function assertExactLoopbackBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  if (
    url.href !== `${MANAGED_BASE_URL}/` ||
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "8080" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  return MANAGED_BASE_URL;
}

export async function readPrivateSimulationMode(modeFile = defaultModeFile()) {
  let handle;
  try {
    handle = await open(modeFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    throw new ProbeError("blocked_mode_unknown");
  }
  try {
    const metadata = await handle.stat();
    const ownerMatches =
      typeof process.getuid !== "function" || metadata.uid === process.getuid();
    if (
      !metadata.isFile() ||
      !ownerMatches ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size > 32
    ) {
      throw new ProbeError("blocked_mode_unknown");
    }
    const mode = (await handle.readFile("utf8")).trim();
    const metadataAfter = await handle.stat();
    if (
      metadataAfter.dev !== metadata.dev ||
      metadataAfter.ino !== metadata.ino ||
      metadataAfter.size !== metadata.size ||
      metadataAfter.mtimeMs !== metadata.mtimeMs
    ) {
      throw new ProbeError("blocked_mode_unknown");
    }
    if (mode !== "simulation") {
      throw new ProbeError(
        mode === "production-readonly" ? "blocked_non_simulation" : "blocked_mode_unknown",
      );
    }
    return mode;
  } finally {
    await handle.close();
  }
}

function accountTuple(account) {
  if (!account || typeof account !== "object") return null;
  const brokerId = account.broker_id;
  const accountId = account.account_id;
  const accountType = account.account_type;
  if (
    typeof brokerId !== "string" || brokerId.length === 0 || brokerId.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(brokerId) ||
    typeof accountId !== "string" || accountId.length === 0 || accountId.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(accountId) ||
    (accountType !== "S" && accountType !== "F")
  ) {
    return null;
  }
  return { broker_id: brokerId, account_id: accountId, account_type: accountType };
}

function accountKey(account) {
  const tuple = accountTuple(account);
  return tuple
    ? JSON.stringify([tuple.broker_id, tuple.account_id, tuple.account_type])
    : "";
}

function sameAccount(left, right) {
  const leftKey = accountKey(left);
  return leftKey.length > 0 && leftKey === accountKey(right);
}

function isBoundedProtocolText(value, maxLength = 128) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function canonicalStockEventAccount(payload) {
  if (!payload || typeof payload !== "object") return { kind: "ignored" };
  const data = payload.data;
  if (payload.state !== "StockOrder") return { kind: "ignored" };
  if (!data || typeof data !== "object" || !data.StockOrder || typeof data.StockOrder !== "object") {
    return { kind: "invalid" };
  }
  if (payload.state === "StockOrder") {
    const body = data.StockOrder;
    const orderId = body.order?.id;
    const statusId = body.status?.id;
    const exchangeTimestamp = body.status?.exchange_ts;
    const structurallyValid =
      isBoundedProtocolText(orderId, 128) &&
      isBoundedProtocolText(body.contract?.code, 64) &&
      isBoundedProtocolText(statusId, 128) &&
      statusId === orderId &&
      typeof exchangeTimestamp === "number" &&
      Number.isFinite(exchangeTimestamp) &&
      exchangeTimestamp > 0;
    if (!structurallyValid) return { kind: "invalid" };
    return {
      kind: "stock",
      account: accountTuple(body.order?.account),
      tradeId: orderId,
    };
  }
  return { kind: "ignored" };
}

export function accountEvidenceFromEventPayload(payload, knownAccounts) {
  const canonical = canonicalStockEventAccount(payload);
  if (canonical.kind === "invalid") {
    return {
      observed: true,
      matchedCount: 0,
      accountAbsent: false,
      mismatch: false,
      schemaInvalid: true,
    };
  }
  if (canonical.kind !== "stock") {
    return {
      observed: false,
      matchedCount: 0,
      accountAbsent: false,
      mismatch: false,
      schemaInvalid: false,
    };
  }
  if (!canonical.account) {
    return {
      observed: true,
      matchedCount: 0,
      accountAbsent: true,
      mismatch: false,
      schemaInvalid: false,
    };
  }
  const matched = knownAccounts.some((account) => sameAccount(account, canonical.account));
  return {
    observed: true,
    matchedCount: matched ? 1 : 0,
    eventIdentitySha256: matched
      ? task03TradeIdentitySha256(canonical.account, canonical.tradeId)
      : null,
    accountAbsent: false,
    mismatch: !matched,
    schemaInvalid: false,
  };
}

export function task03CorrelatedEventEvidence(eventEvidence, proof) {
  if (
    !eventEvidence ||
    typeof eventEvidence !== "object" ||
    !proof ||
    typeof proof !== "object" ||
    !/^sha256:[0-9a-f]{64}$/.test(proof.tradeIdentitySha256 || "") ||
    !Array.isArray(eventEvidence.eventIdentitySha256s)
  ) {
    return false;
  }
  const identities = new Set(eventEvidence.eventIdentitySha256s);
  return identities.size > 0 && identities.has(proof.tradeIdentitySha256);
}

export function bindTask03ObserverLiveness(observer, task03Coordination) {
  if (
    !observer ||
    typeof observer !== "object" ||
    typeof observer.result?.then !== "function" ||
    !isIssuedTask03ObservationCoordination(task03Coordination)
  ) {
    throw new TypeError("Task 0.3 observer liveness binding is invalid");
  }
  return Promise.resolve(observer.result)
    .finally(() => task03Coordination.expireReadinessLiveness())
    .catch(() => {});
}

function safeReason(error, fallback = "blocked_readonly_request_failed") {
  if (error instanceof ProbeError && REASON_CODES.has(error.code)) return error.code;
  return REASON_CODES.has(fallback) ? fallback : "blocked_readonly_request_failed";
}

function addCheck(report, id, status, reason, accountRef) {
  const check = { id, status };
  if (reason) check.reason = safeReason(new ProbeError(reason));
  if (accountRef) check.accountRef = accountRef;
  report.checks.push(check);
}

function emptyMetrics() {
  return {
    requestCount: 0,
    accountingReads: 0,
    observationControlMutations: 0,
    observationStreams: 0,
    subscriptionRequests: 0,
    subscriptionsCreatedOrConfirmed: 0,
    brokerWritesAttempted: 0,
    brokerWritesNetworked: 0,
  };
}

function emptyReport(now, executionMode, runId = randomUUID()) {
  return {
    schema: SMART_ORDER_READONLY_PROBE_SCHEMA,
    version: SMART_ORDER_READONLY_PROBE_VERSION,
    codeRevision: `sha256:${PROBE_SOURCE_SHA256}`,
    generatedAt: new Date(now).toISOString(),
    runId,
    executionMode,
    evidenceClass: executionMode === "fixture" ? "test_fixture" : "live_readonly",
    operationClass: executionMode === "fixture"
      ? "fixture-parser-and-transport-harness"
      : "managed-simulation-readonly-session-contract",
    evidenceEligible: false,
    eligibleForTask0_3: false,
    eligibleForGateManifest: false,
    requiredLiveChecksComplete: false,
    accountIdentifiersPersisted: false,
    selectedAccountRef: null,
    signedStockAccountCount: 0,
    network: emptyMetrics(),
    sideEffects: {
      tradingWrites: 0,
      automaticRetries: 0,
      blindCleanupAttempts: 0,
    },
    managedRuntime: {
      bound: false,
      generationEvidenceClass: executionMode === "fixture"
        ? "test_fixture"
        : "unverified",
      sharedModeLeaseHeld: false,
    },
    mode: { marker: "unknown", apiSimulation: false, servicePidStable: false },
    fingerprint: {
      probeSourceSha256: PROBE_SOURCE_SHA256,
      appBuildSha256: "",
      adapterSha256: "",
      expectedShioajiVersion: "",
      versionMatched: false,
      apiFingerprintStable: false,
    },
    checks: [],
    redactionScan: "pending",
    testOutcome: "blocked",
    resultHash: "",
    overall: executionMode === "fixture" ? "test_only" : "blocked",
  };
}

function transportSnapshot(transport) {
  return transport?.snapshot?.() || emptyMetrics();
}

function objectContainsSensitiveString(value, sensitiveValues, seen = new Set()) {
  if (typeof value === "string") {
    return sensitiveValues.some((sensitive) => value.includes(sensitive));
  }
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) => objectContainsSensitiveString(entry, sensitiveValues, seen));
  }
  return Object.values(value).some((entry) =>
    objectContainsSensitiveString(entry, sensitiveValues, seen));
}

function finishReport(report, transport, sensitiveValues = []) {
  report.network = transportSnapshot(transport);
  report.sideEffects.tradingWrites = report.network.brokerWritesNetworked;
  report.testOutcome = report.checks.some((check) => check.status === "blocked")
    ? "blocked"
    : report.checks.some((check) => check.status === "inconclusive")
      ? "inconclusive"
      : "pass";
  if (report.executionMode === "fixture" && report.testOutcome === "pass") {
    report.testOutcome = "inconclusive";
  }

  report.redactionScan = "pass";
  const requiredCheckStatus = new Map();
  const requiredCheckCount = new Map();
  for (const check of report.checks) {
    requiredCheckStatus.set(check.id, check.status);
    requiredCheckCount.set(check.id, (requiredCheckCount.get(check.id) || 0) + 1);
  }
  report.requiredLiveChecksComplete = REQUIRED_LIVE_CHECK_IDS.every(
    (id) => requiredCheckCount.get(id) === 1 && requiredCheckStatus.get(id) === "pass",
  );
  const immutableFingerprintComplete =
    /^[a-f0-9]{64}$/.test(report.fingerprint.probeSourceSha256) &&
    /^[a-f0-9]{64}$/.test(report.fingerprint.appBuildSha256) &&
    /^[a-f0-9]{64}$/.test(report.fingerprint.adapterSha256);
  const liveEligible =
    report.executionMode === "live-readonly" &&
    report.testOutcome === "pass" &&
    report.requiredLiveChecksComplete === true &&
    report.network.brokerWritesAttempted === 0 &&
    report.network.brokerWritesNetworked === 0 &&
    report.sideEffects.tradingWrites === 0 &&
    report.sideEffects.automaticRetries === 0 &&
    report.sideEffects.blindCleanupAttempts === 0 &&
    report.accountIdentifiersPersisted === false &&
    report.redactionScan === "pass" &&
    report.managedRuntime.bound === true &&
    [
      "pre_listener_private_marker",
      "read_only_attested_process_epoch",
    ].includes(report.managedRuntime.generationEvidenceClass) &&
    report.managedRuntime.sharedModeLeaseHeld === true &&
    report.mode.marker === "simulation" &&
    report.mode.apiSimulation === true &&
    report.mode.servicePidStable === true &&
    immutableFingerprintComplete &&
    report.fingerprint.versionMatched === true &&
    report.fingerprint.apiFingerprintStable === true;
  report.evidenceEligible = liveEligible;
  report.eligibleForTask0_3 = liveEligible;
  report.eligibleForGateManifest = liveEligible;
  report.overall = report.executionMode === "fixture"
    ? "test_only"
    : liveEligible
      ? "pass"
      : report.testOutcome === "inconclusive"
        ? "inconclusive"
        : "blocked";

  const normalizedSensitiveValues = sensitiveValues.filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  const leaked = objectContainsSensitiveString(report, normalizedSensitiveValues);
  if (leaked) {
    const blocked = emptyReport(
      new Date(report.generatedAt).getTime(),
      report.executionMode,
      report.runId,
    );
    blocked.network = report.network;
    blocked.sideEffects.tradingWrites = report.network.brokerWritesNetworked;
    blocked.checks = [{
      id: "redaction-scan",
      status: "blocked",
      reason: "blocked_response_schema_invalid",
    }];
    blocked.redactionScan = "blocked";
    blocked.testOutcome = "blocked";
    blocked.overall = report.executionMode === "fixture" ? "test_only" : "blocked";
    blocked.resultHash = createHash("sha256")
      .update(canonicalJson({ ...blocked, resultHash: "" }))
      .digest("hex");
    return blocked;
  }
  report.resultHash = createHash("sha256")
    .update(canonicalJson({ ...report, resultHash: "" }))
    .digest("hex");
  return report;
}

function assertResponseIdentity(response, requestUrl) {
  if (
    response?.redirected !== false ||
    typeof response?.url !== "string" ||
    response.url !== requestUrl
  ) {
    throw new ProbeError("blocked_redirect");
  }
}

function assertJsonContentType(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new ProbeError("blocked_content_type_invalid");
  }
}

function assertNoApiErrorEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (
    value.ok === false ||
    value.success === false ||
    (typeof value.error === "string" && value.error.length > 0) ||
    value.status === "Failed" ||
    value.status === "error"
  ) {
    throw new ProbeError("blocked_api_error_envelope");
  }
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new ProbeError("blocked_response_too_large");
  }
  const chunks = [];
  let totalBytes = 0;
  let reader;
  try {
    if (response.body?.getReader) {
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          throw new ProbeError("blocked_response_too_large");
        }
        chunks.push(chunk);
      }
    } else {
      const chunk = new Uint8Array(await response.arrayBuffer());
      totalBytes = chunk.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        throw new ProbeError("blocked_response_too_large");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    throw new ProbeError("blocked_response_schema_invalid");
  } finally {
    if (reader) await reader.cancel().catch(() => {});
  }
  if (totalBytes === 0) return null;
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ProbeError("blocked_response_schema_invalid");
  }
}

function createInstrumentedTransport({
  baseUrl = MANAGED_BASE_URL,
  fetchImpl,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  allowNativeFetch = false,
  withResourceOperation,
} = {}) {
  if (
    typeof fetchImpl !== "function" ||
    (allowNativeFetch ? fetchImpl !== globalThis.fetch : fetchImpl === globalThis.fetch)
  ) {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  const fixedBase = assertExactLoopbackBase(baseUrl);
  const metrics = emptyMetrics();

  function classify(method, endpoint) {
    if (typeof method !== "string" || typeof endpoint !== "string") {
      throw new ProbeError("blocked_readonly_endpoint_unavailable");
    }
    if (BROKER_WRITE_PATHS.has(endpoint)) {
      metrics.brokerWritesAttempted += 1;
      throw new ProbeError("blocked_readonly_endpoint_unavailable");
    }
    const category = REQUEST_POLICY.get(`${method} ${endpoint}`);
    if (!category) throw new ProbeError("blocked_readonly_endpoint_unavailable");
    return category;
  }

  function countRequest(category, endpoint) {
    metrics.requestCount += 1;
    if (category === "accounting_read") metrics.accountingReads += 1;
    if (category === "observation_control") metrics.observationControlMutations += 1;
    if (category === "observation_stream") metrics.observationStreams += 1;
    if (endpoint === ENDPOINTS.subscribeTrade) metrics.subscriptionRequests += 1;
  }

  async function fetchBounded(endpoint, method, body, externalSignal) {
    const category = classify(method, endpoint);
    const requestUrl = `${fixedBase}${endpoint}`;
    countRequest(category, endpoint);
    const controller = externalSignal ? null : new AbortController();
    const signal = externalSignal || controller.signal;
    const boundedTimeout = Math.max(10, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, requestTimeoutMs));
    try {
      const execute = async () => {
        const timer = controller
          ? setTimeout(() => controller.abort(), boundedTimeout)
          : null;
        try {
          return await fetchImpl(requestUrl, {
            method,
            headers: body === undefined
              ? { accept: "application/json" }
              : { accept: "application/json", "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: "no-store",
            redirect: "error",
            signal,
          });
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      const response = withResourceOperation
        ? await withResourceOperation(category, endpoint, execute)
        : await execute();
      assertResponseIdentity(response, requestUrl);
      return response;
    } catch (error) {
      if (error instanceof ProbeError) throw error;
      throw new ProbeError("blocked_readonly_request_failed");
    }
  }

  return {
    async requestJson(endpoint, method = "GET", body, options = {}) {
      const category = classify(method, endpoint);
      const requestUrl = `${fixedBase}${endpoint}`;
      countRequest(category, endpoint);
      const controller = new AbortController();
      const boundedTimeout = Math.max(10, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, requestTimeoutMs));
      try {
        const execute = async () => {
          const timer = setTimeout(() => controller.abort(), boundedTimeout);
          try {
            const response = await fetchImpl(requestUrl, {
              method,
              headers: body === undefined
                ? { accept: "application/json" }
                : { accept: "application/json", "content-type": "application/json" },
              body: body === undefined ? undefined : JSON.stringify(body),
              cache: "no-store",
              redirect: "error",
              signal: controller.signal,
            });
            assertResponseIdentity(response, requestUrl);
            if (!response.ok) {
              throw new ProbeError(
                response.status === 404
                  ? "blocked_readonly_endpoint_unavailable"
                  : "blocked_readonly_request_failed",
              );
            }
            if (response.status === 204 && options.allowEmptyResponse === true) {
              return null;
            }
            assertJsonContentType(response);
            const value = await readBoundedJson(response);
            assertNoApiErrorEnvelope(value);
            return value;
          } finally {
            clearTimeout(timer);
          }
        };
        return withResourceOperation
          ? await withResourceOperation(category, endpoint, execute)
          : await execute();
      } catch (error) {
        if (error instanceof ProbeError) throw error;
        throw new ProbeError("blocked_readonly_request_failed");
      }
    },
    async openSse(signal) {
      const response = await fetchBounded(ENDPOINTS.stream, "GET", undefined, signal);
      if (!response.ok || !response.body?.getReader) {
        throw new ProbeError("blocked_readonly_request_failed");
      }
      const contentType = response.headers?.get?.("content-type") || "";
      if (!/^text\/event-stream(?:\s*;|$)/i.test(contentType)) {
        throw new ProbeError("blocked_content_type_invalid");
      }
      return response;
    },
    markSubscriptionConfirmed() {
      metrics.subscriptionsCreatedOrConfirmed += 1;
    },
    snapshot() {
      return { ...metrics };
    },
  };
}

function validateInfo(value, expectedVersion) {
  if (!value || typeof value !== "object" || value.simulation !== true) {
    throw new ProbeError("blocked_non_simulation");
  }
  const normalizedVersion = typeof value.version === "string" && value.version.startsWith("v")
    ? value.version
    : `v${value.version}`;
  if (typeof value.version !== "string" || normalizedVersion !== expectedVersion) {
    throw new ProbeError("blocked_server_version_mismatch");
  }
  if (
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(value.name) ||
    !Array.isArray(value.protocols) ||
    value.protocols.length > 32 ||
    value.protocols.some((protocol) =>
      typeof protocol !== "string" ||
      protocol.length < 1 ||
      protocol.length > 64 ||
      /[\u0000-\u001f\u007f]/.test(protocol))
  ) {
    throw new ProbeError("blocked_response_schema_invalid");
  }
  const canonical = {
    name: value.name,
    version: normalizedVersion,
    protocols: [...value.protocols],
    simulation: true,
  };
  return {
    versionMatched: true,
    capabilityHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}

function validateAccountRefreshCapability(value) {
  const legacyUpdateStatusPath = "/api/v1/order/update_status";
  const tradesOperation = value?.paths?.[ENDPOINTS.trades]?.post;
  const orderEventOperation = value?.paths?.[ENDPOINTS.stream]?.get;
  const accountSchema =
    value?.components?.schemas?.["shioaji.server.http.types.AccountRequest"];
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.openapi !== "string" ||
    value.paths?.[legacyUpdateStatusPath] !== undefined ||
    tradesOperation?.operationId !== "get_trades" ||
    tradesOperation?.summary !==
      "Get all trades (update status first, then list from cache)" ||
    tradesOperation?.requestBody?.content?.["application/json"]?.schema?.$ref !==
      "#/components/schemas/shioaji.server.http.types.AccountRequest" ||
    orderEventOperation?.operationId !== "order_event_stream" ||
    orderEventOperation?.summary !== "Order event data stream endpoint (SSE)" ||
    accountSchema?.type !== "object" ||
    !["broker_id", "account_id", "account_type"].every(
      (key) => accountSchema.properties?.[key]?.type === "string",
    )
  ) {
    throw new ProbeError("blocked_response_schema_invalid");
  }
  const projection = Object.freeze({
    accountRequestRef:
      tradesOperation.requestBody.content["application/json"].schema.$ref,
    accountTupleFields: Object.freeze([
      "account_id",
      "account_type",
      "broker_id",
    ]),
    operationId: tradesOperation.operationId,
    orderEventOperationId: orderEventOperation.operationId,
    orderEventSummary: orderEventOperation.summary,
    openapi: value.openapi,
    summary: tradesOperation.summary,
    updateStatusPathAbsent: true,
  });
  return createHash("sha256").update(canonicalJson(projection)).digest("hex");
}

function selectFixedStockAccount(rawAccounts) {
  if (!Array.isArray(rawAccounts)) throw new ProbeError("blocked_response_schema_invalid");
  if (rawAccounts.length > MAX_ACCOUNT_ROWS) {
    throw new ProbeError("blocked_response_schema_invalid");
  }
  const canonicalRows = rawAccounts.map((account) => {
    if (!account || typeof account !== "object" || typeof account.signed !== "boolean") {
      throw new ProbeError("blocked_response_schema_invalid");
    }
    const tuple = accountTuple(account);
    if (!tuple) throw new ProbeError("blocked_account_missing");
    return { ...tuple, signed: account.signed };
  });
  const signedStockAccounts = rawAccounts
    .filter((account) => account?.signed === true && account?.account_type === "S")
    .map(accountTuple);
  if (signedStockAccounts.length === 0) {
    throw new ProbeError("blocked_account_missing");
  }
  const keys = canonicalRows.filter((account) => account.signed).map(accountKey);
  if (new Set(keys).size !== keys.length) throw new ProbeError("blocked_account_ambiguous");
  const sorted = [...signedStockAccounts].sort((left, right) =>
    accountKey(left).localeCompare(accountKey(right)));
  return { account: sorted[0], signedStockAccountCount: sorted.length };
}

function validateSubscribeResponse(value, account) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.subscribe_trade !== true ||
    !sameAccount(value.account, account) ||
    (value.ts !== undefined && !isBoundedProtocolText(String(value.ts), 64))
  ) {
    throw new ProbeError("blocked_response_schema_invalid");
  }
  return "";
}

function validateTradeAccountEvidence(trades, account) {
  if (!Array.isArray(trades)) throw new ProbeError("blocked_response_schema_invalid");
  if (trades.length === 0) return "";
  let missing = false;
  const allowedStatuses = new Set([
    "PendingSubmit",
    "PreSubmitted",
    "Submitted",
    "PartFilled",
    "Filled",
    "Cancelled",
    "Inactive",
    "Failed",
  ]);
  for (const trade of trades) {
    if (
      !trade || typeof trade !== "object" ||
      typeof trade.contract?.code !== "string" || trade.contract.code.length === 0 ||
      typeof trade.order?.id !== "string" || trade.order.id.length === 0 ||
      !allowedStatuses.has(trade.status?.status)
    ) {
      throw new ProbeError("blocked_response_schema_invalid");
    }
    const canonical = accountTuple(trade?.order?.account);
    if (!canonical) {
      missing = true;
      continue;
    }
    if (!sameAccount(canonical, account)) throw new ProbeError("blocked_account_mismatch");
  }
  return missing ? "inconclusive_account_scope" : "";
}

function validatePositionResponse(positions) {
  if (!Array.isArray(positions)) throw new ProbeError("blocked_response_schema_invalid");
  for (const position of positions) {
    if (
      !position || typeof position !== "object" ||
      !Number.isInteger(position.id) ||
      typeof position.code !== "string" ||
      position.code.length === 0 ||
      (position.direction !== "Buy" && position.direction !== "Sell") ||
      !Number.isInteger(position.quantity) || position.quantity < 0 ||
      !Number.isFinite(position.price) ||
      !Number.isFinite(position.last_price) ||
      !Number.isFinite(position.pnl) ||
      !Number.isInteger(position.yd_quantity) || position.yd_quantity < 0
    ) {
      throw new ProbeError("blocked_response_schema_invalid");
    }
  }
  return "";
}

function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.join("\n") };
}

async function createTradeAccountObserver({
  transport,
  account,
  timeoutMs = DEFAULT_EVENT_TIMEOUT_MS,
  acceptEventsImmediately = false,
  task03Correlated = false,
  observationAbortSignal,
}) {
  if (
    task03Correlated &&
    (!observationAbortSignal ||
      typeof observationAbortSignal.addEventListener !== "function" ||
      typeof observationAbortSignal.removeEventListener !== "function")
  ) {
    throw new TypeError("Task 0.3 observer abort signal is invalid");
  }
  const boundedTimeout = Math.max(
    50,
    Math.min(
      task03Correlated ? TASK_0_3_EVENT_TIMEOUT_MS : MAX_EVENT_TIMEOUT_MS,
      timeoutMs,
    ),
  );
  const deadlineEpochMs = Date.now() + boundedTimeout;
  const controller = new AbortController();
  const abortFromCoordination = () => controller.abort();
  observationAbortSignal?.addEventListener("abort", abortFromCoordination, {
    once: true,
  });
  if (observationAbortSignal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), boundedTimeout);
  const barrierOpen = acceptEventsImmediately === true;
  let reader;
  let stopped = false;
  const aggregate = {
    observedCount: 0,
    matchedCount: 0,
    accountAbsent: false,
    mismatch: false,
    schemaInvalid: false,
    ignoredBeforeSubscription: 0,
    eventIdentitySha256s: [],
  };
  let response;
  try {
    response = await transport.openSse(controller.signal);
  } catch (error) {
    clearTimeout(timer);
    observationAbortSignal?.removeEventListener(
      "abort",
      abortFromCoordination,
    );
    controller.abort();
    throw error;
  }
  reader = response.body.getReader();

  const result = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    let totalBytes = 0;
    let eventCount = 0;
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > MAX_SSE_TOTAL_BYTES) {
          throw new ProbeError("blocked_response_too_large");
        }
        buffer += decoder.decode(chunk, { stream: true });
        let boundary;
        while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const block = buffer.slice(0, boundary);
          const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || "\n\n";
          buffer = buffer.slice(boundary + separator.length);
          if (new TextEncoder().encode(block).byteLength > MAX_SSE_EVENT_BYTES) {
            throw new ProbeError("blocked_response_too_large");
          }
          eventCount += 1;
          if (eventCount > MAX_SSE_EVENTS) {
            throw new ProbeError("blocked_response_too_large");
          }
          if (!barrierOpen) {
            aggregate.ignoredBeforeSubscription += 1;
            continue;
          }
          const parsed = parseSseBlock(block);
          if (parsed.event !== "order_event" || !parsed.data) continue;
          let payload;
          try {
            payload = JSON.parse(parsed.data);
          } catch {
            aggregate.observedCount += 1;
            aggregate.schemaInvalid = true;
            return aggregate;
          }
          const evidence = accountEvidenceFromEventPayload(payload, [account]);
          if (!evidence.observed) continue;
          aggregate.observedCount += 1;
          aggregate.matchedCount += evidence.matchedCount;
          if (evidence.eventIdentitySha256) {
            aggregate.eventIdentitySha256s.push(evidence.eventIdentitySha256);
          }
          aggregate.accountAbsent ||= evidence.accountAbsent;
          aggregate.mismatch ||= evidence.mismatch;
          aggregate.schemaInvalid ||= evidence.schemaInvalid;
          if (
            (!task03Correlated && aggregate.matchedCount > 0) ||
            aggregate.accountAbsent ||
            aggregate.mismatch ||
            aggregate.schemaInvalid
          ) {
            return aggregate;
          }
        }
        if (new TextEncoder().encode(buffer).byteLength > MAX_SSE_EVENT_BYTES) {
          throw new ProbeError("blocked_response_too_large");
        }
      }
    } catch (error) {
      if (error instanceof ProbeError) throw error;
      if (error?.name !== "AbortError") {
        throw new ProbeError("blocked_readonly_request_failed");
      }
    }
    return aggregate;
  })().finally(() => {
    clearTimeout(timer);
    observationAbortSignal?.removeEventListener(
      "abort",
      abortFromCoordination,
    );
  });
  // Attach a rejection handler immediately. The original promise is still
  // awaited by the caller, but cannot become an unhandled rejection while the
  // probe performs its bounded HTTP checks or closes the pre-subscription stream.
  result.catch(() => {});

  return {
    ready: true,
    deadlineEpochMs,
    // An observer's acceptance phase is immutable. Callers must close the
    // pre-subscription stream and open a new post-subscription stream.
    markSubscriptionResponse() {},
    result,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      if (reader) await reader.cancel().catch(() => {});
      return result;
    },
  };
}

async function runProbeHarness(config = {}, dependencies = {}) {
  const executionMode = dependencies.executionMode === "live-readonly"
    ? "live-readonly"
    : "fixture";
  const now = dependencies.now?.() ?? Date.now();
  const report = emptyReport(now, executionMode, dependencies.runId || randomUUID());
  report.managedRuntime.sharedModeLeaseHeld =
    executionMode === "live-readonly" && dependencies.sharedModeLeaseHeld === true;
  if (executionMode === "live-readonly") {
    report.managedRuntime.generationEvidenceClass =
      dependencies.generationEvidenceClass || "unverified";
  }
  const sensitiveValues = [];
  const expectedVersion = dependencies.expectedVersion || await readExpectedShioajiVersion();
  report.fingerprint.expectedShioajiVersion = expectedVersion;
  const dependenciesComplete =
    typeof dependencies.fetchImpl === "function" &&
    typeof dependencies.readMode === "function" &&
    typeof dependencies.readGeneration === "function" &&
    (executionMode === "fixture"
      ? typeof dependencies.createObserver === "function"
      : typeof dependencies.readFingerprints === "function" &&
        typeof dependencies.withResourceOperation === "function" &&
        typeof dependencies.processAttestor?.attest === "function" &&
        typeof dependencies.isManagedAttestation === "function");
  let transport = { snapshot: emptyMetrics };
  let observer;
  const task03Coordination =
    executionMode === "live-readonly" &&
    isIssuedTask03ObservationCoordination(dependencies.task03Coordination)
      ? dependencies.task03Coordination
      : null;
  try {
    if (
      !dependenciesComplete ||
      (executionMode === "fixture"
        ? dependencies.fetchImpl === globalThis.fetch
        : dependencies.fetchImpl !== globalThis.fetch)
    ) {
      throw new ProbeError("blocked_managed_runtime_unverified");
    }
    transport = createInstrumentedTransport({
      baseUrl: config.baseUrl || MANAGED_BASE_URL,
      fetchImpl: dependencies.fetchImpl,
      requestTimeoutMs: dependencies.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
      allowNativeFetch: executionMode === "live-readonly",
      withResourceOperation: dependencies.withResourceOperation,
    });
    const readMode = dependencies.readMode;
    const readGeneration = dependencies.readGeneration;

    await readMode();
    report.mode.marker = "simulation";
    addCheck(report, "mode-marker-before", "pass");
    const generationBefore = await readGeneration();
    addCheck(report, "runtime-generation-evidence-before", "pass");
    let processBefore;
    let fingerprintsBefore;
    if (executionMode === "live-readonly") {
      processBefore = await dependencies.processAttestor.attest();
      if (!dependencies.isManagedAttestation(processBefore)) {
        throw new ProbeError("blocked_managed_runtime_unverified");
      }
      fingerprintsBefore = await dependencies.readFingerprints();
      if (
        !/^[a-f0-9]{64}$/.test(fingerprintsBefore?.appBuildSha256 || "") ||
        !/^[a-f0-9]{64}$/.test(fingerprintsBefore?.adapterSha256 || "")
      ) {
        throw new ProbeError("blocked_managed_runtime_unverified");
      }
      report.managedRuntime.bound = true;
      report.fingerprint.appBuildSha256 = fingerprintsBefore.appBuildSha256;
      report.fingerprint.adapterSha256 = fingerprintsBefore.adapterSha256;
      addCheck(report, "service-pid-before", "pass");
      addCheck(report, "managed-runtime-binding-before", "pass");
    } else {
      addCheck(report, "service-pid-before", "pass");
    }

    const firstInfo = await transport.requestJson(ENDPOINTS.info);
    const firstInfoFingerprint = validateInfo(firstInfo, expectedVersion);
    report.mode.apiSimulation = true;
    report.fingerprint.versionMatched = true;
    addCheck(report, "api-simulation-before", "pass");

    const rawAccounts = await transport.requestJson(ENDPOINTS.accounts);
    if (Array.isArray(rawAccounts)) {
      for (const rawAccount of rawAccounts) {
        for (const key of ["broker_id", "account_id", "person_id", "username"]) {
          if (typeof rawAccount?.[key] === "string") sensitiveValues.push(rawAccount[key]);
        }
      }
    }
    const selection = selectFixedStockAccount(rawAccounts);
    const account = selection.account;
    if (
      task03Coordination &&
      task03Coordination.accountScopeSha256 !==
        smartOrderGateProbeAccountScopeSha256(account)
    ) {
      throw new ProbeError("blocked_account_mismatch");
    }
    report.signedStockAccountCount = selection.signedStockAccountCount;
    report.selectedAccountRef = "stock-account-1";
    addCheck(report, "fixed-stock-account-selection", "pass", "", report.selectedAccountRef);
    const accountRefreshCapabilityBefore = validateAccountRefreshCapability(
      await transport.requestJson(ENDPOINTS.openApi),
    );
    addCheck(report, "update-status-via-trades-capability", "pass");

    const createObserver = dependencies.createObserver || (async (fixedAccount, context) =>
      createTradeAccountObserver({
        transport,
        account: fixedAccount,
        timeoutMs: task03Coordination
          ? TASK_0_3_EVENT_TIMEOUT_MS
          : dependencies.eventTimeoutMs || DEFAULT_EVENT_TIMEOUT_MS,
        acceptEventsImmediately: context.acceptEventsImmediately === true,
        task03Correlated: task03Coordination !== null,
        observationAbortSignal:
          task03Coordination?.observationAbortSignal,
      }));
    observer = await createObserver(account, { phase: "pre_subscription" });
    if (!observer?.ready || typeof observer.markSubscriptionResponse !== "function") {
      throw new ProbeError("blocked_readonly_request_failed");
    }
    addCheck(report, "trade-event-stream-ready", "pass", "", report.selectedAccountRef);

    const subscribeResult = await transport.requestJson(
      ENDPOINTS.subscribeTrade,
      "POST",
      account,
      { allowEmptyResponse: true },
    );
    addCheck(
      report,
      "subscribe-request-account-bound",
      "pass",
      "",
      report.selectedAccountRef,
    );
    const subscriptionReason = validateSubscribeResponse(subscribeResult, account);
    if (!subscriptionReason) transport.markSubscriptionConfirmed();
    addCheck(
      report,
      "trade-subscription-contract",
      subscriptionReason ? "inconclusive" : "pass",
      subscriptionReason,
      report.selectedAccountRef,
    );
    await observer.stop();
    observer = null;
    observer = await createObserver(account, {
      phase: "post_subscription",
      acceptEventsImmediately: true,
    });
    if (!observer?.ready || typeof observer.markSubscriptionResponse !== "function") {
      throw new ProbeError("blocked_readonly_request_failed");
    }
    observer.markSubscriptionResponse();
    if (task03Coordination) {
      await task03Coordination.signalReady({
        observerDeadlineEpochMs: observer.deadlineEpochMs,
      });
      bindTask03ObserverLiveness(observer, task03Coordination);
    }
    addCheck(
      report,
      "trade-event-stream-reopened-after-subscription",
      "pass",
      "",
      report.selectedAccountRef,
    );

    const trades = await transport.requestJson(ENDPOINTS.trades, "POST", account);
    addCheck(
      report,
      "update-status-via-trades-account-bound",
      "pass",
      "",
      report.selectedAccountRef,
    );
    addCheck(
      report,
      "trades-request-account-bound",
      "pass",
      "",
      report.selectedAccountRef,
    );
    const tradeReason = validateTradeAccountEvidence(trades, account);
    addCheck(
      report,
      "update-status-via-trades-account-scope",
      tradeReason ? "inconclusive" : "pass",
      tradeReason,
      report.selectedAccountRef,
    );
    addCheck(
      report,
      "trades-account-scope",
      tradeReason ? "inconclusive" : "pass",
      tradeReason,
      report.selectedAccountRef,
    );

    const positions = await transport.requestJson(ENDPOINTS.positions, "POST", {
      ...account,
      unit: "Share",
    });
    addCheck(
      report,
      "positions-request-account-bound",
      "pass",
      "",
      report.selectedAccountRef,
    );
    const positionReason = validatePositionResponse(positions);
    addCheck(
      report,
      "positions-response-shape",
      "pass",
      "",
      report.selectedAccountRef,
    );
    addCheck(
      report,
      "positions-account-scope",
      positionReason ? "inconclusive" : "pass",
      positionReason,
      report.selectedAccountRef,
    );

    try {
      const eventEvidence = await observer.result;
      if (eventEvidence?.schemaInvalid) {
        addCheck(
          report,
          "order-event-account",
          "blocked",
          "blocked_response_schema_invalid",
          report.selectedAccountRef,
        );
      } else if (eventEvidence?.mismatch) {
        addCheck(
          report,
          "order-event-account",
          "blocked",
          "blocked_event_account_mismatch",
          report.selectedAccountRef,
        );
      } else if (eventEvidence?.accountAbsent) {
        addCheck(
          report,
          "order-event-account",
          "blocked",
          "blocked_event_account_missing",
          report.selectedAccountRef,
        );
      } else if (task03Coordination) {
        const proof = await task03Coordination.readProof({ timeoutMs: 100 });
        if (
          proof &&
          task03CorrelatedEventEvidence(eventEvidence, proof)
        ) {
          addCheck(report, "order-event-account", "pass", "", report.selectedAccountRef);
        } else {
          addCheck(
            report,
            "order-event-account",
            "inconclusive",
            "inconclusive_event_unobserved",
            report.selectedAccountRef,
          );
        }
      } else if ((eventEvidence?.matchedCount || 0) > 0) {
        addCheck(report, "order-event-account", "pass", "", report.selectedAccountRef);
      } else {
        addCheck(
          report,
          "order-event-account",
          "inconclusive",
          "inconclusive_event_unobserved",
          report.selectedAccountRef,
        );
      }
    } finally {
      await observer.stop();
      observer = null;
      await task03Coordination?.closeReadiness();
    }

    const generationMid = await readGeneration();
    if (generationMid !== generationBefore) throw new ProbeError("blocked_generation_changed");
    const finalInfo = await transport.requestJson(ENDPOINTS.info);
    const finalInfoFingerprint = validateInfo(finalInfo, expectedVersion);
    const accountRefreshCapabilityAfter = validateAccountRefreshCapability(
      await transport.requestJson(ENDPOINTS.openApi),
    );
    if (
      firstInfoFingerprint.capabilityHash !== finalInfoFingerprint.capabilityHash ||
      accountRefreshCapabilityBefore !== accountRefreshCapabilityAfter
    ) {
      throw new ProbeError("blocked_generation_changed");
    }
    report.fingerprint.apiFingerprintStable = true;
    addCheck(report, "api-fingerprint-after", "pass");
    await readMode();
    addCheck(report, "mode-marker-after", "pass");
    const generationAfter = await readGeneration();
    if (generationAfter !== generationBefore) throw new ProbeError("blocked_generation_changed");
    if (executionMode === "live-readonly") {
      const processAfter = await dependencies.processAttestor.attest();
      if (
        !dependencies.isManagedAttestation(processAfter) ||
        processAfter.processId !== processBefore.processId ||
        processAfter.processStartIdentitySha256 !==
          processBefore.processStartIdentitySha256
      ) {
        throw new ProbeError("blocked_managed_runtime_unverified");
      }
      const fingerprintsAfter = await dependencies.readFingerprints();
      if (
        fingerprintsAfter?.appBuildSha256 !== fingerprintsBefore.appBuildSha256 ||
        fingerprintsAfter?.adapterSha256 !== fingerprintsBefore.adapterSha256
      ) {
        throw new ProbeError("blocked_managed_runtime_unverified");
      }
      report.mode.servicePidStable = true;
      addCheck(report, "service-pid-after", "pass");
      addCheck(report, "managed-runtime-binding-after", "pass");
    } else {
      report.mode.servicePidStable = true;
      addCheck(report, "service-pid-after", "pass");
    }
    addCheck(report, "runtime-generation-evidence-after", "pass");
  } catch (error) {
    addCheck(report, "probe-execution", "blocked", safeReason(error));
  } finally {
    if (observer) await observer.stop().catch(() => {});
    await task03Coordination?.closeReadiness().catch(() => {});
  }
  return finishReport(report, transport, sensitiveValues);
}

function responseWithUrl(value, requestUrl, status = 200) {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "url", { value: requestUrl });
  return response;
}

function responseWithIdentity(response, requestUrl, redirected = false) {
  Object.defineProperty(response, "url", { value: requestUrl });
  Object.defineProperty(response, "redirected", { value: redirected });
  return response;
}

function fixtureAccount(overrides = {}) {
  return {
    broker_id: "fixture-broker",
    account_id: "fixture-account",
    account_type: "S",
    signed: true,
    person_id: "fixture-person",
    username: "fixture-user",
    ...overrides,
  };
}

const OFFLINE_FIXTURE_KEYS = new Set([
  "account",
  "accounts",
  "eventEvidence",
  "fault",
  "finalInfo",
  "generations",
  "info",
  "mode",
  "omitInfoVersion",
  "openApiContractInvalid",
  "positions",
  "requestTimeoutMs",
  "subscribe204",
  "subscribeResponse",
  "trades",
]);

function parseOfflineScenario(serializedScenario, allowedKeys = OFFLINE_FIXTURE_KEYS) {
  if (
    typeof serializedScenario !== "string" ||
    serializedScenario.length === 0 ||
    serializedScenario.length > 1024 * 1024
  ) {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  let scenario;
  try {
    scenario = JSON.parse(serializedScenario);
  } catch {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  if (Object.keys(scenario).some((key) => !allowedKeys.has(key))) {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  return scenario;
}

function fixtureInfo(expectedVersion, overrides = {}, omitVersion = false) {
  const value = {
    simulation: true,
    name: "fixture-shioaji",
    version: expectedVersion,
    protocols: ["http", "sse"],
    ...overrides,
  };
  if (omitVersion) delete value.version;
  return value;
}

function fixtureOpenApi(invalid = false) {
  return {
    openapi: "3.1.0",
    paths: {
      [ENDPOINTS.stream]: {
        get: {
          operationId: "order_event_stream",
          summary: "Order event data stream endpoint (SSE)",
        },
      },
      [ENDPOINTS.trades]: {
        post: {
          operationId: "get_trades",
          summary: invalid
            ? "Get all trades"
            : "Get all trades (update status first, then list from cache)",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/shioaji.server.http.types.AccountRequest",
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        "shioaji.server.http.types.AccountRequest": {
          type: "object",
          properties: {
            account_id: { type: "string" },
            account_type: { type: "string" },
            broker_id: { type: "string" },
          },
        },
      },
    },
  };
}

function zeroEventEvidence() {
  return {
    observedCount: 0,
    matchedCount: 0,
    accountAbsent: false,
    mismatch: false,
    schemaInvalid: false,
  };
}

// This is the only configurable fixture entrypoint. It accepts JSON data, never
// executable callbacks, so a wrapper around global fetch cannot escape the
// in-memory response table or touch 127.0.0.1:8080.
export async function runOfflineFixtureScenario(serializedScenario = "{}") {
  const scenario = parseOfflineScenario(serializedScenario);
  const expectedVersion = await readExpectedShioajiVersion();
  const account = scenario.account || fixtureAccount();
  const accounts = scenario.accounts || [account];
  const trace = [];
  let infoCalls = 0;
  const fetchImpl = async (requestUrl, init = {}) => {
    const pathname = new URL(requestUrl).pathname;
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    trace.push({ pathname, method, body, redirect: init.redirect });

    if (trace.length === 1 && scenario.fault) {
      if (scenario.fault === "redirect307" || scenario.fault === "redirect308") {
        const status = scenario.fault === "redirect307" ? 307 : 308;
        return responseWithIdentity(new Response(null, {
          status,
          headers: { location: "https://example.invalid/collect" },
        }), requestUrl);
      }
      if (scenario.fault === "responseRedirected" || scenario.fault === "urlMismatch") {
        const response = new Response(JSON.stringify(fixtureInfo(expectedVersion)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
        return responseWithIdentity(
          response,
          scenario.fault === "urlMismatch"
            ? `${MANAGED_BASE_URL}/api/v1/order/place_order`
            : requestUrl,
          scenario.fault === "responseRedirected",
        );
      }
      if (scenario.fault === "wrongContentType") {
        return responseWithIdentity(new Response(JSON.stringify(fixtureInfo(expectedVersion)), {
          status: 200,
          headers: { "content-type": "text/plain" },
        }), requestUrl);
      }
      if (scenario.fault === "stallJson") {
        const stream = new ReadableStream({
          start(controller) {
            init.signal.addEventListener("abort", () => {
              controller.error(new DOMException("aborted", "AbortError"));
            }, { once: true });
          },
        });
        return responseWithIdentity(new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        }), requestUrl);
      }
      if (scenario.fault === "oversizedJson") {
        const payload = new TextEncoder().encode(`"${"oversized-secret".repeat(20_000)}"`);
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(payload.subarray(0, 200_000));
            controller.enqueue(payload.subarray(200_000));
            controller.close();
          },
        });
        return responseWithIdentity(new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        }), requestUrl);
      }
      throw new ProbeError("blocked_managed_runtime_unverified");
    }

    if (pathname === ENDPOINTS.info) {
      infoCalls += 1;
      const value = infoCalls > 1 && scenario.finalInfo
        ? scenario.finalInfo
        : fixtureInfo(expectedVersion, scenario.info, scenario.omitInfoVersion === true);
      return responseWithUrl(value, requestUrl);
    }
    if (pathname === ENDPOINTS.accounts) return responseWithUrl(accounts, requestUrl);
    if (pathname === ENDPOINTS.openApi) {
      return responseWithUrl(
        fixtureOpenApi(scenario.openApiContractInvalid === true),
        requestUrl,
      );
    }
    if (pathname === ENDPOINTS.subscribeTrade) {
      if (scenario.subscribe204 === true) {
        return responseWithIdentity(new Response(null, { status: 204 }), requestUrl);
      }
      return responseWithUrl(scenario.subscribeResponse ?? {
        account: accountTuple(account),
        subscribe_trade: true,
        ts: "20260813000000",
      }, requestUrl);
    }
    if (pathname === ENDPOINTS.trades) {
      return responseWithUrl(scenario.trades ?? [{
        contract: { code: "2330" },
        order: { id: "fixture-trade", account: accountTuple(account) },
        status: { status: "Submitted" },
      }], requestUrl);
    }
    if (pathname === ENDPOINTS.positions) {
      return responseWithUrl(scenario.positions ?? [{
        id: 1,
        code: "2330",
        direction: "Buy",
        quantity: 1000,
        price: 100,
        last_price: 101,
        pnl: 1000,
        yd_quantity: 1000,
      }], requestUrl);
    }
    return responseWithUrl({ message: "not found" }, requestUrl, 404);
  };

  let generationReads = 0;
  const generations = Array.isArray(scenario.generations) && scenario.generations.length > 0
    ? scenario.generations
    : ["fixture-generation"];
  const report = await runProbeHarness(
    { baseUrl: MANAGED_BASE_URL },
    {
      now: () => Date.UTC(2026, 7, 11, 0, 0, 0),
      runId: "00000000-0000-4000-8000-000000000001",
      expectedVersion,
      readMode: async () => {
        if (scenario.mode === "unknown") throw new ProbeError("blocked_mode_unknown");
        return "simulation";
      },
      readGeneration: () => {
        const generation = generations[Math.min(generationReads, generations.length - 1)];
        generationReads += 1;
        return generation;
      },
      fetchImpl,
      requestTimeoutMs: scenario.requestTimeoutMs,
      createObserver: async (_fixedAccount, context) => ({
        ready: true,
        markSubscriptionResponse() {},
        result: Promise.resolve(context.phase === "post_subscription"
          ? { ...zeroEventEvidence(), matchedCount: 1, observedCount: 1, ...scenario.eventEvidence }
          : zeroEventEvidence()),
        async stop() {},
      }),
    },
  );

  let selectedAccount = null;
  try {
    selectedAccount = selectFixedStockAccount(accounts).account;
  } catch {
    // The report already contains the fail-closed reason. Diagnostics stay redacted.
  }
  const redactedTrace = trace.map((entry) => ({
    endpoint: entry.pathname,
    method: entry.method,
    redirect: entry.redirect,
    accountRef: accountTuple(entry.body?.account || entry.body)
      ? sameAccount(entry.body?.account || entry.body, selectedAccount)
        ? "stock-account-1"
        : "other-account"
      : null,
    unit: entry.body?.unit === "Share" ? "Share" : entry.body?.unit ? "other" : null,
  }));
  return { report, trace: redactedTrace };
}

// Exported fixture reports are permanently test-only, and callers can provide
// data only through the JSON scenario schema above.
export async function runReadOnlyContractProbe(serializedScenario = "{}") {
  return (await runOfflineFixtureScenario(serializedScenario)).report;
}

const OFFLINE_TRANSPORT_SCENARIO_KEYS = new Set(["kind"]);

export async function runOfflineTransportScenario(serializedScenario) {
  const scenario = parseOfflineScenario(
    serializedScenario,
    OFFLINE_TRANSPORT_SCENARIO_KEYS,
  );
  let fetchCalls = 0;
  let endpointReads = 0;
  const transport = createInstrumentedTransport({
    fetchImpl: async (requestUrl) => {
      fetchCalls += 1;
      return responseWithUrl(fixtureInfo("v1.7.1"), requestUrl);
    },
  });
  let reason = "";
  try {
    if (scenario.kind === "brokerWrite") {
      await transport.requestJson(PLACE_ORDER_PATH_FOR_OFFLINE_TEST, "POST", { forbidden: true });
    } else if (scenario.kind === "mutableEndpoint") {
      await transport.requestJson({
        toString() {
          endpointReads += 1;
          return endpointReads === 1 ? ENDPOINTS.info : PLACE_ORDER_PATH_FOR_OFFLINE_TEST;
        },
      }, "GET");
    } else if (scenario.kind === "mutableMethod") {
      await transport.requestJson(ENDPOINTS.info, { toString: () => "GET" });
    } else {
      throw new ProbeError("blocked_managed_runtime_unverified");
    }
  } catch (error) {
    reason = safeReason(error);
  }
  return {
    reason,
    fetchCalls,
    endpointReads,
    metrics: transport.snapshot(),
  };
}

const OFFLINE_OBSERVER_SCENARIO_KEYS = new Set(["kind"]);

function fixtureStockOrderEvent(account, overrides = {}) {
  return {
    state: "StockOrder",
    data: {
      StockOrder: {
        operation: { op_type: "New", op_code: "00" },
        order: { id: "event-order", account: accountTuple(account) },
        contract: { code: "2330" },
        status: { id: "event-order", exchange_ts: 1_786_550_400.1 },
        ...overrides,
      },
    },
  };
}

function fixtureSseEvent(payload) {
  return new TextEncoder().encode(
    `event: order_event\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

export async function runOfflineObserverScenario(serializedScenario) {
  const scenario = parseOfflineScenario(
    serializedScenario,
    OFFLINE_OBSERVER_SCENARIO_KEYS,
  );
  const account = fixtureAccount();
  let cancelled = false;
  let stream;
  let acceptEventsImmediately = false;
  if (scenario.kind === "preQueued") {
    stream = new ReadableStream({
      start(controller) {
        controller.enqueue(fixtureSseEvent(fixtureStockOrderEvent(account)));
        controller.close();
      },
    });
  } else if (scenario.kind === "postCanonical") {
    acceptEventsImmediately = true;
    stream = new ReadableStream({
      start(controller) {
        controller.enqueue(fixtureSseEvent(fixtureStockOrderEvent(account)));
        controller.close();
      },
    });
  } else if (scenario.kind === "schemaInvalidThenValid") {
    acceptEventsImmediately = true;
    stream = new ReadableStream({
      start(controller) {
        controller.enqueue(fixtureSseEvent({ state: "StockOrder", data: {} }));
        controller.enqueue(fixtureSseEvent(fixtureStockOrderEvent(account)));
        controller.close();
      },
    });
  } else if (scenario.kind === "oversized" || scenario.kind === "preOversizedStopOnly") {
    const largeData = "x".repeat(70 * 1024);
    stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `event: order_event\ndata: ${largeData}\n\n`,
        ));
      },
      cancel() {
        cancelled = true;
      },
    });
  } else {
    throw new ProbeError("blocked_managed_runtime_unverified");
  }
  const transport = createInstrumentedTransport({
    fetchImpl: async (requestUrl) => responseWithIdentity(new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }), requestUrl),
  });
  const observer = await createTradeAccountObserver({
    transport,
    account,
    timeoutMs: 100,
    acceptEventsImmediately,
  });
  observer.markSubscriptionResponse();
  let evidence = null;
  let reason = "";
  if (scenario.kind === "preOversizedStopOnly") {
    try {
      await observer.stop();
    } catch (error) {
      reason = safeReason(error);
    }
    return { evidence, reason, cancelled, metrics: transport.snapshot() };
  }
  try {
    evidence = await observer.result;
  } catch (error) {
    reason = safeReason(error);
  } finally {
    try {
      await observer.stop();
    } catch (error) {
      if (!reason) reason = safeReason(error);
    }
  }
  return { evidence, reason, cancelled, metrics: transport.snapshot() };
}

export async function runFixtureProbe() {
  return runReadOnlyContractProbe("{}");
}

export async function runManagedLiveReadOnlyPreflight({
  resourceCoordinator,
  task03Coordination,
  eventTimeoutMs,
} = {}) {
  const fallbackReport = emptyReport(Date.now(), "live-readonly");
  const emptyTransport = { snapshot: emptyMetrics };
  let lease;
  try {
    if (
      eventTimeoutMs !== undefined &&
      eventTimeoutMs !== EXTERNAL_ORDER_EVENT_OBSERVATION_TIMEOUT_MS
    ) {
      throw new ProbeError("blocked_managed_runtime_unverified");
    }
    const appSupportRoot = await assertOwnerControlledCanonicalAppSupportRoot(
      managedSmartOrderReadonlyProbeAppSupportRoot(),
    );
    const authority = takeSmartOrderContractProbeRuntimeAuthority();
    if (
      !authority ||
      typeof authority !== "object" ||
      authority.fetchImpl !== globalThis.fetch ||
      typeof authority.acquireSharedLease !== "function" ||
      typeof authority.processAttestor?.attest !== "function" ||
      typeof authority.isManagedAttestation !== "function"
    ) {
      throw new ProbeError("blocked_managed_runtime_unverified");
    }
    if (!isIssuedSmartOrderResourceCoordinator(resourceCoordinator)) {
      throw new ProbeError("blocked_resource_coordinator_unavailable");
    }
    const generationReader = await createManagedReadonlyGenerationReader({
      generationPath: path.join(appSupportRoot, "runtime-api-generation"),
      processAttestor: authority.processAttestor,
      isManagedAttestation: authority.isManagedAttestation,
    });
    let resourceOperationSequence = 0;
    const withResourceOperation = async (category, endpoint, execute) => {
      resourceOperationSequence += 1;
      const operationId = `gate-probe:${randomUUID()}:${resourceOperationSequence}`;
      const kind = category === "accounting_read"
        ? "reconciliation"
        : endpoint === ENDPOINTS.info
          ? "status"
          : "reconciliation";
      const grant = await resourceCoordinator.acquireOperation({
        operationId,
        kind,
      });
      try {
        await resourceCoordinator.acquireOperationUnit({
          operationId: grant.operationId,
        });
        return await execute();
      } finally {
        const completed = resourceCoordinator.completeOperation({
          operationId: grant.operationId,
        });
        if (completed.allowed !== true) {
          throw new ProbeError("blocked_resource_coordinator_settlement");
        }
      }
    };
    const leaseDirectory =
      await prepareSmartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
        appSupportRoot,
      );
    lease = await authority.acquireSharedLease({ directoryPath: leaseDirectory });
    if (!lease?.acquired || lease.mode !== "shared" || lease.brokerAuthority !== false) {
      throw new ProbeError("blocked_shared_mode_lease_unavailable");
    }
    return await runProbeHarness(
      { baseUrl: MANAGED_BASE_URL },
      {
        executionMode: "live-readonly",
        fetchImpl: authority.fetchImpl,
        processAttestor: authority.processAttestor,
        isManagedAttestation: authority.isManagedAttestation,
        sharedModeLeaseHeld: true,
        generationEvidenceClass: generationReader.evidenceClass,
        readMode: () => readPrivateSimulationMode(
          path.join(appSupportRoot, "runtime-mode"),
        ),
        readGeneration: generationReader.readGeneration,
        readFingerprints: currentSmartOrderReadonlyProbeFingerprints,
        withResourceOperation,
        ...(eventTimeoutMs === undefined ? {} : { eventTimeoutMs }),
        ...(isIssuedTask03ObservationCoordination(task03Coordination)
          ? { task03Coordination }
          : {}),
      },
    );
  } catch (error) {
    addCheck(fallbackReport, "probe-execution", "blocked", safeReason(error));
    return finishReport(fallbackReport, emptyTransport);
  } finally {
    if (lease?.acquired && typeof lease.close === "function") {
      await lease.close().catch(() => {});
    }
  }
}

async function runManagedLiveReadOnlyProbe() {
  const resourceCoordinator = createSmartOrderResourceCoordinator();
  try {
    return await runManagedLiveReadOnlyPreflight({ resourceCoordinator });
  } finally {
    resourceCoordinator.close();
  }
}

function parseCli(argv) {
  const [command, ...args] = argv;
  if (command === "fixture" && args.length === 0) return { command };
  if (
    command === "live-readonly" &&
    args.length === 1 &&
    args[0] === `--confirm=${LIVE_CONFIRMATION}`
  ) {
    return { command };
  }
  return { command: "invalid" };
}

async function main() {
  const { command } = parseCli(process.argv.slice(2));
  let report;
  if (command === "fixture") {
    report = await runFixtureProbe();
  } else if (command === "live-readonly") {
    report = await runManagedLiveReadOnlyProbe();
  } else {
    process.stderr.write(
      "usage: node scripts/smart-order-contract-probe.mjs fixture\n" +
      `   or: node scripts/smart-order-contract-probe.mjs live-readonly --confirm=${LIVE_CONFIRMATION}\n`,
    );
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.executionMode === "fixture") {
    // A fixture result is deliberately non-zero so a naive shell pipeline cannot
    // mistake a deterministic harness run for Gate-eligible live evidence.
    process.exitCode = 3;
  } else if (!report.evidenceEligible || report.testOutcome === "blocked") {
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
