## 1. 現況基準與可驗收契約

- [x] 1.1 盤點目前內建頁籤、個人清單、商品目錄與 `candle_history_state` 的啟用商品來源，固定不含使用者識別的 target discovery 責任鏈與 eligibility 契約。
- [x] 1.2 以 deterministic fixtures 建立重複清單商品、新加入普通股、上櫃、ETF、指數與停用商品案例，明確列出應納入、去重、優先及排除結果。
- [x] 1.3 固定台北 `expected completed session`、同日晚間發布寬限、次日 10:00 SLA checkpoint、evidence freshness 與 overdue／degraded 判定表。
- [x] 1.4 實測並記錄既有 `/api/internal/candle-continuity-audit`、官方月資料 cache、每檔 request budget、timeout、retry 與 8 檔／並行 2 的效能基準。

## 2. D1 migration 與 durable repository

- [x] 2.1 新增 additive D1 migration，建立 `candle_continuity_runs` 與 `candle_continuity_run_items`，保存 run 身分、目標快照、cursor、priority、claim／lease、attempt、heartbeat、逐商品狀態、計數與 allowlist reason。
- [x] 2.2 為相同 run ID 冪等 start、`run_id + symbol` 唯一 item、待處理 priority lookup、lease 回收與最近 run health 建立必要 constraint／index。
- [x] 2.3 實作 run／item repository 的 create-or-read、claim、heartbeat、complete、retry-waiting、fail、resume、aggregate 與 bounded anomaly read，拒絕非法狀態轉移及過期 owner 寫入。
- [x] 2.4 增加 migration 重跑、舊 D1 資料保留、相同 run 重送、lease 接手、過期 owner、部分完成後 restart 與 rollback 相容測試。

## 3. 動態目標探索、快照與優先序

- [x] 3.1 實作 canonical 內建頁籤、啟用個人清單與相容商品目錄的 DISTINCT symbol discovery，不把清單名稱、使用者 ID 或完整 target list 寫入 log／health。
- [x] 3.2 套用既有 ordinary-stock／ETF eligibility，排除指數、權證、期貨、選擇權、非台股與停用商品，並在 run 開始時建立固定目標快照。
- [x] 3.3 實作新加入／未稽核、確認缺口、partial／unknown／過期、coverage 落後、待發布及 fresh complete 的穩定 priority 與同級 symbol 排序。
- [x] 3.4 讓 fresh complete item 以 skipped／fresh 終態計入當次 coverage，而不重新呼叫官方來源；下一個 run 重新 discovery 以納入 run 中途新增商品。
- [x] 3.5 增加跨清單去重、新商品最高優先、run 中清單變動、fresh skip、ineligible 排除、商品刪除與 51 檔以上穩定分頁測試。

## 4. Continuity orchestrator 控制面

- [x] 4.1 新增受保護的 continuity orchestrator route，支援 `orchestrator-start`、`orchestrator-tick` 與 `orchestrator-fail` 最小 schema，並沿用環境獨立 audit secret。
- [x] 4.2 start 依 deployment target、trigger、run ID 與 expected session 建立或讀取固定快照；相同 run 重送回傳原狀態，不重設 cursor 或 item。
- [x] 4.3 tick 每次最多 claim 8 檔、並行最多 2，更新 heartbeat／lease／cursor／計數；單一 item 失敗不得阻斷其餘 item。
- [x] 4.4 fail 僅接受 allowlist reason，保留已完成 item 與可續跑 cursor；完成、失敗與 retry-waiting 終態不得被舊 tick 覆寫。
- [x] 4.5 增加 start／tick／fail 冪等、重複 tick、Worker restart、lease 過期、舊結果晚到、部分成功、空目標與最大批次測試。

## 5. 稽核核心、限額與 SLA 整合

- [x] 5.1 讓 orchestrator item 呼叫既有 requested-scope continuity audit 與 repair，不複製另一套交易日或官方資料判定邏輯。
- [x] 5.2 沿用每檔最多 6 個未快取官方月請求、8 秒 timeout、單 key 最多一次 retry、月 cache、single-flight 與 payload cache 精準失效。
- [x] 5.3 將 `reference_not_published`、rate limit、timeout、provider／storage failure 映射為安全 item 狀態、retry after 與 allowlist reason，不保存完整上游 response。
- [x] 5.4 實作同日晚間 pending、次日 checkpoint overdue／degraded、合法休市／停牌／上市前排除及 expected session coverage 判定。
- [x] 5.5 增加 3008 既有缺口、Yahoo 修復、官方定點修復、來源未發布、rate limit、request budget 到頂、部分成功、checkpoint 前後與不補造 candle 測試。

## 6. Protected health 與安全摘要

