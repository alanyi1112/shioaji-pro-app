# K 線載入、資訊列與年線結案紀錄

## 已完成範圍及對應來源

- K 線送達既有 API：api.ts、kbar-request-base.ts；保留原逾時及真正失敗提示。正式條款沿既有 watchlist-loading-resilience，本案不重複改寫。
- 年線與設定：indicator-defs.ts、indicator-dialog.tsx、CandleChart；新增 SMA240、樣式及讀值。
- 展示專用日線：chart-daily-history.ts、chart-daily-history-gateway.mjs、stock-screener-gateway.mjs 的路由接線；同商品／單位／標準時間／重疊價格核對及單序、快取、冷卻、有界資源。
- 指定左上角三列隱藏、原分母與百分比保持，回到最新留在壓撐選單。新規格取代舊顯示要求，沒有刪掉 reference 權威。

## 已發生的實際畫面證據

- [11/03 09:19 K 線逾時修正](../../../../docs/acceptance/kbar-browser-connection-pool-2026-11-03.md)：原 00406A 日 K history=complete、timeline=valid、黃框消失；真失敗不隱藏。
- [11/03 18:28 年線暖機](../../../../docs/acceptance/chart-daily-year-ma-warmup-2026-11-03.md)：0050 共 497 根日 K，SMA240=89.09，原始分鐘 42,954 筆未變。來源 continuity 可能 unknown，不宣稱全歷史無缺口。
- 本輪 key-price-benchmark Chromium 重驗含 400 根暖機／券商呼叫不增加／分鐘不污染／視窗保留，以及三資訊列隱藏的實際元件斷言。既有正常行情路徑仍可能消耗券商資源，「新增暖機 0 broker」不能外推成整個終端 0 用量。

## 本次驗證與邊界

2026-11-04 本輪只補規格、任務、驗證及歸檔；沒有修改任何程式來源，也沒有手動安裝／reload、執行服務啟停命令、操作正式頁面、登入、主動新增行情請求、變更預算／排程或 Git index。測試重產生 fixture 圖可能被既有檔案監聽或自動版本偵測看見，未另外取證瀏覽器事件，故不宣稱所有頁面恰零自動重載／重連或整個終端券商用量為零。既有來源在混合工作桌，來源清單僅界定本案相關內容，不代表整個共享檔案都屬本案。

本次無券商 fixture／純函式回歸：

| 檢查 | 結果 | 證據檔名 |
| --- | --- | --- |
| K 線 transport／資料完整性，7 檔 | 111／111 | kbar-tests.log |
| 日線／指標／設定，14 檔 | 111／111 | daily-tests.log |
| React Chromium，9 檔 | 66／66 | browser-tests.log |
| 版本／交接／URL 純函式，3 檔 | 24／24 | state-unit-tests.log |
| 日線 gateway 與版本 plugin | 7／7 | node-tests.log |
| App TypeScript | 通過 | app-types.log |

上述檢查集合對應本次工作區來源；來源及 log SHA-256 見共同證據目錄的 source-manifest.json 與 validation-evidence.json。Chromium log 有既有 React act 警告，沒有把警告說成零。測試使用 stub／fixture，不代表新發生的實體重開機、斷線或今日自然盤後採集。

## 保留的既有檢查缺口

- 前次 `tsconfig.node.json` 的 3 個錯誤保留：roster-consumer-gateway.mjs 缺 declaration、既有 proxy／response implicit any。當時以記憶體移除新 plugin import 與註冊後重驗相同，原 log 在共同目錄 previous-node-types-baseline.log；本次來源不變，沒有藉文件結案聲稱全專案 build 成功。
- 前次 HMR native wiring 為 2／3；舊 source 斷言要求 App 直接包含 `!selected && first`，而首檔 fallback 已搬至 useSelectedContractRefresh。失敗 log 保存在 previous-wiring.log；此行為由本次 hook／Chromium 測試覆蓋，不把該靜態檢查算作通過，也不在本輪擴張修改程式或舊測試。

## 歸檔與保護

使用者已明確授權本次三案補件、驗證、同步正式規格及歸檔，並要求其他四案保留、不 commit／push。共同證據目錄：[outputs/openspec-ui-closeout-20261104](../../../../outputs/openspec-ui-closeout-20261104)。

四案原 51 個檔案指紋、Git HEAD／index 與工作區其餘來源均於執行前封存；正式規格同步及歸檔後須逐檔讀回一致。最終歸檔結果記於共同目錄 closeout-result.json 及 docs/acceptance/ui-three-changes-closeout-2026-11-04.md。未完成大案的任務及自然驗收不得因本案歸檔被勾選或搬移。

## 規格同步的中間拒絕

首次同步後 strict 因兩份新正式規格 Purpose 少於 50 字拒絕（87／89）；補上具體用途後重驗為 89／89。原拒絕保留於 strict-after-sync.json，修正後另存 strict-after-sync-fixed.json，沒有修改程式或降低驗證要求。

## 測試產物範圍

本輪 Chromium 另重新產生 src/components/key-price-main-chart-fixture.png，前後 SHA 保存於 scope-before-archive.json；另一張本輪新產生的 passing fixture 已移至共同證據目錄。此為可重產生測試產物，不屬程式碼、四案文件或正式行情收據變更。
