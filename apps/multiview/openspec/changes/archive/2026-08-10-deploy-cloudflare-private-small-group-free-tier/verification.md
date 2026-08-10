# 驗證紀錄

## 2026-07-29 實作前基線

- Git：`main` 與 `origin/main` 均指向 `918275844d87023f1067687c30f7448b344da391`；工作樹原先另有未追蹤的 `add-mainforce-chip-subcharts`，本變更不得納入或覆蓋。
- OpenSpec：`move-chip-backfill-orchestration-into-sites-runtime` 尚有 task 5.7 未完成；未取得新鮮且已授權的 D1 health 前保持 active，不歸檔。
- Codex Sites：匿名請求首頁與 `/api/health` 均回傳 `401`，符合私有站邊界；既有登入頁面可開啟，但本輪直接導向 health 遭瀏覽器擴充功能阻擋，不能視為 fresh D1 health 證據。
- GitHub：CLI 已有可用的 repository／workflow 權限；只記錄授權狀態，不保存 token。
- Cloudflare：Wrangler OAuth 已登入且具備 Worker／D1 所需權限；只記錄授權狀態，不保存帳戶識別碼或 credential。
- TDCC：最近核對的真實 `event=schedule` run 為 `30377609888`，結束狀態成功；安全摘要為 daily `remaining 40` 至 `0`、`pending 41` 至 `11`、`reason=source_not_published`，history adapter 為 `--history-only` 且 `completedSymbols=0`、`completedWeeks=0`。此項不取代 D1 health。
- 本益比：最近可見的真實排程 run 為 `30455042883`，結束狀態成功；仍須在 Cloudflare target 建立後分開驗證其 D1 寫入與 health。
- 本機 D1：約 62 MB；主要空間為 `candle_cache` 約 47.7 MB、`taiwan_stock_chip_daily` 約 8.1 MB、`candle_history` 約 3.3 MB。`candle_cache` 共 356 筆且全部已過期，顯示部署前必須加入 retention／cleanup。
- 本機資料列：`candle_history=24656`、`taiwan_stock_chip_daily=4470`、`taiwan_stock_pe_valuation_daily=2700`、`user_tabs=3`、`user_instruments=3`。
- D1 statement：現行程式仍有每批 80 statements 的路徑，必須在 Cloudflare production 發布前降為有界安全批次。

## 完成門檻

- 真實 schedule、安全摘要與已授權 D1 health 必須分開保存證據。
- 不得將匿名 `401`、控制平面資訊、workflow log 或舊 health 當成 fresh private D1 health。
- 所有帳戶、email、token、Access secret 與 pipeline secret 只存在平台設定；文件一律以用途或 `[REDACTED_SECRET]` 表示。

## 2026-07-29 Cloudflare 候選環境

- 已建立 APAC D1 `multichart-production` 並成功套用 `0000` 至 `0017` 共 18 個 migration；再次執行 remote migration list 顯示無待套用項目，資料庫識別碼只保存在平台／本機忽略設定。
- 第一次 Worker upload 因 vinext RSC module 未隨 `no_bundle` 上傳而在切換前失敗；補上 ES module rules 後成功部署候選版本。
- `workers.dev` 首次請求遇到 same-zone fetch `1042`；依 Cloudflare Workers 相容性契約加入 `global_fetch_strictly_public` 後，匿名 health 穩定回傳 Worker 自身的 `403 missing_access_token`，證明目前保持 fail-closed。
- 該候選版當時尚未設定 Cloudflare Access team domain、audience、Google IdP、初始 owner hosted secret 與 service token，因此當時不得視為可交付正式站，也不得啟用自動排程；後續設定見下節。

## 2026-07-29 Access、自動部署與排程設定

- 未建立或綁定任何新的 Google Cloud 帳務帳戶；改用既有專案建立本應用專用 Web OAuth client，origin 與 redirect 只指向 Cloudflare Access team domain。Google IdP 測試頁已顯示連線成功。
- `workers.dev` 已建立 Cloudflare Access self-hosted app，只接受 Google 人員登入；一般 Google 身分通過 Access 後仍須命中 Worker 私有 D1 active 名單，另有獨立 Service Auth policy 供 GitHub Actions 使用。
- 初始 owner 只以 Worker hosted secret 保存；Cloudflare D1 的 `access_users` 與 `access_audit_log` 已由 `0017` migration 建立，實際 email 未寫入 repo、OpenSpec、測試或 log。
- GitHub `cloudflare-production` Environment 已保存 base URL、Access 設定、D1 設定、Service Token 與 pipeline secrets；部署 Token 只具目前帳戶的 Workers Scripts Edit 與 D1 Edit。
- Cloudflare TDCC 與本益比採獨立 workflows、concurrency、run ID、base URL、Access Service Token 與 pipeline secrets；Codex Sites 既有 workflows 與 secrets 均未變更。
- 本機完整驗證：`npm run lint` 成功、`npm test` 為 `321/321`、OpenSpec strict 成功、`git diff --check` 成功；Cloudflare build、Wrangler dry-run 與 Free-tier budget gate 皆成功，估算每日 requests 為 `25,000 / 100,000`。
- 尚待：push 後自動部署、匿名／Service Token smoke、owner 與 member 瀏覽器驗收，以及實際 `event=schedule` 的 Cloudflare D1 fresh health。完成前不得歸檔本變更。

## 2026-07-29 首次自動部署診斷

- 第一輪 push 在 GitHub runner 找不到全域 OpenSpec CLI；正式環境尚未 migration／deploy。已將 `@fission-ai/openspec` 以 exact dev dependency 納入 deterministic install，第二輪的 lint、`321/321` tests、OpenSpec strict、diff、budget、migration 與 deploy 均通過。
- 第二輪受保護 smoke 發現 remote D1 缺少 `latest_source_date`，workflow 正確執行自動 rollback；Cloudflare tail 只保存 `no such column` 安全診斷，未輸出 request credential。
- 根因是舊 Sites D1 曾用 runtime `PRAGMA` 補欄位，但 `0011` 至 `0017` 的 SQL migration 未完整收錄；Cloudflare 已停用 request-time DDL，所以新增 `0018_cloudflare_pe_runtime_columns.sql` 將所有本益比 runtime 欄位轉為 deploy-time schema，並新增舊 schema 套用測試。
- 第三輪 migration 已補齊欄位，但受保護 smoke 顯示 Access runtime 設定仍缺失；版本唯讀檢查確認 `CLOUDFLARE_*` 會被 Wrangler／Cloudflare 視為平台保留前綴而未成為實際 Worker plain-text bindings。Worker runtime binding 改為 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 與 `ACCESS_OWNER_EMAIL`，GitHub Environment 的部署輸入名稱維持原狀。
- 正確 Worker version 以 Service Token 實測 health 為 `200`、`ok=true`、`deploymentTarget=cloudflare`、D1 可用且 commit SHA 完全相符。第四輪失敗源自 deploy 後邊緣傳播延遲，以及 rollback baseline 誤取 deployments array 第一筆舊版本；workflow 改為最多 12 次、每次 5 秒的 bounded smoke，並從最後一筆 deployment 取得 rollback version。
- 第一次 Cloudflare 資料 `workflow_dispatch` 中，本益比 runner 通過 Access 但 control endpoint 回 `401 unauthorized`；確認 Access 會攔截一般 `Authorization` header。Cloudflare runner 改用 `X-MultiChart-Pipeline-Authorization` 傳 pipeline secret，Worker 同時接受新 header 與 Sites 原有 `Authorization`，避免破壞既有排程。
- 2026-07-30：正式 PE `workflow_dispatch` 已證明 Access 與 pipeline secret 可到達 Worker；首次回傳 `license_review_required`，定位為部署設定誤用未允許的 `free` 值，已修正為明確 `private`、`false` 並補回歸測試，待重新部署後驗證。

