# 實作驗證紀錄

## 2026-07-19 實際資料 schema 抽樣

所有抽樣皆為唯讀呼叫，未記錄 token 或其他秘密值。

### FinMind

- `TaiwanStockInstitutionalInvestorsBuySell`，`00919`，`2026-07-17`：
  - `Foreign_Investor.buy = 7963272`、`sell = 37761413`；`Foreign_Dealer_Self` 為 `0 / 0`，正規化後外資買進、賣出及淨額分別為 `7963272`、`37761413`、`-29798141` 股。
  - `Investment_Trust.buy = 0`、`sell = 0`，正規化後投信買進、賣出及淨額皆為 `0` 股。
- `TaiwanStockMarginPurchaseShortSale`，`00919`，`2026-07-17`：
  - 融資餘額／限額為 `8145 / 4527908` 張，推算使用率為 `0.1798843969%`。
  - 融券餘額／限額為 `132 / 4527908` 張，推算使用率為 `0.0029152536%`。
- 本機 `GET /api/taiwan-stock-chip` 同日回傳相同 gross、limit 與使用率，且 `provenance` 分別保留 `institutional-flow`、`foreign-holding`、`margin-short` 的 `provider = finmind`。
- 目前介接來源未提供可證明的投信持股股數或比例，因此資料模型與投信 pane 均不建立、累加或推算投信持股，該能力維持 `null`／不存在。

### TPEx

- `tpex_3insti_daily_trading`，`8069`，民國 `1150717`：外資買進／賣出／淨額為 `3768872 / 3266000 / 502872` 股；投信買進／賣出／淨額為 `1113806 / 2000 / 1111806` 股。
- `tpex_mainboard_margin_balance`，`8069`，民國 `1150717`：
  - 融資餘額／quota／發布使用率為 `8596 / 273663 / 3.14%`；同列推算約 `3.14036%`，故保留來源發布的 `3.14%`。
  - 融券餘額／quota／發布使用率為 `0 / 273663 / 0.0%`，零餘額仍是合法值。

### TWSE

- `MI_MARGN`，`2330`：融資餘額／限額為 `33373 / 6483092` 張，融券餘額／限額為 `81 / 6483092` 張。
- TWSE 此列沒有發布使用率，正規化器依同列餘額與正數限額推算；空白的融券現券償還欄位維持 `null`，不轉成 `0`。

## 瀏覽器驗證

- ETF `00919.TW` 在實際畫面顯示外資買進、賣出、淨額、持股張數／比例，以及融資融券餘額、變化、買進、賣出、償還、使用率與資券互抵；方向箭頭依前一筆實際非空值判定。
- 上櫃 `8069.TWO` 在實際畫面顯示 TPEx 法人、融資與融券資料；融資餘額／使用率為 `8596 張 / 3.14%`，融券合法零餘額顯示為 `0 張 / 0.00%`。
- 不可融券樣本 `2227.TW` 可在 TWSE `STOCK_DAY_ALL` 查得、但不在 `MI_MARGN`；實際籌碼 pane 顯示「無資料」與「不適用」，沒有建立 0% 折線或以 0 補造明細。
- 成交量、MA5、MA10 在游標讀值中同時顯示，三者各自有方向箭頭。
- crosshair 從最新日移至 `2026-04-08` 時，價格、技術指標、成交量、MA5／MA10 與所有籌碼 pane 同步切換日期；在主圖使用滾輪縮放後，K 線、成交量與技術指標維持共用時間範圍。
- 1、3、4、8 圖配置均無頁面水平溢位；4／8 圖的窄 pane 可建立 series 項目控制。
- `summary` 可用鍵盤 Enter 展開，所有 checkbox 具有包含 pane 名稱與 series 名稱的可存取名稱。
- 切換融資使用率 series 前後，瀏覽器 resource 計數未新增 candles 或籌碼請求；重新載入後選擇仍保留。驗證完成後已還原測試偏好。
- 驗收期間暫時加入的 `8069.TWO`、`2227.TW` 已刪除；還原後台股清單為原本 `24` 項。

