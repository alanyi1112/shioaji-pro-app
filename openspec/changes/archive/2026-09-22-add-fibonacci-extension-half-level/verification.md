## 驗證摘要

- 日期：2026-09-22（Asia/Taipei）
- 結果：Shioaji K 線與 MultiView 已共同使用九條拓展水準；`0.5` 價格、標籤、`#60a5fa`、八個色帶及既有顏色保留均有自動化證據。
- 保存遷移：root 公式版本為 `multichart-ecae7ca-fibonacci-v3`，v1／v2 fixture 均保留 kind、anchors、order 並寫回 v3。

## 通過證據

- `pnpm exec vitest run src/lib/fibonacci-annotations.test.ts src/components/fibonacci-overlay.test.tsx`：2 files、25 tests passed。
- `node --test apps/multiview/tests/chart-annotations.test.mjs`：18 tests passed，包含 root／MultiView 九水準 parity fixture。
- `pnpm exec vitest run --config vitest.browser.config.ts src/lib/lightweight-chart.browser.test.ts`：Chromium 1 file、23 tests passed；實際 Lightweight Charts 座標下拓展為九條 level、八個 band。
- `pnpm build`：TypeScript build 與 Vite production build 通過；只有既有 chunk size warning。
- `pnpm typecheck:multiview`：通過。
- root `openspec validate --all --strict`：52 passed、0 failed。
- nested MultiView `openspec validate --all --strict`：38 passed、0 failed。

## 非本 change 風險

- `pnpm lint:multiview` 因既有修改中的 `apps/multiview/tests/stock-screener-v4-publisher-route.test.mjs:133` 未使用 `evidenceHash` warning 而在 `--max-warnings=0` 失敗。該檔不在本 change 修改範圍，本輪未覆蓋或順手修正；費波那契 scoped tests、typecheck 與 build 均通過。

## 2026-09-22 Repo-wide 回歸補正

- `src/lib/fibonacci-overlay.test.ts` 已同步九條拓展線契約：第二張單色拓展為九條、第一張拓展為九條線與八個色帶，並鎖定 `0.5` 價位 `200`、顏色 `#60a5fa` 及 autoscale 下界 `200`。
- `pnpm exec vitest run src/lib/fibonacci-overlay.test.ts scripts/maintenance-run-receipt.test.mjs`：2 files、11 tests passed。
- `pnpm test`：251 files、2548 tests passed；先前 3 項 Fibonacci 舊預期與 maintenance runner 不相容均已排除。
- `pnpm build`、`openspec validate add-fibonacci-extension-half-level --strict` 與 scope `git diff --check`：通過；build 僅保留既有 chunk size warning。
