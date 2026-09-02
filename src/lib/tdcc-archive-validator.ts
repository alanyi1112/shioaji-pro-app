import { validateTdcc } from "./stock-screener-domain.ts";

export const TDCC_ARCHIVE_COMMIT = "17944774a7a37c8ef52a7ca919817fe6f949891c";
export const TDCC_ARCHIVE_MANIFEST_VERSION = "tdcc-archive-2026-v1";
export const TDCC_ARCHIVE_VALIDATOR_VERSION = "tdcc-archive-validator-v1";
export const TDCC_ARCHIVE_NORMALIZATION_VERSION = "tdcc-official-distribution-v2";
export const TDCC_ARCHIVE_MAX_BYTES = 4 * 1024 * 1024;
export const TDCC_ARCHIVE_HEADERS = Object.freeze([
  "資料日期",
  "證券代號",
  "持股分級",
  "人數",
  "股數",
  "占集保庫存數比例%",
]);

export type TdccArchiveManifestEntry = Readonly<{
  date: string;
  bytes: number;
  sha256: string;
  url: string;
}>;

export type TdccArchiveRawRow = {
  "資料日期": string;
  "證券代號": string;
  "持股分級": string;
  "人數": string;
  "股數": string;
  "占集保庫存數比例%": string;
};

const ARCHIVE_ORIGIN = "https://raw.githubusercontent.com";
const ARCHIVE_PATH_PREFIX = `/wirelessr/tdcc-opendata-archive/${TDCC_ARCHIVE_COMMIT}/snapshots/2026`;

export function tdccArchiveUrl(date: string): string {
  if (!/^2026-\d{2}-\d{2}$/.test(date)) throw new Error("archive_source_not_allowed");
  return `${ARCHIVE_ORIGIN}${ARCHIVE_PATH_PREFIX}/${date}.csv`;
}

const manifestRows = [
  ["2026-04-30", 2313365, "e2b69495d5b85cdd65ecf76bd6b0ff24367a2fd3e66232a801c6b776429189cb"],
  ["2026-05-08", 2315913, "d533d882abda9385ab673f043e9bf5e3d2841b1c46ecd6aba36f40434f4314d9"],
  ["2026-05-15", 2318612, "7d4784474befaac31a6825a94d683e6f70afd018f76dfc69b9880a8feca8e8be"],
  ["2026-05-22", 2320402, "0719b26960e1674fa24d63efca21a5225b2587990dcdb4f01c4d81610228a603"],
  ["2026-05-29", 2322238, "3f84eb6a66414caf74919ba524a441ef529c150e4177ea640de7f19b06956575"],
  ["2026-06-05", 2325870, "94661f633f29adae7f80627394d65223da1e7ffd0edbf5a188f04dfe52f516ee"],
  ["2026-06-12", 2327129, "760a9178a06f7258d2874715ec22719e5bb3c58484184eb7a30dcb9a54a61232"],
  ["2026-06-18", 2328229, "1e643f3dd3f1bb43d48d7168e59dc0d5edcdbe42ad22480a5bf26dfa27c8dc77"],
  ["2026-06-26", 2332634, "8ea48f27b213ceb3a1b35838ac48701fe10b63df437fa82c032529c846a94c2c"],
  ["2026-07-03", 2333431, "a01634970798cb2ff6ba531aff80336a540232ce18a6fd4d333001a0d8548d0e"],
  ["2026-07-09", 2334523, "f7b62180e119bd79b81da38c3e227aaddd8e98998db9aa7da6b269a4d2a7c5a6"],
  ["2026-07-17", 2338672, "7e88da9a8cbff7e5a4bcaebce57a955ce4bb8120c595d61105411fdb019987d7"],
  ["2026-07-24", 2341148, "91867bb70afebf5a6b7c3eb7cab86928875bf854a79f6d6dcc4496729d8b0a54"],
  ["2026-07-31", 2344332, "7ad5886e994418975b72e100be97d8782e8ed320e5428fc253d5817e886aaf44"],
  ["2026-08-07", 2347711, "c7cb74ae2e093ac145bfb9d5b2b153069b7f1e1f5e9603f8dec882d72ccc9ad6"],
  ["2026-08-14", 2348999, "6098051708b362ac0215606174d539c40cac91902467b83f4c9da471a19adf8c"],
  ["2026-08-21", 2352208, "4582e2ed52cc4fd48c4f7f6f858291f2c2937fbfa3084c3d44dc58f202eaeaa1"],
  ["2026-08-28", 2359165, "95960f0f828ade074a2e817ce42202488fd3e53522e07b8b8656ff0f469b3dd1"],
] as const;