### 右鍵選單與右側數值軸修正

- 所有籌碼副圖標題列均沒有「項目」或其他新增按鈕；在圖表區按滑鼠右鍵後，既有功能表直接顯示「線圖項目」、各 series checkbox 與原本的「移除副圖」。
- 按 `Shift+F10` 可開啟同一功能表，焦點會進入第一個 `menuitemcheckbox`；按 `Escape` 關閉後，焦點回到具有副圖可存取名稱的圖表區。
- 融資副圖預設顯示張數右側數值軸；關閉餘額／日變化並改選使用率後，右軸會切換為百分比刻度且維持可見。驗證完成後已還原餘額、日變化與使用率選擇。
- 8 圖模式共有 8 個 panel、標題列新增控制為 `0`、頁面水平溢位為 `0`；窄副圖仍保留可見右側刻度空間。

## 自動化驗證

- `npm test` 共 `136` 項通過，`npm run lint` 與單獨 `npm run build` 通過。
- 專案沒有 `typecheck` script；直接執行 `npx tsc --noEmit` 的目前工作樹與乾淨 `HEAD` 都是 `128` 行既有 Cloudflare runtime global／嚴格型別設定錯誤。逐檔錯誤集合與總數相同，差異只有 TypeScript 對相同未載入 global 的 `TS2304`／`TS2552` 建議文字及 union 顯示順序；本 change 沒有新增 typecheck regression。
- `npx openspec validate --all --strict` 共 `12` 個 spec／change 通過、`0` 失敗。

## 正式站驗證

- Sites version `52` 由 commit `9a1935dbd31330a0e4952eb8bc49a8f8ff78655c` 與相同來源的建置 archive 建立；owner-only production deployment `appgdep_6a5c367836d481919086376103558f78` 已成功。
- 正式網址：`https://quote-chart-multiview.alanyi1112.chatgpt.site`。
- live HTML 載入 `20260719-chip-detail-series-v1` 的 `styles.css`、`chip-panes.js`、`app.js`，並包含成交量、量 MA5、量 MA10 讀值節點。
- live `app.js` 會使用 `volume_moving_average.ma5`／`ma10` 建立 series、讀值及方向；live `chip-panes.js` 包含外資／投信 gross、融資／融券限額與使用率 series 定義。
- live `GET /api/taiwan-stock-chip` 的 `institutionalFlow` 與 `marginShort` 已包含所有新增鍵。`00919.TW` 此次命中 `d1_hit` 的舊 JSON，因此新增鍵依向後相容規格為 `null`；沒有缺鍵、API 失效或補成 `0`，後續 refresh 可逐步補齊來源值。

### 右鍵選單與右側數值軸正式站修正

- Sites version `53` 由 commit `26e5cdf44dffe46a0628dd9fd4a6b8158f3c1af5` 與相同來源的建置 archive 建立；owner-only production deployment `appgdep_6a5c3d54386c81919151bafb9bba5054` 已成功。
- live HTML 已載入 `20260719-chip-context-axis-v2` 的 `styles.css`、`chip-panes.js` 與 `app.js`；live `chip-panes.js` 包含 `chip-pane-context-series`、`menuitemcheckbox` 與明確啟用 `rightPriceScale` 的設定，不含舊的 `.chip-series-control`。
- 已登入正式站實際畫面共有 3 個 panel、27 個籌碼 pane、標題列 series 控制為 `0`；張數及百分比副圖的右側數值刻度均可見。
- 正式站融資副圖的滑鼠右鍵功能表直接顯示「線圖項目」、6 個 series checkbox 與「移除副圖」；`Shift+F10` 開啟後焦點位於「融資：餘額」，按 `Escape` 後功能表關閉。
