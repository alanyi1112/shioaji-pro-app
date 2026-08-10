## 1. 基線與相依變更

- [x] 1.1 重新檢查 git、OpenSpec、現有 Codex Sites 正式版本、GitHub workflows 與本機 D1 基線，保存不含秘密的盤點結果
- [ ] 1.2 核對 `move-chip-backfill-orchestration-into-sites-runtime` task 5.7 的真實 `event=schedule`、安全摘要與已授權 D1 health；未通過前不得覆蓋或歸檔其 TDCC 契約
- [x] 1.3 為雙 runtime 建立可測試的設定矩陣，定義 Sites／Cloudflare 的 binding、base URL、身分來源、資料 target 與 production fail-closed 預設

## 2. 身分驗證與個人資料隔離

- [x] 2.1 實作共用 request principal adapter，保留 Codex Sites 可信 header 並支援 Cloudflare Access JWT
- [x] 2.2 驗證 Cloudflare JWT 的簽章、issuer、audience、expiry 與 email，production 缺失或無效時回傳 `401/403` 且不得 fallback 共用使用者
- [x] 2.3 將所有個人頁籤、商品清單、手動回補與寫入路徑改用已驗證 principal，移除直接信任 client email header 的可能性
- [x] 2.4 為 Sites、Cloudflare、偽造 header、錯誤 audience、過期 token、未授權及三使用者資料隔離新增測試
- [x] 2.5 建立一次性個人資料遷移工具與 dry-run／row-count／hash 驗證，無明確 email mapping 時必須停止而不寫入
- [x] 2.6 新增 D1 `access_users` 與私人管理稽核 migration，定義正規化 email 唯一性、`owner`／`member`、active／inactive 與必要 index
- [x] 2.7 將 Cloudflare JWT 身分驗證與 D1 應用授權分層，實作 hosted-secret 初始 owner bootstrap、名單查詢失敗 fail-closed 及 machine route 邊界
- [x] 2.8 新增 owner-only 登入名單 API，可列出、新增、修改、啟用、停用及刪除成員，並原子保證至少一位 active owner
- [x] 2.9 新增站內登入名單管理介面與角色可見性；一般 member 不得取得完整名單，修改 email 必須提示不會自動移轉個人資料
- [x] 2.10 新增 bootstrap、未列名、停用、重複 email、最後 owner、自我鎖死、member 越權、稽核隱私及管理 UI 測試，fixture 不得使用真實 email

## 3. Cloudflare Free runtime 適配

- [x] 3.1 以頁面級 visible-symbol 批次輪詢取代 Cloudflare target 的逐 panel 無限 SSE，加入交易時段、休市、hidden、offline 與重連節流
- [x] 3.2 保留 Sites 相容即時資料 contract，新增 1／4／8 圖、單一商品新分頁、背景分頁與連線恢復測試
- [x] 3.3 將所有 D1 bulk statement 降至 invocation 安全預算，使用 changed-tail upsert、checkpoint 與 remaining count
- [x] 3.4 移除一般 request 的 runtime DDL，將 schema 變更集中為可重複、向後相容的 deploy-time migrations
- [x] 3.5 新增 candle／payload cache retention、必要 index、bounded cleanup 與 cache failure 局部降級
- [x] 3.6 新增 query／write／request／cache 計數與安全 health 摘要，確認不輸出使用者 email、秘密或完整上游錯誤
- [x] 3.7 將籌碼日資料改為 canonical changed-only 寫入，忽略僅 `fetchedAt` 變更，並為來源尚未發布加入 30 分鐘 bounded cooldown
- [x] 3.8 將 K 線 full-window／coverage 狀態改為跨帳戶 canonical 共用，短歷史商品不得重複 full fetch；Yahoo 當日 OHLC 空值以同 session 官方 tail 補齊
- [x] 3.9 將多層籌碼副圖改為 viewport-near lazy mount／offscreen unmount，限制同時存活的 Canvas／chart 數並驗證技術副圖不再隨機空白
- [x] 3.10 讓已授權使用者新存入、但尚未進入內建或官方目錄的合資格台股，使用已保存的伺服器端 metadata 啟動 canonical 日籌碼與 TDCC 回補；不同帳戶共同商品不得建立重複市場資料

## 4. Cloudflare 部署設定與 D1

- [x] 4.1 新增獨立 Wrangler production 設定，綁定 Worker entry、Static Assets、D1、`workers.dev` 與必要非秘密變數，且不覆蓋 `.openai/hosting.json`
- [x] 4.2 建立 Cloudflare D1 migration／apply／status 指令與 production database provisioning 文件，不在 repo 寫入帳戶 ID 或秘密值
- [x] 4.3 新增 Wrangler dry-run 與 gzip bundle、asset count、單檔大小、D1 statement、估算日 request／write 的 Free-tier budget checker
- [x] 4.4 驗證相同 commit 可完成 Sites build 與 Cloudflare production build，且兩者不需讀取另一環境的 production secret
- [x] 4.5 將 3 位成員、8 小時、8 圖的 request、D1 rows read／write 情境納入部署前 budget checker，CPU 明確保留正式站量測 gate
- [x] 4.6 為 Sites 舊 D1 已由 runtime 補欄位但 journal 未同步的情況，新增可測試的 archive baseline，避免 `0018` 重複 `ADD COLUMN` 阻斷發布且不影響 Cloudflare migration

