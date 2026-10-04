/** 集中預算的工作承諾：唯讀 producer 與 append-only writer 均不送 HTTP／登入／訂閱。 */
import { createHash } from 'node:crypto';
import { validateBrokerBudgetPolicy } from './broker-bandwidth-reservations.mjs';
import { readLocalConservativeIdentity } from './broker-local-conservative-ledger.mjs';

const HASH = /^[a-f0-9]{64}$/;
const JOB = /^[a-zA-Z0-9:_|.-]{1,100}$/;
const safe = n => Number.isSafeInteger(n) && n >= 0;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = () => { throw new Error('broker_policy_pending'); };
const fresh = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value))
    && Date.parse(value) <= now.getTime() && now.getTime() - Date.parse(value) <= 60000;
const PROOF_KEYS = ['version', 'jobKey', 'scope', 'quotaEpoch', 'quotaEpochEvidenceHash', 'observedAt',
    'remainingBytes', 'state', 'sourceEvidenceHash', 'evidenceHash'];
const journalId = evidenceHash => `broker-consumer-observation:${evidenceHash}`;
function validProof(e, record, jobKey, now, requireFresh = true) {
    if (!e || Object.keys(e).length !== PROOF_KEYS.length || Object.keys(e).some(key => !PROOF_KEYS.includes(key))
        || e.version !== 1 || e.jobKey !== jobKey || typeof jobKey !== 'string' || !JOB.test(jobKey) || e.scope !== record.scope
        || e.quotaEpoch !== record.quotaEpoch || e.quotaEpochEvidenceHash !== record.quotaEpochEvidenceHash
        || !safe(e.remainingBytes) || !['committed', 'complete'].includes(e.state)
        || e.state === 'complete' && e.remainingBytes !== 0 || !HASH.test(e.sourceEvidenceHash ?? '')
        || !HASH.test(e.evidenceHash ?? '') || !Number.isFinite(Date.parse(e.observedAt))
        || requireFresh && !fresh(e.observedAt, now)) return false;
    const { evidenceHash, ...proof } = e;
    return sha(proof) === evidenceHash;
}
async function resolveProof(db, row, jobKey) {
    if (row?.status !== 'verified') fail();
    let e;
    try { e = JSON.parse(row.checkpoint); } catch { fail(); }
    if (e?.version !== 2) return e; // 既有 v1 head 不重寫；下次合法 writer 更新時保存原觀察。
    if (Object.keys(e).length !== 3 || e.jobKey !== jobKey
        || !/^broker-consumer-observation:[a-f0-9]{64}$/.test(e.receiptId ?? '')) fail();
    const receipt = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(e.receiptId).first();
    if (receipt?.status !== 'verified') fail();
    try { e = JSON.parse(receipt.checkpoint); } catch { fail(); }
    if (journalId(e?.evidenceHash) !== JSON.parse(row.checkpoint).receiptId) fail();
    return e;
}

/** 只供既有背景工作提交其真實、有界剩餘承諾；不產生 quota 身份、實測或來源事實。
 * 呼叫者必須提供 actual observedAt／sourceEvidenceHash；禁止以 writer 的現在時間補證據。
 * receipt 不可變，head 以 CAS 更新；完整 roster／各工作接線仍另行驗收。
 */
