## Context

籌碼 pane 的 header 目前以單列 flex 呈現，`.chip-pane-inline-readout` 設定 `white-space: nowrap` 與 `overflow: hidden`，三欄等窄 panel 會直接裁掉後段數值。副圖右鍵功能表已具備 series 選擇與移除操作，可沿用相同可及性及 lifecycle，不應在 header 或圖表外新增按鈕。

日籌碼已由 Worker 透過 FinMind／TWSE／TPEx 查詢並以 D1、single-flight、fetch-state 與 `waitUntil` 預熱；TDCC 最新快照可由 Worker 讀官方 OpenAPI，但歷史週資料必須由受保護 GitHub runner 低速操作官方表單。瀏覽器不得取得內部 secret，也不得直接或高速抓取 TDCC 歷史表單。

## Goals / Non-Goals

**Goals:**

- 讓所有籌碼 readout segments 在 panel 寬度不足時完整換行顯示，不再以裁切或 ellipsis 隱藏項目。
- 只在目前 pane 的相關 dataset 有缺口、過期或歷史不足時，於既有右鍵功能表提供單一回補操作。
- 日資料立即在 Worker background lifetime 執行；TDCC 歷史只安全地排入 durable queue，並向使用者顯示真實狀態。
- 保留上游 retry-after、單一 symbol／dataset single-flight、D1 冪等、登入要求與 context menu lifecycle。

**Non-Goals:**

- 不在副圖 header、工具列或圖表右上角新增常駐按鈕。
- 不讓瀏覽器直接呼叫 FinMind、TWSE、TPEx、TDCC 或取得任何秘密。
- 不從 Worker 自動操作 TDCC 歷史 HTML 表單、不繞過 CAPTCHA／封鎖，也不承諾 TDCC 歷史在 click response 前完成。
- 不新增 D1 schema、外部 queue、GitHub token 或新的資料來源。

## Decisions

### 1. Header 與 readout 以自然換行增加高度

`.chip-pane-header` 與 `.chip-pane-inline-readout` 改為可 wrap，readout segments 保持不可在數字中間斷行，但整個 segment 可移至下一列。pane 使用 `grid-template-rows: auto minmax(64px, 1fr)` 與自然高度，header 增高時 chart 仍保留至少 64px；方式 B 不再以固定 `height: 96px` 截斷內容。方式 A 仍受共用副圖槽位約束並在必要時於槽位內換行。

替代方案是縮小字體、縮短欄位或保留橫向裁切；這仍會隱藏使用者要求的完整數量，因此不採用。

### 2. 由 payload 決定 pane 是否可回補

前端以 pane 對應 datasets、`availability`、`coverage`、`backfill` 與 TDCC 實際筆數計算狀態。日資料的 availability 非完整、coverage 未涵蓋要求範圍或資料過期時可回補；holder pane 在 `history_not_archived`、只有少量快照、未達至少 51 週的一年歷史，或 backfill 為 queued／running／partial／failed 時視為未完整。`completedWeeks === expectedWeeks` 只有在 target 已達一年門檻時才算完整，避免兩週 target 的 `2/2 completed` 誤隱藏回補項目。真正完整的 available pane 不顯示回補項目；blocked 或 retry-after 狀態顯示不可操作原因，不允許連點繞過限制。

### 3. 新增單一 symbol 的登入寫入 API

`POST /api/taiwan-stock-chip/backfill` 接受 canonical `symbol`、目前 pane datasets 及 candle 日期範圍。正式站要求 `oai-authenticated-user-email`，本機 `localhost` 可供測試。Worker 重新執行 eligibility、dataset allowlist、日期格式、最長範圍、D1 coverage、`last_attempt_at` 與 `retry_after` 檢查，不能只信任前端判斷。

API 回傳 `202` 表示已接受背景工作或排入 durable queue；若資料已完整、工作已 queued／running、仍在 cooldown／retry-after 或來源 blocked，回傳安全且可顯示的狀態，不輸出上游內容、身分或 secrets。

### 4. 日資料背景執行，TDCC 只重排 durable queue

合格日資料 datasets 使用既有 `prewarmTaiwanStockChipSymbol` 並放入 `context.waitUntil`，沿用 D1-first、single-flight 與 fetch-state。TDCC 使用新的單一 symbol queue helper：只有 active 且非 blocked／running 的目標可重設為 `queued`，清除 retry／lease 後由既有 GitHub runner claim、plan 官方日期並只補 missing weeks。若目前是 blocked，不因一般使用者 click 解鎖。

替代方案是由公開 API 觸發 GitHub Actions 或由 Worker 抓 TDCC 歷史表單；前者需要新增高權限 token，後者違反既有來源安全邊界，因此不採用。

### 5. 功能表原位回饋並有限重新載入

每個 pane context menu 建立一個可隱藏的回補 menuitem；操作中 disabled，response 後顯示「日資料回補已開始」或「TDCC 已排入回補」。前端清除該 symbol 的 request cache，日資料在短暫延遲後只重新載入一次；TDCC 顯示 queued 狀態並由後續正常載入或排程完成更新。pane 銷毀時清除 click listener、timer 與 context menu DOM。

### 6. 讀值名稱與數值分開套色

inline readout 的每個 segment 拆成名稱與數值兩個子元素。名稱透過 `seriesId` 查詢既有 `PANE_SERIES_OPTIONS`，直接沿用右鍵「線圖項目」色票；數值與方向箭頭才套用 positive／negative／flat／missing tone。未對應可選線圖的來源、狀態或輔助欄位維持既有中性色，不新增第二份色票或改變線圖選取行為。

## Risks / Trade-offs

- [TDCC click 不會在數秒內產生完整歷史] → 明確區分「已排入」與「已完成」，沿用低速 scheduler，不誤導使用者。
- [連點或多分頁重複要求] → 前端 in-flight lock、D1 queued／running 狀態、fetch-state cooldown／retry-after 與既有 single-flight 共同去重。
- [header 換行使多層頁面更長] → 只依實際內容自然增高、chart 保留最低可讀高度，仍由 document 單一捲軸瀏覽。
- [GET payload 與 click 之間狀態改變] → Worker 重查 eligibility 與 D1；已完整或已執行時回傳 no-op 狀態。
- [背景工作超過 Worker lifetime] → `waitUntil` 保存可完成部分，既有 durable scheduler 依 fetch-state 接手其餘資料。

## Migration Plan

1. 先部署無 schema migration 的 Worker、CSS、前端與 contract tests。
2. 本機以窄 panel 驗證所有 readout segments 可換行、右鍵 menu 只在缺資料 pane 出現。
3. 正式站以既有歷史不足商品做一次回補要求，確認 API、queued 狀態、清單與其他 pane 不受影響。
4. 若發生回歸，回滾至上一 Sites version；D1 已排入的冪等工作可由既有 scheduler 安全完成。

## Open Questions

- 無。若未來要求 TDCC click 後立即啟動 GitHub runner，需另立 change 評估最小權限 dispatch token、成本與濫用防護。
