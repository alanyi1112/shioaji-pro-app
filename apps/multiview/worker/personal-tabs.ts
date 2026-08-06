export type TabSource = "system" | "personal" | "personal-override";

export type UserTabRow = {
  id: string;
  label: string;
  sort_order: number;
  enabled: number;
  is_default: number;
  source_tab_id?: string | null;
  updated_at?: string | null;
};

export type SystemTabSeed = {
  id: string;
  label: string;
  displayLabel: string;
  sortOrder: number;
  enabled: boolean;
  isDefault?: boolean;
  source: "system";
  defaultSymbols: string[];
};

export type ManagedTab = {
  tabKey: string;
  id: string;
  label: string;
  displayLabel: string;
  sortOrder: number;
  enabled: boolean;
  isDefault: boolean;
  source: TabSource;
  sourceTabId: string;
  defaultSymbols: string[];
  overrideRowId: string;
  hasOverride: boolean;
  updatedAt: string;
};

export type TabDiagnostic = {
  code: "duplicate_system_override" | "unknown_system_override";
  blocking: boolean;
  tabKey: string;
};

export type EffectiveTabModel = {
  managedTabs: ManagedTab[];
  marketTabs: ManagedTab[];
  diagnostics: TabDiagnostic[];
  blockingDiagnostics: TabDiagnostic[];
};

export function systemTabKey(id: string) {
  return `system:${id}`;
}

export function personalTabKey(id: string) {
  return `personal:${id}`;
}

export function sourceSystemTabId(row: UserTabRow, systemIds: Set<string>) {
  const sourceTabId = String(row.source_tab_id || "").trim();
  if (sourceTabId && systemIds.has(sourceTabId)) return sourceTabId;
  if (!sourceTabId && systemIds.has(row.id)) return row.id;
  return "";
}

function normalizedSortOrder(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.MAX_SAFE_INTEGER;
}

function compareRowsNewestFirst(a: UserTabRow, b: UserTabRow) {
  const updated = String(b.updated_at || "").localeCompare(String(a.updated_at || ""), "en");
  return updated || b.id.localeCompare(a.id, "en");
}

export function resolveEffectiveTabs(systemSeeds: SystemTabSeed[], userRows: UserTabRow[]): EffectiveTabModel {
  const systemIds = new Set(systemSeeds.map((tab) => tab.id));
  const overrides = new Map<string, UserTabRow[]>();
  const personalRows: UserTabRow[] = [];
  const diagnostics: TabDiagnostic[] = [];

  for (const row of userRows) {
    const sourceTabId = sourceSystemTabId(row, systemIds);
    const declaredSource = String(row.source_tab_id || "").trim();
    if (sourceTabId) {
      const rows = overrides.get(sourceTabId) || [];
      rows.push(row);
      overrides.set(sourceTabId, rows);
    } else {
      personalRows.push(row);
      if (declaredSource) {
        diagnostics.push({
          code: "unknown_system_override",
          blocking: true,
          tabKey: personalTabKey(row.id),
        });
      }
    }
  }

  const managed: ManagedTab[] = systemSeeds.map((seed) => {
    const candidates = [...(overrides.get(seed.id) || [])].sort(compareRowsNewestFirst);
    const override = candidates[0];
    if (candidates.length > 1) {
      diagnostics.push({
        code: "duplicate_system_override",
        blocking: false,
        tabKey: systemTabKey(seed.id),
      });
    }
    return {
      tabKey: systemTabKey(seed.id),
      id: seed.id,
      label: override?.label || seed.label,
      displayLabel: override?.label || seed.displayLabel,
      sortOrder: normalizedSortOrder(override?.sort_order ?? seed.sortOrder),
      enabled: override ? Boolean(override.enabled) : seed.enabled,
      isDefault: override ? Boolean(override.is_default) : Boolean(seed.isDefault),
      source: override ? "personal-override" : "system",
      sourceTabId: seed.id,
      defaultSymbols: [...seed.defaultSymbols],
      overrideRowId: override?.id || "",
      hasOverride: Boolean(override),
      updatedAt: String(override?.updated_at || ""),
    };
  });

  for (const row of personalRows) {
    managed.push({
      tabKey: personalTabKey(row.id),
      id: row.id,
      label: row.label,
      displayLabel: row.label,
      sortOrder: normalizedSortOrder(row.sort_order),
      enabled: Boolean(row.enabled),
      isDefault: Boolean(row.is_default),
      source: "personal",
      sourceTabId: "",
      defaultSymbols: [],
      overrideRowId: row.id,
      hasOverride: false,
      updatedAt: String(row.updated_at || ""),
    });
  }

  const systemOrder = new Map(systemSeeds.map((tab, index) => [systemTabKey(tab.id), index]));
  managed.sort((a, b) => normalizedSortOrder(a.sortOrder) - normalizedSortOrder(b.sortOrder)
    || (systemOrder.get(a.tabKey) ?? Number.MAX_SAFE_INTEGER) - (systemOrder.get(b.tabKey) ?? Number.MAX_SAFE_INTEGER)
    || a.updatedAt.localeCompare(b.updatedAt, "en")
    || a.tabKey.localeCompare(b.tabKey, "en"));

  const visible = managed.filter((tab) => tab.enabled);
  const defaultTab = visible.find((tab) => tab.isDefault && (tab.source !== "system" || tab.hasOverride))
    || visible.find((tab) => tab.isDefault)
    || visible[0];
  for (const tab of managed) tab.isDefault = Boolean(defaultTab && tab.enabled && tab.tabKey === defaultTab.tabKey);

  return {
    managedTabs: managed,
    marketTabs: managed.filter((tab) => tab.enabled),
    diagnostics,
    blockingDiagnostics: diagnostics.filter((item) => item.blocking),
  };
}
