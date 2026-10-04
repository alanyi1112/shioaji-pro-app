import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const root = style({
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    padding: 7,
    overflow: 'hidden',
    containerType: 'inline-size',
});

export const statusStrip = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
    gap: 3,
    '@media': {
        'screen and (max-height: 700px)': {
            display: 'flex',
            overflowX: 'auto',
            paddingBottom: 2,
            scrollbarWidth: 'thin',
        },
    },
});

export const statusSummary = style({
    display: 'grid',
    gap: 4,
});

export const statusGroup = style({
    display: 'grid',
    gap: 2,
});

export const statusGroupTitle = style({
    margin: 0,
    color: vars.color.mutedForeground,
    fontSize: '0.68rem',
    lineHeight: 1.15,
    fontWeight: 600,
});

export const metric = style({
    minWidth: 0,
    minHeight: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 5,
    padding: '3px 6px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 4,
    background: vars.color.background,
    '@media': {
        'screen and (max-height: 700px)': { flex: '0 0 max-content', minWidth: 104 },
    },
});

export const statusMetric = style({
    gridColumn: 'span 2',
});

export const providerEvidenceMetric = style({
    gridColumn: 'span 2',
    overflow: 'hidden',
});

export const metricLabel = style({
    minWidth: 0,
    color: vars.color.mutedForeground,
    fontSize: '0.7rem',
    lineHeight: 1.15,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

export const metricValue = style({
    minWidth: 0,
    flex: '0 1 auto',
    color: vars.color.foreground,
    fontSize: '0.82rem',
    lineHeight: 1.15,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
});

export const statusMetricValue = style({
    minWidth: 0,
    fontSize: '0.74rem',
    fontWeight: 600,
});

export const providerEvidenceMetricValue = style({
    minWidth: 0,
    flex: '1 1 auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontSize: '0.68rem',
});

export const notice = style({
    margin: 0,
    padding: '4px 7px',
    borderRadius: 4,
    border: `1px solid ${vars.color.border}`,
    color: vars.color.amber,
    background: vars.color.background,
    fontSize: '0.7rem',
    lineHeight: 1.3,
});

export const notificationControls = style({
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'center',
    gap: '2px 7px',
    padding: '4px 6px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 4,
    background: vars.color.background,
    '@container': { '(max-width: 340px)': { gridTemplateColumns: '1fr' } },
});
export const notificationButtons = style({
    gridRow: '1 / span 2',
    display: 'flex',
    gap: 4,
    flexWrap: 'nowrap',
    '@container': { '(max-width: 340px)': { gridRow: 'auto', flexWrap: 'wrap' } },
});
export const notificationButton = style({
    width: 'fit-content',
    padding: '3px 6px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 4,
    background: vars.color.panel,
    color: vars.color.foreground,
    fontSize: '0.66rem',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    touchAction: 'manipulation',
    selectors: {
        '&:hover:not(:disabled)': { borderColor: vars.color.accent },
        '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 1 },
        '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
    },
});
export const notificationState = style({ minWidth: 0, color: vars.color.mutedForeground, fontSize: '0.63rem', lineHeight: 1.2 });
export const notificationMessage = style({
    margin: 0,
    color: vars.color.mutedForeground,
    fontSize: '0.63rem',
    lineHeight: 1.2,
    '@container': { '(max-width: 340px)': { gridColumn: '1 / -1' } },
});

export const tabs = style({ display: 'flex', gap: 4, flexWrap: 'nowrap' });
export const tab = style({
    border: `1px solid ${vars.color.border}`,
    borderRadius: 999,
    background: vars.color.background,
    color: vars.color.mutedForeground,
    padding: '3px 8px',
    fontSize: '0.72rem',
    lineHeight: 1.25,
    cursor: 'pointer',
    touchAction: 'manipulation',
    selectors: {
        '&[aria-selected="true"]': { color: vars.color.foreground, borderColor: vars.color.accent },
        '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 1 },
    },
});

export const list = style({
    minHeight: 0,
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingRight: 2,
});
globalStyle(`${list} > *`, { flexShrink: 0 });

export const row = style({
    width: '100%',
    display: 'grid',
    gridTemplateColumns: 'minmax(88px, 1fr) auto',
    gap: 8,
    alignItems: 'center',
    padding: '8px 9px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 5,
    background: vars.color.background,
    color: vars.color.foreground,
    textAlign: 'left',
    cursor: 'pointer',
    selectors: { '&:hover': { borderColor: vars.color.accent }, '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 1 } },
});

export const rowTitle = style({ fontWeight: 700 });
export const rowMeta = style({ display: 'block', marginTop: 1, color: vars.color.mutedForeground, fontSize: '0.68rem' });
export const ratio = style({ color: vars.color.success, fontVariantNumeric: 'tabular-nums', fontWeight: 700 });
export const empty = style({ margin: 'auto', color: vars.color.mutedForeground, textAlign: 'center', lineHeight: 1.6, padding: 16 });
export const footer = style({ display: 'flex', justifyContent: 'space-between', gap: 8, color: vars.color.mutedForeground, fontSize: '0.7rem' });

export const editor = style({
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 7,
    border: `1px solid ${vars.color.border}`,
    borderRadius: 6,
    background: vars.color.background,
});

export const editorHeader = style({
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    color: vars.color.foreground,
    fontVariantNumeric: 'tabular-nums',
});

export const importGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 6,
    paddingTop: 6,
    '@container': { '(max-width: 380px)': { gridTemplateColumns: '1fr' } },
});

export const importDetails = style({
    borderTop: `1px dashed ${vars.color.border}`,
    paddingTop: 3,
});

export const importSummary = style({
    width: 'fit-content',
    color: vars.color.foreground,
    fontSize: '0.72rem',
    lineHeight: 1.3,
    cursor: 'pointer',
    touchAction: 'manipulation',
    selectors: { '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 2 } },
});

export const fieldLabel = style({
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    color: vars.color.mutedForeground,
    fontSize: '0.72rem',
});

export const inlineField = style({ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' });

export const searchField = style({ position: 'relative' });

export const suggestionBox = style({
    position: 'absolute',
    zIndex: 40,
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 3,
    padding: 3,
    border: `1px solid ${vars.color.borderBright}`,
    borderRadius: 5,
    background: vars.color.panelRaised,
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.34)',
});

export const suggestionRow = style({
    width: '100%',
    display: 'grid',
    gridTemplateColumns: 'minmax(4.6rem, auto) minmax(0, 1fr) auto',
    gap: 7,
    alignItems: 'center',
    padding: '6px 7px',
    border: 0,
    borderRadius: 3,
    background: 'transparent',
    color: vars.color.foreground,
    textAlign: 'left',
    cursor: 'pointer',
    selectors: {
        '&:hover': { background: vars.color.muted },
        '&[aria-selected="true"]': { background: vars.color.accentDim },
        '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: -1 },
    },
});

export const suggestionCode = style({ fontWeight: 700, fontVariantNumeric: 'tabular-nums' });
export const suggestionName = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
export const suggestionMarket = style({ color: vars.color.mutedForeground, fontSize: '0.68rem' });
export const searchHint = style({ margin: 0, color: vars.color.mutedForeground, fontSize: '0.68rem', lineHeight: 1.4 });

export const input = style({
    minWidth: 82,
    flex: 1,
    padding: '6px 7px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 4,
    background: vars.color.panel,
    color: vars.color.foreground,
    selectors: { '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 1, borderColor: vars.color.accent } },
});

export const textarea = style({
    width: '100%',
    minHeight: 42,
    resize: 'vertical',
    padding: '6px 7px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 4,
    background: vars.color.panel,
    color: vars.color.foreground,
    fontFamily: 'inherit',
    selectors: { '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 1, borderColor: vars.color.accent } },
});

export const smallButton = style({
    width: 'fit-content',
    padding: '5px 8px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 4,
    background: vars.color.panel,
    color: vars.color.foreground,
    cursor: 'pointer',
    touchAction: 'manipulation',
    selectors: {
        '&:hover:not(:disabled)': { borderColor: vars.color.accent },
        '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 1 },
        '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
    },
});

export const primaryButton = style([smallButton, {
    marginLeft: 'auto',
    padding: '3px 6px',
    borderColor: vars.color.accent,
    background: vars.color.accentDim,
    fontSize: '0.66rem',
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
}]);

export const importReport = style({
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    color: vars.color.mutedForeground,
    fontSize: '0.72rem',
    fontVariantNumeric: 'tabular-nums',
});

export const editorMessage = style({ margin: 0, color: vars.color.mutedForeground, fontSize: '0.72rem', lineHeight: 1.45 });
export const conflict = style([editorMessage, { color: vars.color.danger }]);
export const saveBar = style({ display: 'flex', alignItems: 'center', gap: 6 });

export const editRow = style({
    display: 'grid',
    gridTemplateColumns: 'minmax(130px, 1fr) auto auto auto',
    gap: 4,
    alignItems: 'center',
    padding: '4px 5px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 5,
    background: vars.color.background,
    '@container': { '(max-width: 400px)': { gridTemplateColumns: 'minmax(120px, 1fr) auto', rowGap: 3 } },
});

export const symbolButton = style({
    minWidth: 0,
    display: 'flex',
    alignItems: 'baseline',
    gap: 5,
    overflow: 'hidden',
    padding: 0,
    border: 0,
    background: 'transparent',
    color: vars.color.foreground,
    textAlign: 'left',
    cursor: 'pointer',
    touchAction: 'manipulation',
    selectors: { '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 2 } },
});

export const editRowTitle = style({
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.82rem',
    fontWeight: 700,
    lineHeight: 1.15,
});
export const editRowMeta = style({ flex: 'none', color: vars.color.mutedForeground, fontSize: '0.62rem', lineHeight: 1.15, whiteSpace: 'nowrap' });
export const toggleLabel = style({ display: 'flex', gap: 3, alignItems: 'center', color: vars.color.mutedForeground, fontSize: '0.66rem', whiteSpace: 'nowrap' });
export const thresholdLabel = style({ display: 'flex', gap: 3, alignItems: 'center', color: vars.color.mutedForeground, fontSize: '0.66rem', whiteSpace: 'nowrap' });
export const thresholdInput = style([input, { width: 42, minWidth: 42, flex: 'none', padding: '2px 4px', fontSize: '0.7rem', lineHeight: 1.15 }]);
export const rowActions = style({ display: 'flex', gap: 2, justifyContent: 'flex-end' });
export const iconButton = style([smallButton, { minWidth: 24, padding: '2px 5px', fontSize: '0.72rem', lineHeight: 1.15 }]);

export const resultToolbar = style({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    padding: '4px 2px',
    color: vars.color.foreground,
});
export const resultControls = style({
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '4px 2px',
});
export const chartTargetBar = style({
    display: 'flex',
    alignItems: 'end',
    gap: 6,
    flexWrap: 'wrap',
});
export const resultSortLabel = style({ display: 'flex', alignItems: 'center', gap: 5, color: vars.color.mutedForeground, fontSize: '0.72rem' });

export const sortSelect = style({
    padding: '4px 6px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 4,
    background: vars.color.panel,
    color: vars.color.foreground,
    selectors: { '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 1 } },
});

export const resultCard = style({
    border: `1px solid ${vars.color.border}`,
    borderRadius: 6,
    background: vars.color.background,
    overflow: 'hidden',
    selectors: {
        '&[data-kind="live"]': { borderLeft: `3px solid ${vars.color.success}` },
        '&[data-kind="historical"]': { borderLeft: `3px solid ${vars.color.mutedForeground}` },
    },
});

export const resultTop = style({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'stretch',
});

export const resultMain = style({
    width: '100%',
    display: 'grid',
    gridTemplateColumns: 'minmax(100px, 1fr) auto',
    gap: 8,
    alignItems: 'center',
    padding: '9px',
    border: 0,
    background: 'transparent',
    color: vars.color.foreground,
    textAlign: 'left',
    cursor: 'pointer',
    touchAction: 'manipulation',
    selectors: {
        '&:hover': { background: vars.color.accentDim },
        '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: -2 },
        '&:disabled': { cursor: 'not-allowed', opacity: 0.6 },
    },
});

export const addButton = style({
    alignSelf: 'start',
    margin: 7,
    padding: '6px 8px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 4,
    background: vars.color.panel,
    color: vars.color.foreground,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    touchAction: 'manipulation',
    selectors: {
        '&:hover:not(:disabled)': { borderColor: vars.color.accent, background: vars.color.accentDim },
        '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 1 },
        '&:disabled': { opacity: 0.62, cursor: 'not-allowed' },
    },
});

export const addStatus = style({
    margin: '0 9px 7px',
    color: vars.color.success,
    fontSize: '0.72rem',
});

export const addError = style([addStatus, { color: vars.color.danger }]);

export const ratioBlock = style({ textAlign: 'right', fontVariantNumeric: 'tabular-nums' });
export const evidenceDetails = style({
    borderTop: `1px solid ${vars.color.border}`,
    padding: '6px 9px 8px',
    color: vars.color.mutedForeground,
    fontSize: '0.72rem',
});
export const evidenceSummary = style({
    cursor: 'pointer',
    color: vars.color.foreground,
    touchAction: 'manipulation',
    selectors: { '&:focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 2 } },
});
export const evidenceGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '5px 10px',
    margin: '7px 0 0',
    '@container': { '(max-width: 480px)': { gridTemplateColumns: '1fr' } },
});
export const evidenceEntry = style({ minWidth: 0 });
export const evidenceTerm = style({ color: vars.color.mutedForeground });
export const evidenceValue = style({ margin: '1px 0 0', color: vars.color.foreground, overflowWrap: 'anywhere' });

export const itemEvidence = style({
    gridColumn: '1 / -1',
    display: 'flex',
    gap: '1px 6px',
    flexWrap: 'wrap',
    paddingTop: 2,
    borderTop: `1px dashed ${vars.color.border}`,
    color: vars.color.mutedForeground,
    fontSize: '0.62rem',
    lineHeight: 1.15,
});
export const itemState = style({ color: vars.color.foreground });
