// src/lib/trigger-engine.ts — legacy alert-only compatibility runtime.
//
// IMPORTANT: `sj-pro-triggers` used to contain browser-side stop-loss and
// take-profit instructions.  Those records are no longer trading authority.
// They remain visible for manual rebuilding, but this module never resolves a
// contract, submits an order, removes an OCO sibling, or infers broker state.

import { useSyncExternalStore } from 'react';
import { onAnyTick } from './stream';
import { notify } from './trade';
import type { Action } from './types/order';

export interface AlertTriggerOrder {
    id: string;
    code: string;
    condition: 'below' | 'above';
    price: number;
    action: 'Sell';
    quantity: 0;
    kind: 'alert';
}

export interface BlockedLegacyTradingTriggerOrder {
    id: string;
    code: string;
    condition: 'below' | 'above';
    price: number;
    action: Action;
    quantity: number;
    kind: 'stop' | 'take';
    group?: string;
}

export type TriggerOrder =
    | AlertTriggerOrder
    | BlockedLegacyTradingTriggerOrder;

export type NewAlertTrigger = Omit<AlertTriggerOrder, 'id'>;

export const LEGACY_TRADING_TRIGGER_DISABLED_MESSAGE =
    '舊版瀏覽器停損／停利已停用，不會自動下單；請先人工核對券商委託與部位，再到智慧下單重建。';

/**
 * Closed-world compatibility contract.  There is deliberately no value that
 * can turn the legacy browser runtime back into a trading sender.  The single
 * durable trading-sender authority belongs to the sidecar Runtime; alerts are
 * outside that authority because they cannot create broker side effects.
 */
export const LEGACY_TRIGGER_AUTHORITY = Object.freeze({
    schemaVersion: 'legacy-trigger-authority/2026-08-12.1',
    tradingSender: 'permanently_retired' as const,
    alertRuntime: 'notification_only' as const,
    brokerWriteAuthorized: false as const,
});

export class LegacyTradingTriggerDisabledError extends Error {
    readonly code = 'LEGACY_TRADING_TRIGGER_DISABLED';

    constructor() {
        super(LEGACY_TRADING_TRIGGER_DISABLED_MESSAGE);
        this.name = 'LegacyTradingTriggerDisabledError';
    }
}

const STORAGE_KEY = 'sj-pro-triggers';
const MAX_STORAGE_BYTES = 256 * 1024;
const MAX_RECORDS = 2_000;

type StorageSnapshot = {
    records: unknown[];
    writable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShortText(value: unknown, maxLength: number): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= maxLength
    );
}

function decodeTrigger(value: unknown): TriggerOrder | null {
    if (!isRecord(value)) return null;
    if (!isShortText(value.id, 160) || !isShortText(value.code, 64)) {
        return null;
    }
    if (value.condition !== 'below' && value.condition !== 'above') {
        return null;
    }
    if (
        typeof value.price !== 'number' ||
        !Number.isFinite(value.price) ||
        value.price <= 0
    ) {
        return null;
    }

    if (value.kind === 'alert') {
        if (
            value.action !== 'Sell' ||
            value.quantity !== 0 ||
            value.group !== undefined
        ) {
            return null;
        }
        return Object.freeze({
            id: value.id,
            code: value.code,
            condition: value.condition,
            price: value.price,
            action: 'Sell' as const,
            quantity: 0 as const,
            kind: 'alert' as const,
        });
    }

    if (value.kind !== 'stop' && value.kind !== 'take') return null;
    if (value.action !== 'Buy' && value.action !== 'Sell') return null;
    if (
        typeof value.quantity !== 'number' ||
        !Number.isInteger(value.quantity) ||
        value.quantity <= 0
    ) {
        return null;
    }
    if (
        value.group !== undefined &&
        !isShortText(value.group, 160)
    ) {
        return null;
    }
    return Object.freeze({
        id: value.id,
        code: value.code,
        condition: value.condition,
        price: value.price,
        action: value.action,
        quantity: value.quantity,
        kind: value.kind,
        ...(value.group === undefined ? {} : { group: value.group }),
    });
}

function readStorage(): StorageSnapshot {
    try {
        if (typeof localStorage === 'undefined') {
            return { records: [], writable: false };
        }
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return { records: [], writable: true };
        if (raw.length > MAX_STORAGE_BYTES) {
            return { records: [], writable: false };
        }
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length > MAX_RECORDS) {
            return { records: [], writable: false };
        }
        // Keep the original records.  Alert changes must not silently rewrite,
        // remove, or reinterpret disabled legacy stop/take inventory.
        return { records: parsed, writable: true };
    } catch {
        return { records: [], writable: false };
    }
}

