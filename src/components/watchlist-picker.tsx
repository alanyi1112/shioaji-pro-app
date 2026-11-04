import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServerWatchlist } from '../lib/shioaji';
import { openWatchlistWindow } from '../lib/watchlist-window';
import * as styles from './watchlist.css';

// Keep the menu mounted until the single/double click decision is complete.
const DOUBLE_CLICK_MS = 500;

export function WatchlistPicker({ lists, activeId, onSelect }: {
    lists: ServerWatchlist[];
    activeId: string;
    onSelect: (id: string) => void;
}) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const pending = useRef<{ id: string; at: number; timer: ReturnType<typeof setTimeout> } | null>(null);
    const [anchor, setAnchor] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
    const [focused, setFocused] = useState(activeId);
    const cancelPending = () => {
        if (pending.current) clearTimeout(pending.current.timer);
        pending.current = null;
    };
    const close = (restoreFocus = false) => {
        cancelPending();
        setAnchor(null);
        if (restoreFocus) trigger.current?.focus();
    };
    const choose = (listId: string) => { close(true); onSelect(listId); };
    const open = () => {
        const rect = trigger.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
        const below = window.innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const upwards = below < 180 && above > below;
        const maxHeight = Math.max(60, Math.min(320, upwards ? above : below));
        setFocused(lists.some(list => list.id === activeId) ? activeId : lists[0]?.id ?? '');
        setAnchor({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
            ...(upwards ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }), width, maxHeight });
    };
    useEffect(() => {
        if (!anchor) return;
        const outside = (event: Event) => {
            const target = event.target as Node;
            if (!trigger.current?.contains(target) && !menu.current?.contains(target)) close();
        };
        const moved = (event: Event) => {
            if (menu.current?.contains(event.target as Node)) return;
            close();
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('focusin', outside, true);
        window.addEventListener('resize', moved);
        window.addEventListener('scroll', moved, true);
        return () => { document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('focusin', outside, true);
            window.removeEventListener('resize', moved); window.removeEventListener('scroll', moved, true); cancelPending(); };
    }, [anchor]);
    useEffect(() => {
        if (anchor) menu.current?.querySelector<HTMLElement>(`[data-focused="true"]`)?.focus();
    }, [anchor, focused]);
    useEffect(() => () => cancelPending(), []);

    return <>
        <button ref={trigger} type='button' className={styles.listSelect}
            aria-label='選擇自選清單' aria-haspopup='listbox' aria-expanded={!!anchor} aria-controls={anchor ? id : undefined}
            title='左鍵單擊切換清單；左鍵雙擊在新分頁開啟'
            onClick={() => anchor ? close() : open()}
            onKeyDown={event => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
            }}>
            <span className={styles.listPickerName}>{(() => {
                const active = lists.find(list => list.id === activeId);
                return active ? `${active.name}（${active.contracts.length}）` : '選擇清單';
            })()}</span><ChevronDown size={12} />
        </button>
        {anchor && createPortal(<div ref={menu} id={id} role='listbox' aria-label='自選清單'
            className={styles.listPickerMenu} style={anchor}
            onBlur={event => {
                const next = event.relatedTarget as Node | null;
                if (next && !event.currentTarget.contains(next) && !trigger.current?.contains(next)) close();
            }} onKeyDown={event => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const index = lists.findIndex(list => list.id === focused);
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? lists.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + lists.length) % lists.length;
                    if (lists[next]) setFocused(lists[next].id);
                }
            }}>
            {lists.map(list => <button key={list.id} type='button' role='option' aria-selected={list.id === activeId}
                tabIndex={list.id === focused ? 0 : -1} data-focused={list.id === focused}
                className={styles.listPickerOption} onFocus={() => setFocused(list.id)}
                onClick={event => {
                    if (event.button !== 0) return;
                    // Keyboard activation has no click count and need not wait for a double click.
                    if (event.detail === 0) { choose(list.id); return; }
                    const previous = pending.current, at = performance.now();
                    cancelPending();
                    if (previous?.id === list.id && at - previous.at <= DOUBLE_CLICK_MS) {
                        openWatchlistWindow(list.id);
                        close();
                    } else {
                        pending.current = { id: list.id, at,
                            timer: setTimeout(() => choose(list.id), DOUBLE_CLICK_MS) };
                    }
                }}>{list.name}（{list.contracts.length}）</button>)}
        </div>, document.body)}
    </>;
}
