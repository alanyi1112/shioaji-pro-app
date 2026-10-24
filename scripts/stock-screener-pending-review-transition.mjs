/** 明確單日操作：只接續從未下載的 pending；原列封存在收據，不清冷卻／嘗試。 */
import { createHash } from 'node:crypto';
import { readSourceReview } from './stock-screener-source-selection.mjs';
import { validDailyQuotesReview, DAILY_QUOTES_MAPPING, DAILY_QUOTES_URL } from './stock-screener-shioaji-daily-quotes.mjs';
import { technicalEvidenceHash } from '../src/lib/stock-screener-technical-patterns.ts';
const sha = text => createHash('sha256').update(text).digest('hex');
const contract = review => Object.fromEntries(Object.entries(review).filter(([k]) => !['evidenceHash','reviewedAt','validThrough'].includes(k)));
const deny = () => { throw new Error('pending_review_transition_denied'); };

export async function transitionPendingDailyQuotesReview({ db, sessionDate, reviewId, authorization, now = () => new Date() }) {
  const at = now();
  if (authorization?.approved !== true || authorization.sessionDate !== sessionDate || authorization.maximumSourceRequests !== 1
    || !/^[a-f0-9]{64}$/.test(authorization.expectedCacheHash ?? '')) deny();
  const key = `${DAILY_QUOTES_MAPPING}|${sessionDate}`;
  const original = await db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').bind(key).first();
  const next = await readSourceReview(db, reviewId, at);
  if (next.provider !== 'shioaji-daily-quotes' || !validDailyQuotesReview(next.review, at)) deny();
  if (!original || await technicalEvidenceHash(original) !== authorization.expectedCacheHash || original.session_date !== sessionDate
    || original.status !== 'pending' || original.attempts !== 0 || original.response_text !== null || original.payload_hash !== null
    || original.fetched_at !== null || original.review_hash === next.review.evidenceHash
    || original.lease_until && Date.parse(original.lease_until) > +at
    || original.next_attempt_at && Date.parse(original.next_attempt_at) > +at) deny();
  let cursor = next;
  const links = [];
  for (let i = 0; cursor.review.evidenceHash !== original.review_hash && i < 16; i++) {
    const record = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?')
      .bind(`screener-source-review-renewal:${cursor.review.evidenceHash}`).first();
    if (record?.status !== 'verified') deny();
    const proof = JSON.parse(record.checkpoint), { newReviewId, ...facts } = proof;
    if (newReviewId !== cursor.id || sha(JSON.stringify(facts)) !== cursor.review.evidenceHash || facts.version !== 1
      || facts.provider !== 'shioaji-daily-quotes' || facts.reviewedAt !== cursor.review.reviewedAt
      || facts.validThrough !== cursor.review.validThrough || facts.schema?.endpoint !== DAILY_QUOTES_URL) deny();
    const prior = await readSourceReview(db, facts.priorReviewId, at);
    if (prior.provider !== cursor.provider || prior.review.evidenceHash !== facts.priorEvidenceHash
      || await technicalEvidenceHash(contract(prior.review)) !== await technicalEvidenceHash(contract(cursor.review))) deny();
    const sample = await db.prepare('SELECT status,payload FROM screener_daily_quotes_receipts WHERE id=?').bind(facts.sampleReceiptId).first();
    if (sample?.status !== 'complete' || sha(sample.payload) !== facts.sampleReceiptHash) deny();
    links.push(cursor.id); cursor = prior;
  }
  if (cursor.review.evidenceHash !== original.review_hash) deny();
  const payload = { version: 1, sessionDate, original, originalHash: authorization.expectedCacheHash,
    priorReviewId: cursor.id, nextReviewId: next.id, nextReviewHash: next.review.evidenceHash, links,
    authorization: { approved: true, sessionDate, maximumSourceRequests: 1 }, approvedAt: at.toISOString() };
  const id = `pending-review-${await technicalEvidenceHash(payload)}`, serialized = JSON.stringify(payload);
  const guard = `cache_key=? AND session_date=? AND review_hash=? AND status='pending' AND attempts=0
    AND response_text IS NULL AND payload_hash IS NULL AND fetched_at IS NULL AND lease_owner IS ? AND lease_until IS ?
    AND next_attempt_at IS ? AND reason IS ? AND updated_at=?`;
  const values = [key, sessionDate, original.review_hash, original.lease_owner, original.lease_until,
    original.next_attempt_at, original.reason, original.updated_at];
  const results = await db.batch([
    db.prepare(`INSERT INTO screener_daily_quotes_receipts(id,cache_key,status,payload,created_at)
      SELECT ?,?,'review_transition_approved',?,? WHERE EXISTS(SELECT 1 FROM screener_daily_quotes_cache WHERE ${guard})`)
      .bind(id, key, serialized, at.toISOString(), ...values),
    db.prepare(`UPDATE screener_daily_quotes_cache SET review_hash=?,updated_at=? WHERE ${guard}
      AND EXISTS(SELECT 1 FROM screener_daily_quotes_receipts WHERE id=? AND payload=?)`)
      .bind(next.review.evidenceHash, at.toISOString(), ...values, id, serialized),
  ]);
  if ((results[1]?.meta?.changes ?? results[1]?.changes) !== 1) throw new Error('pending_review_transition_raced');
  return { state: 'transitioned', receiptId: id, sessionDate, sourceRequests: 0, originalHash: authorization.expectedCacheHash };
}