const initialStorage = readStorage();
let storedRecords = initialStorage.records;
let storageWritable = initialStorage.writable;
let triggers = Object.freeze(
    storedRecords.map(decodeTrigger).filter((t): t is TriggerOrder => t !== null),
) as readonly TriggerOrder[];
const listeners = new Set<() => void>();
const firingAlerts = new Set<string>();

function publish(nextRecords: unknown[]): boolean {
    if (!storageWritable || typeof localStorage === 'undefined') return false;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
    } catch {
        storageWritable = false;
        return false;
    }
    storedRecords = nextRecords;
    triggers = Object.freeze(
        storedRecords
            .map(decodeTrigger)
            .filter((t): t is TriggerOrder => t !== null),
    );
    listeners.forEach((listener) => listener());
    return true;
}

function isCanonicalNewAlert(value: unknown): value is NewAlertTrigger {
    if (!isRecord(value)) return false;
    return (
        value.kind === 'alert' &&
        value.action === 'Sell' &&
        value.quantity === 0 &&
        isShortText(value.code, 64) &&
        (value.condition === 'below' || value.condition === 'above') &&
        typeof value.price === 'number' &&
        Number.isFinite(value.price) &&
        value.price > 0 &&
        !('group' in value)
    );
}

/**
 * Adds notification-only authority.  Passing an old stop/take shape throws
 * synchronously before any contract lookup or broker write can occur.
 */
export function addTrigger(value: NewAlertTrigger): AlertTriggerOrder {
    if (!isCanonicalNewAlert(value)) {
        throw new LegacyTradingTriggerDisabledError();
    }
    const trigger: AlertTriggerOrder = Object.freeze({
        ...value,
        id: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });
    if (!publish([...storedRecords, trigger])) {
        throw new Error('到價警示無法安全保存；未建立警示');
    }
    notify({
        kind: 'info',
        title: '🔔 警示已設',
        body: `${trigger.code} 觸價 ${trigger.condition === 'below' ? '≤' : '≥'} ${trigger.price} 時通知（不下單）`,
    });
    return trigger;
}

/** Only notification alerts can be removed by this runtime. */
export function removeTrigger(id: string): boolean {
    const target = triggers.find((trigger) => trigger.id === id);
    if (!target || target.kind !== 'alert') return false;
    const nextRecords = storedRecords.filter(
        (record) =>
            !(
                isRecord(record) &&
                record.kind === 'alert' &&
                record.id === id
            ),
    );
    return publish(nextRecords);
}

export function getTriggers(): readonly TriggerOrder[] {
    return triggers;
}

export function useTriggers(): readonly TriggerOrder[] {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => triggers,
    );
}

function fireAlert(trigger: AlertTriggerOrder, lastPrice: number) {
    if (firingAlerts.has(trigger.id)) return;
    firingAlerts.add(trigger.id);
    try {
        if (!removeTrigger(trigger.id)) {
            notify({
                kind: 'err',
                title: '到價警示狀態未更新',
                body: `${trigger.code} 的警示無法安全移除，因此未標記為已觸發`,
            });
            return;
        }
        notify({
            kind: 'info',
            title: '🔔 到價警示',
            body: `${trigger.code} 現價 ${lastPrice} 已${trigger.condition === 'below' ? '跌破' : '突破'} ${trigger.price}（只通知，不下單）`,
        });
    } finally {
        firingAlerts.delete(trigger.id);
    }
}

let alertEngineUnsubscribe: (() => void) | null = null;
let alertEngineGeneration = 0;

/** Starts the single notification-only legacy authority. Idempotent. */
export function startLegacyAlertEngine(): () => void {
    if (alertEngineUnsubscribe) return stopLegacyAlertEngine;
    const generation = ++alertEngineGeneration;
    const unsubscribe = onAnyTick((tick) => {
        if (generation !== alertEngineGeneration) return;
        const price = Number(tick.close);
        if (!Number.isFinite(price)) return;
        for (const trigger of triggers) {
            // Disabled stop/take inventory is display-only.  Do not remove it,
            // infer OCO state, resolve a contract, or submit an order.
            if (trigger.kind !== 'alert' || trigger.code !== tick.code) continue;
            if (
                (trigger.condition === 'below' && price <= trigger.price) ||
                (trigger.condition === 'above' && price >= trigger.price)
            ) {
                fireAlert(trigger, price);
            }
        }
    });
    alertEngineUnsubscribe = () => unsubscribe();
    return stopLegacyAlertEngine;
}

/** Stops the alert-only listener. Idempotent and safe across restart cycles. */
export function stopLegacyAlertEngine() {
    alertEngineGeneration += 1;
    const unsubscribe = alertEngineUnsubscribe;
    alertEngineUnsubscribe = null;
    unsubscribe?.();
}