export const TDCC_ARCHIVE_MANIFEST: readonly TdccArchiveManifestEntry[] = Object.freeze(
  manifestRows.map(([date, bytes, sha256]) => Object.freeze({ date, bytes, sha256, url: tdccArchiveUrl(date) })),
);

export function assertAllowedTdccArchiveEntry(
  entry: TdccArchiveManifestEntry,
  manifest: readonly TdccArchiveManifestEntry[] = TDCC_ARCHIVE_MANIFEST,
): void {
  let parsed: URL;
  try {
    parsed = new URL(entry.url);
  } catch {
    throw new Error("archive_source_not_allowed");
  }
  const allowed = manifest.some((candidate) => candidate.date === entry.date
    && candidate.bytes === entry.bytes
    && candidate.sha256 === entry.sha256
    && candidate.url === entry.url);
  if (!allowed
    || parsed.protocol !== "https:"
    || parsed.host !== "raw.githubusercontent.com"
    || parsed.pathname !== `${ARCHIVE_PATH_PREFIX}/${entry.date}.csv`
    || parsed.search
    || parsed.hash
    || entry.url !== tdccArchiveUrl(entry.date)
    || entry.bytes <= 0
    || entry.bytes > TDCC_ARCHIVE_MAX_BYTES
    || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error("archive_source_not_allowed");
  }
}

