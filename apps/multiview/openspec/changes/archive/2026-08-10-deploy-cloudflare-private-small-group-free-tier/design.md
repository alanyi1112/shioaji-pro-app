## Context

現有產品由 Codex Sites 管理部署，Worker 以 `oai-authenticated-user-email` 識別使用者，D1 則以 `user_id` 隔離個人頁籤與清單。專案已有 Cloudflare Workers 相容建置輸出、D1 schema、GitHub Actions 資料排程及 `.openai/hosting.json`，但沒有使用者自管 Cloudflare deployment、Access JWT 驗證、Wrangler production 設定或自動部署流程。

目標使用者起始只有少數人，皆以 Google 帳號登入，但允許名單會由擁有者日後自行增刪改，尚無自訂網域。Cloudflare Free 的 CPU、request、D1 query／write、資產與 cron 限制比 Codex Sites 執行環境嚴格；目前每個 panel 的長時間 SSE、最高 80 個 D1 statement 批次、完整 payload cache 與未清理過期 cache 都必須先調整。TDCC 歷史來源仍需要外部 session adapter，因此 GitHub Actions 仍是合適的時鐘與來源執行器，但 Worker／D1 必須保有 plan、lease、驗證、寫入與完成狀態的權威。

## Goals / Non-Goals

**Goals:**

- 同一份核心程式可部署到 Codex Sites 與使用者自管 Cloudflare，兩邊能獨立運作與回滾。
- Cloudflare 以 Access Google IdP 驗證 Google 身分，再以私有 D1 動態名單授權私人小群組，並以驗證成功的身分隔離個人資料。
- 擁有者可在站內管理允許登入的 email、角色與啟用狀態，且不需重新部署程式。
- 使用 `workers.dev` 起步，之後新增自訂網域時不改應用程式身分與資料契約。
- 在 Cloudflare Free 可量測的安全預算內提供主要圖表、主副圖、個人清單、籌碼與本益比功能。
- `main` 通過完整 gate 後自動部署 Cloudflare，且無人登入時仍自動更新每日／每週資料。
- 秘密只存在 Cloudflare／GitHub 的受保護設定，不寫入 repo、artifact、log 或瀏覽器 bundle。

**Non-Goals:**

- 不建立兩套長期分岔的產品程式碼或複製 repository。
- 不將 Cloudflare D1 與 Codex Sites D1 做即時雙向同步。
- 不讓網站公開註冊、不讓一般成員管理名單，也不建立密碼、MFA、帳務或組織等通用帳號系統；只提供私人小群組必要的登入名單管理。
- 不在本變更購買或綁定自訂網域。
- 不把 TDCC 歷史來源的瀏覽器式 session 模擬硬搬到單次 Worker request。
- 不宣稱 Cloudflare Free 有 SLA；若真實量測超過安全預算，必須降載或升級 Workers Paid，而非隱藏失敗。

## Decisions

### 1. 採單一核心、部署介面分層

共用 `app/`、`worker/`、資料模型與測試，只將 deployment manifest、身分驗證、資產 binding、base URL 與 secrets 解析放在薄型 adapter。Codex Sites 繼續保留 `.openai/hosting.json` 與既有發布路徑；Cloudflare 使用獨立 Wrangler production 設定與 D1 binding。

替代方案是複製一份 Cloudflare 版本。兩份程式會快速產生圖表、資料 schema 與安全修正漂移，因此不採用。

### 2. Cloudflare 身分驗證與應用授權分層且 fail closed

Cloudflare runtime 先驗證 `Cf-Access-Jwt-Assertion` 的 RS256 簽章、`iss`、`aud`、到期時間及 email，再查詢私有 D1 的 active 登入名單。只有兩層都成功，才以正規化 email 作為現有 D1 `user_id`。只信任 `cf-access-authenticated-user-email`、任意 client header，或只驗證 Google 身分，都不足以形成應用層授權。Codex Sites runtime 仍使用平台提供的已驗證 header；production 未取得對應可信且獲准的身分時直接拒絕，不再 fallback 為 `local-sites-user`。

Access policy 使用 Google IdP 作為身分閘門；精確可登入名單由 D1 `access_users` 管理，避免每次名單變更都需要 Cloudflare 控制台權限。初始擁有者 email 只以 hosted secret 注入，當且僅當尚無擁有者且 JWT email 精確相符時，才能冪等建立第一位擁有者。OAuth client secret、初始擁有者 email與 Access audience／team domain 均不得寫入程式或 repository。

擁有者可在站內管理 `owner`／`member`、active／inactive 與 email。一般成員不得讀取完整名單；任何修改都保存私人稽核紀錄。系統必須保留至少一位 active owner，禁止自我鎖死。修改 email 只改變日後授權，不自動轉移舊 email 的個人頁籤或商品資料；資料遷移必須另行明確確認。

替代方案一是自行實作 Google OAuth session，會重複 Access 已提供的登入、session 與 policy 能力，增加 cookie、CSRF 與 token 儲存風險。替代方案二是把所有 email 靜態寫在 Access policy，無法滿足擁有者日後自行維護名單，且容易讓程式授權與平台 policy 漂移，因此皆不採用。

