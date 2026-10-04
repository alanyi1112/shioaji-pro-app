## Why

盤中監控可能只在收盤最後幾分鐘留下缺口；目前雖有經人工執行的受限尾端雙抓審閱，以及獨立的翌日基準建檔，卻沒有自動辨識、驗證並回報當日缺口的流程。2026-10-02 另出現 160 檔同時缺少 13:30 observation，顯示「少量來源尾端缺漏」與「整批收尾異常」必須分開處理，不能用盤後歷史資料冒充當日 live 成功。

## What Changes

- 收盤定稿後自動唯讀分類原始 capture 的連續尾端缺口、逐檔來源缺漏與整批收尾異常；保留原始 capture、失敗狀態及收據，不覆寫或倒填即時資料庫。
- 對符合既有政策的少量缺口（最多 4 檔、每檔僅缺 13:26–13:30 內連續至多 5 分鐘）自動執行有界盤後驗證；完整核對 live 前綴、來源雙抓、收盤總量與 13:33 延後收盤規則後，另存具來源標記的衍生結果。
- 對 2026-10-02 類型的整批尾端異常，優先利用當日已驗證且不可變的盤後歷史基準做逐檔比對，產生獨立的「盤後資料復原」報告；即使 160 檔資料可補齊，也不得升格為當日 live capture 或現有 Stage 160 尾端例外 GO。
- 補值固定標示 `liveDelivered=false`，不得產生追溯觸發、通知或交易權限；UI／API 分開呈現盤中已收到範圍、盤後補齊範圍及正式驗收結果。
- 來源未完成發布、額度不足、雙抓漂移、live 前綴衝突或超出政策時有界重試並保留失敗原因；不額外建立行情登入、訂閱或無界輪詢。

## Capabilities

### New Capabilities

- `intraday-monitor-postclose-tail-recovery`：收盤後缺口分類、受限自動補救、整批資料復原與不可變來源／驗收邊界。

### Modified Capabilities

- `intraday-stock-selection-workspace`：分別顯示原始 live 完整性、盤後復原狀態與資料來源，不將補值呈現為即時結果。

## Impact

- 影響 `scripts/intraday-monitor-runtime/` 的正式擷取收尾、既有 `direct-160-tail-gap-review.mjs`、盤後已驗證基準讀取、持久化收據與獨立稽核，以及本機監控 API／面板。
- 沿用 simulation business session、目前固定 Stage 160 cohort 與現行最多 4 檔尾端例外；不修改既有跨交易日 live acceptance 任務、通知 Gate、核准上限或原始 evidence。
- 不啟用 production、CA、真實下單、第二個 broker login／訂閱，亦不停止或重啟共用服務。
