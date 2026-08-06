## 1. 現況盤點與資料來源 gate

- [x] 1.1 盤點現有 watchlist D1 schema／API、主圖 line registry、十二項前的 chip pane registry、`margin-short`／TDCC response、偏好 key 與測試 fixtures，記錄相容與 migration 邊界
- [x] 1.2 以實際 response、授權與自動化限制確認逐日融資買進／賣出／現金償還／餘額的免費來源、單位及前後餘額核對規則
- [x] 1.3 確認可追溯融資成數的來源、有效日期與 schema；無合適來源時保留 `marginLoanRatioPercent=null`，不得以固定 60% 代替
- [x] 1.4 建立正常、seeded、歸零重啟、流量不平、缺融資成數及 TDCC 首筆／缺級距 fixtures
- [x] 1.5 確認現有 repo 未先行存在本 change 新增的績效追蹤 route、按鈕、快取或 D1 欄位；若有實驗殘留 MUST 從本 change 範圍移除

## 2. D1 清單 metadata migration 與權限

- [x] 2.1 為 watchlist item 新增 stable `itemId`、nullable `addedAt`、`dateStatus`、`dateSource`、`recommender` 與必要 index，不新增績效或價格追蹤欄位
- [x] 2.2 實作向後相容 migration，保留既有商品並將無可信日期項目標示 `addedAt=null`、`legacy_unknown`，不得填入 migration 日期
- [x] 2.3 修改新增、編輯、刪除與重新加入流程，由 Worker 以 `Asia/Taipei` 伺服器日期原子寫入新加入紀錄，並驗證推薦人長度、控制字元及輸出 escaping
- [x] 2.4 為所有 watchlist metadata routes 實作 server-side owner lookup，拒絕跨使用者讀寫且不洩露項目內容
- [x] 2.5 新增 migration、reload、跨裝置一致、刪除後重加、推薦人驗證與使用者隔離測試

## 3. TDCC 戶數與 400 張級距資料

- [x] 3.1 擴充 TDCC 正規化資料，保存分級 17 總戶數並以實際前一筆 `dataDate` 計算總戶數變化
- [x] 3.2 為每個支援的大戶／散戶級距回傳聚合人數及人數變化，必要分級缺漏時回傳 partial／null
- [x] 3.3 新增「400 張以上」精確聚合，固定使用 levels 12～15 並回傳 `400,001 股以上` metadata
- [x] 3.4 更新 chip schema／cache version 與 response 型別，保持 additive nullable 相容且不得 forward-fill 週資料
- [x] 3.5 新增總戶數、首筆、跨週、缺級距、levels 12～15 邊界與不支援任意門檻測試

## 4. 估算融資計算與資料 API

- [x] 4.1 實作有 `formulaVersion` 的移動平均融資成本 calculator，涵蓋逐日買進加權、賣出／現償減部位、seeded、歸零重啟與精度規則
- [x] 4.2 實作融資流量與餘額核對及 partial 中斷，不得以零值、餘額差或未揭露價格靜默修補
- [x] 4.3 實作估算融資維持率 calculator，僅在收盤價、估算成本及可追溯融資成數皆合法時套用指定公式
- [x] 4.4 擴充相容 `margin-short` response，回傳融資輸入、估算結果、融資增減張、seeded／partial／unavailable reason、來源日期及 formula metadata
- [x] 4.5 版本化 D1／edge cache key，確保融資、融券、券資比與估算維持率對相同 `symbol + range` 共用資料且不重複呼叫上游
- [x] 4.6 新增 calculator、單位正規化、流量不平、缺融資成數、cache version、stale／partial 與慢回應取消測試

## 5. 主圖估算融資成本

- [x] 5.1 在主圖 line registry 加入預設關閉的「估算融資成本」，限制 eligible 台股普通股與 ETF，並保留「估算」及 seeded／partial 說明
- [x] 5.2 實作與 candles 共用價格尺度及交易日的折線、游標讀值、gap、loading／unavailable 狀態與不適用商品行為
- [x] 5.3 依 `tabId + canonical symbol` 保存選取，完整清理切換商品／頁籤／圖數時的 series、listener 與 pending response
- [x] 5.4 新增 registry、日期對齊、缺值、偏好恢復、快速切換與 stale response 防污染測試

## 6. 十二項籌碼副圖與群組相容

