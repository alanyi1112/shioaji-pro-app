import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { parsePinnedTdccCsv, preparePinnedTdccBootstrap, PINNED_TDCC_BOOTSTRAP } from '../../../scripts/stock-screener-tdcc-bootstrap.mjs';

const header = '資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%';
function fixture(date = '20260828', code = '2330') {
  const rows = Array.from({ length: 15 }, (_, index) => `${date},${code},${index + 1},1,100,6.66`);
  rows.push(`${date},${code},16,0,0,0.00`, `${date},${code},17,15,1500,100.00`);
  return `\uFEFF${header}\n${rows.join('\n')}\n`;
}
const entry = (text, date = '2026-08-28') => {
  const bytes = Buffer.from(text);
  return { ...PINNED_TDCC_BOOTSTRAP.at(-1), date, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};

test('固定 CSV 解析保留完整 17 級，日期、內容或雜湊改動皆 fail closed', () => {
  const text = fixture();
  const parsed = parsePinnedTdccCsv(Buffer.from(text), entry(text), { minimumRows: 17, minimumSymbols: 1 });
  assert.equal(parsed.rowCount, 17);
  assert.equal(parsed.symbolCount, 1);
  assert.throws(() => parsePinnedTdccCsv(Buffer.from(`${text} `), entry(text), { minimumRows: 17, minimumSymbols: 1 }), /archive_hash_mismatch/);
  const wrongDate = text.replaceAll('20260828', '20260821');
  assert.throws(() => parsePinnedTdccCsv(Buffer.from(wrongDate), entry(wrongDate), { minimumRows: 17, minimumSymbols: 1 }), /archive_invalid_row/);
  const duplicate = text.replace(',17,15,1500,100.00', ',16,15,1500,100.00');
  assert.throws(() => parsePinnedTdccCsv(Buffer.from(duplicate), entry(duplicate), { minimumRows: 17, minimumSymbols: 1 }), /archive_duplicate_level/);
});

test('一般呼叫不得把自訂 manifest 或任意 URL 當成核准歷史來源', async () => {
  const weeks = PINNED_TDCC_BOOTSTRAP.map(item => item.date);
  await assert.rejects(preparePinnedTdccBootstrap(weeks.slice(1), [], async () => { throw new Error('must_not_fetch'); }), /archive_period_mismatch/);
});
