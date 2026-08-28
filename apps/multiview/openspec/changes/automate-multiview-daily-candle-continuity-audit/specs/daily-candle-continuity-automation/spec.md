## Purpose

建立 MultiView 啟用台股商品的每日日 K 連續性營運契約，使 Sites 保留站與 Cloudflare 正式站能在有限額度內持續稽核、修復、保存逐商品證據並對逾期異常明確告警。

## ADDED Requirements

### Requirement: 每日稽核必須動態探索所有啟用台股商品

系統 MUST 在每個目標環境的每日 continuity run 開始時，從該環境目前啟用的內建清單與個人清單動態建立 `.TW`／`.TWO` 普通股及 ETF 目標，不得在 workflow 固定完整 symbol 清單。相容商品目錄 MUST 僅用於補充 active、quote type 與市場 metadata；商品目錄中「仍上市」但未出現在啟用清單的商品 MUST NOT 被視為已啟用目標。目標 MUST 正規化、去重並套用既有台股 eligibility；指數、權證、期貨、選擇權、非台股與停用商品不得進入日 K continuity 稽核。

#### Scenario: 多份清單包含相同商品
- **WHEN** 同一 eligible 台股商品同時存在於內建清單與一個以上個人清單
- **THEN** 當次目標集合 MUST 只包含該 symbol 一次
- **AND** 稽核結果 MUST 不含清單名稱、使用者識別或重複 request

#### Scenario: 新商品加入清單
- **WHEN** eligible `.TW`／`.TWO` 商品在前一個 run 之後首次加入任一啟用清單
- **THEN** 下一個 run MUST 自動探索該商品
- **AND** 尚無 continuity evidence 的新商品 MUST 優先於已完成且證據仍新鮮的商品

#### Scenario: 不合格商品出現在清單
- **WHEN** 目標來源包含指數、非台股、非日 K 適用商品或停用商品
- **THEN** 系統 MUST 在執行上游請求前排除該商品
- **AND** MUST NOT 因排除商品而將其他 eligible 商品標示失敗

### Requirement: Continuity run 必須持久化且可續跑

每個目標環境 MUST 以唯一 run ID 保存當次 expected completed session、trigger、目標快照、cursor、逐商品狀態、attempt、heartbeat、計數與安全終態。相同 run ID 的 start／tick／fail MUST 冪等；Worker restart、workflow retry 或單次 tick 中斷後 MUST 從已保存位置續跑，不得重設已完成商品或建立重複 run。

#### Scenario: Worker 在批次中途重新啟動
- **WHEN** run 已完成部分商品後 Worker restart 或 isolate 更換
- **THEN** 下一個合法 tick MUST 從持久化 cursor 與逐商品 item 續跑
- **AND** 已完成商品 MUST NOT 因 restart 被重新排入同一 run

#### Scenario: 相同 run ID 重複 start
- **WHEN** workflow retry 對同一環境、trigger 與 run ID 再次送出 start
- **THEN** 系統 MUST 回傳原 run 的目前摘要
- **AND** MUST NOT 建立第二份目標快照或重置已保存終態

#### Scenario: 舊 run 的 lease 過期
- **WHEN** run 長時間沒有 heartbeat 且 lease 已逾期
- **THEN** 後續 tick MUST 能安全接手未完成 item
- **AND** 舊 owner 的延遲結果 MUST NOT 覆寫新 owner 已提交的狀態

### Requirement: 每日稽核必須遵守有限額度與穩定優先序

單次 tick MUST 最多處理 8 檔商品、並行度最多為 2，且 MUST 沿用每檔 continuity audit 的官方新月份請求、timeout、retry、cache 與 single-flight 上限。單一 workflow run MUST 有最大 tick 數及最大執行時間；優先序依序為新加入／未稽核、有確認缺口、`partial`／`unknown` 或 evidence 過期、最新交易日 coverage 落後，已完成且證據新鮮者 MAY 直接略過。

#### Scenario: 目標數超過單次批次
- **WHEN** 當次待稽核 eligible 商品超過 8 檔
- **THEN** tick MUST 只 claim 有界批次並保存 remaining count 與 next cursor
- **AND** 後續 tick MUST 依穩定優先序續跑而不遺漏較後面的商品

#### Scenario: 官方來源 rate limit
- **WHEN** 單一商品或批次遇到官方 rate limit、timeout 或暫時不可用
- **THEN** 該商品 MUST 保存 allowlist reason、retry after 與未完成狀態
- **AND** 其他商品 MUST 繼續處理，workflow MUST NOT 以無上限立即重試耗盡額度

#### Scenario: Workflow 到達時間上限
- **WHEN** run 尚有未完成商品但已達最大 tick 數或執行時間
- **THEN** run MUST 保存 cursor、remaining count 與可續跑狀態
- **AND** 下一次排程或人工觸發 MUST 能接續處理，不得將 remaining 商品誤算為 complete

### Requirement: 逐商品 SLA 必須區分等待發布與逾期異常

系統 MUST 以台北交易日與 expected completed session 判斷每檔 continuity evidence 是否新鮮。官方資料仍在發布寬限期時，`unknown`／`partial` MUST 顯示為 pending；超過下一個明確 SLA checkpoint 仍未涵蓋 expected session、仍有 `missing_traded_session`、evidence 過期或 run 失敗時，該商品 MUST 標示 overdue／degraded。全域 schema、D1、workflow 或其他商品成功 MUST NOT 取代逐商品 SLA。

