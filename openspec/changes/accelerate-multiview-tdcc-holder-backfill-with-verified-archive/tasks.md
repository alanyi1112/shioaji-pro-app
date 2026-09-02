## 1. 保存基線與完成來源審查

- [x] 1.1 記錄實作前 `git status`、既有未提交檔案、OpenSpec 狀態與允許修改範圍，後續精準避開無關 candle、PE、smart-order、exports 與產生物
- [ ] 1.2 盤點本機、Sites 保留站、Cloudflare 正式站的 TDCC schema／migration、period dates、row／symbol count、D1 bytes／page count、continuous target／remaining／failed／overdue 與 `PRAGMA integrity_check` 基線
- [x] 1.3 保存代表 `.TW`、`.TWO` 與 8103 的 shareholder-distribution API、實際日期、大戶／散戶聚合、狀態文案、DOM、可見 canvas 尺寸與 console 基線，確認 8103 單點問題可重現
- [x] 1.4 重新檢查政府資料開放平臺、TDCC `1-5` 實際欄位、授權、顯名義務、發布日期語意及 `wirelessr/tdcc-opendata-archive` 的來源鏈、自動化與覆蓋範圍，寫入非敏感 `source-review.md`
- [x] 1.5 固定實作當下 upstream immutable commit，產生 2026 初始 allowlist manifest 的逐期 date／exact URL／bytes／SHA-256／normalization version，明確排除浮動 `main`、redirect、2021 快照與任意 URL
- [x] 1.6 保存最小且合法的 8103／`.TW`／`.TWO`／ETF 驗證 fixtures 與預期 material hash，不將大型原始 CSV、秘密、cookie、token 或個人資料提交 repo

## 2. 抽出並強化共用 TDCC archive validator

- [x] 2.1 從 `scripts/stock-screener-tdcc-bootstrap.mjs` 抽出可供選股與 MultiView 共用的 manifest、canonical row、SHA-256、UTF-8 與完整 17 級驗證模組，保持既有選股輸出與 operator-only 邊界不變
- [x] 2.2 實作 allowed host／immutable commit／固定 path／無 query／拒絕 redirect／檔案大小／hard timeout 檢查，禁止環境變數、UI 或 request 注入來源 URL
- [x] 2.3 實作精確六欄欄名、單一預期日期、證券代號 padding 正規化、唯一 1–17 級、安全整數、人數／股數、比例、調整與合計守恆、最低 row／symbol 數驗證
- [x] 2.4 實作最新 manifest period 與同次 TDCC 官方 OpenAPI canonical 全市場 rows 完全對帳，以及歷史 period 與任何既有官方重疊列的 material hash 對帳
- [x] 2.5 實作「所有目標檔先完成下載與驗證、任何正式寫入才可開始」的 fail-closed prepare API，錯誤只輸出 safe reason 與非敏感摘要
- [x] 2.6 新增 validator 單元／契約測試，涵蓋正確資料、bytes／hash／UTF-8／欄名／日期／級距／重複列／整數／比例／合計／row count／redirect／浮動 URL／官方 anchor／歷史重疊錯誤與 2021 排除
- [x] 2.7 跑既有盤後選股六期 bootstrap、snapshot 與篩選測試，證明共用抽取沒有修改 `screener_tdcc_weekly`、選股 snapshot 或個人 TDCC 長歷史 target

## 3. 建立 receipt、staging 與逐列 provenance

- [x] 3.1 設計 additive D1 migration，建立 archive run／period receipts、run 隔離 staging rows 與正式 row provenance，保存 manifest version、commit、date、URL、bytes、hash、row／symbol count、material hash、validator version、status 與 safe reason
- [x] 3.2 為 receipt、staging、provenance 與 `taiwan_stock_shareholder_distribution` 查詢建立必要 index、foreign-key／狀態限制與 retention 保護，不改動個人清單、交易或其他資料族群
- [x] 3.3 對既有 shareholder-distribution rows 以不改寫 material 的方式建立 `official-openapi`／`official-history`／`legacy-verified` provenance 或可證明的相容狀態
- [x] 3.4 實作 archive insert-only、matched-existing、source-mismatch 與 official-confirmed 的資料庫 statements；archive MUST NOT 使用現有可覆蓋 material 的一般 upsert
- [x] 3.5 實作依 receipt id 的 staging 清理／續跑與安全 rollback dry-run，只允許移除尚未被官方確認且可證明由無效 receipt 新增的 rows
- [x] 3.6 在 fresh、目前 staging schema 與代表 production export schema 執行 migration dry-run、重跑冪等、rollback、schema equality、row hash、個人清單 hash 與 `PRAGMA integrity_check` 測試

## 4. 實作全市場 archive seed operator

