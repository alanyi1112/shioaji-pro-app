## 驗證環境

- 日期：2026-09-02（Asia/Taipei）
- 本機主交易頁：`http://127.0.0.1:5173/`
- 本機選股資料服務：`127.0.0.1:5174`
- Runtime：simulation；驗收前後 `api_listener=up`、`api_simulation=true`、`api_business_session=available`、`web_listener=up`、`multiview_listener=up`。
- 驗收期間未停止或重啟 simulation API、business watchdog、5173、5174、盤後 pipeline 或行情連線；smart-order write master 維持 disabled。

## 自動化驗證

- `npm run build`：通過，包含 TypeScript project build 與 Vite production build。
- 本輪版面校正 focused unit tests：3 files、18 tests 通過，涵蓋完整交易頁 URL、5／19 欄 workspace、可視高度 row 計算、session-only 持久化邊界、指定清單及 watchlist recovery。
- Focused Chromium component tests：2 files、17 tests 通過，涵蓋版面選單開新交易頁且不在來源頁套用 preset、新增面板建立內嵌 block、結果內容／清單按鈕互斥、hover highlight、後端成功／失敗狀態與連點防重。
- 彈出視窗誤報修正 focused tests：`stock-screener-window.test.ts` 5 tests、`hud-header.browser.test.ts` 6 tests 通過；涵蓋保留 `_blank` + `noopener`、`window.open()` 回傳 `null` 時不顯示自製 alert，且不原地套用 preset。
- 完整 `npm test -- --reporter=dot`：171 files、2,056 tests 通過。
- 完整 `npm run test:browser -- --reporter=dot`：7 files、82 tests 通過，最終重跑無失敗或依賴最佳化重載警告。
- Root `package.json` 原本沒有 `lint` script，root `node_modules/.bin` 也沒有 ESLint；本 change 不擴張範圍新增 lint toolchain，以 `npm run build` 的 TypeScript 檢查及既有完整測試作為 root 靜態品質閘門。
- `openspec validate --all --strict`：35 items 全數通過；`git diff --check` 與本 change 新檔尾端空白檢查皆無輸出。

## 本機實際 UI／API 驗收

- 「版面」選單的「預設版面 Presets」區實際顯示「選股篩選」與說明「全市場收盤後條件篩選（開新分頁）」；啟用後開啟 `http://127.0.0.1:5173/?layout=stock-screener`，未使用錯誤的 `popout=screener` 單一選股根頁面。
- 針對使用者截圖的誤報情境重載主交易頁後，實際啟用「版面 → 選股篩選」：新頁正確開啟為 `?layout=stock-screener`，來源頁與新頁均沒有 JavaScript dialog，且兩頁來自 `127.0.0.1:5173` 的 console warning／error 均為 0。
- 新頁 DOM 實際包含完整 `Shioaji Pro` 頂部工具列、「＋新增面板」與「版面」按鈕，並只有一個左側選股面板與一個右側 K 線面板，沒有圖 1 形式的獨立「選股／收盤後全市場篩選」頁首。
- 在 2048×1120 CSS px 桌面 viewport，左側選股面板為 419×1038 px，右側 K 線面板為 1610×1038 px；`bodyClientWidth` 與 `bodyScrollWidth` 皆為 2048，無水平溢出。
- 在實際 1280×720 CSS px 較矮 viewport，grid 可視區為 636 px 高；左側選股與右側 K 線均自動縮為 606 px 高，頂端 91、底端 697，小於 viewport 底端 720，`bodyClientHeight` 與 `bodyScrollHeight` 均為 720。放大至 2048×1120 後兩面板自動恢復為 1038 px 高且底端 1092，持續位於可視區內。
- 專用新頁的 workspace update 在 `layout=stock-screener` 模式不呼叫 `saveWorkspace`；單元測試確認該模式不持久化，來源主頁 workspace 不會被新頁拖拉或面板變更覆寫。
- 「＋新增面板」實際保留名稱「選股」的內嵌面板 action；因目前 workspace 已有一個選股 block，DOM 依 singleton 合約顯示「選股（已存在）」並停用。元件測試另驗證未存在時啟用只呼叫 `addBlock('screener')`，不開新分頁。
- 新頁選股面板顯示完整篩選控制、目標 K 線 selector 與獨立「加入清單」按鈕；實際目標為同頁「K 線圖 1」，本輪新開選股交易頁 console 的 error／warning 均為 0。
- 實際 pointer hover 第一筆「加入清單」時，computed style 由 `rgb(221, 227, 238)`／`rgb(34, 43, 55)`／`rgb(29, 37, 48)` 變為 accent `rgb(61, 139, 255)` 文字與邊框、`rgba(61, 139, 255, 0.12)` 背景；移開後三者完整還原，未觸發加入或 chart pick。
- 實際全市場查詢使用 2026-08-31 → 2026-09-01 日量，母體 1,975 檔（TWSE 1,085、TPEx 890），符合 1,953、不符合 7、unknown 15；頁面顯示真實 snapshot 與缺漏，不以自選清單代替母體。
- 既有選股圖表選擇單與點選安全測試繼續確認結果只更新同頁指定且未鎖定的 K 線，快速連點的過時結果不得覆寫新目標。

## 自選清單驗收

- 實際按下 `1101` 右上方「加入清單」後，按鈕顯示「已加入」，主頁「選股」清單計數由 0 變 1，原作用中清單保持作用中。
- 重整選股分頁、重新篩選並再次加入同商品後，顯示「原已在『選股』清單」，清單計數仍為 1。
- 自動化測試另覆蓋「選股」清單不存在時建立、雙分頁 duplicate/conflict recovery、同名不唯一、合約市場／種類不一致及後端未確認等 fail-closed 路徑。
- 結果內容 click 與「加入清單」是同層獨立 button；測試證明按清單不送 chart pick、點內容不送 watchlist mutation，API 失敗不顯示成功。

## 副作用邊界

- 加入流程只使用 contract resolve、watchlist GET／create／add／confirm 與同源 invalidation；未呼叫交易、智慧下單、帳務、選股 provider／回補、DDL 或 runtime 管理 API。
- 實際驗收後 runtime listener 與 simulation business session 狀態和驗收前一致，console 無錯誤或未受控警告。
