## Why

盤中監控雖已於 2026-09-16 完成 160 檔容量驗收，但 durable premarket 設定仍固定綁定該交易日與已歸檔 change 的舊路徑，之後的交易日只會回傳 `not_configured_trading_date`，畫面卻持續顯示歷史 `GO`／「訂閱已接受」，造成「容量曾通過」與「今日正在監控」混淆。2026-09-22 實查已確認當日 `dataActive=0`、結果為 0、最新 evidence 仍停在 2026-09-16，因此需要補上每日 session rollover 與狀態誠實性契約。

## What Changes

- 讓 durable premarket runner 以 `Asia/Taipei`、前一交易日盤後已驗證並落地的 TWSE／TPEx 年度日曆判定交易日，原子建立或推進每日 session；盤前四個節點不依賴官方網站即時回應，也不再依賴人工修改固定 `tradeDate`。
- 在前一適用交易日收盤後，以既有 simulation business session 有界採集 160 檔歷史 1 分 K 與獨立逐筆資料，完成驗證後原子發布下一交易日的同分鐘累積量基準；流量或來源不足時保留失敗收據，不降級成圖表快取或未核對 K 棒。
- 基準採集啟動門檻改由同 cohort、完整驗證的近期實測用量與當前 provider 額度計算，不再使用寫死的 256 MiB；採集期間逐請求檢查動態保留額度。當日最多三次獨立嘗試，每次來源、claim、失敗或成功 receipt 均 append-only，前次失敗不得覆寫。
- 若開盤前 API generation 換代，只在當日 session 尚未提出訂閱、尚無合法 KBar 與結果時，允許帶 append-only 換代證據的受控恢復；既有 scheduler 失敗收據與舊 generation 證據不覆寫。
- 將執行期所需 cohort、plan、baseline 與 prerequisite 解析成 archive-stable、可驗證的 immutable artifact reference；OpenSpec change 歸檔後不得留下失效 active-change 路徑。
- 將容量核准、今日 session、control-plane request、data-plane activity、baseline、config revision 與 evidence freshness 分離；任何 trade date／revision／artifact／generation 不一致都 fail closed。
- 將產品 sink 的正式核准與資料契約抽成可唯讀預檢，供盤前 Gate 與正式擷取共用；正式擷取失敗時立即嘗試本機通知，並由獨立排程於 08:52／13:40 複核遺漏或失敗收據，保存通知接手或失敗紀錄。
- 要求本機 status／diagnostics／results API 顯示 authority trade date、evidence trade date、evidence age、current-session 判定與明確 reason，不得以歷史 `complete_go` 冒充今日 live ready。
- 修正盤中監控 UI 文案與分類：歷史容量 `GO` 必須標示驗收日期與 reviewer 類型；「人工核准」不得用於 Codex 代理審閱；`waiting baseline=0` 不得被解讀為所有 configured 商品均有當日可用基準。
- 新增跨交易日、config revision 漂移、歸檔路徑遷移、排程實際觸發、stale evidence 與瀏覽器狀態的回歸／live acceptance；保留 provider physical usage、ownership、release 與 headroom 的 `unknown` 安全語意。
- 全程維持 Shioaji simulation-only、單一既有 business session、零 broker write、零 production／CA 與未授權 service lifecycle mutation。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `intraday-monitor-premarket-readiness`: 增加每日官方交易日 rollover、archive-stable artifact reference、排程 readback 與跨日 fail-closed 啟動需求。
- `intraday-relative-volume-monitor`: 將 active session 綁定 current trade date、config revision、generation、baseline 與新鮮 evidence，禁止重用舊 session state 產生比較或結果。
- `intraday-stock-selection-workspace`: 將歷史容量核准與今日 live 狀態分開呈現，新增 stale／revision mismatch／session inactive 的可稽核狀態與正確 reviewer 文案。
- `intraday-monitor-tiered-capacity-evaluation`: 明確規定 Stage 160 `GO` 只授予 durable active limit，不等於後續每個交易日的 live readiness、subscription confirmation 或人類簽核。

## Impact

- 受影響區域包含 `scripts/intraday-monitor-runtime/` 的 premarket orchestrator、product runtime state、artifact resolver、status projection 與 repositories，以及 `src/components/intraday-monitor-panel.tsx`、`src/lib/intraday-monitor-api.ts` 與相關測試。
- 本機 Application Support 內現有 2026-09-16 evidence 必須保留為歷史稽核資料；不得覆寫、刪除或改寫成 2026-09-22 live evidence。
- API 應以向後相容方式增加 session／freshness 欄位；舊 client 在缺欄時仍須 fail closed，而不是預設 current／active。
- 不變更 configured 上限 200、已核准 active limit 160、要求保留 40 的安全政策，也不推定 provider physical capacity。