- [x] 6.1 擴充 protected health，回傳 automation configured、最近 run、trigger、expected session、phase、heartbeat、checkpoint 與 processed／remaining／complete／partial／unknown／failed／overdue aggregate。
- [x] 6.2 以固定最多 20 筆穩定排序 anomaly items 回傳 symbol、status、verified through、missing count、checked time 與 allowlist reason，超量時標示 total／truncated。
- [x] 6.3 保留既有 `dailyCandleContinuity.items` 向後相容，並確認全域 `ok`、schema current 或 run completed 不會掩蓋逐商品 SLA degraded。
- [x] 6.4 建立 workflow-safe summary formatter，只輸出目標環境、run ID、expected session、aggregate、bounded reason 與代表性 acceptance，不輸出清單來源、完整 target set、OHLCV、SQL、header 或秘密。
- [x] 6.5 增加 health truncation、個人清單隱私、秘密掃描、非法 reason、全域成功但單檔 overdue 及舊 client 相容測試。

## 7. Sites／Cloudflare 每日 workflow

- [x] 7.1 建立共用 Node runner，執行 protected start／tick／fail、最多 60 ticks／15 分鐘、90 秒 HTTP timeout、response schema 驗證、錯誤 cleanup 與安全單行摘要。
- [x] 7.2 建立 Sites 每日 workflow，使用獨立 concurrency、`sites` run ID prefix、Sites 私人存取及 Sites audit secret，預設於台北 23:00 執行並保留 `workflow_dispatch`。
- [x] 7.3 建立 Cloudflare 每日 workflow，使用 `cloudflare-production` environment、獨立 concurrency、`cloudflare` run ID prefix、Access service principal 及 Cloudflare audit secret，預設於台北 23:30 執行並保留 `workflow_dispatch`。
- [x] 7.4 讓兩份 workflow 在完成後核對 exact deployment target、commit SHA、run ID、expected session、remaining／failed／overdue 與 protected health；匿名存取結果不得作為 health gate。
- [x] 7.5 增加 schedule／manual trigger、最小權限、單例、timeout、secret preflight、target isolation、safe log、tick 上限、cleanup 與錯誤退出 workflow contract 測試。

## 8. 全量與代表性自動驗收

- [x] 8.1 建立全量 runner fixture，證明 51 檔以上商品可跨 tick 穩定完成、cursor 不遺漏／重複，且 fresh item 不增加官方 request。
- [x] 8.2 固定 `3008.TW`、至少一檔 `.TWO`、一檔 ETF 與一檔新加入商品的代表性 acceptance，逐檔核對 expected session、continuity、missing count、verified through 與 cache reuse。
- [x] 8.3 驗證 Sites 與 Cloudflare 使用不同 D1／run／secret／access context；一邊成功、失敗、重試或過期不得改寫另一邊證據。
- [x] 8.4 執行 migration、orchestrator、continuity、cache、health、workflow、security、lint、build、完整 `npm test`、`git diff --check` 與 `openspec validate --all --strict`。

## 9. 本機實際驗收與發布準備

- [x] 9.1 在本機 D1 建立不含個人資料的代表性 target snapshot，跑完 start／多次 tick／restart／resume／complete，保存 aggregate、逐商品 anomaly 與 request budget 證據。
- [x] 9.2 在實際 MultiView 載入大立光、上櫃、ETF 與新加入商品，確認 panel loaded、continuity 文案、日期、主副圖對齊、所有可見 canvas 尺寸與 console。
- [x] 9.3 整理 additive migration 順序、schedule 預設關閉／啟用步驟、secret 名稱、Free-tier／上游 request budget、rollback 與不停止既有 simulation API、watchdog、5173／5174、pipeline、行情連線的發布邊界。
- [x] 9.4 將通過驗證的精準 scope 同步至發布 repo，明確排除 `add-mainforce-chip-subcharts` 與其他 deferred／unrelated 變更，並確認來源檔案 parity。

## 10. 雙環境正式發布與 OpenSpec 收尾

- [x] 10.1 在未取得使用者另行明確授權前，只準備 commit／push／migration／workflow／部署與驗收清單，不啟用 schedule、不配置或變更正式 secret、不部署。
- [ ] 10.2 取得分階段明確授權後，精準 commit／push，先部署並手動驗收 Sites 全量 run，再部署 Cloudflare exact SHA 並完成其獨立全量 run。
- [ ] 10.3 Sites／Cloudflare 各自驗證代表性逐商品 evidence、160／320 cache reuse、protected health、workflow safe summary、實際 DOM／canvas／console 與 SLA gate；不得以單一環境成功替代另一環境。
- [ ] 10.4 正式驗收通過後才啟用錯開的每日 schedule，觀察至少一個已完成交易日與次日 SLA checkpoint，確認無漏檔、無未受控 request、無假告警。
- [ ] 10.5 更新正式 spec、tasks 與非敏感 evidence，執行 strict validation 及 `git diff --check` 後再依使用者授權 archive；服務與行情連線維持既有運作。
