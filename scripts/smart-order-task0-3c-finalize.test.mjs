import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import { verifySmartOrderTask03cRepositoryProjection } from './smart-order-task0-3c-finalize.mjs';

const roots = [];
const account = {
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
};
const tradeDate = '2026-08-27';
const startedAtEpochMs = Date.parse('2026-08-27T02:00:00.000Z');

afterEach(async () => {
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function reconciliationScope() {
    return sha256(
        `smart-order-reconciliation-account\u001f${canonicalJson([
            account.broker_id,
            account.account_id,
            'S',
        ])}`,
    );
}

function claimId(orderId) {
    return `external-sell-claim:${sha256(
        canonicalJson([
            reconciliationScope(),
            tradeDate,
            orderId,
            'TSE:2330:STK:Common',
        ]),
    ).slice(7)}`;
}

function target(operationOrdinal) {
    return {
        operationOrdinal,
        orderId: `order-${operationOrdinal}`,
        contractUnit: 1_000,
    };
}

async function databaseFixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'task0-3c-finalize-'));
    roots.push(root);
    const databasePath = path.join(root, 'smart-orders.sqlite3');
    const database = new DatabaseSync(databasePath);
    database.exec(`
        CREATE TABLE external_sell_visibility_heads (
            account_broker_ref TEXT, account_id_ref TEXT, trade_date TEXT,
            contract_key TEXT, source_revision TEXT, source_sequence INTEGER,
            source_evidence_hash TEXT, position_revision TEXT,
            position_shares INTEGER, working_set_hash TEXT,
            collection_complete INTEGER, observed_at_epoch_ms INTEGER,
            valid_until_epoch_ms INTEGER, updated_at_epoch_ms INTEGER,
            revision INTEGER
        );
        CREATE TABLE account_reconciliation_heads (
            account_broker_ref TEXT, account_id_ref TEXT, trade_date TEXT,
            updated_at_epoch_ms INTEGER, revision INTEGER
        );
        CREATE TABLE exit_claims (
            exit_claim_id TEXT, external_lineage INTEGER,
            account_broker_ref TEXT, account_id_ref TEXT,
            contract_key TEXT, quantity_shares INTEGER, state TEXT,
            position_lineage_id TEXT
        );
        CREATE TABLE exit_claim_visibility_bindings (
            exit_claim_id TEXT, trade_date TEXT, source_revision TEXT,
            source_sequence INTEGER, source_evidence_hash TEXT,
            position_revision TEXT, position_shares INTEGER,
            working_set_hash TEXT, binding_kind TEXT,
            visibility_head_revision INTEGER
        );
    `);
    const sourceEvidence = `sha256:${'a'.repeat(64)}`;
    const workingSetHash = `sha256:${'b'.repeat(64)}`;
    database.prepare(`
        INSERT INTO external_sell_visibility_heads VALUES(
            ?, ?, ?, 'TSE:2330:STK:Common', 'source-r1', 3, ?,
            'source-r1', 7000, ?, 1, ?, ?, ?, 4
        )
    `).run(
        account.broker_id,
        account.account_id,
        tradeDate,
        sourceEvidence,
        workingSetHash,
        startedAtEpochMs + 1_000,
        startedAtEpochMs + 6_000,
        startedAtEpochMs + 1_000,
    );
    database.prepare(
        'INSERT INTO account_reconciliation_heads VALUES(?, ?, ?, ?, 7)',
    ).run(
        account.broker_id,
        account.account_id,
        tradeDate,
        startedAtEpochMs + 1_000,
    );
    for (const operationOrdinal of [1, 2]) {
        const exitClaimId = claimId(`order-${operationOrdinal}`);
        database.prepare(`
            INSERT INTO exit_claims VALUES(
                ?, 1, ?, ?, 'TSE:2330:STK:Common', 1000,
                'broker_working', 'position-lineage-1'
            )
        `).run(exitClaimId, account.broker_id, account.account_id);
        database.prepare(`
            INSERT INTO exit_claim_visibility_bindings VALUES(
                ?, ?, 'source-r1', 3, ?, 'source-r1', 7000, ?,
                'external_projection', 4
            )
        `).run(exitClaimId, tradeDate, sourceEvidence, workingSetHash);
    }
    database.close();
    return databasePath;
}

describe('Task 0.3c restarted Runtime repository finalizer', () => {
    it('requires the exact two external claims bound to one current visibility head', async () => {
        const databasePath = await databaseFixture();
        expect(
            verifySmartOrderTask03cRepositoryProjection({
                account,
                databasePath,
                discovery: { startedAtEpochMs },
                nowEpochMs: startedAtEpochMs + 2_000,
                targets: [target(1), target(2)],
                tradeDate,
            }),
        ).toMatchObject({
            visibilityRevision: 4,
            reconciliationRevision: 4,
            observedAtEpochMs: startedAtEpochMs + 1_000,
        });
    });

    it('rejects a single visible claim as incomplete', async () => {
        const databasePath = await databaseFixture();
        const database = new DatabaseSync(databasePath);
        database.prepare('DELETE FROM exit_claims WHERE exit_claim_id=?').run(
            claimId('order-2'),
        );
        database.close();
        expect(() =>
            verifySmartOrderTask03cRepositoryProjection({
                account,
                databasePath,
                discovery: { startedAtEpochMs },
                nowEpochMs: startedAtEpochMs + 2_000,
                targets: [target(1), target(2)],
                tradeDate,
            }),
        ).toThrow('exact complete');
    });
});
