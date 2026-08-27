import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveSmartOrderTask13_2CurrentDayPnlEvidence } from './task13-2-pnl-current-day-evidence.mjs';

const roots = [];
const nowEpochMs = Date.parse('2026-08-27T03:00:00.000Z');
const account = Object.freeze({
    account_type: 'S',
    broker_id: 'broker-secret',
    account_id: 'account-secret',
});

function digest(character) {
    return `sha256:${character.repeat(64)}`;
}

async function databaseWithClaims() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'task13-2-pnl-'));
    roots.push(root);
    const databasePath = path.join(root, 'smart-orders.sqlite3');
    const database = new DatabaseSync(databasePath);
    database.exec(`
        CREATE TABLE exit_claims (
            exit_claim_id TEXT PRIMARY KEY,
            account_broker_ref TEXT NOT NULL,
            account_id_ref TEXT NOT NULL,
            external_lineage INTEGER NOT NULL,
            state TEXT NOT NULL
        );
        CREATE TABLE exit_claim_visibility_bindings (
            exit_claim_id TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            binding_kind TEXT NOT NULL
        );
    `);
    const insertClaim = database.prepare(`
        INSERT INTO exit_claims VALUES (?, ?, ?, 1, 'broker_working')
    `);
    const insertBinding = database.prepare(`
        INSERT INTO exit_claim_visibility_bindings VALUES (?, '2026-08-27', 'external_projection')
    `);
    for (const claimId of ['claim-1', 'claim-2']) {
        insertClaim.run(claimId, account.broker_id, account.account_id);
        insertBinding.run(claimId);
    }
    database.close();
    return databasePath;
}

function trade(index, deals = []) {
    return {
        order: { account },
        status: {
            order_ts: Date.parse(`2026-08-27T01:0${index}:00.000Z`) / 1_000,
            deals,
        },
    };
}

function input(databasePath, trades = [trade(1), trade(2)]) {
    return {
        account,
        accountScopeSha256: digest('a'),
        apiGenerationSha256: digest('b'),
        databasePath,
        discoveryStartedAtEpochMs: Date.parse('2026-08-27T02:00:00.000Z'),
        positions: [
            {
                direction: 'Buy',
                pnl: 123,
                last_price: 100,
                price: 99,
                quantity: 7_000,
            },
        ],
        positionsSha256: digest('c'),
        quoteEvidenceSha256: digest('d'),
        tradeDate: '2026-08-27',
        trades,
        unitCapability: {
            eligible: true,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            serviceMutations: 0,
        },
        workingOrdersSha256: digest('e'),
        nowEpochMs,
    };
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('Task 13.2 current-day PnL evidence', () => {
    it('proves the exact complete empty-deal set without persisting account identifiers', async () => {
        const databasePath = await databaseWithClaims();
        const result = deriveSmartOrderTask13_2CurrentDayPnlEvidence(
            input(databasePath),
        );

        expect(result).toMatchObject({
            tradeDate: '2026-08-27',
            tradeCount: 2,
            dealCount: 0,
            externalClaimCount: 2,
            realizedMinorUnits: 0,
            feeMinorUnits: 0,
            transactionTaxMinorUnits: 0,
            fullDayDealsComplete: true,
            fullDayFeesComplete: true,
            fullDayTaxesComplete: true,
            validUntilEpochMs: nowEpochMs + 5_000,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            serviceMutations: 0,
            brokerAuthority: false,
        });
        expect(JSON.stringify(result)).not.toContain(account.broker_id);
        expect(JSON.stringify(result)).not.toContain(account.account_id);
    });

    it('fails closed when a nonempty deal lacks actual fee or tax fields', async () => {
        const databasePath = await databaseWithClaims();
        const incompleteDeal = {
            seq: '1',
            realized_pnl: 0,
            fee: 1,
        };

        expect(() =>
            deriveSmartOrderTask13_2CurrentDayPnlEvidence(
                input(databasePath, [trade(1, [incompleteDeal]), trade(2)]),
            ),
        ).toThrow('lacks fee or tax');
    });

    it('fails closed when the broker and repository working sets diverge', async () => {
        const databasePath = await databaseWithClaims();

        expect(() =>
            deriveSmartOrderTask13_2CurrentDayPnlEvidence(
                input(databasePath, [trade(1)]),
            ),
        ).toThrow('complete empty-deal set is no longer exact');
    });
});