## 2026-07-30 Cloudflare 正式環境終驗進度

- 自動部署 run `30470704689` 以 push event 發布 commit `1ecfad4c07f1908af5f93f84ee87021f402ead31`；lint、`324/324` tests、OpenSpec strict、diff、Free-tier budget、D1 migration、exact-commit deploy、匿名 Access boundary 與 Service Token protected smoke 全數成功，未觸發 rollback。
- 瀏覽器已驗證 owner Google 登入後可載入正式圖表及「登入名單」後台，並在 D1 建立三個 active 帳號；切換 member Google 登入後可載入圖表、我的清單與主副圖選單，但看不到 owner-only 後台。尚未驗證 session expiry、完整第三帳號與所有 1／4／8 圖互動，因此 tasks 6.4、8.2、8.3 保持未完成。
- TDCC `workflow_dispatch` run `30470491108` 成功；orchestrator 使用新 pipeline header 到達 completed，D1 health 顯示五類籌碼資料均為 available，四類日資料 `sourceDate=2026-07-29`、TDCC 週資料 `sourceDate=2026-07-24`。本輪 `pendingSymbols=24`、`reason=source_not_published`，history adapter 依既有授權邊界回 `history_automation_not_permitted`，不得誤報為歷史下載成功。
- PE `workflow_dispatch` run `30470866750` 成功；D1 continuous heartbeat 與 `lastLatestRunAt` 更新為 `2026-07-29T16:29:15.310Z`，TWSE 官方來源日為 `2026-07-28`。當下沒有 history target，安全摘要為 `historyClaimed=0`、`historyFailed=0` 的合法 no-op。
- Service Token fresh health 回 `200`、`ok=true`、`deploymentTarget=cloudflare`、D1 可用且 commit SHA 完全相符；此證據與 workflow log 分開取得。
- 上述兩個資料 run 都是 `workflow_dispatch`，只證明手動啟動路徑；task 8.6 必須等真實 `event=schedule` 後，另外核對該次摘要、source date、D1 write／no-op 與 fresh health，現在不得勾選或歸檔。

## 2026-07-30 登入名單關閉按鈕回歸

- 正式站重現：新增帳號 email 保持空白時，管理介面上方「關閉」被表單的 `required` 驗證攔截。
- 根因：`access-close` 位於 `method="dialog"` form 內且誤設為 `type="submit"`。
- 修正：改為 `type="button"` 並由 click handler 明確呼叫 `dialog.close()`；新增空白 email 不得攔截關閉的規格與契約測試。
- Cloudflare 自動部署 run `30502444511` 成功發布 commit `375eb2fdea0daaf4ad2ede300833dd75462d245a`，所有 gate 與 protected smoke 通過且未回滾。
- owner 正式站瀏覽器可見驗收：重新載入後開啟管理介面，確認 email value 為空、關閉按鈕 `type=button`；點選後 dialog 由 `open` 變為關閉且不可見，未被必填驗證攔截。

## 2026-07-30 Access session、D1 allowlist 與兩使用者隔離終驗

- Cloudflare Access 控制台唯讀核對：`MultiChart Private` 應用程式工作階段為 `24 hours`，全域工作階段為 `Same as application session timeout`，人員 allow policy 沒有另設覆寫值。為驗證真正的 browser session expiry，曾將應用程式工作階段暫設為「無持續時間，立即到期」；member 完成一次 Google 登入並載入正式站後，下一次導覽立即回到 Google 帳號選擇頁。驗收後已將應用程式工作階段恢復為 `24 hours`，重新開啟設定頁確認測試值未殘留。
- 登入／登出與角色可見性：owner、member 都能以各自 Google 身分載入 Cloudflare 正式站；Cloudflare logout 頁明確顯示成功登出。owner 可看到並開啟「登入名單」，member 看不到該入口。
- D1 active allowlist：owner 透過站內管理介面暫時將一位 member 設為停用；該 member 原本仍有效的 Access session 隨後無法載入應用程式，只收到安全 reason `email_not_allowed`。owner 將其恢復啟用後，member 再次成功載入正式站；終態仍為一位 active owner、兩位 active member，文件未保存真實 email。
- 兩使用者 D1 隔離：owner 與 member 分別建立不同名稱的空白驗收頁籤，雙向重新載入都只看見自己的頁籤，未看到對方頁籤。驗收後依精確名稱與各自身分刪除兩筆測試 `user_tabs`，兩者皆沒有 `user_instruments` 子項，remote D1 複查 `remaining_temp_tabs=0`。
- 機器雙層授權沿用已完成的 production 證據：自動部署 protected smoke 以 Access Service Token 取得 exact-commit health；TDCC 與本益比 runner 另以各自 pipeline secret 通過應用層授權。瀏覽器驗收全程未讀取、輸出或保存 cookie。
- 聚焦回歸：`node --test tests/request-principal.test.mjs tests/access-admin-ui.test.mjs tests/personal-tab-management.test.mjs` 為 `22/22`；涵蓋過期 JWT 拒絕、member owner-only API `403`、管理入口角色可見性與個人資料隔離。Browser Use 直接導覽 owner-only API 會被客戶端以 `ERR_BLOCKED_BY_CLIENT` 攔截，故未把該阻擋頁當作正式站 HTTP `403` 證據；task 8.3 仍須完成全部頁籤／商品增刪、排序與隱藏互不影響驗收後才可勾選。

## 2026-07-30 Free-tier runtime 與遷移工具完成

