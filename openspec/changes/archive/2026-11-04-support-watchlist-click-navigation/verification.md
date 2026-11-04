# 自選清單左鍵操作結案紀錄

## 已完成範圍及對應來源

WatchlistPicker／watchlist 樣式與接線、watchlist-window、use-watchlist 與 App 的初始清單／URL 接線。左鍵單擊約半秒後在本頁切換；窗口內雙擊同項只開一個新分頁，不先切原頁。新分頁沿目前 URL 的版面入口與 profile，並非複製全部未儲存 layout。

## 已發生的實際 Chrome 證據

- 11/04 前次實測在「易看盤」的庫存 ETF 原頁雙擊「觀察」，實際另開帶 watchlist 的同一 saved-profile 入口，原頁仍保留庫存 ETF；右鍵沒有此自訂行為。
- 初次回報未成功時，原頁仍使用舊原生 select。重新載入新版後，在使用者原分頁再次雙擊已開出新頁；原失敗不被寫成當時已成功。
- 畫面：[雙擊產生的新頁](../../../../outputs/watchlist-picker-20261104/double-click-opened.png)、[下拉選單](../../../../outputs/watchlist-picker-20261104/menu.png)。測試分頁已關閉，未修改清單內容。
- 本輪 browser 重驗涵蓋 500ms 單／雙擊互斥、不同項連點、取消、右鍵、焦點與鍵盤、URL 優先／缺失 fallback 及啟動重試；純函式重驗 URL 參數與 noopener。真實瀏覽器畫面與 mocked window.open 的測試分開判定。

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
