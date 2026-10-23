import { useEffect, useRef, type ReactNode } from 'react';

/** Non-modal: close on outside pointerdown without intercepting its target. */
export function DismissiblePopover({ children, className, label, triggerSelector, onClose }: {
    children: ReactNode;
    className: string;
    label?: string;
    triggerSelector: string;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDivElement>(null);
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        const document = element.ownerDocument;
        const trigger = element.parentElement?.querySelector<HTMLElement>(triggerSelector);
        const inside = (event: Event) => {
            const route = event.composedPath();
            return route.includes(element) || Boolean(trigger && route.includes(trigger));
        };
        const outside = (event: PointerEvent) => {
            if (inside(event)) return;
            // Do not preventDefault/stopPropagation or synthesize another click.
            close.current();
        };
        const focusOutside = (event: FocusEvent) => {
            if (!inside(event)) close.current();
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            close.current();
            trigger?.focus({ preventScroll: true });
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('focusin', focusOutside, true);
        document.addEventListener('keydown', escape, true);
        return () => {
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('focusin', focusOutside, true);
            document.removeEventListener('keydown', escape, true);
        };
    }, [triggerSelector]);
    return <div ref={dialog} className={className} role='dialog' aria-label={label}>{children}</div>;
}
