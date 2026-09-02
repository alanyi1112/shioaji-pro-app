import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertAllowedTdccArchiveEntry,
  canonicalTdccArchiveRow,
  compareCanonicalTdccRows,
  fetchTdccArchiveCsv,
  parseTdccArchiveCsvWithDigest,
  TDCC_ARCHIVE_COMMIT,
  TDCC_ARCHIVE_HEADERS,
  TDCC_ARCHIVE_MANIFEST,
} from '../../../src/lib/tdcc-archive-validator.ts';

const fixtureMeta = JSON.parse(await readFile(new URL('./fixtures/tdcc-archive-minimal.json', import.meta.url), 'utf8'));
const header = TDCC_ARCHIVE_HEADERS.join(',');
const rowsFor = (code, date = fixtureMeta.date.replaceAll('-', '')) => [
  ...Array.from({ length: 15 }, (_, index) => `${date},${code},${index + 1},1,100,6.66`),
  `${date},${code},16,0,0,0.00`,
  `${date},${code},17,15,1500,100.00`,
];
const csv = (securities = fixtureMeta.securities) => `\uFEFF${header}\n${securities.flatMap(item => rowsFor(item.code)).join('\n')}\n`;
const syntheticEntry = text => {
  const bytes = Buffer.from(text);
  return {
    date: fixtureMeta.date,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    url: TDCC_ARCHIVE_MANIFEST.at(-1).url,
  };
};
const parseSynthetic = (text, options = {}) => {
  const bytes = Buffer.from(text);
  const entry = syntheticEntry(text);
  return parseTdccArchiveCsvWithDigest(bytes, entry, entry.sha256, {
    minimumRows: 17,
    minimumSymbols: 1,
    requireAllowlisted: false,
    ...options,
  });
};

test('固定 manifest 只允許 immutable commit、固定 host/path 且排除 2021、query 與浮動 main', () => {
  assert.equal(TDCC_ARCHIVE_MANIFEST.length, 18);
  assert.equal(TDCC_ARCHIVE_MANIFEST[0].date, '2026-04-30');
  assert.equal(TDCC_ARCHIVE_MANIFEST.at(-1).date, '2026-08-28');
  assert.doesNotThrow(() => assertAllowedTdccArchiveEntry(TDCC_ARCHIVE_MANIFEST[0]));
  for (const url of [
    `https://raw.githubusercontent.com/wirelessr/tdcc-opendata-archive/main/snapshots/2026/2026-04-30.csv`,
    `https://raw.githubusercontent.com/wirelessr/tdcc-opendata-archive/${TDCC_ARCHIVE_COMMIT}/snapshots/2021/2021-01-01.csv`,
    `${TDCC_ARCHIVE_MANIFEST[0].url}?download=1`,
    `https://example.com/${TDCC_ARCHIVE_COMMIT}/snapshots/2026/2026-04-30.csv`,
  ]) {
    assert.throws(() => assertAllowedTdccArchiveEntry({ ...TDCC_ARCHIVE_MANIFEST[0], url }), /archive_source_not_allowed/);
  }
});

test('共用 validator 接受完整 17 級與代表 .TW、.TWO、8103、ETF fixture', () => {
  const text = csv();
  const parsed = parseSynthetic(text, { minimumRows: 68, minimumSymbols: 4 });
  assert.equal(parsed.rowCount, 68);
  assert.equal(parsed.symbolCount, 4);
  const material = JSON.stringify({
    levels: Array.from({ length: 15 }, (_, index) => ({ level: index + 1, holders: 1, shares: 100, ratioPercent: 6.66 })),
    adjustment: { level: 16, holders: 0, shares: 0, ratioPercent: 0 },
    total: { level: 17, holders: 15, shares: 1500, ratioPercent: 100 },
  });
  assert.equal(createHash('sha256').update(material).digest('hex'), fixtureMeta.expectedMaterialHash);
});

