import type { SupportResistanceReference } from './support-resistance';
import type { ContractBase } from './types/contract';

export interface ProductSupportResistanceState {
    key: string;
    reference: SupportResistanceReference;
    pinned: boolean;
}

const states = new Map<string, ProductSupportResistanceState>();
const listeners = new Set<() => void>();
let version = 0;

function normalizedPart(value: unknown, fallback: string): string {
    return String(value ?? fallback).trim().toUpperCase() || fallback;
}

export function supportResistanceProductKey(
    contract: Pick<ContractBase, 'security_type' | 'exchange' | 'code'>,
): string {
    const code = normalizedPart(contract.code, '');
    if (!code) return '';
    return [
        normalizedPart(contract.security_type, 'AUTO'),
        normalizedPart(contract.exchange, 'UNKNOWN'),
        code,
    ].join('|');
}

function signature(state: ProductSupportResistanceState | undefined): string {
    return state
        ? JSON.stringify([
              state.key,
              state.pinned,
              state.reference.date,
              state.reference.high,
              state.reference.low,
              state.reference.close,
              state.reference.firstTime,
              state.reference.lastTime,
              state.reference.status,
              state.reference.mode,
          ])
        : '';
}

export function getSupportResistanceProductState(
    key: string,
): ProductSupportResistanceState | null {
    return states.get(key) ?? null;
}

export function setSupportResistanceProductState(
    state: ProductSupportResistanceState,
): void {
    if (!state.key || signature(states.get(state.key)) === signature(state)) return;
    states.set(state.key, state);
    version += 1;
    listeners.forEach((listener) => listener());
}

export function clearSupportResistanceProductState(key: string): void {
    if (!states.delete(key)) return;
    version += 1;
    listeners.forEach((listener) => listener());
}

export function subscribeSupportResistanceProductStates(
    listener: () => void,
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getSupportResistanceProductStateVersion(): number {
    return version;
}

export function resetSupportResistanceProductStatesForTests(): void {
    states.clear();
    listeners.clear();
    version = 0;
}
