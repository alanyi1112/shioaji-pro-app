import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from './theme.css';

export const page = style({
    boxSizing: 'border-box',
    height: '100dvh',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: 12,
    gap: 10,
    background: vars.color.background,
    color: vars.color.foreground,
});

export const header = style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    padding: '0 4px',
});
globalStyle(`${header} h1`, { margin: 0, fontSize: '1.2rem' });
globalStyle(`${header} p`, { margin: '2px 0 0', color: vars.color.mutedForeground });

export const panel = style({
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 6,
    background: vars.color.panel,
});

export const connected = style({ color: vars.color.success });
export const disconnected = style({ color: vars.color.amber });
