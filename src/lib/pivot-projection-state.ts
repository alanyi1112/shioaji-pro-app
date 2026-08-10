import type { ContractBase } from './types/contract';
import type { PivotReferenceDay } from './traditional-pivot';

export interface ProductPivotProjectionState {
    key: string;
    indicatorId: string;
    reference: PivotReferenceDay;
    pinned: boolean;
}

const states = new Map<string, ProductPivotProjectionState>();
const listeners = new Set<() => void>();
let version = 0;

function normalizedPart(value: unknown, fallback: string): string {
    return String(value ?? fallback).trim().toUpperCase() || fallback;
}

export function pivotProductKey(
    indicatorId: string,
    contract: Pick<ContractBase, 'security_type' | 'exchange' | 'code'>,
): string {
    const id = String(indicatorId || '').trim();
    const code = normalizedPart(contract.code, '');
    if (!id || !code) return '';
    return [
        id,
        normalizedPart(contract.security_type, 'AUTO'),
        normalizedPart(contract.exchange, 'UNKNOWN'),
        code,
    ].join('|');
}

function stateSignature(state: ProductPivotProjectionState | undefined) {
    if (!state) return '';
    const reference = state.reference;
    return JSON.stringify([
        state.key,
        state.indicatorId,
        state.pinned,
        reference.date,
        reference.status,
        reference.applicationDate,
        reference.firstTime,
        reference.lastTime,
        reference.levels,
    ]);
}

export function getPivotProductState(
    key: string,
): ProductPivotProjectionState | null {
    return states.get(key) ?? null;
}

export function setPivotProductState(
    state: ProductPivotProjectionState,
): void {
    if (!state.key || stateSignature(states.get(state.key)) === stateSignature(state)) {
        return;
    }
    states.set(state.key, state);
    version += 1;
    listeners.forEach((listener) => listener());
}

export function clearPivotProductState(key: string): void {
    if (!states.delete(key)) return;
    version += 1;
    listeners.forEach((listener) => listener());
}

export function clearPivotStatesForIndicator(indicatorId: string): void {
    let changed = false;
    for (const [key, state] of states) {
        if (state.indicatorId !== indicatorId) continue;
        states.delete(key);
        changed = true;
    }
    if (!changed) return;
    version += 1;
    listeners.forEach((listener) => listener());
}

export function subscribePivotProductStates(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getPivotProductStateVersion(): number {
    return version;
}
