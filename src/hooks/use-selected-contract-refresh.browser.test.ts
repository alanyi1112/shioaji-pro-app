import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSelectedContractRefresh } from './use-selected-contract-refresh';
import type { ContractInfo } from '../lib/types/contract';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const old = { code: '3380', name: 'fixture', security_type: 'STK', exchange: 'TSE', reference: 10 } as ContractInfo;
const fresh = { ...old, reference: 11 };
const items = [{ contract: old }];

it.each([
    ['清單外選取仍採新cache', old, [], fresh, false, 'none', fresh],
    ['沒有cache時保留清單更新', old, [{ contract: fresh }], undefined, true, 'none', fresh],
    ['舊清單不得搶回新cache', fresh, items, fresh, true, 'none', fresh],
    ['cache不同商品不得改選', old, [], { ...fresh, code: '2330' }, false, 'none', old],
    ['cache不同市場不得改選', old, [], { ...fresh, exchange: 'OTC' }, false, 'none', old],
    ['metadata-only不選第一檔', null, items, undefined, false, 'none', null],
    ['HMR解析期間不選第一檔', null, items, undefined, true, 'pending', null],
    ['一般首次載入保留原首檔', null, items, undefined, true, 'none', old],
] as const)('%s', async (_name, initial, list, cache, fallback, restore, expected) => {
    let selected: ContractInfo | null = null;
    function Harness() {
        const [value, setValue] = useState<ContractInfo | null>(initial);
        selected = value;
        useSelectedContractRefresh(value, setValue, list, cache, fallback, restore);
        return null;
    }
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(Harness)));
        expect(selected).toBe(expected);
        await act(async () => root.render(createElement(Harness)));
        expect(selected).toBe(expected);
    } finally { await act(async () => root.unmount()); host.remove(); }
});

it('cache再次更新只更新同商品metadata，穩定後不額外回寫', async () => {
    let cache = fresh, selected: ContractInfo | null = null;
    const list = [{ contract: old }];
    function Harness() {
        const [value, setValue] = useState<ContractInfo | null>(old);
        selected = value;
        useSelectedContractRefresh(value, setValue, list, cache, false, 'none');
        return null;
    }
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(Harness)));
        expect(selected).toBe(fresh);
        cache = { ...fresh, reference: 12 };
        await act(async () => root.render(createElement(Harness)));
        expect(selected).toBe(cache);
        await act(async () => root.render(createElement(Harness)));
        expect(selected).toBe(cache);
    } finally { await act(async () => root.unmount()); host.remove(); }
});

it('自選清單舊物件與Contract cache新物件不得互相覆寫成React循環', async () => {
    let commits = 0;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Harness() {
        const [selected, rawSet] = useState<ContractInfo | null>(old);
        const [setSelected] = useState(() => ((value: React.SetStateAction<ContractInfo | null>) => {
            if (++commits > 110) throw Error('bounded-selection-loop; maximum-depth-warning=' +
                errors.mock.calls.flat().map(String).some(text => text.includes('Maximum update depth')));
            rawSet(value);
        }));
        useSelectedContractRefresh(selected, setSelected, items, fresh, true, 'none');
        return createElement('output', null, selected?.reference);
    }
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(Harness)));
        expect(host.textContent).toBe('11');
        expect(commits).toBeLessThan(4);
        expect(errors.mock.calls.flat().map(String).join('\n')).not.toContain('Maximum update depth');
    } finally { await act(async () => root.unmount()); host.remove(); errors.mockRestore(); }
});
