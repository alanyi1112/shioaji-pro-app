## 驗證結果

日期：2026-07-22（Asia/Taipei）

### 來源實測

- FinMind 匿名 v4 對 `TaiwanStockPER`／`TaiwanStockPrice` 可取得五年 range；`2330` 與 `8069` 各 1,214 筆有效同日配對。
- TWSE `BWIBBU_d` 實測 1,079 列，`2330` 最新 source date 為 `2026-07-21`；TPEx 本益比與收盤 OpenAPI 對 `8069` 的 source date 為 `2026-07-22`。
- 最近共同交易日的 P/E 與收盤價皆通過 0.01 絕對差核對；完整欄位、授權、額度與 private/custom 非商業邊界記錄於 `docs/research/2026-07-22-taiwan-stock-pe-river-data-sources.md`。

### 本機資料與 UI

- 真實五年 seed 已寫入本機 D1，`2330.TW` 與 `8069.TWO` public river API 均回 available、actual coverage 與政府資料開放授權顯名。
- 1／4／8 圖、crosshair、縮放、平移、快速換商品、週 K、ETF cleanup 與完整 PNG 均完成實際瀏覽器驗收。
- `npm run lint`、214 項完整 `npm test`、19 項 `openspec validate --all --strict` 與 `git diff --check` 均通過。

### 正式環境驗證

- 私有 workflow 已多次手動執行並直接核對正式 D1：latest-first、每批 8 檔、月 checkpoint、budget window、heartbeat、ready／insufficient／missing／running 與逐商品 API 均有實際證據；`2330.TW` 為 1,214 筆完整五年 available。
- 第一批歷史資料曾因交易所最新資料尚未成功而停在 `finmind_pending_verification`；新增自動 promotion 後，下一次官方共同交易日相符即整批轉為 `finmind_overlap_verified`，不必重抓五年資料。
- TPEx 全欄位收盤 payload 約 3.95 MB，在 Sites／GitHub 雲端出口會逾時；改用同一 TPEx OpenAPI 的 `tpex_mainboard_quotes`（約 0.36 MB），並加入 GitHub official fallback、IPv4 優先與一般 JSON client header。正式 health 已成功寫入 TPEx `2026-07-22`，同時保留 TWSE `2026-07-21`、fresh 29、mismatch 0。
- 正式站先後發布 version 103～110；本次 SQL／原子完成修正版 version 110 對應完整 commit `34e5c32e1f78a6faec544d89dfbd1c3913cd7fe7`，access 為 custom、1 user、0 groups，部署 succeeded。

### 尚待外部排程事件

- 2026-07-22 23:30（Asia/Taipei）的第二 cron 窗口到達後，GitHub workflow 維持 active 且 default branch／cron 正確，但截至 23:55 尚未產生 `event=schedule` run。手動背景執行、最新來源與 D1 coverage 已驗證；task 7.4 保持未勾選，待下一個工作日 19:30／23:30 窗口實際觸發後再確認無 panel 自動執行與第二窗口 retry，不以設定檔或手動 run 冒充 schedule 證據。

### 2026-07-23 history completion 修正

- 手動 workflow run `29937363226` 的八個 history target 均回報 `invalid_payload`；正式 Sites error log 顯示八次 `POST /api/internal/pe-river-continuous-backfill` 為 `400`，而相同 FinMind 請求的 HTTP／status／schema 均合法，因此問題不在免費來源 payload。
- 根因是 `completePeRiverHistoryTarget` 的 fetch-state SQL 有 10 個 placeholder，卻只提供 9 個 binding；Cloudflare D1 嚴格拒絕，既有本機 `node:sqlite` test double 則把缺值視為 `NULL`，未能提前攔截。此外 job 完成狀態早於 fetch-state／control 寫入，後段失敗會留下非原子狀態。
- 修正後以單一 D1 `batch` 原子寫入 fetch state、control heartbeat 與 job 完成狀態，補齊 `latest_source_date` binding，並只在相同 job lease 仍有效時完成；新增嚴格 placeholder／binding 計數測試及強制中段失敗的 rollback 整合測試。
- `npm run lint`、216 項完整 `npm test`、19 項 `openspec validate --all --strict` 與 `git diff --check` 均通過。
- 修正版已發布為 Sites version 110；private workflow run `29939035098` 使用相同 HEAD，結果為 latest accepted 30、fallback accepted 6、history claimed 8、completed 8、failed 0，先前的 `invalid_payload` 完全消失。七檔既有問題商品成功完成，`3149.TW` 合法回報 `official_not_published`，另完成 `8027.TWO`。
- 正式 D1 health 的 `lastHistoryRunAt` 更新為 `2026-07-22T16:42:55.831Z`，history 沒有 running、blocked 或 retry waiting，latest mismatch 0；Sites 最近 20 分鐘 error log 為 0。這是手動 `workflow_dispatch` 證據，仍不取代 task 7.4 所要求的真實 `event=schedule`。

