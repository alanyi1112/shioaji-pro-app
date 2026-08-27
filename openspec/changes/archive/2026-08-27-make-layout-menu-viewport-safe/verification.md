# 驗證紀錄

## 自動化驗證

- `pnpm exec vitest run src/lib/workspace.test.ts`：6／6 通過。
- 聚焦 Chromium browser tests：4／4 通過。
- 完整 Chromium browser suite：69／69 通過，共 12 個 test files。
- `pnpm exec tsc -b --pretty false`：通過。
- `pnpm build`：通過。
- root 專案沒有 lint script 或 root lint 設定；現有 ESLint 設定只位於 `apps/multiview/`，因此本 change 沒有可執行的 root lint gate。
- `openspec validate --all --strict --json`：26／26 通過（25 個正式規格與 1 個 change）。
- `git diff --check`：通過。

## 完整 root test 的既有例外

已實際執行完整 `pnpm test`。隔離權限外重跑後，仍只有 3 個既有 test files 失敗；原因是它們仍讀取已移至 `openspec/changes/archive/2026-08-27-add-durable-smart-order-panel-and-protective-exits/` 的 active-change 路徑：

- `src/lib/smart-order-state-machine.test.ts`
- `scripts/smart-order-runtime/task-13-4-feature-acceptance-validator.test.mjs`
- `scripts/smart-order-runtime/task-14-7-acceptance-validator.test.mjs`

排除上述 3 個與本 change 無關的 archived-path test files 後，root suite 為 1950／1950 通過，共 369 個 test files。本 change 不修改 smart-order 安全驗收的 canonical path 或 hash。

## 實際瀏覽器驗收

使用隔離的 production preview `127.0.0.1:4173`，未變更既有 `5173`、`5174`、simulation API、行情連線或 broker 狀態：

- 標準字級與特大字級均確認「儲存目前版面」位於完整 presets 之前。
- 特大字級於 600、768、900 CSS px 高度量測時，選單 bottom 均小於 viewport height，`overflow-y` 為 `auto`，且內容高度大於可視高度時可在選單內捲動。
- 600 CSS px 高度可由選單內捲動抵達「重設為預設版面」。
- 新名稱顯示「另存」；同名顯示「更新」與覆寫提示；click 與 Enter 都成功，且同名只保留一筆。
- 重新載入後具名版面仍存在，且可載入。
- Theme、Account、Risk、新增面板、Flash（全開）與版面選單均可正常開啟／關閉；長選單維持 viewport 邊界與內部捲動，外部點擊可關閉。
- browser console error：0。
- 刪除、套用 preset、重設與末端按鈕鍵盤 focus／自動捲動由 Chromium component browser tests 覆蓋；storage key 與資料結構相容性由 `src/lib/workspace.test.ts` 覆蓋。依瀏覽器技能安全規則，實機驗收未直接讀取 browser localStorage。
- 全程未啟用 production、CA 或任何 broker write。
