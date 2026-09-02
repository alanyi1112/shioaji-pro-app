# 驗證紀錄

## 2026-09-02 實作前基線

### Git 與服務邊界

- Branch：`main`，相對 `origin/main` ahead 2。
- 實作前已有 candle、PE、smart-order、`exports/`、產生檔與其他未提交變更；本 change 只精準修改 archive bootstrap、TDCC shareholder-distribution、對應 migration／tests／OpenSpec artifacts。
- 本機 `127.0.0.1:5173` 與 `127.0.0.1:5174` 均有既有 listener。實作與驗證不得停止 simulation API、business-session watchdog、行情連線或其他盤後 pipeline。

### 本機 TDCC 與 8103 冷／暖路徑

- 初始畫面中 8103 只有 `2026-08-28` 一個持股點：大戶持股 32.16%、人數 11；散戶持股 23.11%，狀態為等待背景回補。
- 約六分鐘後，既有官方 history 背景流程已將 8103 補為 51 列，日期範圍 `2025-09-05` 至 `2026-08-28`，continuous `completed=51`、`remaining=0`。
- 這證明資料正確性可由既有官方 lane 達成，但新商品的首次可見歷史仍太慢；本 change 的目標是先利用全市場 verified archive 使相同情況成為 DB-only warm path，再讓官方 lane 補滿其餘日期。
- API 在已有 51 列時仍回傳「目前僅有一期集保週資料，尚無前週比較」警告，屬進度與 material 合併時序錯誤，納入本 change 修正與回歸測試。

### 本機 health 基線

- `/api/health` 顯示 shareholder-distribution 全域保存範圍 `2025-08-01` 至 `2026-08-21`、saved weeks 56；continuous 52 個 targets 均 completed，missing／blocked／overdue 為 0，最新資料日為 `2026-08-28`。
- 現行資料庫狀態工具回報約 524 MB。為避免中斷既有 5174，實作前未強制關閉 live DB 取得直接 `PRAGMA integrity_check`；migration 與 seed 先在隔離資料庫驗證，live finalize 前另行備份與驗證。

## 2026-09-02 本機實作與驗收

### 來源、validator 與資料庫寫入

- [x] 共用 validator 與既有六期選股結果相容：`stock-screener*.test.mjs` 57 項全數通過。
- [x] 實際 18 期 immutable CSV 全數通過 bytes、SHA-256、UTF-8、六欄、17 級與守恆驗證；合計 1,224,459 列。首期 `2026-04-30` 為 67,439 列／3,967 商品，末期 `2026-08-28` 為 68,799 列／4,047 商品。
- [x] `2026-08-28` archive 68,799 canonical rows 與同次 TDCC 官方 OpenAPI 68,799 rows 完全一致。
- [x] 固定 manifest 18／18 期完成 prepare 與 finalize；本機 receipt 終態為 `processed=18`、`remaining=0`、`failed=0`、`overdue=0`，正式新增 40,805 列、對帳既有 969 列、staging 為 0。
- [x] migration／operator 測試涵蓋 fresh schema、重跑、manifest 未完整時零正式寫入、lease 競爭、restart、insert-only、matched-existing、source mismatch、official-confirmed、staging 清理與個人資料保護。
- [x] 本機 live D1 完成備份後才 finalize；驗收後 `PRAGMA integrity_check=ok`。正式 shareholder-distribution 共 43,721 列，provenance 為 `verified-archive=40,805`、`official-history=33`、`official-openapi=25`、`legacy-verified=2,858`；固定商品母體 2,331 檔（普通股 1,975、ETF 356）。
- [x] 排除本次 UI 驗收新增的 1101 後，個人清單實作前後 hash 均為 `b3b5df503fb6e8d6c8c2568cb14b5d3757630d42568ba15ed3432d1ee156fb3`。

### 新增商品 warm path 與官方補缺

- [x] 以原本不在個人清單的 `1101.TW` 驗收：儲存後立即顯示 archive 18 期，大戶／散戶副圖可用，狀態為「快速補入 18 期／官方補缺尚餘 33 期」。首次儲存回應約 1.086 秒，隨後 API 約 0.107 秒。
- [x] 20 次 DB-only shareholder-distribution API 全部 HTTP 200；p95 約 0.048 秒，最慢首次 0.236 秒，低於 2 秒門檻。
- [x] 既有 watcher 自動執行 bounded remaining-only run，只補 33 個未完成日期；約 45 秒後 `completed=51/51`、`remaining=0`、`failed=0`，既有 archive 18 期未重抓或消失，最終 provenance 為 archive 18 期加 official-history 33 期。
- [x] API 最終回傳 51 個 distinct dates，範圍 `2025-09-05` 至 `2026-08-28`，回應約 0.089 秒。

### 8103、代表商品與實際 UI