test('bytes、hash、UTF-8、欄名、日期與 row/symbol count 異常皆 fail closed', () => {
  const text = csv([fixtureMeta.securities[0]]);
  const bytes = Buffer.from(text);
  const entry = syntheticEntry(text);
  assert.throws(() => parseTdccArchiveCsvWithDigest(Buffer.concat([bytes, Buffer.from(' ')]), entry, entry.sha256, { minimumRows: 17, minimumSymbols: 1, requireAllowlisted: false }), /archive_hash_mismatch/);
  assert.throws(() => parseTdccArchiveCsvWithDigest(bytes, entry, '0'.repeat(64), { minimumRows: 17, minimumSymbols: 1, requireAllowlisted: false }), /archive_hash_mismatch/);
  const invalidUtf8 = Buffer.from([0xff, 0xfe]);
  assert.throws(() => parseTdccArchiveCsvWithDigest(invalidUtf8, { ...entry, bytes: 2, sha256: createHash('sha256').update(invalidUtf8).digest('hex') }, createHash('sha256').update(invalidUtf8).digest('hex'), { minimumRows: 1, minimumSymbols: 1, requireAllowlisted: false }), /archive_invalid_utf8/);
  assert.throws(() => parseSynthetic(text.replace('資料日期', '日期')), /archive_invalid_headers/);
  assert.throws(() => parseSynthetic(text.replaceAll('20260828', '20260821')), /archive_invalid_row/);
  assert.throws(() => parseSynthetic(text, { minimumRows: 18 }), /archive_invalid_row_count/);
  assert.throws(() => parseSynthetic(text, { minimumSymbols: 2 }), /archive_invalid_symbol_count/);
});

test('重複級距、非安全整數、比例及合計守恆異常皆拒絕', () => {
  const text = csv([fixtureMeta.securities[0]]);
  assert.throws(() => parseSynthetic(text.replace(',17,15,1500,100.00', ',16,15,1500,100.00')), /archive_duplicate_level/);
  assert.throws(() => parseSynthetic(text.replace(',1,1,100,6.66', ',1,9007199254740992,100,6.66')), /archive_invalid_row/);
  assert.throws(() => parseSynthetic(text.replace(',1,1,100,6.66', ',1,1,100,101.00')), /archive_invalid_row/);
  assert.throws(() => parseSynthetic(text.replace(',17,15,1500,100.00', ',17,15,1499,100.00')), /archive_invalid_tdcc/);
});

test('官方 canonical anchor 忽略欄名 BOM/空白但任何 material 差異皆拒絕', () => {
  const rows = parseSynthetic(csv([fixtureMeta.securities[0]])).rows;
  const official = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [` ${key} `, value])));
  assert.equal(compareCanonicalTdccRows(rows, official), 17);
  assert.equal(canonicalTdccArchiveRow({ ...rows[0], '\uFEFF資料日期': rows[0]['資料日期'] }), canonicalTdccArchiveRow(rows[0]));
  official[0][' 股數 '] = '101';
  assert.throws(() => compareCanonicalTdccRows(rows, official), /archive_official_anchor_mismatch/);
});

test('archive fetch 拒絕 redirect／錯誤大小並受 hard timeout 約束', async () => {
  const entry = TDCC_ARCHIVE_MANIFEST[0];
  await assert.rejects(fetchTdccArchiveCsv(entry, async () => ({ redirected: true, ok: true }), 50), /archive_redirect_not_allowed/);
  await assert.rejects(fetchTdccArchiveCsv(entry, async () => ({
    redirected: false,
    ok: true,
    headers: new Headers({ 'content-length': '1' }),
    arrayBuffer: async () => new ArrayBuffer(1),
  }), 50), /archive_size_mismatch/);
  await assert.rejects(fetchTdccArchiveCsv(entry, async () => new Promise(() => {}), 5), /archive_timeout/);
  await assert.rejects(fetchTdccArchiveCsv(entry, async () => { throw new TypeError('network detail'); }, 50), /archive_transport_unavailable/);
});
