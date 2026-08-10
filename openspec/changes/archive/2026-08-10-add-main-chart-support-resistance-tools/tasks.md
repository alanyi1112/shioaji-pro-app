## 1. 前置基準與 fixture

- [x] 1.1 歸檔並同步 `align-chart-tools-and-add-multiview-minute-klines`，確認正式 `chart-technical-indicators` spec 已包含 1D-authoritative Pivot projection，再重新執行本 change strict validation
- [x] 1.2 建立版本化 PivotPoint／三關價／CDP 共用 OHLC fixture，涵蓋正常值、相同高低、邊界 close、非法有限值與六位小數期望結果
- [x] 1.3 定義 `SupportResistanceProjection`、formula id／version、reference metadata 與固定排序的 level-set 型別，且不引入外部行情或第三方 runtime dependency

## 2. 三套公式與自動 reference resolver

- [x] 2.1 將既有 Traditional Pivot adapter 接入共用 level-set contract，保持 `traditional-pivot-tw-v1` 七線 fixture parity
- [x] 2.2 實作 `three-level-price-tw-v1` 純函式與 UP／MID／DOWN 測試，拒絕非法 OHLC 並驗證公式順序
- [x] 2.3 實作 `cdp-wilder-tw-v1` 純函式與 AH／NH／CDP／NL／AL 測試，拒絕非法 OHLC 並驗證單調順序
- [x] 2.4 實作可注入 `Asia/Taipei` 時間、資料載入狀態與來源可用性的自動 reference resolver，涵蓋盤中今日 forming、13:35 後今日 completed、開盤前、週末、休市、補行交易日與資料倒序
- [x] 2.5 為收盤後 Kbars 失敗、來源 unavailable、今日 OHLC 非法及沒有前一完整交易日加入 fail-closed 測試，確認不得用 quote 或零值補造 reference

## 3. Canonical state 與非破壞遷移

- [x] 3.1 建立不含 timeframe／formula／instance id 的 product reference key 與 document-session pinned state，讓三套公式訂閱相同 reference
- [x] 3.2 將三個 checkbox enabled state 接入既有 canonical indicator store，沿用 functional update、同 origin revision 與 storage failure reason code
- [x] 3.3 實作最後一個 formula 取消時清除 pinned reference、reload 恢復 enabled 但回到自動 reference，以及不同商品／多 panel 隔離測試
- [x] 3.4 實作可重入的 legacy `traditional-pivot` migration：可見轉為勾選、hidden 轉為未勾選、新版優先、成功保存前保留舊資料且不得產生重複七線
- [x] 3.5 從通用 indicator picker 移除可新增 Traditional Pivot 的入口，保留公式與 legacy parser 供 migration／fixture 使用，並加入 picker regression test

## 4. 共用 renderer 與 readout

- [x] 4.1 將既有 Pivot primitive 抽象為可同時接收多個 level sets 的共用壓撐 renderer，保留右向投影、價格軸安全邊界與 reference 不在分鐘窗時的左側 clamp
- [x] 4.2 實作十五線跨公式固定排序、formula prefix、level 名稱、格式化價位、色彩／線型與全域 Y 標籤避碰，位移標籤以短 connector 指向真實價格
- [x] 4.3 將 autoscale 限制為 enabled finite levels，並測試單一 formula 取消只移除自己的線、readout 與 autoscale contribution
- [x] 4.4 加入三套公式共用 reference 的中文 readout，明示自動／固定歷史、reference 日期、完成／unavailable 狀態及各 level 價位
- [x] 4.5 為價格相同／相近、十五線、resize、平移縮放、history paging、theme、快速 generation、切換商品／時框與 unmount 加入 renderer cleanup regression tests

## 5. 主交易畫面壓撐互動

- [x] 5.1 在主交易畫面「指標」旁加入「壓撐」按鈕與 viewport-safe、鍵盤可操作的三 checkbox popover，提供 active、focus、outside click／Escape 與設定未保存狀態
- [x] 5.2 勾選第一個公式時立即執行自動 reference；取消個別 formula 時保持其他 formula 與共用 reference；三項全關時清除整組投影
- [x] 5.3 在 1D 游標觀察模式提供「固定歷史」與「回到最新」，讓點選已完成日 K 同步更新三套公式，並拒絕固定盤中 forming K
- [x] 5.4 讓 1m、5m、15m、60m 唯讀鏡像 1D reference 與 enabled projections，顯示「由 1D 管理」且不提供任何會改變 reference／checkbox 的控制
- [x] 5.5 保持點價買、點價賣、停損、停利及警示模式優先，測試壓撐選棒不攔截交易點擊、不送單、不啟用 production 且不改其他 indicator／Fibonacci state

## 6. 驗證與本機可見驗收

- [x] 6.1 執行壓撐公式、resolver、store migration、primitive、CandleChart component 與既有 Pivot／indicator／交易互動 targeted tests
- [x] 6.2 執行完整 root unit tests、browser tests、TypeScript／build、OpenSpec strict validation 與 `git diff --check`，修正所有 regression
- [x] 6.3 在 `127.0.0.1:5173` 與 Shioaji simulation 以固定盤中時間驗證上一交易日 reference、三個 checkbox、1D 固定歷史及四個分鐘時框同組投影
- [x] 6.4 在 `127.0.0.1:5173` 與 Shioaji simulation 以固定 13:35 後時間驗證最後一根完整日 K、資料不可用 fail-closed、十五線標籤避碰、個別取消、全清除及 reload 回自動 reference
- [x] 6.5 回歸多 panel／不同商品、快速切換、console 未處理錯誤、MultiView 未被修改、simulation 安全邊界及既有 5173／5174 runtime 與行情連線保持運作

