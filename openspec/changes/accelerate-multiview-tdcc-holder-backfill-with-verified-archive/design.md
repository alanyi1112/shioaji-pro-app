## Context

MultiView 目前在商品加入自選清單或首次讀取 shareholder-distribution 時，會先以 TDCC `1-5` OpenAPI 寫入最新全市場快照，再將該商品註冊到 `tdcc_continuous_symbols`，由官方歷史表單逐週補足至少 51 週。這個流程能維持官方來源語意，但新加入的既有上市商品通常先只有一個點；歷史表單的 rate limit、冷卻、session 失效或封鎖會延長等待時間。

`wirelessr/tdcc-opendata-archive` 保存 TDCC `1-5` 原始 CSV。2026 快照自 2026-04-30 起累積，單檔包含全市場與完整 1–17 級；專案的盤後選股已具備 pinned commit、逐檔 bytes／SHA-256、完整 CSV 驗證與最新官方全檔對帳程式，但目前只寫入選股專用資料表，也未接入 MultiView 的 51 週 continuous ledger。

這項變更橫跨來源治理、D1 schema、全市場批次匯入、逐商品 ledger、三個執行環境與副圖可見狀態。設計必須同時滿足：鏡像不取代 TDCC 權威性、互動路徑不直接抓取外部檔案、既有官方列不被覆蓋、失敗可回復，以及新增商品可重用已準備的全市場歷史。

## Goals / Non-Goals

**Goals:**

- 將已核准且完整驗證的 2026 TDCC 歷史快照按週次一次匯入全市場，使之後加入的既有 `.TW`／`.TWO` 支援商品可直接從資料庫取得歷史。
- 沿用或抽出盤後選股已驗證的 archive parser／validator，避免兩套級距、整數精度、hash 與官方錨點邏輯漂移。
- 將 archive 已補週次精準併入 51 週 continuous plan，官方歷史 lane 只處理真正缺少的日期。
- 保存 period receipt、逐列 transport provenance、material hash、驗證版本與來源優先序，支援稽核、衝突隔離與回復。
- 讓大戶／散戶持股副圖立即使用已驗證部分歷史並清楚顯示快速補入與官方補缺進度。
- 在本機、Sites 保留站、Cloudflare 正式站分別完成資料、API、DOM、canvas、console 與 health 驗收。

**Non-Goals:**

- 不以 GitHub 鏡像取代 TDCC provider，不改變大戶、散戶級距公式或週變化定義。
- 不從浮動 `main`、使用者輸入 URL、redirect 或環境變數任意選取歷史檔。
- 不把 2021 的非連續快照混入第一版近 51 週線圖，也不宣稱鏡像能單獨補齊 51 週。
- 不由圖表 GET、頁面重整、商品點選或未識別 request 執行全市場下載或寫入。
- 不改變盤後選股專用六期資料、個人 watchlist ownership、Shioaji 訂閱、simulation runtime 或交易路由。
- 不啟用 production、真實下單、CA 或任何帳戶操作。

## Decisions

### 1. TDCC 保持唯一資料 provider，archive 只作傳輸鏡像

主資料列的 provider 仍為 `tdcc`。系統另外記錄 `official-openapi`、`official-history`、`verified-archive` 或 `legacy-verified` 等 transport／validation provenance，使用者介面與文件標示原資料提供機關及政府資料開放授權，並另列歷史傳輸鏡像 repository。

替代方案是把 `wirelessr` 當成第二 provider；這會讓相同官方資料產生不必要的來源分叉，也可能讓 UI 誤解鏡像具有獨立權威性，因此不採用。

### 2. 採全市場 period seed，而非每個新商品重新下載

每個核准週次只下載、解析與驗證一次，依當次台股支援母體正規化為每個 `symbol + data_date` 一列，再匯入 `taiwan_stock_shareholder_distribution`。使用者之後加入 8103 或其他已存在於母體的商品時，只查詢本機／D1，互動路徑不需再下載約 18 個全市場檔案。

替代方案是每次加入商品才掃描所有 CSV；雖然比逐週官方歷史表單快，但會讓每位使用者、每個商品重複傳輸約數十 MB，無法形成穩定的快速路徑，因此不採用。

### 3. Manifest 分為初始核准集合與未來 append-only 週次