- [x] 6.1 將 pane registry 擴為法人 4、融資券 5、持股比 3，沿用第三群 stable ID 並只把顯示名稱由「大戶持股」改為「持股比」
- [x] 6.2 在融資券群組加入「估算融資維持率」折線 pane，顯示逐日估算率與融資增減張並共用 `margin-short` response
- [x] 6.3 在持股比群組加入「集保戶數」週頻柱狀 pane，顯示實際 `dataDate`、總戶數與戶數變化並共用 TDCC response
- [x] 6.4 在大戶與散戶 pane 加入預設顯示且具獨立尺度的股東人數線，標題列顯示人數及人數變化
- [x] 6.5 在大戶級距選單加入「400 張以上」，用已載入 levels 12～15 重聚合比例、股數、人數及變化，不重新呼叫上游
- [x] 6.6 更新首次無偏好使用者為全選十二項；既有 `modeBSelectedPaneIds`、series 可見性、群組排序／置底與空陣列原樣保留
- [x] 6.7 驗證方式 A／B、1／2／3／4／6／8 圖、group checked／indeterminate、canonical child order、共用時間軸與小於等於 1 CSS px 日期對齊
- [x] 6.8 新增 pane controller 建立／銷毀、共用 request、TDCC gap、首筆、缺值、群組改名相容、偏好與頁面高度測試

## 7. 右鍵功能表、詳細資料與匯出

- [x] 7.1 為新增 panes／series 接上既有滑鼠與鍵盤右鍵功能表，讓線圖項目可獨立開關並共用 canonical 色票
- [x] 7.2 擴充 daily 詳細資料表，顯示估算維持率、融資餘額／增減、估算成本、融資成數、seeded／partial 與 formula metadata
- [x] 7.3 擴充 weekly 詳細資料表，顯示集保總戶數、大戶／散戶人數、兩筆實際 `dataDate`、人數變化及 400 張官方精確邊界
- [x] 7.4 保持前一期／當期欄頭、缺值、顏色、內容收縮、viewport 捲動、焦點、Escape、外部點擊與 controller cleanup 行為
- [x] 7.5 更新完整單一 panel PNG 匯出，涵蓋新增可見 panes、標題讀值、warnings 與超出 viewport 的自然高度
- [x] 7.6 新增 pointed-date、前一有效值、週資料不 forward-fill、series 色票、鍵盤操作與完整 PNG 尺寸測試

## 8. 我的清單 metadata UI

- [x] 8.1 在台股清單商品旁顯示加入日期與可編輯推薦人，既有未知日期明確顯示「日期未知」
- [x] 8.2 實作推薦人的儲存中、成功、欄位錯誤與 API 錯誤狀態，維持鍵盤操作、焦點與既有清單排序／刪除行為
- [x] 8.3 確認 UI 不顯示「績效追蹤」、投資報酬、報酬率、理論上下限或 1／2／3／4／5／20 日價格表現入口
- [x] 8.4 確認新增商品或修改推薦人不觸發 candles、交易日、公司行動或其他績效計算請求
- [x] 8.5 新增 metadata 編輯、reload、日期未知、輸入驗證、使用者隔離與無績效入口／請求測試

## 9. 整合驗證與交付

- [x] 9.1 執行相關 unit／integration／migration tests、全套 `npm test`、typecheck、lint、build 與 `git diff --check`
- [x] 9.2 執行 `openspec validate add-financing-holder-watchlist-metadata --strict` 並確認暫緩的 `add-mainforce-chip-subcharts` tasks 未被誤勾或實作
- [x] 9.3 以本機 browser 實測 eligible／不適用台股、方式 A／B、十二 panes、右鍵、400 張、清單 metadata、reload 與使用者隔離
- [x] 9.4 搜尋並確認本 change 沒有新增 performance route、績效按鈕、投資報酬公式、績效 D1 欄位、價格追蹤快取或背景排程
- [x] 9.5 以已登入 Sites session 部署候選版本並核對 live HTML／JS、Worker API、D1 migration、實際可見 UI 與互動，不以 source 或匿名 401 代替
- [x] 9.6 記錄資料來源、公式版本、已知 unavailable 狀態、正式站證據與 rollback 結果，完成 OpenSpec tasks 後再進行 archive／commit／push／正式部署流程

> 驗證註記：`npm test` 237/237、`npm run lint`、`npm run build`、`git diff --check` 與 strict OpenSpec validation 均通過。專案未定義獨立 typecheck script；`npx tsc --noEmit` 會命中既有 Cloudflare runtime 型別、`.ts` import 與 vinext baseline 錯誤，本 change 以既有 release gates 驗收，未把既有型別債務誤列為本次回歸。
>
> 交付紀錄：融資流量以 FinMind `TaiwanStockMarginPurchaseShortSale` 歷史資料為主，上市最新資料可保守 fallback 至 TWSE `MI_MARGN`；TDCC 股權分散維持官方週資料與實際 `dataDate`，不得 forward-fill。估算公式版本為 `estimated-margin-v1`；融資成數沒有可追溯來源時維持 `marginLoanRatioPercent=null`，估算融資維持率呈現 unavailable，不使用固定 60%。候選版本已在 owner-only 正式站完成主圖、副圖、右鍵詳細資料、D1 migration、清單推薦人儲存與 reload 驗收。rollback 時回退前端與 Worker，additive D1 metadata 欄位保留但停止讀取，避免破壞既有清單。
