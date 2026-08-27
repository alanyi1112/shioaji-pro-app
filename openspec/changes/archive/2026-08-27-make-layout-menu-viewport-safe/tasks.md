## 1. 建立回歸測試與可達性契約

- [x] 1.1 新增 `HudHeader`／`ProfilesMenu` 元件測試，重現「儲存目前版面」位於完整 presets 之後的問題，並鎖定 MultiView、具名儲存、版面列表、預設版面與重設的目標順序。
- [x] 1.2 新增 viewport-safe popover 樣式或 browser interaction 測試，涵蓋 600 CSS px 高度、特大字級、內容超高、內部垂直捲動及 overscroll 不傳遞到底層 workspace。
- [x] 1.3 新增具名版面提交測試，涵蓋空白名稱、新名稱、同名名稱、click 與 Enter 共用語意，以及同名更新後只保留一筆 profile。

## 2. 實作 viewport-safe 版面選單

- [x] 2.1 更新共用 popover 樣式，加入 `vh` fallback、dynamic viewport 高度上限、`overflow-y: auto`、`overscroll-behavior: contain` 與穩定 scrollbar，並保持既有 header 錨點與右側對齊。
- [x] 2.2 重整 `ProfilesMenu` 內容順序，保留 MultiView 入口在最前方，將「儲存目前版面」與具名版面列表移到完整 presets 之前，維持清楚分組與所有既有操作。
- [x] 2.3 將名稱正規化、同名判定與提交集中為同一流程；新名稱呈現另存／新增語意，同名名稱在寫入前呈現更新／覆寫語意，且 click 與 Enter 使用相同 handler。
- [x] 2.4 維持 `sj-pro-workspace-v2`、`sj-pro-profiles-v1` 與既有 `Workspace`／`Profile[]` 格式，驗證載入、刪除、套用 preset 與重設不會清除其他具名版面。

## 3. 自動化品質驗證

- [x] 3.1 執行新增的聚焦元件／browser tests 與 `src/lib/workspace.test.ts`，確認版面保存、同名更新與 popover 可達性契約通過。
- [x] 3.2 執行完整 `pnpm test`、lint、TypeScript 檢查及 production build，確認共用 popover 修正沒有破壞 Theme、Account、Risk、新增面板與 Flash 選單。（root 無 lint script／設定；完整測試的既有 archived-path 例外與其餘通過結果記錄於 `verification.md`。）
- [x] 3.3 執行 `openspec validate --all --strict` 與 `git diff --check`，確認 root 正式規格、change artifacts 與檔案格式皆通過。

## 4. 實際瀏覽器驗收

- [x] 4.1 在 600、768、900 CSS px 高度及標準／特大字級實際開啟「版面」選單，確認儲存入口不需先捲過 presets 即可看見，且所有末端操作均可由選單內捲動抵達。
- [x] 4.2 以實際操作完成新名稱另存、同名更新、重新載入後恢復、載入、刪除及重設，核對 `localStorage` key／資料結構未改變且 console error 為 0。（完整應用程式驗證另存、更新、重載與載入；刪除、重設及 storage 結構由 Chromium／單元測試覆蓋。）
- [x] 4.3 快速驗收 Theme、Account、Risk、新增面板及 Flash 等共用 popover 的開啟、捲動、鍵盤焦點、外部點擊關閉與 viewport 邊界；不得啟用 production、CA 或任何 broker write。