### 3. 人員與自動化使用不同授權通道

瀏覽器請求使用 Google／Access JWT；GitHub Actions 使用 Cloudflare Access Service Token 通過 edge policy，並繼續使用各資料管線自己的 bearer secret 通過應用層授權。部署 API token、Access service token 與資料 ingest secret 權限分離，任何一個 token 都不能同時取得帳戶管理與資料寫入能力。

替代方案是讓排程模擬某位 Google 使用者。人員帳號登出、MFA 或 session 到期會中斷資料更新，也無法安全稽核機器行為，因此不採用。

### 4. Cloudflare 與 Sites 使用獨立 D1，資料工作以目標設定驅動

兩個 deployment 各自綁定自己的 D1，不做 cross-account live query。個人清單資料不自動同步；既有 owner 資料只有在驗證來源身分與目標 Google email 對應後，才允許一次性遷移。共享市場資料由相同 runner 契約更新各目標，但 workflow 必須以 target-specific concurrency、base URL、Access credential 與 ingest secret 隔離。

對需大量外部抓取的歷史 adapter，單次來源下載可產生正規化 bounded payload，再依序送到需要的目標，避免為每個 deployment 無限制重抓；每個 D1 仍各自驗證與冪等寫入。任何一個目標失敗不得回滾另一個已成功目標。

### 5. Cloudflare runtime 以批次輪詢、有限工作與 retention 控制免費額度

Cloudflare target 不維持每個 panel 無限 SSE。前端以頁面級可見 symbol 批次輪詢取得即時摘要：交易時段使用有界間隔，休市、背景分頁與離線狀態降低頻率或暫停；完整 candles 仍依 cache key 按需取得。Sites target 可保留現有相容路徑，但共用 API contract。

每次 Worker invocation 的 D1 statements 設安全上限並預留 health／metadata 查詢空間；bulk write 只寫 changed tail，以小批次 checkpoint 續跑。過期 candle cache 由排程清理，並建立必要 index。runtime 不在一般 request 執行 schema DDL，migration 由部署流程完成，僅保留向後相容的 read guard。

籌碼日資料的 changed-only 判定採 canonical 內容比較：數值與來源識別／日期有變才更新，單純 `fetchedAt` 變動不觸發 D1 write。若當日來源只發布到前一個來源日，state 保存真實 coverage 與 `partial_data`，並設 30 分鐘冷卻；冷卻期間互動式重載直接使用既有資料，避免每次開頁重抓同一段歷史。部署前預算則以 3 位成員、每人每日前景 8 小時、最多 8 圖的日 K 情境計算 request、D1 read／write，CPU 保留為正式站實測 gate。

K 線歷史另外以 `provider + symbol + interval` 作為跨帳戶 canonical identity；個人清單只保存 membership，不參與行情 cache key。`candle_history_state` 記錄 configured full window 是否已抓完、實際 coverage 與可用 row 數，使新掛牌商品即使不足顯示根數，也不會被另一帳戶誤判為尚未回補。台股 Yahoo metadata 已進入新 session 但必要 OHLC 為空時，以相同 session 的 TWSE／TPEx 官方盤中或收盤 OHLCV 補齊共享 tail；官方 row 的優先級高於後續延遲來源，避免不同帳戶看到不同日期。

多層副圖不得同時為所有螢幕外籌碼 pane 建立 Lightweight Charts。每個 pane 保留 DOM、順序、選取與最近 payload，但只有進入 viewport 或有限預載邊界時才 mount chart；離開後必須 disconnect observer 並 `chart.remove()`。這讓四圖乘十二個籌碼副圖不再產生數百個 Canvas，也避免瀏覽器繪圖資源耗盡後讓 KD／ATR 等技術副圖整塊空白。

台股籌碼資格不得只依內建 setup 與可能延後更新的官方商品目錄。使用者已成功保存的清單 row 可作為該 principal 對該 symbol 的伺服器端 metadata fallback；判定合資格後，日資料與 TDCC target 仍以 symbol 為 canonical identity 全站共用。第一次保存立即在 `waitUntil` 預熱，既有清單開啟時若發現尚未登錄 TDCC target，則冪等自我修復；不得把 email 或清單 membership 寫入共享市場資料。

替代方案是直接把現有 SSE 與 80-statement batch 部署。這會使同時開啟多圖的 2～3 位使用者快速放大 request／CPU／D1 query，且可能超過每次 invocation 限制，因此不採用。

### 6. `main` 自動部署 Cloudflare，但保留人工 promotion 與 rollback gate

GitHub Actions 在 push `main` 後執行 deterministic install、lint、tests、build、OpenSpec strict、`git diff --check`、Wrangler dry-run 與 bundle／asset／D1 budget 檢查。成功後先套用 additive migration，再部署 Worker；使用 Access service credential 驗證首頁、health、身分拒絕、已授權讀取與一個非破壞性 D1 smoke。失敗時 workflow 必須停止 promotion，保留前一 deployment 可回滾資訊。

