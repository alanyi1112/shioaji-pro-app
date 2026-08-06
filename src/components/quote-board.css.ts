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
    gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1.2fr)',
    alignItems: 'center',
    columnGap: `clamp(0.75rem, 1.3cqi, 1.25rem)`,
    rowGap: vars.space.sm,
    minWidth: 0,
    padding: `${vars.space.sm} ${vars.space.md}`,
    '@container': {
        '(max-width: 780px)': {
            gridTemplateColumns: 'minmax(0, 1fr)',
            columnGap: vars.space.sm,
            rowGap: vars.space.sm,
        },
        '(max-width: 42rem)': {
            gridTemplateColumns: 'minmax(0, 1fr)',
            columnGap: vars.space.sm,
            rowGap: vars.space.sm,
        },
    },
});

export const hero = style({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) max-content',
    gridTemplateRows: 'auto auto',
    alignItems: 'baseline',
    columnGap: `clamp(0.25rem, 0.7cqi, ${vars.space.sm})`,
    rowGap: '2px',
    width: '100%',
    minWidth: 0,
    '@container': {
        '(max-width: 480px)': {
            columnGap: `clamp(0.25rem, 1cqi, ${vars.space.sm})`,
        },
        '(max-width: 330px)': {
            gridTemplateColumns: 'minmax(0, 1fr)',
            rowGap: '1px',
        },
    },
});

export const symbolCode = style({
    gridColumn: '1',
    gridRow: '1',
    minWidth: 0,
    alignSelf: 'baseline',
    fontFamily: vars.font.display,
    fontSize: 'clamp(0.92rem, 2.6cqi, 1.15rem)',
    fontWeight: 700,
    letterSpacing: '0.01em',
    color: vars.color.foreground,
    whiteSpace: 'nowrap',
    '@container': {
        '(max-width: 330px)': {
            gridColumn: '1',
            gridRow: '1',
        },
    },
});

export const symbolName = style({
    gridColumn: '1',
    gridRow: '2',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    alignSelf: 'baseline',
    fontSize: '0.72rem',
    color: vars.color.mutedForeground,
    whiteSpace: 'nowrap',
    '@container': {
        '(max-width: 330px)': {
            gridColumn: '1',
            gridRow: '3',
        },
    },
});

export const priceBlock = style({
    gridColumn: '2',
    gridRow: '1',
    display: 'inline-flex',
    alignItems: 'baseline',
    justifySelf: 'end',
    gap: `clamp(0.25rem, 0.7cqi, ${vars.space.sm})`,
    minWidth: 0,
    whiteSpace: 'nowrap',
    '@container': {
        '(max-width: 330px)': {
            gridColumn: '1',
            gridRow: '2',
        },
    },
});

const bigPriceBase = style({
    fontFamily: vars.font.mono,
    fontSize: 'clamp(1.35rem, 5cqi, 1.9rem)',
    fontWeight: 600,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    minWidth: 0,
    whiteSpace: 'nowrap',
});

export const bigPrice = styleVariants({
    up: [bigPriceBase, { color: vars.color.up }],
    down: [bigPriceBase, { color: vars.color.down }],
    flat: [bigPriceBase, { color: vars.color.flat }],
});

export const changeBlock = style({
    gridColumn: '2',
    gridRow: '2',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifySelf: 'end',
    gap: vars.space.xs,
    fontFamily: vars.font.mono,
    fontSize: 'clamp(0.68rem, 2cqi, 0.82rem)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    '@container': {
        '(max-width: 330px)': {
            gridColumn: '1',
            gridRow: '4',
        },
    },
});

export const statGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    alignItems: 'baseline',
    rowGap: '4px',
    columnGap: `clamp(0.18rem, 0.35cqi, 0.42rem)`,
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
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 1fr)',
    alignItems: 'baseline',
    columnGap: 'clamp(0.14rem, 0.25cqi, 0.22rem)',
    minWidth: 0,
    whiteSpace: 'nowrap',
    '@container': {
        '(max-width: 480px)': {
            columnGap: 'clamp(0.2rem, 0.4cqi, 0.32rem)',
        },
        '(max-width: 28rem)': {
            columnGap: 'clamp(0.2rem, 0.4cqi, 0.32rem)',
        },
    },
});

export const statLabel = style({
    minWidth: 0,
    fontFamily: vars.font.display,
    color: vars.color.mutedForeground,
    fontSize: '0.66rem',
    fontWeight: 500,
});

const statValueBase = style({
    minWidth: '4.2ch',
    textAlign: 'right',
    justifySelf: 'stretch',
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
