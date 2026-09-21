## Context

收盤後選股目前以 v2 snapshot 保存成交量／TDCC，以 v3 snapshot 保存相同底稿再加上 60 個交易日的官方 OHLC 技術證據。2026-09-02 本機 live evidence 顯示最新 v2 已使用 `2026-09-01 → 2026-09-02`，但 v3 仍固定在 `2026-08-31 → 2026-09-01`；v3 route 雖標示 `snapshot_stale`，仍把舊 rows 當成可點選結果回傳。1409 新纖因此在 v3 顯示 5.6393 倍，實際 2026-09-02 對 2026-09-01 只有約 0.3896 倍。

技術 operator 另以每日批次 collector 回報日期的較小值決定 `technicalThrough`，而不是以兩市場皆已驗證的正式歷史日報共同日期決定。universe revision 一變，現有 receipt 的全市場 symbol hash 也會失效，使 60 日 × 2 市場被重新視為未完成；publisher 又沒有核對 v2 `anchors.daily.current` 與 v3 `technicalAnchors.through` 相等，存在發布混期 snapshot 的風險。

前端結果列另有兩個獨立問題：父條件未啟用時成交值子條件仍可保持啟用並重複顯示；指定圖表 selection 只保存 `ContractInfo`，同時刻意不傳全域 snapshot，盤後若沒有新 quote event，QuoteBoard 就全部顯示 `—`。

## Goals / Non-Goals

**Goals:**

- 讓日量、成交值、技術 OHLC 與所有衍生型態共同綁定同一個可證明已完成的官方交易日。
- 禁止 stale 或 mixed-session v3 被當成最新可操作結果，同時讓不需要技術資料的查詢不受 OHLC 準備進度阻塞。
- 讓 OHLC planner 在 universe 變動時只處理真正缺少的市場／日期／商品覆蓋，保留既有完整 rows 與 receipt 證據。
- 讓結果列顯示逐值日期、父子篩選語意一致，並讓指定 K 線圖取得自己的 Snapshot。
- 以同一交易日的官方 OHLC 對分型與 BOLL 正反例進行可重現的全市場驗證。

**Non-Goals:**

- 不更改既有原始三 K 或纏論分型數學定義，不新增第三種分型算法。
- 不更改 BOLL 週期、倍數或「首次穿越」定義，不把十字線或碰軌納入通過。
- 不把選股結果加入 broker 訂閱，不改動自選清單、交易、智慧下單、帳務或 production 模式。
- 不讓 GET／UI 觸發 provider 抓取、背景工作、服務重啟或 DDL。
- 不以主圖 Kbars 或盤中 Snapshot 取代選股的官方全市場盤後資料來源。

## Decisions

### 1. 使用單一 `effectiveSessionDate` 作為 v2／v3 發布契約

`effectiveSessionDate` 取自官方市場日曆中不晚於目前日期，且 TWSE、TPEx 正式盤後日報都已有完整 receipt 的最新共同交易日。日量 `D` 必須等於此日期，`P` 必須是官方日曆上一個共同交易日；技術 session window 的最後一日也必須等於 `D`。

不再以最新批次 collector 各自回報日期的最小值推導技術日期，因為批次端點的發布時間可能不同。publisher 在 staging 前與 CAS 寫入前都必須核對：

`base.expectedSessionDate === base.anchors.daily.current === technicalAnchors.through === effectiveSessionDate`

任何一項缺少或不相等時回 pending／mixed-session reason，保留最後合法 snapshot，不發布新 v3。

替代方案是允許日量與型態各自有日期，但這會讓 `all`／`any` 成為跨日混合條件，無法回答「哪一個收盤日的選股」，因此不採用。

### 2. 依查詢需要選擇最新合法 projection

當分型與布林皆停用時，v3 route 可用最新合法 v2 snapshot 建立相同 v3 response shape，技術欄位保持 null；成交量／大戶結果不必等待技術 OHLC。任一技術條件啟用時，route 只接受 `technicalAnchors.through` 等於當期 `effectiveSessionDate` 的 v3 snapshot。

過期 snapshot 可作為帶日期的唯讀歷史資訊，但預設「符合條件」查詢不得回傳可點選或可加入清單的 rows。UI 必須呈現等待當期資料及最後合法日期；不得只顯示一行 stale 提示後繼續提供舊操作。

替代方案是先發布 v2 日量加舊技術證據的 v3，會產生混期判定，故不採用。

### 3. OHLC receipt 與 universe coverage 分離

市場日報 receipt 證明來源日期、schema、payload 與該次已解析範圍，不再只用整份 current-universe hash 決定所有舊 receipt 是否失效。planner 以現有 canonical rows 對目前 universe、listing date 與 60 日 sessions 計算實際缺口：

- 商品集合未變或只刪除商品時，重用全部仍有效 receipt／rows。
- 新增商品時，只把該商品上市日起缺 row 的 `market + session` 放入 work；每次來源仍是完整市場日報，但只新增合法缺 row，不覆寫較高驗證資料。
- session window 向前移動時，只新增新 D 的兩個市場 target，並在 snapshot retention 允許後淘汰最舊日期。
- schema、source date、payload revision 或驗證等級不相容時，才讓受影響 target 重新驗證。