- 新增 `0019_acoustic_swordsman.sql`：`candle_cache.expires_at` index、單例 maintenance state；scheduled tick 每次最多刪除 40 筆過期 cache 並保存 deleted／remaining。清理失敗不阻斷 TDCC orchestrator，cache read／write 失敗則改回 fresh、stale-safe 或局部失敗，不影響個人頁籤與商品清單。
- Worker isolate 以包裝後的 D1 binding 計數 request、scheduled invocation、query、write 與 cache hit／miss／stale／failure；`/api/health` 只公開計數與起始時間，不含 SQL、參數、email、secret 或完整上游錯誤。此摘要用於應用層趨勢，Cloudflare dashboard 的帳戶級實際用量仍須在 task 8.7 分開核對。
- `migrate-personal-data.mjs` 預設 dry-run，輸出 mapping 數、row count、SHA-256 與去識別 sample key hash；只有來源每個 user 都有唯一明確 target email mapping 且加上 `--apply`、平台憑證齊全時才會寫入，之後逐列回讀核對 hash。當次沒有使用者授權的來源到目標 mapping，因此依 task 8.4 保持兩個 D1 原狀，未執行 apply。
- 本益比 runner 新增多 target 協調：相同 symbol／日期範圍只產生一次 bounded normalized source payload，再依序送入各 target；每個 target 仍自行 start、lease、ingest、checkpoint／complete。單一 target 失敗只回安全 reason，不回滾其他成功 target。
- 完整本機 gate：`npm test` 為 `333/333`、`npm run lint` 成功、OpenSpec strict 成功、`git diff --check` 成功。新增測試涵蓋 40-row cleanup、safe usage summary、無 mapping 停止、資料日期不偽造、來源未發布、rate limit、部分 target 失敗、重複 schedule 與 secret redaction。

## 2026-07-30 雙角色、雙站與 Free-tier 實際用量續驗

- Cloudflare 正式站 commit `31041b0226dbd9886ba6f57d385d6aa35e64d37e` 由自動部署 run `30511304218` 成功發布為 version `57b5f1cb-b1cf-417a-8a0c-83fe63f2ded6`；所有 gate、匿名 Access boundary、exact-commit protected health 均通過，未觸發 rollback。
- owner 瀏覽器實測 1／4／8 圖分別得到 1／4／8 個 loaded panel；雙擊可開啟 `00919.TW` 單一商品頁。主圖、單一副圖、多層副圖三模式均可切換；`2330.TW` 多層模式的 12 個籌碼 pane 全部載入，四類日資料顯示來源日 `2026-07-29`，沒有載入錯誤。
- 本益比開關與不足資料狀態可見，但 Cloudflare D1 當時 `taiwan_stock_pe_valuation_daily=0`，`2330.TW`／`3231.TW` 都明確顯示未達 252 筆門檻；因此 task 8.2 仍保持未完成，必須等真實 PE schedule 寫入後再驗證河流圖，不把「沒有錯誤」冒充圖層可用。
- owner 以站內 UI 完成登入名單新增、停用／修改與刪除測試；member 看不到 owner-only 入口，越權 API 由 production 同版回歸測試確認為 `403`。驗收帳號與稽核資料均已精確刪除，D1 複查為零殘留，文件不保存真實 email。
- owner 與 member 各自以 UI 完成個人頁籤新增、兩筆商品新增、商品上移排序、頁籤隱藏與恢復、商品刪除；member 再完成頁籤刪除，remote D1 複查驗收頁籤與子項為零。先前雙使用者互相不可見的隔離驗收仍成立；共享 K 線與籌碼 response／DOM 未出現個人識別欄位。task 8.3 因而完成。
- Codex Sites 控制面顯示保留站最新為 version `159`、source commit `918275844d87023f1067687c30f7448b344da391`。既有授權 session 實際載入 `00878.TW` 單一商品日線、報價、主圖與技術副圖，狀態為已載入；Cloudflare 則分開記錄上述 commit／version。直接導向 Sites `/api/health` 仍被瀏覽器以 `ERR_BLOCKED_BY_CLIENT` 阻擋，故此 UI 證據完成 task 8.5，但不取代 task 1.2 的 fresh D1 health。
- Cloudflare D1 實際近 24 小時統計為 storage `19,808,256` bytes、rows read `640,145`、rows written `176,069`；其中 rows written 高於 Workers Free 每日 `100,000` 上限，不能勾 task 8.7。production 資料列為 `candle_cache=32`、`candle_history=14,533`、日籌碼 `5,673`、TDCC 週分布 `24`、本益比 `0`。
- 根因確認為 candle history 到期刷新會把 merged 500-row window 全數重新 upsert。commit `7f176ea146e1f1fea62fb061b420fa68f81cac15` 改為只寫新增／變動尾端；若尾端完全未變，只更新最新一筆作 freshness marker。本機 `335/335` tests、lint、OpenSpec strict、diff 與 budget 全數通過，自動部署 run `30512611650` 成功發布 version `e8f70769-43f6-4087-8ff7-0a9d5663e4f5`，protected smoke 通過且未回滾。
- 為降低 1／4／8 圖重新載入時的重複組裝成本，commit `68075193fd861b68a09bfff7c6ce8f503961998b` 新增整批 candle response 短效快取；自動部署 run `30513009550` 成功發布 version `49bada6d-32ca-4bdf-974c-38b3b56a6454`，完整 gates 與 protected smoke 通過且未回滾。正式站 tail 對同一已授權 8 圖頁面連續重新載入，第一次 cache miss 為 `171 ms`，後續命中樣本為 `23 ms`、`9 ms`、`5 ms`；其中兩次已低於 Workers Free 每次 `10 ms` 的名目 CPU 門檻，但仍保留 `23 ms` 偶發樣本，不以單次低值冒充穩態完成。
- 此版發布後 D1 查得 batch cache 共 `8` 筆；自發布至 `04:16:27 UTC`，`14,533` 筆 history 中只有 `24` 筆被更新，且分屬 `24` 個 series，符合「未變資料只更新每個 series 最新一筆 freshness marker」，不再對每個 series 重寫約 500 筆。仍須跨過原本 24 小時 rows-written 視窗、history TTL 與真實 schedule 後重新量測，再決定 task 8.7。Cloudflare PE／TDCC workflows 目前只有 `workflow_dispatch`，task 8.6 必須等待 `event=schedule`。
- 後續檢查確認第二個主要寫入來源為 `taiwan_stock_chip_daily`：同一段歷史即使只有 `fetchedAt` 改變仍逐列 upsert，且當日來源只發布到前一日時，每次開頁都會重新抓取。修正後改以數值與 material provenance 做 canonical changed-only 判定，partial update 的 completeness 只 patch 實際族群；`partial_data` 保存真實 source date 與 30 分鐘 `retry_after`，冷卻期間回傳 D1 既有資料而不重抓。
- 部署預算 checker 新增 3 位成員、每人每日前景 8 小時、最多 8 圖的日 K 穩態模型。當次輸出為 requests `6,746 / 50,000`、D1 rows read `622,690 / 3,500,000`、D1 rows written `26,720 / 50,000`；官方日額度另列為 `100,000 / 5,000,000 / 100,000`，CPU 明確標為必須以 production observation 驗證。
- 本機 gate 為 `339/339` tests、lint、OpenSpec strict `36/36`、`git diff --check` 與 build／budget 全部通過。`cloudflare:dry-run` 在本機因未注入 production D1／Access 平台設定而 fail closed；不得用本機秘密補繞，完整 Wrangler dry-run、migration、deploy 與 protected smoke 留給 GitHub protected environment 驗證。

## 2026-07-30 Sites migration journal drift 修正