Codex Sites 不由此 workflow 冒充發布；它繼續使用既有 Sites 管理流程。同一 commit 必須能通過 Sites build 與 Cloudflare build，才能視為雙 runtime 相容。

Sites 舊 D1 曾由 runtime `PRAGMA table_info` 補齊本益比欄位，因此其 migration journal 可能落後於實際 schema。Sites 封裝流程在 plugin 標準 archive 建立後，以 repo 內可測試 script 將 `0018` 轉成 `runtime_metadata` baseline marker；Cloudflare Wrangler 仍直接使用 source migration。這個 target-specific artifact 差異只處理已知 schema drift，不改動核心程式或兩邊資料。

### 7. 正式切換分階段進行

先部署 Cloudflare preview／production Worker 與空白或測試 D1，完成 Access、資料隔離及核心功能驗收；再匯入必要資料並啟用 Cloudflare 資料排程；最後才將 Cloudflare 自動部署設為 required environment。現有 Codex Sites 全程保持目前可用版本，直到 Cloudflare production 通過驗收後才考慮同 commit 更新 Sites。

TDCC schedule 切換前必須處理 `move-chip-backfill-orchestration-into-sites-runtime` task 5.7 的真實 schedule／D1 health gate；本變更不得用手動 dispatch 冒充該證據。

## Risks / Trade-offs

- [Google OAuth／Cloudflare Access 需要使用者帳戶核准] → 只在已登入 dashboard 中操作，使用者親自完成必要 consent；不索取密碼，秘密直接存入受保護設定。
- [email 變更會形成新的 `user_id`] → 管理後台明確提示不會轉移個人資料；未確認 mapping 時保持兩份資料，不自動合併。
- [誤刪管理者造成無法維護名單] → D1 transaction／條件檢查保證至少一位 active owner，禁止最後擁有者被刪除、停用或降級，並保存稽核紀錄。
- [Access 接受 Google 身分但 D1 查詢失敗] → 應用授權 fail closed，回傳安全 reason code，不建立個人資料也不洩漏名單內容。
- [兩個 D1 不會即時同步] → 將個人清單視為 deployment-local；遷移是明確操作，共享市場資料由自動化各自維護。
- [Cloudflare Free CPU 或 request 仍可能因多圖重載超標] → 批次輪詢、cache、changed-tail、retention、usage health 與部署預算 gate；超標時先降載，仍不足才升級 Paid。
- [D1 migration 成功但 Worker deploy 失敗] → 只使用向後相容 additive migration，舊 Worker 可繼續讀取；保留前一版本 rollback。
- [兩個資料目標其中之一失敗] → target-specific run／concurrency／health，個別重試，不將部分成功誤報為全部成功。
- [Access 保護使匿名 smoke 只得到登入頁] → 分開驗證匿名拒絕與 service-token 已授權 API，不以 `302`／`401` 冒充應用健康。
- [FinMind 私人非商業邊界改變] → 只允許指定小群組且不公開原始資料；若改公開、商業或擴大使用，先停止相關管線並重新審查授權。

## Migration Plan

1. 完成並驗證 runtime identity adapter、Access JWT tests、D1 per-user isolation 與無身分 fail-closed。
2. 新增 Cloudflare Wrangler 設定、production D1、migration 與 `workers.dev` Access policy；先不啟用資料寫入排程。
3. 完成 Free-tier runtime 調整與完整 local／preview 驗證，記錄 bundle、query、write、request 與 CPU 觀測值。
4. 建立 Google IdP、初始擁有者 hosted secret、Service Token 與 GitHub Environment secrets；秘密與真實 email 只在平台私有設定或 D1 中保存。
5. 首次部署 Cloudflare，以初始擁有者登入並透過管理後台加入其他成員，驗證 owner／member／未列名身分的 allow／deny、名單管理、個人清單隔離、主要圖表與共享資料讀取。
6. 視需要執行一次性 owner 資料遷移，再以 row count、hash／sample 與目標 email 核對；來源資料保持不變以便回復。
7. 將 TDCC 與本益比 workflows 加入 Cloudflare target，完成真實 schedule 與 D1 health 證據後才視為自動資料更新完成。
8. 啟用 `main` 自動部署；Codex Sites 保持獨立發布。若 Cloudflare 回歸失敗，立即回滾上一 Worker version 並停用該 target 的資料寫入，不影響 Sites。
9. 若 Cloudflare D1 首次切換時只保存 TDCC 最新一週，使用本機低速官方歷史 adapter 產生 51 週公開資料快照；先備份 TDCC 公開表，再以快照 SHA-256、逐商品 coverage 與 material changed-only SQL 驗證後補入。此流程不搬移 Sites D1，也不接觸任何使用者資料。

## Open Questions

- 初始擁有者 email 以 Cloudflare hosted secret 設定；其他允許 email 由擁有者登入後透過管理後台加入。所有真實 email 均不寫入規格或 repository。
- 自訂網域申請後的 hostname、Access application 與 OAuth origin／redirect 更新另案處理；本變更以 `workers.dev` 完成正式可用狀態。