初始 bootstrap 由實作時固定的 immutable commit 與逐期 manifest 建立，至少記錄 date、exact URL、bytes、SHA-256、commit 與 normalization version。任何 runtime 都不得直接以 `main` 讀取初始歷史。

未來新週次原則上仍由 TDCC 官方 latest pipeline 直接保存全市場，不依賴鏡像。若要將該週加入可重建 manifest，只能在同次取得的官方全市場 payload 與固定 commit 下的候選 CSV canonical rows 完全一致後 append；既有日期、hash 與 receipt 不得就地改寫。

替代方案是排程自動信任 upstream `main` 所有歷史；最新一週即使與官方相同，也不能證明被改寫的舊檔正確，因此不採用。

### 4. 所有 archive 寫入採 staging-first、period-atomic 與 insert-only

新增 period receipt 與 staging／provenance 結構。operator 先完整下載所有目標檔並驗證 manifest，再按 period 將正規化列寫入 staging；只有 row count、symbol count、完整性與 material hash readback 全部通過，才以 period finalize 將缺列提升至正式表並將 receipt 標示 `verified`。中途失敗的 staging 可依 run id 清理或續跑，不讓 UI 讀到半期資料。

Archive finalize 對正式表採 insert-only。若 `symbol + data_date` 已有官方或 legacy verified 列，保留原列並比較 material hash；相同則記錄 `matched_existing`，不同則將 receipt／row 標示 `source_mismatch` 並阻擋該 period finalize，不得覆蓋。

替代方案是沿用目前一般 upsert；該 upsert 會在 material 不同時更新，無法保證 archive 不覆蓋官方資料，因此不採用。

### 5. 共用嚴格 validator，且在任何正式寫入前完成全批驗證

共用 validator 必須檢查：UTF-8、精確六欄欄名、單一預期資料日期、合法證券代號、去除 TDCC padding、每商品唯一 1–17 級、安全整數人數／股數、合法比例、調整與合計守恆、最低 row／symbol 數、檔案大小、SHA-256 及 allowed host／path。最新 manifest period 必須與同次 TDCC 官方 OpenAPI 的 canonical 全市場 rows 完全一致。

初始歷史 period 也必須與資料庫中任何既有官方重疊列比較；有一筆不一致即拒絕對應 period。任一 manifest 檔驗證失敗時，整個新 manifest run 不得開始正式寫入，但既有 verified periods 與副圖保持可用。

### 6. Archive coverage 直接完成相同 continuous item，官方只補剩餘日期

Period finalize 後，以現有官方 period plan 為基準重新計算每個 active symbol 的 expected dates。只有資料列完整且 period receipt verified 的 `symbol + date` 才可將對應 `tdcc_continuous_items` 標為 completed；不得只因 CSV 中沒有商品便宣稱完成。合法新上市、下市或官方無資料須使用既有可驗證 unknown／insufficient 語意。

官方 history runner 依 `remaining` 取工作，優先補最近缺口並持續到既有 51 週目標成立。官方取得同日期時比較 material hash：相同則把 provenance 提升為 official-confirmed；不同則隔離、保留最後 verified row 並將該 item 標為待處理衝突。

### 7. 將可顯示狀態與完整完成狀態分開

API 回傳至少包含 `displayWeeks`、`archiveImportedWeeks`、`officialVerifiedWeeks`、`expectedWeeks`、`remainingWeeks`、`failedWeeks`、`overdue` 與安全 reason。只要有兩個相鄰 verified periods，大戶／散戶持股副圖即可畫線並計算週變化；不得等 51 週全部完成才提供已驗證歷史。

UI 狀態分為：快速資料準備中、已快速補入且官方背景補缺中、完整、來源暫時受阻、資料衝突。狀態變更不可清空最後已驗證 payload，且不得把 non-adjacent periods 當作相鄰週計算。

### 8. 三環境由同一 manifest 與驗證版本驅動，但各自保存 receipt

本機 operator、Sites workflow 與 Cloudflare workflow 使用同一 committed manifest／validator version，卻分別寫入各自資料庫與 period receipt。任何環境只有在自己的 receipt、row count、coverage、health、API 與 UI 都通過後才可宣稱完成；其他環境成功不能代替。

