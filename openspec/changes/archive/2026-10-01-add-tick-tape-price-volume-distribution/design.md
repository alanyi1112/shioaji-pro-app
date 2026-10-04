## Context

成交明細已具備台股完整日歷史成交、SSE 即時成交、跨來源合併去重、coverage、IndexedDB 快取及可設定大單分類。每筆正規化資料已有成交價、張數、`tickType` 與 `isLarge`，足以衍生分價統計；若另開行情來源或重新查詢 ticks，會破壞既有 single-flight、請求預算與完整性證據。

參考畫面使用「大戶」，但目前系統只有依金額、張數與動態百分位判斷的「大單」，沒有交易者帳戶身分，因此新介面必須維持可證明的「大單」語意。

## Goals / Non-Goals

**Goals:**

- 在成交明細面板提供可切換、可捲動的分價量表。
- 使用同一份已去重 session 資料計算價位量、方向量、佔比與成交量加權均價。
- 沿用大單設定與重新分類版本，並對 partial／failed／loading 狀態 fail closed。
- 對歷史 replay 與每筆 live append 維持有界 CPU、DOM 與記憶體成本。
- 在 simulation 模式完成真實歷史＋SSE 驗收，不產生交易副作用。

**Non-Goals:**

- 不推測或辨識實際「大戶」帳戶身分。
- 不新增後端 endpoint、第二條 SSE subscription 或額外輪詢。
- 不支援期貨、選擇權、權證、指數、零股、試撮或 14:00 定價交易。
- 不提供跨日分價、成本分布、委託簿或 Volume Profile 替代功能。

## Decisions

### 1. 分價量表是成交明細的同 session 衍生檢視

工具列新增第一層「成交明細／分價量表」檢視切換；既有「全部／大單」保留在成交明細檢視。切換只改本機呈現，不觸發 history reload、SSE subscribe/unsubscribe 或 cache mutation。主面板與獨立視窗沿用相同元件及生命週期。

### 2. 以正規化實際成交價作為 bucket key

每個合法整股成交依既有價格正規化後歸入精確成交價 bucket，不自訂區間。bucket 保存 `totalVolume`、`buyVolume`、`sellVolume`、`unknownVolume`、`largeVolume`；全域保存總量、總價量乘積、大單量、大單價量乘積、第一筆與最新一筆價格。價位排序只對 bucket 集合做由高到低排序。

方向採既有 Shioaji 契約：`tickType=1` 為買方、`2` 為賣方、其他為未知。成交量圖以該價位總量相對最大 bucket 縮放，內部依買／賣／未知量堆疊；未知量不得被併入任一方向。

### 3. 統計分母固定為同一份全部成交量

- 總成交均價：`Σ(price × volume) ÷ Σvolume`。
- 大單成交均價：`Σ(large price × large volume) ÷ ΣlargeVolume`；分母為零時顯示 `—`。
- 總佔比：`bucket.totalVolume ÷ session.totalVolume`。
- 大單佔比：`bucket.largeVolume ÷ session.totalVolume`，不是 bucket 內大單比例。

價格使用商品既有 formatter；佔比顯示一位小數，但內部運算保留原始精度。成交量單位沿用 common lot（張）。

### 4. 沿用大單分類結果，不建立大戶模型

`largeVolume` 只累加目前設定 revision 下 `isLarge=true` 的成交。使用者變更大單設定時，既有 replay 依時間順序建立新 classifier 與新分價結果，完成後原子切換；畫面在重算期間保留上一版並顯示狀態。開盤瞬間與 13:25 起成交可計入全日總量，但依既有規則不得被分類為大單。

### 5. 彙總器與 classifier 同步增量更新

不在 React render 對最多 500,000 rows 反覆 `reduce`。`SessionTapeClassifier.append` 在完成該筆分類後同步更新 distribution accumulator；歷史 replay 以既有分批 yield 節奏建立完整結果。UI 接收具 revision 的不可變 snapshot 或能明確觸發更新的版本欄位，排序與可見列再以 memoized view model 處理。

### 6. 標記由同一 session 成交推導並服從 coverage

`現` 為目前已載入 session 最後一筆成交，`開` 為第一筆，`高／低` 為 bucket 最大／最小價格。只有 coverage 為 `verified` 或 `confirmed_empty` 時可把開、高、低稱為已核實當日結果；partial、loading 或 failed 時必須顯示狀態，並不得以未完整資料宣稱完整日高低與佔比。多個標記落在同一價位時必須全部可辨識。

