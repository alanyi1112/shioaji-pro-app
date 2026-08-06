import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const page = style({
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    background: vars.color.background,
    color: vars.color.foreground,
});

export const card = style({
    width: 'min(680px, 100%)',
    padding: 28,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.lg,
    background: vars.color.panel,
    boxShadow: '0 18px 60px rgba(0, 0, 0, 0.28)',
});

export const eyebrow = style({
    color: vars.color.mutedForeground,
    fontSize: '0.72rem',
    letterSpacing: '0.08em',
});

export const title = style({ margin: '12px 0 8px', fontSize: '1.5rem' });
export const detail = style({ margin: 0, color: vars.color.mutedForeground, lineHeight: 1.6 });

export const statusGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
    margin: '22px 0',
    '@media': {
        'screen and (max-width: 560px)': { gridTemplateColumns: '1fr' },
    },
});

export const reason = style({ color: vars.color.amber, fontSize: '0.78rem' });
export const actions = style({ display: 'flex', gap: 10, marginTop: 18 });
export const help = style({ marginTop: 18, color: vars.color.mutedForeground, lineHeight: 1.55 });
