# 第二階段隔離實作驗收（2026-10-03）

## 本輪完成

- task 2.5：凍結底稿結構／hash 驗證、未格式化指標排序、unknown 置末、穩定 code tie-break、分頁及 cursor fingerprint。fingerprint 固定快照、來源／商品底稿、參數、階段集合、排序、狀態與頁大小；改設定必須拒絕舊 cursor。
- tasks 3.2、3.3：新增獨立歷史 schema、canonical 股／TWD 實際金額、exact URL／payload hash／review hash／fetchedAt、逐商品終態。準備器按 market/date 最新優先，預設每輪最多兩次來源 port 呼叫、8 MiB、15 分鐘；每次來源呼叫最長 30 秒，單一租約、只續缺項。
- task 3.5：已驗證批次先保存再投影，中止續跑使用相同不可變來源補缺列；同一 universe revision 若變更母體拒絕，不能混用 immutable rows。新上市、下市後、明確停牌、無成交、缺來源／價／量／金額均保留理由，不造 K 棒。
- task 5.3：每市場日期最多 18 次來源 port 嘗試、一般等待至少 20 分鐘、429 尊重 Retry-After 且至少一小時、日期／schema invalid 不自動解除。started／source_verified／complete／failed／partial 收據追加保存，不覆寫原紀錄；過期 owner 不可發布成功資料。

這些 checkbox 指程式與隔離測試完成，不表示 task 1.1 已驗證真實來源、task 7.2 已取得 160 日正式資料，或 task 7.3 已有真實每日自動 run。

## 測試與安全證據

- 支援版本 Node 24.19.0，使用 `/opt/homebrew/opt/node@24/bin`；未更動既有服務的 Node 或 runtime 設定。
- Node tests 38／38：新準備器 15、單次官方 transport 4、保留聯集 4、既有 v3／v4 bootstrap 15。
- Vitest 10 files／119 tests：新凍結查詢／v8／history 與 v7、v6、v5、v4、domain、API、condition UI 回歸。
- 隔離 160 日 × 2 市場的 320 targets 經 18 輪有界準備完成；重觸發來源 port 呼叫為零。fixture grid、payload、review、readiness 與 request count 不是官方來源或實際網路驗收證據。
- 投影中止、整輪 deadline、並行 lease、429、18 次耗盡、雙市場混日、HTML、來源契約未成立及新 schema 缺席皆經隔離測試。失敗收據與完成資料保留；來源錯誤不改官方 session grid。
- 保留政策回歸使用原有 SQLite 測試，不涉及真實資料庫清理。新 migration `0035_screener_bollinger_history.sql` 未套用到產品資料庫。
- 未接正式 watcher、HTTP route 或面板，未增加 broker login／subscription、改交易草稿、啟停服務、commit、push、archive 或安裝排程。
- 根 TypeScript project、包含 scripts／schema 的獨立 strict type check、`pnpm build` 通過；保留既有 bundle 大於 500 kB 警告。
- 此 change 的 OpenSpec strict validation、`git diff --check`、本輪新增檔空白／衝突標記檢查通過。任務總數為 33，目前完成 14。

## 未完成與後續 Gate

TPEx 指定日期入口仍是 `ECONNRESET`，歷史入口適用使用範圍尚未核實。保留原查證紀錄，沒有把失敗改成成功或建立真實來源 verified review。

task 4.3 的排序／分頁 core 已完成，但 HTTP API 尚未接線；4.1–4.5 的 publisher／atomic head／profile／同日 legacy join、5.1–5.2／5.4 的 watcher 與 idle gate、6.x 的面板及 7.x 真實驗收仍未完成。

新增單次官方 HTTPS transport factory，不跟轉址、不自行重試、不停用 TLS 驗證，與準備器每次 attempt 一次 request 的契約一致。以隔離 transport 測試驗證 429／302／重設／半份回應中止及 8 MiB 上限；本輪尚未接入正式 watcher。以一個 12 秒有界 signal 對 TPEx 指定日期入口唯讀查證，採既有 collector 的 TLS1.2 設定，仍回 `read ECONNRESET`，沒有可驗證 body。這是來源失敗證據，不是正式歷史下載／native transport 成功驗收。

正式匯入前先核實 source review，再量測兩市場 bytes／時間與來源限制。未成立時保持 `source_contract_pending`；後續 publisher／API／UI 可接續完成程式，但不得跳過來源 Gate 啟用正式報告。
