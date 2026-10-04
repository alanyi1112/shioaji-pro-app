/** 只在同日同母體且已驗證 v7 mapping 的固定底稿上判定舊分支。 */
import { effectiveCriteria, screenStocks, type Verdict } from '../../../src/lib/stock-screener-domain.ts';
import { selectStoredFractal, selectStoredBoll } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { evaluateMaCriteria, selectStoredDivergence } from '../../../src/lib/stock-screener-v4.ts';
import { evaluateChipCriteria } from '../../../src/lib/stock-screener-v5.ts';
import { evaluateInstitutionalCriteriaV6 } from '../../../src/lib/stock-screener-v6.ts';
import { evaluateTechnicalCriteriaV7, combineCriteriaV7, type CriteriaV7 } from '../../../src/lib/stock-screener-v7.ts';
import { readScreenerV7Snapshot } from './stock-screener-v7-repository.ts';
import type { ScreenerDatabase } from './stock-screener-repository.ts';

export const enabledLegacyBranches = (c: CriteriaV7) => Object.entries(c).filter(([key, value]) => key !== 'mode'
  && value && typeof value === 'object' && 'enabled' in value && value.enabled).map(([key]) => key);
export async function readBollingerLegacyJoin(db: ScreenerDatabase, criteria: CriteriaV7,
  date: string, universeRevision: string, symbols: string[]) {
  const enabled = enabledLegacyBranches(criteria);
  if (!enabled.length) return null;
  const unknown = { snapshotId: null, reason: 'same_session_legacy_pending', enabled,
    rows: Object.fromEntries(symbols.map(symbol => [symbol, { verdict: 'unknown' as Verdict, evidence: null }])) };
  // 舊 schema 或破損舊底稿只令舊分支 unknown，不遮蔽已合法發布的純價量結果。
  const columns = (await db.prepare('PRAGMA table_info(screener_snapshots)').all<{ name: string }>()).results ?? [];
  if (!columns.some(c => c.name === 'schema_version')) return unknown;
  let snapshot;
  try { snapshot = await readScreenerV7Snapshot(db); }
  catch (e) { if (e instanceof Error && /^invalid_.*snapshot$/.test(e.message)) return unknown; throw e; }
  if (!snapshot || snapshot.metadata.effectiveSessionDate !== date || snapshot.metadata.universeRevision !== universeRevision
    || snapshot.inputs.length !== symbols.length || snapshot.inputs.some(r => !symbols.includes(r.symbol))) return unknown;
  const compatible = criteria.volume.enabled || criteria.holder.enabled ? criteria
    : { ...criteria, volume: { ...criteria.volume, enabled: true } };
  const base = screenStocks(snapshot.inputs, snapshot.metadata.anchors, effectiveCriteria(compatible)).rows;
  const rows = Object.fromEntries(snapshot.inputs.map((input, index) => {
    const legacy = { volume: base[index]?.volume?.verdict, holder: base[index]?.holder?.verdict,
      fractal: criteria.fractal.enabled ? selectStoredFractal(input.technical, criteria.fractal).verdict : undefined,
      bollReversal: criteria.bollReversal.enabled ? selectStoredBoll(input.technical, criteria.bollReversal).verdict : undefined,
      ma: criteria.ma.enabled ? evaluateMaCriteria(input.technicalV4.ma, criteria.ma).verdict : undefined,
      divergence: criteria.divergence.enabled ? selectStoredDivergence(input.technicalV4.divergence, criteria.divergence).verdict : undefined };
    const chip = evaluateChipCriteria(input.chipV5, criteria), institutional = evaluateInstitutionalCriteriaV6(input.institutionalV6, criteria);
    const technical = evaluateTechnicalCriteriaV7(input.technicalV7, criteria);
    return [input.symbol, { verdict: combineCriteriaV7(criteria, legacy, chip, institutional, technical),
      evidence: { legacy, chip, institutional, technical } }];
  }));
  return { snapshotId: snapshot.id, reason: 'none', enabled, rows };
}