- Sites version `160` 保存後在 migration 階段因 `duplicate column name: provider` 結束為 failed，未切換流量；Sites 保留站全程維持 version `159`，沒有以失敗版本覆蓋既有服務。
- 根因是 Sites 舊 D1 已由 runtime `PRAGMA table_info` 路徑補齊本益比欄位，但 migration journal 尚未記錄 Cloudflare additive migration `0018`。Cloudflare D1 則已正常套用原始 `0018`，兩個 runtime 的既有 schema／journal 狀態不同。
- 新增 `scripts/prepare-sites-archive.mjs`：只在 Sites plugin 標準 archive 建立後，將已知 `0018` 轉為 `runtime_metadata` baseline marker；script 會先驗證 migration shape，避免 source 改變後靜默略過。repo 內原始 migration 不修改，Cloudflare workflow 仍使用正式 additive SQL。
- 本機完整 gate：`npm test` 為 `340/340`、`npm run lint` 成功、OpenSpec change strict 成功、`git diff --check` 成功；新增 archive fixture 測試確認 Sites artifact 不再包含重複 `ALTER TABLE` 且保存 baseline marker。

## 2026-07-30 22:40 真實排程與 Free-tier 續驗

- Cloudflare 本益比河流圖真實 `event=schedule` run `30545394205` 以 exact commit `69f5b4b684e41a4114a0de90b15ce80a9262a9b5` 成功完成；安全摘要為 latest accepted `2`、provisional accepted `2`、history claimed／completed `2/2`、failed `0`，兩個 history target 各接收 `1,214` 筆且為 `finmind_overlap_verified`。同一 Cloudflare D1 的 scheduler heartbeat 為 `2026-07-30T13:10:33.292Z`，TWSE official source date 為 `2026-07-29`，TPEx 本輪沒有 active target，未以 requested date 冒充來源日。
- Cloudflare D1 聚合核對：`2330.TW` 與 `3231.TW` 各有 `1,214` 筆，coverage 均為 `2021-07-30`～`2026-07-30`。owner 既有 Google 登入 session 的 Cloudflare 正式站實際勾選 `2330.TW`「本益比河流圖」後，畫面顯示七條歷史百分位界線與「`1214` 筆（`2021-07-30`～`2026-07-30`）」；因此補足 task 8.2 先前唯一缺少的 PE 可見性證據並完成該 task。
- `beae212a7804ecd2e903f3fb520aa9878ea58c9b` 修正發布後，`candle_history` 共 `14,543` 筆，其中 release 後更新 `32` 筆且分屬 `32` 個 series，仍維持每個 series 最多一筆 freshness tail；`taiwan_stock_chip_daily` 共 `5,681` 筆，release 後只更新 `2` 筆、分屬 `2` 個 symbol，沒有整窗重寫。`partial_data` 共 `37` 個 state，最近一次 attempt 與最晚 `retry_after` 相差 30 分鐘，符合 bounded cooldown。
- `npx wrangler d1 info DB --config .wrangler.cloudflare.generated.jsonc --json` 的安全統計為 storage `32,387,072` bytes、近 24 小時 rows read `1,493,061`、rows written `197,222`、read queries `9,147`、write queries `148,628`。PE 五年首次 seed 屬本輪一次性回補，但 rows written 仍高於 Free 每日 `100,000`，尚未跨過新的 rolling window，task 8.7 保持未完成。
- 22:48 Asia/Taipei 重新查詢時，Cloudflare 每日籌碼與 Cloudflare TDCC 皆尚無新的 `event=schedule` run；TDCC 拆分後只在週六／週日 22:30 執行，下一個可驗收窗口為 2026-08-01。PE run 雖已使用 Access Service Token 呼叫受保護管線，但該 workflow 沒有另存同一 run 的 fresh `/api/health` 安全摘要，因此 task 8.6 保持未完成。另以既有 Chrome 登入狀態新開 Sites 保留站 `/api/health` 仍得到 `ERR_BLOCKED_BY_CLIENT`，依驗收邊界不得算 task 1.2 的 fresh private D1 health；不以 D1 control-plane 聚合、匿名 `401`、既有 deploy smoke 或人員首頁取代。

## 2026-08-02 22:40 TDCC 真實排程競態修正

- Cloudflare 每日籌碼 `event=schedule` run `30706179068` 使用 exact commit `f7b96fdf6d05d5ab1759be99f3ef91ca29a2f256` 成功；安全摘要由 processed `0` 推進至 `8`，最終 status／phase 為 `completed`、remaining `0`、pending `1`、reason `source_not_published`。Service Token protected health 同時證明 target `cloudflare`、D1 可用、scope `daily`、trigger `schedule` 與相同 run heartbeat。
- Cloudflare TDCC `event=schedule` run `30706174513` 的週資料工作本身完成：TDCC-specific D1 run 為 trigger `schedule`、status `completed`、latest data date `2026-07-31`、target／completed `29/29`、queued／blocked `0/0`，history adapter 亦成功；但 workflow 最後的 protected health gate 誤判為失敗。
- 根因是每日籌碼與 TDCC 都在 22:30 啟動；舊 gate 以全域 `backgroundOrchestrator` 最新一筆核對 TDCC run。較晚完成的每日籌碼合法覆蓋全域 latest 後，TDCC gate 讀到 daily run 而回 `contract_failed`，並非 TDCC D1 工作失敗。
- 修正後 `/api/health` 的 TDCC continuous 摘要明確回傳 `lastRunId`、`lastRunTrigger`、`lastRunStatus`；TDCC workflow 只核對 `tdcc_continuous_runs` 的同一 run，不再依賴可能被並行 daily run 更新的全域 orchestrator latest。每日籌碼的既有精確 run 驗證維持不變。
- 修正 commit `f9ba2492d175f7f2bbfc68a49bf9328e16f47707` 由 Cloudflare 自動部署 run `30752929998` 成功發布；lint、`383/383` tests、OpenSpec strict、diff check、Free-tier budget、D1 migration、exact-commit deploy、匿名 Access boundary 與 Service Token protected smoke 全部通過，rollback 未執行。
- 當次安全 D1 近 24 小時統計為 storage `151,384,064` bytes、rows read `28,426`、rows written `444`、read queries `388`、write queries `170`；寫入已明顯低於 Free 日額度，但仍須以修正版下一個真實 TDCC `event=schedule` 和 production request／CPU／error rate 完成 task 8.6、8.7，不以本輪 workflow failure 或單項 D1 指標提前勾選。

## 2026-07-31 00:45 每日籌碼真實排程與 protected health 補強

