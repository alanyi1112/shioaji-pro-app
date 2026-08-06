import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const board = style({
    containerType: 'inline-size',
    width: '100%',
    minWidth: 0,
    flexShrink: 0,
    borderBottom: `1px solid ${vars.color.border}`,
});

export const boardLayout = style({
    display: 'grid',
    gridTemplateColumns: 'minmax(15rem, 0.72fr) minmax(0, 1.28fr)',
    alignItems: 'center',
    gap: `clamp(0.35rem, 1cqi, ${vars.space.md})`,
    minWidth: 0,
    padding: `${vars.space.sm} ${vars.space.md}`,
    '@container': {
        '(max-width: 780px)': {
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: vars.space.sm,
        },
        '(max-width: 42rem)': {
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: vars.space.sm,
        },
    },
});

export const hero = style({
    display: 'grid',
    gridTemplateColumns: 'max-content max-content max-content',
    alignItems: 'center',
    justifyContent: 'start',
    gap: `clamp(0.25rem, 0.7cqi, ${vars.space.sm})`,
    minWidth: 0,
    '@container': {
        '(max-width: 480px)': {
            gap: `clamp(0.25rem, 1cqi, ${vars.space.sm})`,
        },
        '(max-width: 330px)': {
            gridTemplateColumns: 'max-content minmax(0, auto)',
        },
    },
});

export const symbolBlock = style({
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
});

export const symbolCode = style({
    fontFamily: vars.font.display,
    fontSize: 'clamp(0.92rem, 2.6cqi, 1.15rem)',
    fontWeight: 700,
    letterSpacing: '0.01em',
    color: vars.color.foreground,
    whiteSpace: 'nowrap',
});

export const symbolName = style({
    fontSize: '0.72rem',
    color: vars.color.mutedForeground,
    whiteSpace: 'nowrap',
});

export const priceBlock = style({
    display: 'inline-flex',
    alignItems: 'center',
    gap: vars.space.sm,
    minWidth: 0,
    whiteSpace: 'nowrap',
});

const bigPriceBase = style({
    fontFamily: vars.font.mono,
    fontSize: 'clamp(1.35rem, 5cqi, 1.9rem)',
    fontWeight: 600,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
});

export const bigPrice = styleVariants({
    up: [bigPriceBase, { color: vars.color.up }],
    down: [bigPriceBase, { color: vars.color.down }],
    flat: [bigPriceBase, { color: vars.color.flat }],
});

export const changeBlock = style({
    display: 'flex',
    flexDirection: 'column',
    fontFamily: vars.font.mono,
    fontSize: 'clamp(0.68rem, 2cqi, 0.82rem)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    '@container': {
        '(max-width: 330px)': {
            gridColumn: '2',
        },
    },
});

export const statGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    alignItems: 'baseline',
    gap: `4px clamp(0.25rem, 0.7cqi, ${vars.space.sm})`,
    minWidth: 0,
    fontFamily: vars.font.mono,
    fontSize: '0.72rem',
    fontVariantNumeric: 'tabular-nums',
    '@container': {
        '(max-width: 480px)': {
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        },
        '(max-width: 28rem)': {
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        },
        '(max-width: 270px)': {
            gridTemplateColumns: 'minmax(0, 1fr)',
        },
    },
});

export const statMetric = style({
    display: 'inline-flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 'clamp(0.2rem, 0.4cqi, 0.32rem)',
    minWidth: 0,
    whiteSpace: 'nowrap',
});

export const statLabel = style({
    flex: '0 0 auto',
    fontFamily: vars.font.display,
    color: vars.color.mutedForeground,
    fontSize: '0.66rem',
    fontWeight: 500,
});

const statValueBase = style({
    flex: '0 0 auto',
    minWidth: '4.2ch',
    textAlign: 'right',
});

export const statValue = styleVariants({
    neutral: [statValueBase, { color: vars.color.foreground }],
    up: [statValueBase, { color: vars.color.up }],
    down: [statValueBase, { color: vars.color.down }],
    flat: [statValueBase, { color: vars.color.flat }],
});

const limitBadgeBase = style({
    flex: '0 0 auto',
    fontFamily: vars.font.display,
    fontSize: '0.6rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    color: '#fff',
    borderRadius: vars.radius.sm,
    padding: '2px 6px',
});

export const limitBadge = styleVariants({
    up: [limitBadgeBase, { background: vars.color.up }],
    down: [limitBadgeBase, { background: vars.color.down }],
});