### 2026-07-23 排程證據拆分與解除時點阻塞

- GitHub run [`29940025433`](https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/29940025433) 已由 GitHub API 再確認為 `event=schedule`、completed／success、HEAD `3202bfb8e7057bf20518bfe2b32124126bf2baa9`。該 run 在沒有 panel／browser 流量下自動啟動，heartbeat／latest／history 都前進，並在第二盤後窗口證明延遲發布、單商品錯誤隔離與 bounded retry；當時 TWSE 官方 OpenAPI 仍停在 `2026-07-21`，因此沒有把日曆日偽造成新 source date。
- 官方 OpenAPI 後續發布後，run [`29971570970`](https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/29971570970) 已由 GitHub API 再確認為 `workflow_dispatch`、completed／success、HEAD `49ca302fb90e0602dd806ad14a3a7b3d02d7fd1f`。同一 workflow／runner 成功寫入 TWSE／TPEx `2026-07-22`，latest accepted 38、fallback accepted 14、provisional accepted 0、history 8／8 completed、failed 0；正式 health 的 provisional pending 與 mismatch 都為 0。
- 以上兩段證據分別證明「真正 schedule 可在無 panel 狀態自動執行」及「官方日期前進時相同 runner 可把新 source date 寫入 D1」。沒有把手動 run 冒稱 schedule，也不再要求兩個外部時點必須碰巧落在同一 run；下一次 cron 恰逢官方新日期保留為營運監看，不作為已完成實作的歸檔阻塞。

### 2026-07-23 正式站終驗與完成狀態

- Sites control plane 再確認正式站 status `active`、access mode `custom`、允許 1 位使用者且 0 groups；latest deployed version 114 對應 runtime commit `49ca302fb90e0602dd806ad14a3a7b3d02d7fd1f`。
- 匿名請求正式首頁與 `/api/health` 均回 `401`；已登入正式站則完成 `2481.TW` 與 `8069.TWO` 上市／上櫃普通股的單圖、4／8 圖、五線四帶、crosshair attribution、快速切換與重新整理 cleanup。`8069.TWO` 為 1,199 筆、coverage `2021-07-23～2026-07-22`，readout 明確顯示證券櫃檯買賣中心、FinMind 與政府資料開放授權。
- 實際下載並目視開檔 `/Users/alanyi/Downloads/8069.TWO_1d_2026-07-23T01-42-03-862Z.png`，尺寸 2992×3468、約 1.2 MB；主圖河流帶、官方 readout、技術副圖與完整籌碼副圖都未裁切。
- 最新完整品質門檻為 `npm run lint` 通過、226 項 `npm test` 全數通過、OpenSpec strict 20／20 與 `git diff --check` 通過。tasks 7.4、8.3、8.5 已完成，本 change 達 42／42；精確的下次 cron／官方發布重合僅是持續監看，不再是功能完成條件。

### 歸檔結果

- `free-pe-river-data-pipeline` delta 已同步為主規格 `openspec/specs/free-pe-river-data-pipeline/spec.md`，共新增 9 項 requirements。
- `use-free-pe-river-data-sources` 已以 spec-driven schema 歸檔至 `openspec/changes/archive/2026-07-23-use-free-pe-river-data-sources`；所有 artifacts 與 42 項 tasks 完成，歸檔後沒有 active OpenSpec change。
- 歸檔後 `openspec validate --all --strict` 為 20 passed、0 failed，`git diff --check` 通過。這次只有 OpenSpec／驗證文件變更，runtime 仍沿用已驗證的 Sites version 114，不需要重複部署。