- Cloudflare 每日籌碼真實 `event=schedule` run `30559679062` 於 00:03 Asia/Taipei 建立、00:07 完成，exact commit 為 `69f5b4b684e41a4114a0de90b15ce80a9262a9b5`。安全摘要從 scope `daily`、processed `0`、remaining `22` 推進至 status／phase `completed`、processed `22`、remaining `0`、pending `24`、reason `source_not_published`、recovery `none`，沒有手動 dispatch 或 cleanup failure。
- 同一 Cloudflare D1 的 run 狀態為 trigger `schedule`、expected session date `2026-07-30`、heartbeat／completed `2026-07-30T16:07:00.277Z`。該窗口只更新 `22` 筆 `taiwan_stock_chip_daily`、分屬 `22` 個商品且全部是 `2026-07-30`，沒有重寫既有歷史。四類日資料 state 中，`55` 個為 available、`19` 個為 `partial_data`、`14` 個因上游 rate limit 暫待重試；partial cooldown 精確為 30 分鐘、rate-limit backoff 為 15 分鐘。
- 修正發布後累計核對為：`candle_history` 只更新 `37` 筆、分屬 `32` 個 series；`taiwan_stock_chip_daily` 只更新 `24` 筆、分屬 `24` 個商品。最近一小時 D1 計費寫入為 chip state `206`、candle cache `142`、orchestrator `132`、chip daily `74`、candle history `18`，未出現整窗重寫。
- 00:45 的 D1 安全統計為 storage `32,563,200` bytes、rows read `1,765,235`、rows written `147,430`、read queries `8,737`、write queries `120,049`。rows written 已由前次 `197,222` 下降，但修正前窗口仍未完全退出且仍高於 Free 日額度，task 8.7 保持未完成。
- 真實每日 run 使用 Service Token 成功通過受保護 orchestrator，但當時 workflow 尚未讀取 `/api/health`。為讓後續 PE／daily／TDCC 的同一 run 可完成規格要求，三條 Cloudflare 資料 workflow 已補上 `Verify protected health`：驗證 exact commit、Cloudflare target、D1、對應 run／scope／trigger、heartbeat、coverage/count/reason，且只輸出 allowlist 摘要，不輸出完整 response 或 credential。完成發布並取得新真實排程前，task 8.6 仍保持未完成。

## 2026-07-31 01:20 PE protected health 與 rolling window 續驗

- Cloudflare 本益比河流圖真實 `event=schedule` run `30563916791` 成功完成，使用已部署的 exact commit `48f082dbbfe9a5b1b839c4d96f8528975e7a46b4`。安全摘要為 latest accepted `2`、provisional accepted `2`、fallback accepted `0`、history claimed／completed／failed `0/0/0`；同一 run 的 `Verify protected health` 成功，allowlist 摘要為 Cloudflare target、D1 可用、heartbeat `2026-07-30T16:59:44.436Z`、source date `2026-07-30`、official source date `2026-07-29`、history ready／target `2/2`、pending `2`、retry `0`。
- Cloudflare D1 在該 run 窗口只更新 `2` 筆估值資料、分屬 `2` 個商品，session date 均為 `2026-07-29`；總量仍為 `2,428` 筆、`2` 個商品、coverage `2021-07-30`～`2026-07-30`，沒有重寫五年歷史。先前正式站已完成 `1,214` 筆河流圖可見驗收，此完成證據不倒退。
- `beae212a7804ecd2e903f3fb520aa9878ea58c9b` 修正後累計仍只有 `37` 筆 `candle_history` 更新、分屬 `32` 個 series；`taiwan_stock_chip_daily` 仍只有 `24` 筆更新、分屬 `24` 個商品，其中真實每日排程窗口為 `22` 筆／`22` 個商品且全是 `2026-07-30`。目前 `partial_data` 且有 retry time 的 `7` 個 state 皆為精確 30 分鐘 cooldown。
- 01:20 的 D1 安全統計為 storage `32,563,200` bytes、rows read `1,821,099`、rows written `142,945`、read queries `8,814`、write queries `115,510`。rows written 持續下降但仍高於 Free 日額度；必須等 canonical changed-only 修正前寫入完整離開 rolling window後再判定，task 8.7 保持未完成。
- Cloudflare TDCC 仍沒有真實 `event=schedule`；拆分後下一個合法窗口是週六／週日 22:30。每日籌碼尚未以含 protected health 補強的新 commit 跑過下一次真實 schedule；因此 task 8.6 仍保持未完成，不以先前手動 run 或本次 PE 證據代替。另以既有 Chrome 登入狀態重試 Sites 保留站 `/api/health` 仍為 `ERR_BLOCKED_BY_CLIENT`，不算 task 1.2 的 fresh private D1 health，且未讀 cookie、未建立或輪替 bypass token。

## 2026-07-31 21:23 PE 排程與 D1 rolling window 續驗

- Cloudflare 本益比河流圖新鮮 `event=schedule` run `30633604414` 成功完成，使用 exact commit `1d4c73c6f4b6aeecfb544db0a630fb822d8e106e`。安全摘要為 latest accepted `2`、provisional accepted `2`、fallback accepted `0`、history claimed／completed／failed `0/0/0`，本輪預算使用 `0/240`。
- 同一 run 的 `Verify protected health` 成功；allowlist 摘要為 Cloudflare target、D1 可用、heartbeat `2026-07-31T13:14:36.612Z`、source date／official source date 均為 `2026-07-30`、history ready／target `2/2`、pending `2`、retry `0`。該 run 窗口只更新 `4` 筆估值資料、分屬 `2` 個商品，沒有重寫五年歷史；先前正式站每個商品 `1,214` 筆且河流圖可見的完成證據不倒退。
- `beae212a7804ecd2e903f3fb520aa9878ea58c9b` 修正後累計核對：`candle_history` 更新 `60` 筆、仍只分屬 `32` 個 series；`taiwan_stock_chip_daily` 更新 `24` 筆、分屬 `24` 個商品，仍未出現整窗重寫。目前沒有同時為 `partial_data` 且帶 retry time 的 state，因此本輪沒有新增 cooldown 樣本；先前精確 30 分鐘的已完成證據保留、不倒退。
- 21:23 的 D1 安全統計為 storage `39,206,912` bytes、rows read `699,094`、rows written `2,857`、read queries `3,594`、write queries `1,585`。24 小時 rows written 已降到內部安全預算 `50,000` 以下，但 task 8.7 尚需每日籌碼新鮮排程、production CPU／request／錯誤率等穩態證據，故本輪仍不勾選。
- 每日籌碼在 22:30 前尚無新的 `event=schedule`，TDCC 合法週末排程也尚未到；task 8.6 保持未完成。Sites 保留站 task 1.2 本輪沒有可用的新鮮既有授權 health 證據，不以匿名、控制面或舊 health 取代。
- 22:40 再查時，每日籌碼仍未出現新的 `event=schedule`；不以排程時間到達冒充 run 已建立。D1 24 小時安全統計續降為 storage `39,206,912` bytes、rows read `659,902`、rows written `2,685`、read queries `3,398`、write queries `1,487`，但 task 8.6、production CPU／request／錯誤率與 Sites fresh private health gates 仍未完成；依前一日 GitHub schedule 延遲幅度，下一次檢查安排於 2026-08-01 00:15 Asia/Taipei。

## 2026-08-01 00:23 每日籌碼排程、changed-tail 與 Free-tier 續驗

