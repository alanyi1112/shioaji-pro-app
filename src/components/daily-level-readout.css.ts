import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';
export const details = style({ position: 'relative', pointerEvents: 'auto', whiteSpace: 'normal' });
export const summary = style({ cursor: 'pointer', color: vars.color.foreground });
export const popover = style({ position: 'absolute', zIndex: 20, minWidth: 245, maxWidth: 'min(340px, 75vw)', padding: 10,
    background: vars.color.background, color: vars.color.foreground, border: `1px solid ${vars.color.border}`,
    borderRadius: 6, fontSize: 12, maxHeight: 'min(340px, 60vh)', overflowY: 'auto' });