- [x] `8103.TW` API 回傳 34 期，範圍 `2026-01-02` 至 `2026-08-28`；最新期大戶為 32.16%、11 人、25,228,740 股，散戶為 23.11%、18,389 人、18,138,091 股。
- [x] 5174 實際 UI 顯示 8103 大戶週增 `+7.95%`、`+6,231.5 張`、人數 `+4`；散戶週減 `-2.13%`、`-1,675.7 張`、人數 `-84`，沒有再停留於單點或「無前週比較」。
- [x] 1／2／3／4 圖同時顯示大戶與散戶：pane／canvas 實測分別為 1 圖 `1247x71／1186x70`、2 圖 `628x70／568x70`、3 圖 `409x70／348x70`、4 圖 `304x64／244x64`；6／8 圖既有單副圖模式亦分別得到 `414x36／356x36`、`308x36／256x36` 的可見 canvas。
- [x] 完整 reload、圖數切換與大戶／散戶切換後資料仍在；browser console 的 warn／error 為空陣列。
- [x] 代表 `.TWO` `4768.TWO` 為 22 期、代表 ETF `0050.TW` 為 22 期，兩者 API 均 HTTP 200；資料與 8103 皆由逐商品狀態隔離。

### 服務邊界與品質關卡

- [x] 驗收後以 listener 與唯讀 business API 核對：Shioaji simulation API `8080`、Web `5173`、MultiView `5174` 均持續 LISTEN；2330 snapshot HTTP 200。daily、TDCC、PE pipeline 與 watcher 保持載入，production-readonly 停止、smart-order write master 停用；本次未啟停任何服務或行情連線。
- [x] `npm test`：169 個 test files、2,045 項測試全數通過。
- [x] `npm --prefix apps/multiview test`：build 成功，695 項測試全數通過；另由 HEAD 加上精準 staged patch 重建隔離 release tree，再次得到 695／695 通過。
- [x] `npm run lint:multiview`、`npm run typecheck:multiview`、根專案 `npm run build` 與 archive focused tests 全數通過。
- [x] `openspec validate --all --strict`：33 項通過、0 失敗；`git diff --check` 通過。
- [x] 本 change 沒有寫入秘密、大型 CSV、SQLite、logs、screenshots、exports 或產生物；精準 scope 已與既有 candle、PE、smart-order 與其他 dirty work 分離。

### Production-like migration preflight

- [x] 以 2026-08-31、尚未套用 0026～0030 的實際 MultiView 備份建立隔離 production-like copy，另由空白資料庫套用完整 31 個 migrations 作為 fresh schema 對照。
- [x] production-like copy 依序套用 0026～0030 後，`d1_migrations` 終點為 `0030_tdcc_verified_archive_bootstrap.sql`；4 個 archive tables 與 provenance schema 均與 fresh schema 相等。
- [x] migration 前後 allowlist tables 的 row count／material hash 與個人清單 row count／material hash 完全一致；既有 2,781 筆 shareholder-distribution 只新增 `legacy-verified` provenance，不改寫 material。
- [x] migration 後 `PRAGMA integrity_check=ok`；另以 focused suites 驗證重跑冪等、rollback、insert-only、source mismatch、個人資料保護與 31-migration staging，共 18 項全數通過。

### Sites 保留站部署前基線

- [x] Sites access 為 owner-only custom policy；實際受保護頁可由既有 ChatGPT 身分登入，DOM 顯示「報價線圖 multiview」。
- [x] Sites D1 `DB` 部署前只有 28 個 user tables；有 `candle_continuity_*`，但尚無 `screener_*`、`tdcc_archive_*` 或 `tdcc_distribution_row_provenance`，因此本次部署須由 0027 連續套用至 0030。
- [x] 部署前 D1 可讀到既有 `taiwan_stock_shareholder_distribution`、`tdcc_continuous_*` 與 runtime metadata；未以其他環境取代 Sites 基線。
- [ ] Sites 連線器不提供 arbitrary SQL／`PRAGMA`／總 row count，這些數值必須在 migration／seed 後由 protected health 與 operator receipt 補齊，未取得前不勾選 1.2 或 8.1～8.4。

## 已授權、正在進行的遠端部署與資料寫入

- [ ] 使用者已授權依建議順序執行；先保存 Sites 保留站與 Cloudflare 正式站可取得的 migration、TDCC、容量、integrity 與 continuous 基線，再以同一 exact release SHA 分別執行 additive migration 與 verified manifest seed。
- [ ] 逐環境核對獨立 receipts、18 期 hashes、archive all-zero 終態、51 週官方 remaining、protected health、API、8103／`.TW`／`.TWO` DOM、可見 canvas、console／network 與新增商品 warm path。
- [ ] 未取得上述兩環境實際證據前，不勾選 tasks 8.1–8.4，也不把本機成功代替 Sites 或 Cloudflare 成功。