- Cloudflare 每日籌碼新鮮 `event=schedule` run `30646351398` 成功完成，使用 exact commit `7d5ff2d5804d3fa79e45f85f2a43f8ba7843e5a8`；不是 `workflow_dispatch`。安全摘要由 scope `daily`、processed `0`、remaining `16` 推進至 status／phase `completed`、processed `16`、remaining `0`、pending `24`、reason `source_not_published`、recovery `none`。
- 同一 run 的 `Verify protected health` 成功；allowlist 摘要為 Cloudflare target、D1 可用、trigger `schedule`、scope `daily`、phase `completed`、heartbeat `2026-07-31T16:17:10.695Z`。D1 run 的 expected session date 為 `2026-07-31`；窗口內 `taiwan_stock_chip_daily` 只更新 `26` rows／`16` symbols，session date 範圍為 `2026-07-30`～`2026-07-31`。四類日資料最新 source date 已到 `2026-07-31`，部分借券與 rate-limit state 仍停在 `2026-07-30`；TDCC 週資料 source date 保持 `2026-07-24`，不 forward-fill。
- `partial_data` 的 `7` 個 active retry state 皆為精確 `30` 分鐘 cooldown，另有 `6` 個 rate-limited state 為 `15` 分鐘 backoff。`beae212a7804ecd2e903f3fb520aa9878ea58c9b` 發布前已存在的 `32` 個 candle series，發布後累計只變更 `68` rows、每個 series 最多 `3` rows，既有 series 整窗重寫為 `0`；另有 `28` 個新 series 的首次 seed 共 `13,550` rows，與既有 series 更新分開計算。既有 `24` 個籌碼 symbols 累計只變更 `48` rows、每個 symbol 最多 `2` rows，整窗重寫為 `0`。
- 00:23 的 D1 安全統計為 storage `84,054,016` bytes、rows read `1,017,582`、rows written `43,751`、read queries `5,049`、write queries `15,219`、tables `25`。rows written 仍低於內部安全預算 `50,000` 與 Free 日額度 `100,000`，storage 遠低於 `5 GB`；但 production CPU／request／錯誤率尚未補齊，task 8.7 仍不勾選。
- 23:30 PE 排程尚未出現新的 `event=schedule`，依本輪 GitHub schedule 延遲推估於 01:30 再查；Cloudflare TDCC 的下一個合法週末排程仍為 2026-08-01 22:30。Sites task 1.2 本輪沒有新的既有授權 private D1 health，故 tasks 1.2、8.6 仍保持未完成，不以匿名、控制面、舊 health 或 owner Cloudflare session 取代。

## 2026-08-01 01:00 跨帳戶共用 K 線與官方尾端修正發布

- 根因確認為 Yahoo 台股日線在來源 session 已到 `2026-07-31` 時，部分商品當日 `close` 仍為空值；舊轉換會捨棄整根 K 棒。另有新上市 ETF 的真實歷史少於一般 warm-up 目標，舊流程缺少 durable full-window completion，可能在不同 Worker isolate／帳戶載入時再次抓取完整區間。個人頁籤與商品清單雖依 principal 隔離，`candle_history` 本身一直是 `provider + symbol + interval + time` 的全站 canonical 資料，並非各帳戶行情副本。
- commit `ff24243b13ad9b7bfa32901395d57a02f729fbce` 經 main push 的 Cloudflare production run `30648894181` 完成；lint、完整 tests `376/376`、OpenSpec strict `37/37`、diff check、Free-tier budget、additive D1 migration、exact-commit deploy、匿名 Access 邊界與 Service Token protected health 全部成功，rollback 未啟動。
- `0021_bumpy_bruce_banner.sql` 已建立不含 user identity 的 `candle_history_state`。正式 D1 安全查詢顯示 `009816.TW` 的 `124` 根與 `009819.TW` 的 `77` 根日線均為 `full_window_complete=1`、coverage end `2026-07-31`、latest source `twse-official`；後續帳戶可直接沿用完整狀態，不會因少於一般 `285` 根而重做 full-range fetch。
- 正式 D1 同時顯示原本落後的 `3008.TW` 及本輪可見的 `00878.TW`、`00919.TW`、`00929.TW`、`00981A.TW`、`00982A.TW`、`3231.TW` 最新日線均已到 `2026-07-31` 且 latest source 為 `twse-official`。既有 Chrome 授權 session 的八個可見台股 panel 也全部顯示 `2026-07-31`，未讀取或保存 cookie。
- 自動化整合測試使用兩個獨立 Worker service 實例與不同 `display_count`，證明第一個請求在 Yahoo 當日 `close=null` 時只補同 session 官方 OHLCV，第二個請求直接命中 shared D1，Yahoo／官方來源呼叫數都不增加；另有來源優先序測試，確保官方收盤 K 不會被 MIS 或 Yahoo 覆蓋。
- 本輪可控制的既有 Chrome 正式站分頁屬同一登入身分，不能冒充兩個帳戶的 browser-visible 驗收；因此 task 8.9 仍保持未完成，待另一位 active member 使用修正版重新載入共同商品後補最後一項畫面確認。此限制不影響 migration、共享資料模型、正式 D1 狀態與單一已授權 session 的修正證據。

## 2026-08-01 Cloudflare TDCC 51 週歷史復原

- 根因確認為 Cloudflare D1 只有 `2026-07-24` 最新快照：`taiwan_stock_shareholder_distribution=24` rows／`24` symbols，逐商品都只有 1 週；既有 Cloudflare TDCC workflow 的 history adapter 又固定回報 `history_automation_not_permitted`，所以重跑最新快照排程不會補回大戶／散戶歷史。此問題與個人頁籤隔離無關，共同商品本來就使用全站共用 `symbol + data_date` 資料。
- 新增本機 dry-run 快照與復原 SQL 工具，只處理 TDCC 公開市場資料。快照逐商品逐官方週驗證 17 級資料、`published`／`pre_listing`／`not_published`，輸出檔權限固定 `0600`；復原 SQL 僅觸及 TDCC distribution、continuous items／symbols 與 market fetch state，不包含登入名單、個人頁籤或商品清單。
- 官方低速來源完成最近 `51` 個週次、`24` 個 active symbols；canonical 快照 SHA-256 為 `555f9d8b48f5e7f3545f62d8e4b839a28b27546f770a4caa835e2304e449864a`。共有 `1,160` 筆實際發布資料、`1,224` 個逐商品週狀態；兩檔 2026 年新上市 ETF 合計 `64` 個 `pre_listing`，沒有 `not_published`，不得把上市前週次冒充資料列。
- 寫入前只備份 TDCC 公開資料表與 market fetch state，備份 SHA-256 為 `4cff3d3a3eef0f8b0af07dff50188f8ff59b37975405275fece1961d824d419c`；沒有匯出整個含個人資料的 D1。相同 SQL 先在全新本機 D1 套用兩次，筆數仍為 distribution `1,160`、items `1,224/1,224 completed`、targets `24/24 completed`。
- Cloudflare 正式 D1 套用後為 `1,160` rows／`24` symbols／`51` distinct weeks，coverage `2025-08-01`～`2026-07-24`；`00919.TW`、`2330.TW` 均為 `51` 筆。continuous items 為 `1,224/1,224 completed`，24 個 active targets 全部 `expected/completed=51/51`、missing `[]`、failed `0`。再套用 changed-only SQL 的計費結果為 `rowsWritten=0`，沒有因抓取時間不同重寫歷史。
- 既有授權 Chrome session 的 Cloudflare 正式站實際顯示 `00919.TW` 與 `2330.TW` 的大戶、散戶、集保戶數多週折線／柱狀圖，狀態包含 `2026-07-24` 數值與非零週變化；兩個 panel 均未顯示 `history_not_archived`。此 UI 證據完成 tasks 7.6、7.7。
- 寫入後 D1 安全統計為 storage `108,974,080` bytes、近 24 小時 rows read `2,193,976`、rows written `70,229`、read queries `7,160`、write queries `21,476`。本次一次性復原仍低於 Workers Free 的 `100,000` writes 日額度，但高於專案內部 `50,000` 安全預算；日常 schedule 仍只會 changed-only 保存新一週，因此不以一次性復原量冒充穩態，也不據此完成 task 8.7。
- 修復 commit `e78147a1a64410d14558e35cd9df0f5a4d4ff823` 經 `main` push 的 Cloudflare production run `30653078038` 完成；lint、完整 tests `380/380`、OpenSpec strict、diff check、Free-tier budget、additive D1 migration、exact-commit deploy、匿名 Access 邊界與 Service Token protected health 全部成功，rollback 未啟動。

