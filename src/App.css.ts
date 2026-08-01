// src/App.css.ts — app shell

import { style } from '@vanilla-extract/css';
import { vars } from './theme.css';

export const shell = style({
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: vars.color.background,
});

export const blockPlaceholder = style({
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: vars.color.mutedForeground,
    fontSize: '0.72rem',
});

export const loading = style({
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: vars.space.md,
    fontFamily: vars.font.display,
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: vars.color.mutedForeground,
});

export const serviceNotice = style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: vars.space.md,
    padding: `8px ${vars.space.md}`,
    flexShrink: 0,
    color: vars.color.amber,
    background: 'rgba(224, 164, 60, 0.09)',
    borderBottom: '1px solid rgba(224, 164, 60, 0.35)',
});

export const serviceNoticeText = style({
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: vars.space.sm,
    fontSize: '0.72rem',
    lineHeight: 1.45,
});

export const serviceRetryButton = style({
    flexShrink: 0,
    padding: '4px 10px',
    borderRadius: vars.radius.sm,
    border: '1px solid rgba(224, 164, 60, 0.55)',
    background: 'rgba(224, 164, 60, 0.12)',
    color: vars.color.amber,
    fontFamily: vars.font.display,
    fontSize: '0.68rem',
    fontWeight: 600,
    cursor: 'pointer',
    selectors: {
        '&:hover:not(:disabled)': {
            background: 'rgba(224, 164, 60, 0.2)',
        },
        '&:disabled': {
            cursor: 'wait',
            opacity: 0.6,
        },
    },
});