export async function tdccArchiveSha256(bytes: Uint8Array): Promise<string> {
  const payload = new Uint8Array(bytes.byteLength);
  payload.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", payload.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function strictInteger(value: string): number | null {
  if (!/^-?(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function strictRatio(value: string): number | null {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function canonicalTdccArchiveRow(row: Record<string, unknown>): string {
  return TDCC_ARCHIVE_HEADERS.map((header) => {
    const match = Object.entries(row).find(([key]) => key.replace(/^\uFEFF/, "").trim() === header);
    if (!match) throw new Error("archive_official_anchor_invalid");
    return String(match[1] ?? "").trim();
  }).join("|");
}

export function compareCanonicalTdccRows(
  archiveRows: readonly Record<string, unknown>[],
  officialRows: readonly Record<string, unknown>[],
): number {
  const archive = archiveRows.map(canonicalTdccArchiveRow).sort();
  const official = officialRows.map(canonicalTdccArchiveRow).sort();
  if (archive.length !== official.length || archive.some((row, index) => row !== official[index])) {
    throw new Error("archive_official_anchor_mismatch");
  }
  return official.length;
}

export function parseTdccArchiveCsvWithDigest(
  bytes: Uint8Array,
  entry: TdccArchiveManifestEntry,
  digestHex: string,
  options: { minimumRows?: number; minimumSymbols?: number; requireAllowlisted?: boolean } = {},
) {
  const { minimumRows = 30000, minimumSymbols = 3000, requireAllowlisted = true } = options;
  if (requireAllowlisted) assertAllowedTdccArchiveEntry(entry);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== entry.bytes || digestHex !== entry.sha256) {
    throw new Error("archive_hash_mismatch");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("archive_invalid_utf8");
  }
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length < minimumRows + 1 || lines.length > 100001 || lines.some(line => line.length === 0)) {
    throw new Error("archive_invalid_row_count");
  }
  const headers = lines.shift()!.replace(/^\uFEFF/, "").split(",").map(value => value.trim());
  if (headers.length !== TDCC_ARCHIVE_HEADERS.length
    || headers.some((value, index) => value !== TDCC_ARCHIVE_HEADERS[index])) {
    throw new Error("archive_invalid_headers");
  }

  const rows: TdccArchiveRawRow[] = [];
  const grouped = new Map<string, Array<{ level: number; holders: string; shares: string; ratio: string }>>();
  const uniqueLevels = new Set<string>();
  const expectedDate = entry.date.replaceAll("-", "");
  for (const line of lines) {
    const cells = line.split(",");
    if (cells.length !== TDCC_ARCHIVE_HEADERS.length) throw new Error("archive_invalid_csv");
    const [dataDateCell, codeCell, levelCell, holdersCell, sharesCell, ratioCell] = cells;
    if ([dataDateCell, codeCell, levelCell, holdersCell, sharesCell, ratioCell].some(value => value === undefined)) {
      throw new Error("archive_invalid_csv");
    }
    const row: TdccArchiveRawRow = {
      "資料日期": dataDateCell!.trim(),
      "證券代號": codeCell!.trim(),
      "持股分級": levelCell!.trim(),
      "人數": holdersCell!.trim(),
      "股數": sharesCell!.trim(),
      "占集保庫存數比例%": ratioCell!.trim(),
    };
    const code = row["證券代號"];
    const level = strictInteger(row["持股分級"]);
    const holders = strictInteger(row["人數"]);
    const shares = strictInteger(row["股數"]);
    const ratio = strictRatio(row["占集保庫存數比例%"]);
    if (row["資料日期"] !== expectedDate
      || !/^[0-9A-Z]{4,12}$/.test(code)
      || level === null || level < 1 || level > 17
      || holders === null || holders < 0
      || shares === null
      || (level !== 16 && shares < 0)
      || ratio === null
      || (level === 16 ? ratio < -100 || ratio > 100 : ratio < 0 || ratio > 100)) {
      throw new Error("archive_invalid_row");
    }
    const uniqueKey = `${code}|${level}`;
    if (uniqueLevels.has(uniqueKey)) throw new Error("archive_duplicate_level");
    uniqueLevels.add(uniqueKey);
    const bands = grouped.get(code) ?? [];
    bands.push({ level, holders: row["人數"], shares: row["股數"], ratio: row["占集保庫存數比例%"] });
    grouped.set(code, bands);
    rows.push(row);
  }

  if (grouped.size < minimumSymbols) throw new Error("archive_invalid_symbol_count");
  const provenance = {
    source: "TDCC" as const,
    sourceUrl: entry.url,
    fetchedAt: "1970-01-01T00:00:00.000Z",
    payloadHash: entry.sha256,
    normalizationVersion: TDCC_ARCHIVE_NORMALIZATION_VERSION,
  };
  for (const bands of grouped.values()) {
    if (bands.length !== 17 || validateTdcc({ date: entry.date, bands, provenance }) !== "none") {
      throw new Error("archive_invalid_tdcc");
    }
  }
  return { ...entry, rows, rowCount: rows.length, symbolCount: grouped.size };
}

export async function parseTdccArchiveCsv(
  bytes: Uint8Array,
  entry: TdccArchiveManifestEntry,
  options?: { minimumRows?: number; minimumSymbols?: number; requireAllowlisted?: boolean },
) {
  return parseTdccArchiveCsvWithDigest(bytes, entry, await tdccArchiveSha256(bytes), options);
}

export async function fetchTdccArchiveCsv(
  entry: TdccArchiveManifestEntry,
  fetcher: typeof fetch = fetch,
  timeoutMs = 30000,
) {
  assertAllowedTdccArchiveEntry(entry);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const response = await fetcher(entry.url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "accept-encoding": "identity" },
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error("archive_redirect_not_allowed");
    if (!response.ok) throw new Error(`archive_http_${response.status}`);
    const declaredText = response.headers.get("content-length");
    if (declaredText !== null) {
      const declared = Number(declaredText);
      if (!Number.isSafeInteger(declared) || declared !== entry.bytes || declared > TDCC_ARCHIVE_MAX_BYTES) {
        throw new Error("archive_size_mismatch");
      }
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > TDCC_ARCHIVE_MAX_BYTES) throw new Error("archive_too_large");
    return parseTdccArchiveCsv(bytes, entry);
  })();
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("archive_timeout"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && /^archive_/.test(error.message)) throw error;
    throw new Error("archive_transport_unavailable");
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

/** Returns only after every immutable period has downloaded and passed validation. */
export async function prepareTdccArchiveManifest(
  entries: readonly TdccArchiveManifestEntry[],
  officialLatestRows: readonly Record<string, unknown>[],
  fetcher: typeof fetch = fetch,
) {
  if (entries.length === 0
    || entries.length !== TDCC_ARCHIVE_MANIFEST.length
    || entries.some((entry, index) => entry !== TDCC_ARCHIVE_MANIFEST[index])) {
    throw new Error("archive_period_mismatch");
  }
  const snapshots = [];
  for (const entry of entries) snapshots.push(await fetchTdccArchiveCsv(entry, fetcher));
  const latest = snapshots.at(-1)!;
  const officialComparedRows = compareCanonicalTdccRows(latest.rows, officialLatestRows);
  return {
    manifestVersion: TDCC_ARCHIVE_MANIFEST_VERSION,
    validatorVersion: TDCC_ARCHIVE_VALIDATOR_VERSION,
    commit: TDCC_ARCHIVE_COMMIT,
    snapshots,
    officialComparedRows,
  };
}