## 2026-08-01 多層副圖繪圖資源與新清單籌碼回補修正

- 正式站修正前以既有授權 session 重現四圖多層副圖：四個 panel 的技術指標資料與三條 series 都已建立，讀值列亦有 KD／ATR 數值，但頁面同時存在 `392` 個 Canvas，其中 `336` 個屬於 `48` 個籌碼 pane，當下只有 `4` 個籌碼 pane 位於 viewport；部分技術副圖因此只剩空白畫布。這證明根因是離屏圖表資源未釋放，不是指標公式、暖機筆數或 API 資料缺漏。
- 籌碼 pane controller 改為 `IntersectionObserver` 管理：距 viewport 垂直 `240px` 內才建立 LightweightCharts、Canvas、wheel routing 與 resize observer；離屏時完整移除 chart，仍保留 pane DOM、順序、選取設定及最後 payload，捲回時依最後資料重建。同步游標、範圍、座標與 resize 只作用於已 mount 的 controller，避免離屏圖表再占用瀏覽器繪圖資源。
- 正式 D1 安全盤點顯示另一位 active member 新增的四個台股商品已有各自的 `user_instruments`，但不在內建 setup／`instrument_catalog`，亦未建立 `tdcc_continuous_symbols`、日籌碼 fetch state 或共享籌碼資料。舊 eligibility 因此在儲存後的背景預熱前即判定不合格，沒有真正啟動回補。
- eligibility 現在只在目前已授權 principal 範圍內讀取 enabled `user_instruments` 作為伺服器端 metadata fallback；通過台股 ordinary equity／ETF 驗證後，立即啟動 canonical 日籌碼預熱並冪等登錄 TDCC target。既有漏登錄商品在讀取籌碼 API 時會自我修復；市場資料仍以 canonical symbol 共用，不依帳戶建立副本，且不向其他帳戶洩漏個人清單成員關係。
- 發布前完整 gate：`npm test` 為 `382/382`、`npm run lint` 成功、OpenSpec strict 成功、`git diff --check` 成功。新增整合測試覆蓋不在內建／官方目錄的已儲存台股、新增後 immediate prewarm／TDCC queue、跨帳戶 canonical 共用，以及多層副圖 viewport-near mount 契約。task 8.10 保持未完成，待 exact-commit 部署後以既有授權 session 核對 active Canvas 已有界、原空白技術副圖可見，並由 member 重新載入確認新清單籌碼狀態。
- 首次 exact-commit 部署後，既有瀏覽器重載仍沿用固定的舊 `chip-panes.js` query version，實測 Canvas 保持 `392`；因此追加獨立資產版本指紋與契約測試，確保已開啟過正式站的瀏覽器也會取得本次 lazy-mount 程式。此輪快取證據不得當作修正失敗或 task 8.10 成功，必須重新發布後再量測。

## 2026-08-01 新清單商品立即 TDCC 啟動補強

- member 重新載入修正版後，正式 D1 的四個新商品都完成 canonical 日籌碼自我修復：每檔各有 `163` 筆日資料，coverage 為 `2025-12-01`～`2026-07-31`；法人、外資持股、融資券與借券四類 state 均為 `available`、source date `2026-07-31`。共同商品只保存一份 `symbol + session_date` 市場資料，沒有按帳戶建立副本。
- 查得立即啟動先前因 Cloudflare Worker 未配置 `GITHUB_WORKFLOW_DISPATCH_TOKEN`，四個 durable dispatch row 均安全記為 `dispatch_not_configured`。本輪使用既有 GitHub CLI credential 經 stdin 直接寫入 Cloudflare encrypted secret；沒有回顯 token、寫入檔案或提交 repo。重新列出 secret 名稱後已可見該設定。
- 為處理既有已排隊商品，本輪明確以 `workflow_dispatch` 啟動 Cloudflare TDCC run `30677258485`；exact commit 為 `eb5583abae34d40773e207b2cc0071cbbbd3c2b0`，全部步驟成功。protected health 安全摘要為 target `cloudflare`、D1 可用、scope `tdcc-weekly`、trigger `workflow_dispatch`、phase `completed`、pending `0`、reason `none`、TDCC health `healthy`、source date `2026-07-24`。此 run 只驗證立即啟動路徑，絕不取代 task 8.6 要求的真實週末 `event=schedule`。
- run 後四個新商品都已有 `2026-07-24` 最新 TDCC 一週，原本完全沒有大戶／散戶資料的狀態已解除；但只有 `1` 週，完整歷史尚未完成。history adapter 明確回報 `history_automation_not_permitted`，符合 `TDCC_HISTORY_AUTOMATION_ENABLED=false` 的既有 fail-closed 規範；未取得維運者對 TDCC 可見歷史表單自動查詢規範的明確確認前，不得擅自開啟。
- 維運者已於 2026-08-01 明確確認啟用 TDCC 歷史自動查詢。Cloudflare production 改由 GitHub Environment variable 驅動該開關：只有精確 `true` 才啟用，其餘值仍 fail closed；variable 已設為 `true`，部署 workflow 會驗證值只能為 `true`／`false`。本機完整測試為 `383/383`，lint、build、OpenSpec strict `37/37` 與 `git diff --check` 均通過。
- task 8.10 仍保持未完成：尚需合法補齊新商品 TDCC 歷史，並以 member 既有授權 session 完成瀏覽器可見驗收；不得把 D1 最新一週、owner session 或本次手動 run 冒充完成。

## 2026-08-01 TDCC 歷史自動查詢啟用與四檔完整回補