#### Scenario: 官方資料仍在寬限期
- **WHEN** run 在已完成交易日後執行，但官方商品資料尚未發布且尚未超過 SLA checkpoint
- **THEN** 商品 MUST 維持 pending 並保存 `reference_not_published` 或等價安全原因
- **AND** MUST NOT 產生假 candle、mismatch 或立即的資料缺口告警

#### Scenario: 超過 SLA 仍未核對
- **WHEN** 到達下一個 SLA checkpoint 後，商品的 verified through 仍早於 expected completed session，或 continuity 仍為 `partial`／`unknown`
- **THEN** 逐商品 health MUST 標示 overdue／degraded 並提供安全 reason
- **AND** 每日 workflow 的品質 gate MUST 以失敗終態提示需要處理

#### Scenario: 只有部分商品失敗
- **WHEN** 同一 run 中部分商品 complete、部分商品 overdue 或 failed
- **THEN** health MUST 分開回報各狀態計數及有界異常 item
- **AND** MUST NOT 以 run completed 或 complete 商品數掩蓋異常商品

### Requirement: Sites 與 Cloudflare 必須獨立排程及隔離狀態

Sites 保留站與 Cloudflare 正式站 MUST 使用分開的 workflow、concurrency group、run ID namespace、protected access、audit secret、D1 run／item 狀態與 health 證據。任一環境成功、失敗、重試或 cursor 進度 MUST NOT 改寫另一環境；匿名 `401`／`302` 或存取邊界結果不得冒充 application health。

#### Scenario: Sites 完成但 Cloudflare 失敗
- **WHEN** 同一 expected session 的 Sites run 完成，而 Cloudflare run 因 protected access、D1 或來源問題失敗
- **THEN** Sites health MUST 保留自己的完成證據
- **AND** Cloudflare MUST 維持失敗或待續跑狀態，不得引用 Sites 結果宣稱完成

#### Scenario: 排程使用不同安全邊界
- **WHEN** workflow 呼叫 Sites 或 Cloudflare 的 continuity orchestrator
- **THEN** Sites MUST 使用其既有私人存取與獨立 audit secret
- **AND** Cloudflare MUST 使用其 Access service principal 與獨立 audit secret
- **AND** workflow、health 與 log MUST NOT 輸出秘密值、cookie、完整 header 或原始上游 response

### Requirement: Health 與排程摘要必須安全且可驗收

Protected health MUST 提供最近 run 的 run ID、trigger、expected session、status、phase、heartbeat、processed／remaining／complete／partial／unknown／failed／overdue 計數，以及有固定上限的逐商品異常證據。GitHub Actions log MUST 只輸出 aggregate、安全 allowlist reason 與代表性驗收摘要，不得輸出完整個人清單、完整 symbol 集合、OHLCV payload、SQL、秘密或上游 response。

#### Scenario: 排程正常完成
- **WHEN** 當次 eligible 商品皆已具有涵蓋 expected session 的 complete 或合法排除證據
- **THEN** run MUST 進入 completed 且 remaining、failed、overdue 均為零
- **AND** protected health 與 workflow summary MUST 能交叉核對 run ID、目標環境、expected session 與計數

#### Scenario: 異常商品超過輸出上限
- **WHEN** overdue、failed 或有缺口的商品數超過 health item 上限
- **THEN** health MUST 回傳總數與截斷後的穩定排序 item
- **AND** MUST 明確標示 truncated，不得無限制擴張 response 或 log

### Requirement: 自動化必須通過代表性與全量雙環境驗收

變更完成前 MUST 以 deterministic tests 證明目標探索、優先序、durable cursor、lease、部分成功、SLA、限額與環境隔離，並在 Sites 保留站及 Cloudflare 正式站各完成一次已授權的全量 run。正式驗收 MUST 包含 `3008.TW`、至少一檔 `.TWO`、一檔 ETF 與一檔新加入商品，並核對 cache reuse、逐商品 health、排程摘要及實際 MultiView 日 K 畫面。

#### Scenario: 大立光回歸與代表性商品驗收
- **WHEN** 正式 run 處理大立光、上櫃、ETF 與新加入商品
- **THEN** `3008.TW` 的既有指定交易日 continuity MUST 保持 complete 且 missing count 為零
- **AND** 其他代表性商品 MUST 各自具有涵蓋 expected session 的逐商品證據，不得只引用大立光結果
- **AND** 已授權 acceptance MAY 核對最多 4 檔不在當日 target snapshot 的合法台股代表 symbol，但 MUST NOT 因此擴張 durable target set；普通稽核仍 MUST 拒絕非啟用商品

#### Scenario: 實際雙環境品質 gate
- **WHEN** 候選版本準備完成發布
- **THEN** lint、完整測試、migration、OpenSpec strict、workflow contract 與 rollback 驗證 MUST 通過
- **AND** Sites／Cloudflare 的 protected run 與 health MUST 分別通過
- **AND** 實際 MultiView MUST 顯示代表性商品 panel loaded、continuity 文案正確、canvas 尺寸有效且 console 無新增錯誤