- [x] 4.1 實作以 market-period 為單位的 manifest run、single-flight、lease、checkpoint、chunk budget、timeout、retry 與 safe 終態，使每個 period／環境最多下載解析一次
- [x] 4.2 將完整驗證的 period 依當次支援台股母體正規化為所有合法 `symbol + data_date` rows，正確處理 `.TW`／`.TWO`、ETF、上市日、下市與該期合法無資料
- [x] 4.3 實作 run 隔離 staging chunk 寫入與 readback，只有 row count、distinct symbol、material hash、完整性與 lease 全部通過才 period-atomic finalize
- [x] 4.4 實作 finalize insert-only、既有列 material 對帳、matched-existing 計數、衝突整期阻擋與 verified receipt，確保 API 永遠不讀 staging 或半期資料
- [x] 4.5 實作本機 data-only CLI／operator 與既有權限受限 internal route，request 只能指定 committed manifest version／固定 scope，不能指定 URL、commit、payload 或秘密
- [x] 4.6 將同一 manifest／validator／receipt 契約接入 Sites 與 Cloudflare TDCC workflow，維持 exact release SHA、機器授權、bounded summary 與每環境獨立 receipt
- [x] 4.7 實作 archive run status／health 摘要，回報 target／processed／remaining／failed／overdue、period receipts、rows、symbols、bytes、validator version 與 safe reason
- [x] 4.8 新增 operator 測試，涵蓋重入、lease 競爭、chunk 中斷、process restart、hash drift、source mismatch、既有官方列、部分母體、D1 batch 上限、archive unavailable 與 official fallback

## 5. 整合 TDCC continuous ledger 與官方補缺

- [x] 5.1 實作 verified market periods 對 active symbol 的 coverage reconciliation，只有完整正式 row、verified receipt 且日期屬 official period plan 才完成相同 continuous item
- [x] 5.2 以 distinct dates 計算 archive imported、official verified、completed、remaining、failed、overdue，防止 archive／official 最新期重疊或重跑造成雙重計數
- [x] 5.3 調整新增商品註冊流程，先重用資料庫既有全市場歷史再決定是否 dispatch，已完成日期不得重新呼叫 TDCC 歷史表單
- [x] 5.4 調整 official history claim 只取真正 remaining dates並優先補最近缺口，維持 51 週目標、冷卻、timeout、retry、blocked 與合法 unknown／insufficient 語意
- [x] 5.5 官方後續取得 archive 同日期時比較 material hash，相同則提升 official-confirmed，不同則保留最後 verified row、隔離衝突並維持 item incomplete
- [x] 5.6 擴充逐商品 status 與全域 health，分離 archive manifest／receipt 狀態、archive weeks、official weeks、51 週 expected／completed／remaining、最近官方來源日與安全錯誤
- [x] 5.7 新增 ledger／scheduler 測試，涵蓋原本 1 期加 archive 多期、最新期重疊、archive 缺期／缺商品、51 週剩餘、source mismatch、官方補齊、overdue、restart 與零重複 request
- [x] 5.8 證明 archive／reconciliation 正常、失敗與 rollback 都不啟停或改寫 simulation API、watchdog、5173、5174、其他 pipeline、行情、Shioaji 訂閱與交易路徑

## 6. 更新 shareholder-distribution API 與持股副圖

- [x] 6.1 擴充 API 回傳 `displayWeeks`、`archiveImportedWeeks`、`officialVerifiedWeeks`、`expectedWeeks`、`remainingWeeks`、`failedWeeks`、`overdue`、receipt／provenance 摘要與 safe reason
- [x] 6.2 讓 API 只讀 verified period rows；至少兩個相鄰 official periods 即可計算大戶／散戶週變化，缺中間週須回 history gap 而非跨週冒充單週差
- [x] 6.3 更新大戶／散戶持股副圖文案與狀態，區分快速準備中、快速補入完成／官方補缺中、完整、來源暫時受阻與資料衝突，並顯示事實期數
- [x] 6.4 分離 distribution material signature 與 progress signature；純 heartbeat／lease／fetchedAt／相同計數不得清空 series、重建 canvas 或重發相同 GET，新 verified period 只觸發一次 material render
- [x] 6.5 在 UI／API 可讀位置加入 TDCC 原資料提供機關、政府資料開放授權條款與 verified archive transport 顯名，不暗示 GitHub repo 是另一官方 provider
- [x] 6.6 新增 API／UI 測試，涵蓋 8103 多期、32.16%／11 人、散戶聚合、相鄰週／缺週、archive partial、official pending、source mismatch、最後 payload 保留、render 去重與 GET 零外部副作用

## 7. 本機完整 seed、效能與實際 UI 驗收

