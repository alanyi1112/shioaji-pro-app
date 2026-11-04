# K 線黃框／瀏覽器連線競爭修正

完成：2026-11-03 09:19 Asia/Taipei。依使用者09:02:47截圖，00406A日K顯示「K 線來源查詢逾時（20秒）」且圖形未正常載入。

## 診斷與修正

原分頁重演日K時仍於20秒逾時；同一商品目前日及最近30日的兩次受控本機API查詢均HTTP200，分別約0.030／0.036秒，沒有保存原始行情。即時報價與API／watchdog正常。多個盤中選股分頁各有SSE，加上共用行情與合約事件通道，會與同源REST爭用HTTP/1.1連線池；依上述差異及既有市場脈動分流設計，定位為瀏覽器連線競爭。未把來源逾時訊息本身當作券商故障證據。

新增`kbarRequestBase`，只在本機HTTP Vite開發、API base為空且非Tauri時，讓`/api/v1/data/kbars` POST經相同port的另一個loopback hostname讀取（127.0.0.1與localhost互換）。仍由同一個Vite代理同一個既有API，沒有新listener或資料來源；其他路由不改。明確API base、正式build、Tauri、HTTPS與其他hostname保留原目的地。

保留20秒有界逾時、最多30日分段、single-flight、取消、進度發布、來源驗證與真失敗黃框。沒有隱藏錯誤、增加重試或擴大券商授權。實際CORS preflight回204，既有Vite允許本機來源；沒有修改CORS／安全設定。

## 驗證

- `vitest.kbar-loading.config.ts`：7檔、111項通過，涵蓋K線transport、取消／逾時、資料完整性及本次路由邊界。
- Chromium圖表完整性：12項通過；近期進度、較早歷史失敗、切股取消、live tail保留與手動恢復保持。
- 原00406A分頁實際重驗：1D、97根日K／25229份原始分鐘資料，history=`complete`、timeline=`valid`、alerts空；實際工具截圖顯示K線／指標完整、黃框消失。這是目前請求成功，不宣稱來源永不失敗。
- 同分頁6274亦重驗完整日K與後續成交；最後恢復驗證前「盤中選股（12）」清單、6274及原先前景分頁，history=`complete`、162根日K、timeline=`valid`、alerts空。
- 全部變更`git diff --check`通過。

09:18:38讀回：simulation wrapper957、Web935、MultiView941均保持；watchdog healthy／armed、restartCount0、consecutiveFailures0。沒有啟停服務、broker login、改盤中監控背景owner／排程／帳本或commit／push。前端正常HMR可能重建頁面連線，沒有將它說成所有瀏覽器恰零重連。

兩筆直接K線查詢是本次受控診斷；後續透過原圖表需求驗證。provider實體下載量／cache命中未取證，不聲稱整輪資料下載0。驗證還原時單次Esc觸發撤單快捷鍵的第一階段提示，沒有第二次確認，未執行撤單；未再使用該快捷鍵。

本輪僅修改`src/lib/api.ts`、新增`src/lib/kbar-request-base.ts`及測試，並將測試加入既有K線離線config。既有`candle-chart.tsx`／`shioaji.ts`混合變更保留，不覆寫。