- 維運者明確確認後，commit `39f55b2cb3293ecb0578b1c9ca8822bc85ae0075` 將 `TDCC_HISTORY_AUTOMATION_ENABLED` 改由 Cloudflare production GitHub Environment variable 控制；只有精確 `true` 才啟用，缺值或其他值維持 fail closed。部署 workflow 同時驗證只接受 `true`／`false`，未把任何帳號、token、cookie 或 credential 寫入 repo 或 log。
- main push 的 Cloudflare production run `30678525554` 以 exact commit `39f55b2cb3293ecb0578b1c9ca8822bc85ae0075` 成功完成；lint、完整 tests `383/383`、build、OpenSpec strict `37/37`、`git diff --check`、migration、exact deploy、匿名 Access 邊界與 Service Token protected smoke 全部通過。
- 為立即處理既有佇列，本輪明確以 `workflow_dispatch` 啟動 TDCC run `30678590351`；exact commit 同為 `39f55b2cb3293ecb0578b1c9ca8822bc85ae0075`，job `91310800266` 成功完成。歷史 adapter 在 `1,200,000 ms` 有界執行時間內完成 `5` 個商品、`255` 個週次；protected health 安全摘要為 Cloudflare target、D1 可用、scope `tdcc-weekly`、trigger `workflow_dispatch`、phase `completed`、pending `0`、reason `none`、TDCC `healthy`、source date `2026-07-31`、target/completed `29/29`、queued/running/blocked `0/0/0`。
- 原缺歷史的 `3037.TW`、`3149.TW`、`3189.TW`、`8046.TW` 均完成 expected/completed `52/52`、failed `0`、missing `0`；每檔實際各有 `52` 筆 distinct published weeks，coverage 與 target coverage 均為 `2025-08-01`～`2026-07-31`，最新快照日為 `2026-07-31`。全體 TDCC 佇列為 `29` 個商品、expected/completed `1,484/1,484`、failed `0`；共同商品仍只保存 canonical `symbol + data_date` 公開市場資料，不依帳戶重複抓取或建立副本。
- `npx wrangler d1 info` 的安全統計重測在本輪遭 Cloudflare control-plane authentication error 拒絕，因此沒有以舊統計冒充新證據，也未勾 task 8.7。task 8.10 的資料層回補已成立，但仍需 member 既有授權 session 重新載入，確認法人／融資券／TDCC 可見及多層副圖 Canvas 有界後才能完成。
- 本輪是維運者授權後的立即 `workflow_dispatch`，不得取代 task 8.6 所要求的真實週末 `event=schedule`；下一個合法 TDCC 排程仍需另外核對 run event、安全摘要、source date、D1 changed-only/no-op 與 fresh protected health。

## 2026-08-01 四圖 Canvas 與 member 新清單籌碼終驗

- 維運者以 member 帳號重新載入 Cloudflare 正式站後，明確確認先前缺少的 TDCC 歷史已出現。此人員驗收與正式 D1 四檔各 `52` 個 published weeks、法人／融資券四類日資料各 `163` 筆且 source date `2026-07-31` 的資料層證據相符；共享資料仍以 canonical symbol 保存，不依帳戶建立副本。
- 另以 owner 既有授權 Chrome session 唯讀量測四圖、多層副圖：修正前基線為 `392` 個 Canvas，修正後為 `168` 個；四個 panel 的籌碼區各只有 `28` 個 Canvas，即 `4` 個鄰近 viewport 的 chart × 每 chart `7` 個 Canvas，不再同時 mount 每 panel `12` 個籌碼 chart。當下 viewport 內 Canvas 為 `60`、鄰近 viewport 為 `108`，其餘離屏圖表已受 lazy mount／unmount 邊界限制。
- 四個 `KD RSI MACD ATR 指標圖` 均位於可視區，尺寸各為 `362 × 79`，且各有 `7` 個 Canvas；原本因繪圖資源耗盡而空白的技術副圖已可見。驗收未讀取 cookie、local storage 或其他 session store，也未修改使用者清單。task 8.10 完成；tasks 1.2、8.6、8.7、8.9 仍依各自 gate 保持未完成。

## 2026-08-01 10:55 Free-tier 實際用量與 D1 讀取放大修正

- Cloudflare D1 近 24 小時安全統計為 storage `131,489,792` bytes、read queries `11,682`、write queries `28,596`、rows read `6,375,889`、rows written `99,390`。rows read 已高於 D1 Free 每日 `5,000,000`，rows written 也非常接近每日 `100,000`；其中近期 TDCC 51／52 週歷史回補屬一次性作業，但仍在 24 小時統計窗口內，不能當成長期穩態。
- Cloudflare Workers 控制面近 24 小時顯示約 `3,000` 次 invocation、約 `2,000` 次 subrequest、錯誤 `0`；當日帳戶請求 `849 / 100,000`、總 CPU `7,889 ms`。CPU P50／P90／P99／P999 分別為 `24.04 / 44.95 / 111 / 143 ms`，active version error rate `0%`，沒有 CPU limit、memory、internal 或 client disconnect error；記憶體 P50／P90／P99 為 `19.63 / 28.34 / 32.9 MB`。請求量與錯誤率健康，但 P50 仍高於 Workers Free HTTP request 的 `10 ms` CPU 名目上限，因此 task 8.7 保持未完成。
- D1 query metadata 將主要讀取放大鎖定在 `candle_history` 日線收盤查詢：24 小時共執行 `337` 次、累計約讀取 `9.54M` rows。舊 SQL 只以 `symbol + interval + time` 過濾，未帶複合主鍵／索引最前欄 `provider`；remote `EXPLAIN QUERY PLAN` 因而顯示掃描 `candle_history_lookup_idx` 並額外使用 temporary B-tree 排序。
- canonical 台股日線 provider 已安全核對為 `yfinance`。查詢補上 `provider = 'yfinance'` 後，remote query plan 改為依 `provider + symbol + interval + time range` 直接 index search；代表性查詢回傳 `161` 筆、計費只讀取 `162` rows、寫入 `0`，不再掃描整張日線索引。
- 實作已在 `readDailyCloses` 固定使用 canonical provider，並新增回歸測試防止日後遺漏 leading index column。此修正不新增 migration、不改寫既有市場資料，預期直接降低籌碼 API 的 D1 reads 與 Worker CPU；完成完整本機 gate、exact-commit 部署及部署後新觀測窗口前，不據此勾選 task 8.7。
- commit `b0251a9ed0f7332391ac6cea3ad13cbabae25574` 經 `main` push 的 Cloudflare production run `30681010729` 成功發布；遠端 lint、完整 tests `383/383`、OpenSpec strict、`git diff --check`、Free-tier budget、Wrangler dry-run、匿名 Access 邊界與 Service Token protected health 全部通過，rollback 未啟動。migration 階段明確回報沒有待套用項目，因此本次發布沒有 schema／migration 寫入。
- 發布後立即重測 D1 為 storage `131,489,792` bytes、read queries `11,686`、write queries `28,596`、rows read `6,405,656`、rows written `99,390`；相較發布前 write queries 與 rows written 完全未增加，證明本修正／部署沒有新增 D1 寫入。reads 仍包含修正發布前的 24 小時放大量，CPU 也尚未形成足夠的發布後觀測窗口；task 8.7 因此仍保持未完成，待舊窗口退出後重測實際穩態。