切入分價量表後優先將 `現` 所在列捲入可見區域；使用者主動捲動後，新 tick 不得強迫跳回目前價。

### 7. UI 只在支援商品提供完整功能

台股 `STK` 且 exchange 為 `TSE`／`OTC` 時顯示分價量表入口。其他商品維持既有成交明細，不顯示或以不可用狀態說明，不能呈現空白但看似有效的統計。

## Risks / Trade-offs

### 盤中驗收的共用串流診斷

在既有「診斷 Debug」面板提供手動擷取：由此頁已建立的 SharedWorker `MessagePort` 查詢每條允許的行情路徑、port 數、EventSource 狀態、open／error 時間、事件計數與 worker 存活期間 source 建立／關閉計數。查詢不建立新的 EventSource、REST、broker subscription 或登入；EventSource fallback 時明示無法量測共享 refcount，不能把空值當成零。

可選擇單一商品短暫觀察 `tick_stk`，最多 5 分鐘、僅保留最近 32 筆的商品代碼、來源日期／時間、價、量與方向；平常不解析額外事件，不保存原始 payload、憑證或逐筆資料至磁碟。這項診斷只能證明 worker 收到事件及其本機 listener 生命週期；`sourceCreated` 不是瀏覽器底層 HTTP 重連 request count，仍須與同一驗收窗的 Network、REST、UI 增量一起對照。測試中的最後 port 關閉證據不能冒充隔日真實跨視窗驗收。

2026-10-01 發現 API 換代後 EventSource 仍回報 `OPEN`，但心跳與成交均靜止。共用 worker 以最後任何事件時間為準，每 10 秒檢查一次；連續 60 秒無事件時先關閉舊 EventSource，再建立唯一替代來源，保留既有 ports／refcount，向各頁通知 `reconnecting`。既有成交 session 隨即標示 partial、保留已載入資料，重連後僅走原有有界缺口補齊與去重；診斷另外揭露最後事件時間及 watchdog 重連次數。此機制不得另建平行來源、第二次登入或交易寫入。

盤中補驗另提供僅限 localhost、開發版及已確認 simulation 的一次性「60 秒無事件」演練：既有 EventSource 保持 `OPEN`，只暫停成交通道的事件轉發與最後轉發時間更新，不關閉來源、不碰 broker session；原本的 watchdog 必須自行達到 60 秒門檻並依序重連。演練記錄被暫停轉發的事件數，最多每個 worker 一次，75 秒後保險解除；真實傳輸出錯時立即解除演練並走正常錯誤路徑。這是**真實盤中行情上的受控靜默故障注入**，不是自然發生的網路故障；不得混淆兩者。

- [逐筆更新造成大量 React render] → domain accumulator O(1) 更新，UI 使用 revision 與價位層級資料，不複製完整 rows。
- [歷史與 SSE 重疊造成統計加倍] → 分價統計只消費現有 merge／去重後 classifier 輸入，不自行接行情。
- [partial 資料產生誤導佔比] → coverage 與已載入範圍常駐於分價檢視，未驗證時明示「部分資料」。
- [大單設定變更期間新成交漏算] →沿用 replay generation／abort／原子切換流程，重算完成前保持上一版並補入期間新增事件。
- [同價位含未知方向] → 灰色獨立呈現且列入總量，避免買賣色段加總小於總量卻無解釋。
- [完整日成交量很大] → bucket 數受合法價格階梯限制，完整 rows 仍依既有 IndexedDB 與 500,000 筆預算管理。

## Migration Plan

1. 先建立純 domain accumulator 與 fixture，驗證公式、方向、時段及大單設定 replay。
2. 將 accumulator 接入 classifier result，不變更 history／SSE／cache 契約。
3. 加入成交明細 view switch、摘要、表格、標記、coverage 與可及性。
4. 以 browser tests 驗證大量資料、設定重算、切商品、獨立視窗及 partial 狀態。
5. 在 Shioaji simulation 的實際盤中 session 驗證歷史請求、`/api/v1/stream/data`、即時 bucket 更新與無重複量；驗收不得啟停 production 或送單。
6. 回滾只移除衍生 UI／accumulator；既有 tick cache、設定與成交明細資料格式不需遷移或刪除。

## Open Questions

無。首版市場範圍、語意、公式、方向與資料完整性政策均已固定。