- [x] 7.1 備份並驗證本機 SQLite／D1，在隔離 staging DB 以完整初始 manifest 執行全市場 seed，核對逐 period receipt、row／symbol count、material hash、bytes、through date、容量增量與 `PRAGMA integrity_check`
- [x] 7.2 以 transaction 將通過 staging gates 的 periods finalize 至本機 live DB，確認 archive target／remaining／failed／overdue 為零且既有官方、個人清單與其他資料族群 hash 不變
- [x] 7.3 核對 8103 與代表 `.TW`／`.TWO`／ETF 的實際 period dates、17 級、大戶／散戶值、archive／official provenance、51 週 distinct completed／remaining 與 official claim 清單
- [x] 7.4 在 seed 完成後新增一檔先前不在個人清單但已有 market periods 的商品，證明下一次 API 為 DB-only、archive／provider request 為零，並量測代表性本機 p95 不超過 2 秒
- [x] 7.5 執行 bounded official history run，證明只處理 remaining dates、重疊不重抓，archive 失敗時 official lane 仍可續作且資料不消失
- [x] 7.6 在實際本機 5174 核對 1／2／3／4／6／8 圖下 8103 與代表商品的大戶／散戶 DOM、文案、實際日期、週變化、可見 canvas 尺寸、切頁／重排／重整與 console／network
- [x] 7.7 驗收前後核對 simulation API、business-session watchdog、5173、5174、daily／TDCC／PE pipeline 與行情連線保持原狀，production、真實下單與 CA 維持停用

## 8. Sites／Cloudflare 驗收與完成證據

- [x] 8.1 在明確部署／資料寫入授權下，以 exact release SHA `1994d3f874f965ab2907cb3c4af6d48fa1dddbcd` 對 Sites 保留站套用 additive migration 與 verified manifest seed；protected workflow 已核對固定商品母體 2,330 檔、18 期 receipts 與 archive all-zero 終態
- [ ] 8.2 【後續維護，不列入本輪完成 gate】Cloudflare D1 免費額度恢復後，以當時 exact release SHA 完成 migration／seed／readback，核對與 Sites 相同的 manifest version、validator version、逐 period hashes 與獨立 receipts
- [x] 8.3a 對 Sites 保留站完成 protected health 與 shareholder-distribution API 驗收；8103、`.TWO` 4768 與 ETF 0050 均為 available，archive receipt 18／18、remaining／failed／overdue 為 0，且未以本機或 Cloudflare 回應代替
- [ ] 8.3b 【後續維護，不列入本輪完成 gate】在可操作的 owner 身分瀏覽器補做 Sites 保留站 8103／`.TW`／`.TWO` DOM、可見 canvas、文案、週變化與 console／network；machine bypass 不具個人清單 principal，不得以 `SAMPLE` 畫面冒充驗收
- [ ] 8.3c 【後續維護，不列入本輪完成 gate】Cloudflare D1 額度恢復後，補做 protected health、shareholder-distribution API、8103／`.TW`／`.TWO` DOM、可見 canvas、console／network 與新增商品 DB-only warm path 驗收
- [x] 8.4a 證明本機與 Sites 的 archive target／processed／remaining／failed／overdue 各自守恆，並將 archive complete 與 official 51 週補缺分列；Sites fresh run `33588505422` 為 18／18、0／0／0
- [ ] 8.4b 【後續維護，不列入本輪完成 gate】Cloudflare D1 額度恢復後，補齊其獨立守恆與 official 51 週證據；不得用 Sites 或舊 run 代替 fresh Cloudflare 證據
- [x] 8.5 執行完整 `npm test`、lint、type／build、migration suites、`openspec validate --all --strict` 與 `git diff --check`，修正本 change 範圍內問題且保留無關 dirty work
- [x] 8.6 更新繁體中文 `source-review.md`、`verification.md`、tasks 與正式 specs 所需 evidence，只勾選已取得實際資料／API／DOM／canvas／console／health 證據的項目
- [x] 8.7 盤點精準 commit／push／部署 scope，排除秘密、大型 CSV、staging DB、logs、screenshots、exports、產生物及所有無關變更；archive、commit、push 與部署仍依各自明確授權執行

## 9. 已授權延後的 hosted 補驗

> 2026-09-02 使用者明確指示：Cloudflare 正式站因 D1 免費用量已達限制，本輪跳過所有 D1 回補與驗收，且不得因此阻擋本 change 的本輪完成。下列項目保留為額度恢復後的維護清單；未實際取得證據前不得勾選。

- [ ] 9.1 確認 Cloudflare D1 額度與寫入限制恢復，再選定並記錄當時 exact deployment SHA；不得沿用過期 SHA 或假設 push 即部署成功
- [ ] 9.2 fresh dispatch `cloudflare-tdcc-verified-archive-bootstrap.yml`，核對固定 2,330 檔 universe、18 期 receipts、manifest／validator／immutable archive commit 與 `target=processed=18`、`remaining=failed=overdue=0`
- [ ] 9.3 以 Cloudflare protected health 與代表 8103／`.TW`／`.TWO`／ETF API 核對日期、級距、provenance、archive／official weeks、D1 warm path 與零非預期外部 request
- [ ] 9.4 在已登入 Cloudflare Access 的瀏覽器核對 8103／`.TW`／`.TWO` 的大戶／散戶 DOM、可見 canvas、狀態文案、週變化、console 與 network
- [ ] 9.5 在可操作的 Sites owner 身分瀏覽器補齊 8.3b，並將 Cloudflare 9.1～9.4 與 Sites 8.3b 的實際非敏感證據寫回 `verification.md`