## 7. 公式樣式設定補強

- [x] 7.1 讓「壓撐」按鈕的正常／active 視覺樣式與「指標」一致，並加入樣式 regression test
- [x] 7.2 在 PivotPoint、三關價、CDP 列右側加入鍵盤可操作的設定圖示與草稿對話框，支援顏色、粗細、實線／虛線／點線、套用、取消及恢復預設
- [x] 7.3 將 formula-level `styles.line` 接入 canonical store 與共用 renderer，驗證未勾選先設定、reload／多 panel 同步、個別公式隔離及 storage failure
- [x] 7.4 執行 targeted、完整 unit、browser、TypeScript／build、OpenSpec strict、`git diff --check` 與 5173 simulation 可見驗收，確認 5174／行情連線不受影響

## 8. 直接選棒與投影起點補強

- [x] 8.1 為「壓撐」按鈕的正常及 active 狀態加入清楚框線，更新與「指標」共用色彩／背景但框線獨立的 browser regression test
- [x] 8.2 移除「固定歷史」armed state；任一公式啟用時，1D 游標模式直接點選合法已完成 K 棒即固定該根並重算，未完成 K 棒拒絕、分鐘圖唯讀且交易模式仍優先
- [x] 8.3 驗證自動與直接點選 reference 的所有價格線皆由 reference K 棒 `firstTime` 向右延伸，並執行 targeted、完整 unit／browser、build、OpenSpec strict、`git diff --check` 與 5173 simulation 可見驗收

## 9. 壓撐按鈕尺寸對齊

- [x] 9.1 移除「壓撐」按鈕的 layout wrapper，使其與「指標」同為 toolbar 的直接 flex child；outside click 改由按鈕與 popover refs 判定，並加入 rendered width／height、font、line-height 與 padding 完全相同的 browser regression test
- [x] 9.2 執行完整 unit／browser、build、OpenSpec strict、`git diff --check` 與 5173 simulation 可見量測驗收，確認兩個按鈕幾何一致且既有選單互動、5174 與行情連線不受影響

## 10. 壓撐樣式對話框穩定性

- [x] 10.1 修正顏色、粗細與線型 handler：在 functional updater 外同步擷取並驗證 DOM value；以 React `StrictMode` browser tests 覆蓋 PivotPoint、三關價、CDP 的預覽、套用、取消、Escape、遮罩關閉及恢復預設，確認沒有 uncaught exception 或半套用
- [x] 10.2 執行完整 unit／browser、build、OpenSpec strict、`git diff --check` 與 runtime 檢查，並在 5173 simulation 逐一驗收三個公式的顏色、粗細、三種線型與所有離開路徑，不得出現全頁錯誤或影響 5174／行情連線

## 11. 台股報價精度與壓撐 readout 精簡

- [x] 11.1 建立 contract-aware 台股報價 formatter，以 canonical category 區分普通股票與 ETF，涵蓋所有價位級距邊界、英文字尾／上櫃 ETF、絕對報價及以昨收級距格式化漲跌價差
- [x] 11.2 將 formatter 套用到自選清單、排行榜、主報價摘要、五檔、逐筆成交與 tray 等相關報價欄位，保持百分比、非台股與非 STK 既有格式
- [x] 11.3 移除 K 線左上角 PivotPoint／三關價／CDP 的 level 名稱與價位，保留共用 reference 狀態及「回到最新」，並確認右側線標籤不受影響
- [x] 11.4 執行 targeted、完整 unit／browser、TypeScript／build、OpenSpec strict、`git diff --check` 與 5173 simulation 可見驗收，確認普通股票／ETF 邊界格式、壓撐 readout、5174 與行情連線均正常

## 12. MultiView 主圖壓撐公式一致化

- [x] 12.1 在 MultiView worker 的既有版本化 Pivot projection 中，以同一 reference OHLC 加入三關價與 CDP level sets；驗證正常值、非法 OHLC、分鐘／日／週／月 reference mapping，並保持 Traditional Pivot 舊欄位相容
- [x] 12.2 在每個 MultiView panel 的「主圖」加入三關價與 CDP checkbox；任一公式啟用時共用既有載入、stream、直接選棒及「回到最新」流程，三項全關時才清除 reference
- [x] 12.3 將 enabled formulas 合併交由同一 overlay／autoscale，線由所選 K 棒向右延伸，右側顯示公式前綴／level／價位且共同避碰；左上角只保留共用 reference 狀態，不列 level 值
- [x] 12.4 執行 MultiView targeted／完整 tests、build、OpenSpec strict、`git diff --check`，並在 `127.0.0.1:5174` 逐一驗證所有圖表數量、1m／5m／15m／60m／日／週／月、個別取消與 console 無未處理錯誤，保持 5173／行情連線運作

## 13. MultiView 來源週期投影繼承

- [x] 13.1 將每個 panel 的壓撐狀態改為依 canonical symbol 與來源週期保存，建立 `月 > 週 > 日 > 60m > 15m > 5m > 1m` 向下繼承規則，並以 generation 隔離過期回應
- [x] 13.2 合併目前目標週期可見的所有來源投影，讓來源 anchor 對應短週期期間起點、右側標籤顯示來源週期，且 checkbox／直接選棒／回到最新／取消只管理目前來源週期
- [x] 13.3 新增日線至全部分鐘、月／週／分鐘長短週期、同名公式來源隔離、來源週期取消、切換商品／panel、stream 與 autoscale cleanup 回歸測試
- [x] 13.4 執行 MultiView targeted／完整 tests、build、OpenSpec strict、`git diff --check`，並在 `127.0.0.1:5174` 驗證全部週期與圖表數量、來源清除語意及 console 無未處理錯誤，保持 5173／行情連線運作