## 5. 自動部署與秘密邊界

- [x] 5.1 建立 Cloudflare production GitHub Environment 與 least-privilege deploy credential，將 account／token／D1／Access 值只存於平台 secrets／variables
- [x] 5.2 新增 `main` 自動部署 workflow：install、lint、tests、build、OpenSpec strict、diff check、dry-run、budget、migration、deploy 與 smoke
- [x] 5.3 將部署產物與 health version 綁定 exact commit SHA，保存前一成功 deployment 資訊並實作失敗 rollback／停止 promotion
- [x] 5.4 新增 workflow 契約測試，確認 fork／PR 不取得 production secrets、log 不輸出 credential，且 concurrency 不會並行部署同一環境

## 6. Google Access 與機器授權

- [x] 6.1 在已登入 Cloudflare／Google 控制台建立或核對 Google External OAuth client，將 redirect／origin 指向 Access team domain；使用者親自完成必要 consent
- [x] 6.2 為 production `workers.dev` 啟用 Cloudflare Access Google 身分閘門，將初始 owner email 設為 hosted secret；以站內管理後台加入其餘成員，並驗證不在 D1 active 名單的 Google 帳號遭 Worker 拒絕
- [x] 6.3 建立 least-privilege Access Service Token 與 Service Auth policy，讓 GitHub smoke／資料工作不依賴人員登入
- [x] 6.4 驗證瀏覽器登入、登出、session expiry、owner 管理名單、至少兩位使用者 D1 隔離及 service-token 雙層授權，不讀取或保存瀏覽器 cookie

## 7. TDCC 與本益比自動資料更新

- [x] 7.1 將 TDCC 與本益比 workflows 的硬編碼 Sites URL／bypass 改為 target-specific GitHub Environment base URL 與授權 adapter
- [x] 7.2 為 Codex Sites 與 Cloudflare 建立獨立 concurrency、run ID、Access／pipeline credential 與安全摘要，任一 target 失敗不得回滾另一 target
- [x] 7.3 讓可重用歷史來源下載以 bounded normalized payload 依序 ingest 各 target，維持每個 D1 自行驗證、lease、checkpoint 與冪等完成
- [x] 7.4 新增無使用者流量、來源尚未發布、rate limit、部分 target 失敗、重複 schedule 與 secret redaction 測試
- [x] 7.5 新增 TDCC 公開歷史資料的本機 dry-run 快照與復原 SQL 工具；逐商品逐官方週驗證 17 級資料、只允許 additive material changed-only upsert，且不得包含登入、個人清單或其他使用者資料
- [x] 7.6 備份 Cloudflare TDCC 公開資料表，將至少 51 個官方週的已驗證快照補入正式 D1，重建 `tdcc_continuous_items`／coverage，並核對筆數、日期範圍與快照雜湊
- [x] 7.7 以 Cloudflare 正式站既有授權 session 驗證 `00919.TW`、`2330.TW` 的大戶／散戶歷史序列可見且不再顯示 `history_not_archived`

## 8. 完整驗證與首次發布

- [x] 8.1 執行 lint、完整 tests、兩個 production builds、OpenSpec strict、`git diff --check`、migration dry-run 與 Free-tier budget gate
- [x] 8.2 部署 Cloudflare production，分別驗證匿名拒絕、Service Token health、已授權 Google 首頁、1／4／8 圖、單一商品、三種主副圖模式、籌碼與本益比
- [x] 8.3 以 owner 與至少一位 member 驗證名單增刪改、越權拒絕，以及新增／排序／隱藏／刪除頁籤與商品互不影響；共享市場資料不得包含個人資訊
- [x] 8.4 視確認 mapping 執行 owner 資料遷移並核對 row count／hash／sample；未授權或不確定資料保持原狀
- [x] 8.5 以既有授權 session 驗證 Codex Sites 保留版本仍可運作，分開記錄 Sites version 與 Cloudflare commit／deployment
- [ ] 8.6 等待 Cloudflare 真實 `event=schedule`，核對 TDCC 與本益比的 workflow 摘要、source date、D1 write／no-op、fresh health 與 history adapter 邊界
- [ ] 8.7 觀測私人小群組實際使用的 request、CPU、D1 reads／writes、storage 與錯誤率；確認目前成員規模符合 Free 安全預算，名單顯著擴大前必須重新量測或提出 Paid 決策
- [x] 8.8 更新繁體中文 verification 與部署／回滾操作說明，確認所有秘密以 `[REDACTED_SECRET]` 或平台設定表示
- [ ] 8.9 部署並以兩個已授權帳戶驗證共同商品日期、K 棒與 shared history state 一致，且第二帳戶未重做 full-range 抓取
- [x] 8.10 部署後以既有授權 session 驗證四圖多層副圖的 active Canvas 有界、原空白技術副圖可見，並確認新清單商品的法人／融資券／TDCC 由共享資料自動補入