export async function saveScreenerBrokerCommitment(db, record, proof, now = new Date()) {
    const policyId = 'screener-bollinger-broker-budget-policy';
    const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(policyId).first();
    if (row?.status !== 'verified') fail();
    let actual;
    try { actual = JSON.parse(row.checkpoint); } catch { fail(); }
    if (sha(actual) !== sha(record)) throw new Error('broker_policy_changed');
    const jobs = record?.budgetPolicy?.otherConsumerJobKeys;
    const e = { ...proof, evidenceHash: sha(proof) };
    if (![2, 3].includes(record?.version) || !(record.version === 3
        ? record.quotaEpochVerified === false && record.identityMode === 'local-conservative-v1' : record.quotaEpochVerified === true)
        || !HASH.test(record.scope ?? '')
        || typeof record.quotaEpoch !== 'string' || !JOB.test(record.quotaEpoch) || !HASH.test(record.quotaEpochEvidenceHash ?? '')
        || !Number.isFinite(Date.parse(record.validThrough)) || Date.parse(record.validThrough) <= now.getTime()
        || !Array.isArray(jobs) || !jobs.length || jobs.length > 100 || jobs.some(job => typeof job !== 'string' || !JOB.test(job))
        || new Set(jobs).size !== jobs.length || !jobs.includes(proof?.jobKey)
        || Object.hasOwn(proof ?? {}, 'evidenceHash') || !validProof(e, record, proof?.jobKey, now))
        throw new Error('invalid_broker_commitment');
    if (record.version === 3) {
        const anchor = await readLocalConservativeIdentity(db);
        if (anchor.scope !== record.scope || anchor.quotaEpoch !== record.quotaEpoch
            || anchor.quotaEpochEvidenceHash !== record.quotaEpochEvidenceHash) fail();
    }
    const headId = `broker-consumer-commitment:${e.jobKey}`, receiptId = journalId(e.evidenceHash);
    const current = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(headId).first();
    let prior = null;
    if (current) {
        prior = await resolveProof(db, current, e.jobKey);
        if (!validProof(prior, record, e.jobKey, now, false)) fail();
        if (prior.evidenceHash === e.evidenceHash) return { state: 'unchanged', receiptId };
        if (Date.parse(e.observedAt) <= Date.parse(prior.observedAt)) throw new Error('broker_commitment_changed');
    }
    const checkpoint = JSON.stringify(e), head = JSON.stringify({ version: 2, jobKey: e.jobKey, receiptId });
    const insert = value => db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        SELECT ?,'broker-consumer-observation','verified',?,? WHERE EXISTS
        (SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?) ON CONFLICT(id) DO NOTHING`)
        .bind(journalId(value.evidenceHash), JSON.stringify(value), now.toISOString(), policyId, row.checkpoint);
    const statements = [];
    if (prior && prior.version === 1) statements.push(insert(prior));
    statements.push(insert(e), db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        SELECT ?,'broker-consumer-head','verified',?,? WHERE EXISTS
        (SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?) AND EXISTS
        (SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)
        AND (?=0 OR EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?))
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,checkpoint=excluded.checkpoint,updated_at=excluded.updated_at
        WHERE screener_runs.status=? AND screener_runs.checkpoint=?`)
        .bind(headId, head, now.toISOString(), policyId, row.checkpoint, receiptId, checkpoint,
            prior ? 1 : 0, prior ? journalId(prior.evidenceHash) : '', prior ? JSON.stringify(prior) : '',
            current?.status ?? 'verified', current?.checkpoint ?? ''));
    const results = await db.batch(statements);
    if ((results.at(-1).meta?.changes ?? results.at(-1).changes) !== 1) throw new Error('broker_commitment_changed');
    return { state: 'saved', receiptId };
}

/** v2 配置與工作 receipt 分開；只組合事實，不替工作回填 observedAt／verified。 */
export async function readScreenerBrokerCommitments(db, record, now = new Date()) {
    const configured = record?.budgetPolicy;
    const jobs = configured?.otherConsumerJobKeys;
    // 非參與中央 ledger 的工作必須完整登錄；空 roster 不能宣稱已盤點其他工作。
    if (![2, 3].includes(record?.version) || !configured || !Array.isArray(jobs) || !jobs.length || jobs.length > 100
        || jobs.some(job => typeof job !== 'string' || !JOB.test(job)) || new Set(jobs).size !== jobs.length
        || !HASH.test(configured.evidenceHash ?? '')
        || Object.hasOwn(configured, 'otherJobCommitments') || Object.hasOwn(configured, 'commitmentsObservedAt')) fail();
    const facts = []; let oldest = now.getTime();
    for (const jobKey of [...jobs].sort()) {
        const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?')
            .bind(`broker-consumer-commitment:${jobKey}`).first();
        const e = await resolveProof(db, row, jobKey);
        if (!validProof(e, record, jobKey, now)) fail();
        oldest = Math.min(oldest, Date.parse(e.observedAt));
        // proof 的觀察時間仍驗 hash 與 freshness；條款 hash 僅在實際承諾／來源證據修訂時變。
        facts.push({ jobKey, bytes: e.remainingBytes, state: e.state, sourceEvidenceHash: e.sourceEvidenceHash });
    }
    const { otherConsumerJobKeys: _jobs, evidenceHash: configurationEvidenceHash, ...settings } = configured;
    const policy = { ...settings, version: 1, commitmentsObservedAt: new Date(oldest).toISOString(),
        otherJobCommitments: facts.map(({ jobKey, bytes }) => ({ jobKey, bytes })),
        evidenceHash: sha({ version: 1, configurationEvidenceHash, facts }) };
    if (!validateBrokerBudgetPolicy(policy, now)) fail();
    return policy;
}