這樣避免名稱更新、下市或無關市場變動讓 120 個 targets 全部重跑，同時保留新商品必須補歷史資料的正確性。

### 4. 結果 API 保存逐筆日期與有效父子條件

volume evidence 增加 `previousDate`／`currentDate`，並要求與 snapshot P／D 完全相等。turnover evidence 固定屬於 D。request parser、criteria fingerprint、domain combine 與 UI 都以「父條件 enabled AND 子條件 enabled」作為成交值的有效啟用值；父條件關閉時 UI disable 子控制、API 正規化為 inactive，結果不得顯示該分支成交值。

兩個主要條件若都各自啟用成交值，API 保留兩個分支的 verdict evidence 供判定與稽核；畫面的「已套用」仍顯示最低成交值門檻，但結果卡不重複顯示任一分支的成交值、日期或共同成交值。如此保留篩選語意，又避免成交值明細干擾使用者核對成交量。

### 5. 圖表 selection 同時管理 contract 與 chart-local snapshot

chart-specific state 改為 `{ contract, snapshot, generation }`。點選結果後先驗證目標仍未鎖定，再解析 contract 並以既有 `fetchSnapshots([contract])` 取得 Snapshot；只有同 generation 且目標仍有效時才原子提交。Snapshot 失敗時 K 線可依既有 Kbars 規則載入，但 QuoteBoard 必須顯示明確不可用狀態，不能靜默留下全欄 `—` 而假裝完成。

選股 P／D 數值繼續以官方盤後底稿為準；主圖 Kbars 保留 Shioaji canonical source。UI 必須將選股證據日期直接放在結果列，並在點選後讓圖表標題／報價商品一致。Shioaji STK Snapshot 的 `total_volume` 單位為 common lot（張），不可標成股；只有 Snapshot 日期與選股 D 相同時，才把官方股數除以 1,000 精確換算成張，於被選取的結果卡顯示「官方盤後張數 − Snapshot 張數＝差異張數」。差異保留不足一張的小數及正負號，不在圖表 QuoteBoard 與主圖之間另加提示列，也不以其中一方覆寫另一方。

### 6. 型態公式固定，驗收改為逐筆可稽核

原始三 K 與纏論包含處理沿用正式 spec 的 strict high／low 關係。BOLL 固定使用官方未調整 OHLC 的 close 計算 BOLL(20,2)：陽 K 為 `close > open`、陰 K 為 `close < open`；下影為 `low < open`，上影為 `high > open`。所有 pass row 必須保存實際 A／B／C 或 P／D、bands、日期與 evidence hash。

驗收除了既有 pure tests，另以 snapshot D 為界，獨立從 canonical OHLC 重算全市場 pass symbols 並比對 API 集合。1409 fixture 同時包含舊窗與新窗，證明 9/1 的結果不得延續至 9/2。

## Risks / Trade-offs

- [兩市場盤後資料發布時間不同，當期結果會短暫等待] → 保留上一合法快照日期供查看，但停用其當期操作；純量／大戶在最新共同 v2 完成後先恢復。
- [新增一檔長期上市但先前未在 universe 的商品，仍可能需要多個歷史市場日報 request] → 只請求該市場且確實缺少的日期，使用既有 request／時間 budget、checkpoint 與冷卻續跑。
- [chart-local Snapshot 可能因 Shioaji session 暫時不可用] → Kbars 與 QuoteBoard 分開降級，顯示明確狀態，不改動全域 selection 或自動重啟服務。
- [官方盤後成交量與 Shioaji Kbars 同日仍可能有來源差異] → 選股判定維持官方來源，UI 顯示來源與日期；差異納入驗收 evidence，不以估算或靜默覆寫處理。
- [舊 cursor 指向 stale v3] → 保留 snapshot-expired／historical response 邊界，禁止被重新解釋為最新結果。

## Migration Plan

1. 先加入日期解析、有效父子條件與 publisher gate 測試，確認舊 mixed-session fixture 會 fail closed。
2. 擴充 evidence schema 與 response shape；以向後相容 nullable 欄位讀取舊 snapshot，舊版不得冒充新 formula version。
3. 調整 OHLC planner／receipt coverage，從既有 rows 重建新 checkpoint；不刪除舊 snapshot，直到新版本完成驗證。
4. 更新 route projection 與 UI，再加入 chart-local Snapshot state；保持 simulation runtime 與 5173／5174 既有服務運作。
5. 完成單元、整合、browser、本機 D1 full run 與實際 UI 驗收後才切換公式／schema version。
6. 若新版本無法發布，rollback 至最後合法 v2／v3 snapshot 與舊前端；不得以人工改日期或刪除 checkpoint 強迫 ready。

## Open Questions

目前沒有阻擋 proposal 的未決事項；實作以既有正式 spec 的嚴格分型定義與使用者再次確認的陽／陰 K 定義為準。