內部 archive route 必須使用既有機器授權邊界、固定 scope、single-flight、lease、request／time budget 與 safe error allowlist。外部 GET、匿名 POST 與 UI 不得指定 URL、commit 或 payload。

### 9. 以 period 數與資料庫實測控制效能及容量

初始 2026 seed 預期約 18 個全市場 period、每期約四千個商品；實作前後必須量測資料庫 page count／bytes、每期寫入時間、API latency 與 D1 batch 限制。Warm path 的目標是商品儲存完成後下一次 shareholder-distribution API 只做資料庫讀取，代表性本機驗收 p95 不超過 2 秒且 archive/provider request 計數為零。

若容量或批次限制不符，優先縮小保留到 active 51-week window 或調整 staging chunk，不得改回每商品互動式下載，也不得刪除仍被 receipt、ledger 或可見線圖引用的 verified rows。

## Risks / Trade-offs

- [上游 repo 改寫或遭入侵] → runtime 不信任浮動 branch；只讀 immutable commit、exact hash，舊 period append-only，最新新增期須與官方全市場完全對帳。
- [初始 2026 鏡像未涵蓋完整 51 週] → UI 明示快速補入期數；官方 continuous runner繼續補真正 remaining，不宣稱完整。
- [全市場歷史增加 D1 容量與寫入成本] → 先量測 staging／正式表增量、period rows 與 page count，使用 period chunk、active window retention 與 receipt 引用保護。
- [部分 period 寫入造成線圖混合] → staging-first、period finalize、receipt gate；API 只讀 verified receipt 對應列。
- [鏡像與既有官方列衝突] → insert-only、material hash 比較、`source_mismatch` 隔離；不得覆蓋或清除最後 verified row。
- [不同環境 manifest 或 schema 漂移] → 同一 release SHA、manifest version、migration hash 與 validator version；逐環境保存並核對 receipt。
- [TDCC 發布日期不固定或 catalog metadata 與實際週期不同] → 以 payload 的 `資料日期` 與官方 period plan 為真相，不以日曆星期、檔名或 metadata 更新頻率推定資料已發布。
- [正式 UI 被背景狀態頻繁重繪] → material payload／progress signature 去重；只有資料列或使用者可見狀態實際變化才 render。

## Migration Plan

1. 保存實作前 Git／OpenSpec、三環境 schema、D1 integrity、TDCC period coverage、代表 `.TW`／`.TWO` 與 8103 API／副圖基線；不修改既有未提交工作。
2. 抽出共用 archive manifest parser／validator，先以既有六期 fixture 與拒絕案例證明不改變盤後選股結果。
3. 套用 additive migration，建立 period receipt、staging 與 row provenance；對既有正式列建立不改寫 material 的 legacy／official provenance。
4. 在隔離 staging DB 跑完整初始 manifest，通過 bytes、hash、17 級、官方最新全檔 anchor、既有重疊列、row count、material hash 與 integrity。
5. 先於本機執行 period finalize 與 continuous reconciliation，驗證 8103 等代表商品後，再依相同 release SHA 分別執行 Sites、Cloudflare。
6. 啟用 API coverage 與 UI 狀態；確認新增商品 warm path 為 DB-only，官方 runner 只處理 remaining dates。
7. 執行完整 tests、lint、strict OpenSpec validation、migration dry-run／readback，以及三環境 protected API／DOM／canvas／console 驗收。

Rollback 時停用 archive seed／manifest extension，但不停止既有 TDCC official runner。Additive schema 可保留；若特定 receipt 被證明無效，只能依 receipt id 移除由該 receipt 新增且未被官方確認的 rows，先備份並在 staging 計算受影響 coverage，再以 transaction 回復。既有官方／legacy rows、個人清單、simulation runtime 與交易資料不得刪除或改寫。

## Open Questions

- 實作當下應固定的 upstream exact commit 與 2026 manifest 最終 through date，須在 source review 重新取得並保存，不沿用規格撰寫日的浮動 `main`。
- Sites 與 Cloudflare 的實際 D1 容量／batch 上限是否需要將 staging 分成每期多個 chunk，須由 migration benchmark 決定。
- 初始 full-market seed 完成後，archive 原始 bytes 是否只保留 manifest／hash，或另存 repo 外可重建 cache，須依三環境儲存能力與營運需求決定；不得將大型原始資料提交進應用 repo。
