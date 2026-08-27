import { useState } from 'react';
import * as styles from './hud-header.css';

export function Menu({
    label,
    children,
}: {
    label: React.ReactNode;
    children: (close: () => void) => React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    return (
        <div className={styles.settingsWrap}>
            <button
                className={styles.resetBtn}
                aria-haspopup='dialog'
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            >
                {label}
            </button>
            {open && (
                <>
                    <div
                        className={styles.popoverBackdrop}
                        onClick={() => setOpen(false)}
                    />
                    <div
                        className={styles.popover}
                        role='dialog'
                        aria-label={
                            typeof label === 'string' ? label : undefined
                        }
                    >
                        {children(() => setOpen(false))}
                    </div>
                </>
            )}
        </div>
    );
}
