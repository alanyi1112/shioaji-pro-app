## 1. 背景來源契約與安全邊界

- [x] 1.1 重新核對 TDCC 最新 OpenAPI、公開歷史查詢頁與當時使用規範，記錄允許的背景低速操作、資料日期、頻率及禁止規避事項；若不允許則固定回傳 `history_automation_not_permitted`
- [x] 1.2 將 continuous-backfill 的 provider、scheduler、頻率、批次上限、最低間隔、timeout、retry、lease 與 allowlist 錯誤碼整理為不含秘密的程式 metadata
- [x] 1.3 加入 CAPTCHA、封鎖、candidate mismatch、HTML 漂移、429、5xx、timeout 與秘密遮罩 fixtures／contract tests
- [x] 1.4 確認歷史 HTML parser 與公開表單 cookie／token session 只在受保護 GitHub runner 執行，Worker bundle、前端與公開 API 均不包含該邏輯

## 2. D1 queue、run 與逐 symbol coverage

- [x] 2.1 新增 D1 migration，建立 `tdcc_continuous_runs`、`tdcc_continuous_symbols`、`tdcc_continuous_items` 與必要 index，保留既有股權分散 rows／history job
- [x] 2.2 以目前已支援的 24 檔與既有 D1 coverage 建立 baseline revision，避免首次啟用把整個既有市場誤判為新增
- [x] 2.3 實作逐 symbol `firstSeenAt`、來源、catalog revision、目標範圍、週數、checkpoint、latest snapshot、history success、next retry 與安全錯誤碼 repository
- [x] 2.4 實作原子 claim、lease expiry、heartbeat、complete、retry、blocked 與過期 lease 回收
- [x] 2.5 加入 migration 相容、重複 enqueue、併發 claim、lease 過期、checkpoint 續跑、唯一鍵與公平排序測試

## 3. 動態台股目標發現

- [x] 3.1 建立 target discovery，合併 base setup、D1 instrument catalog、所有使用者已加入 symbol 與 baseline 後官方新上市增量，再套用既有 `isEligibleTaiwanEquity`
- [x] 3.2 在使用者新增合格 TWSE／TPEx 普通股或 ETF 時冪等 upsert continuous symbol，並於下一個 scheduler cycle 建立歷史 queue
- [x] 3.3 擴充官方商品目錄增量同步，讓 baseline 後新上市普通股／ETF 自動建立 coverage；上市日前保存 `pre_listing` 缺值語意
- [x] 3.4 對 inactive、下市、非普通股與非 ETF 停止新工作，但保留既有驗證資料與 coverage
- [x] 3.5 加入新增既有普通股、新增 ETF、官方新上市、重複加入、跨使用者同 symbol、下市與首次 baseline 不全市場掃描測試

## 4. 背景最新週快照控制面

- [x] 4.1 新增雙重授權的 latest-refresh endpoint，呼叫 TDCC 最新 OpenAPI、沿用完整 snapshot validator 並優先於歷史 queue 執行
- [x] 4.2 將目前 dynamic target set 的 snapshot rows 依 `symbol + dataDate` 冪等保存，同一期回傳成功 no-op 並更新 scheduler heartbeat
- [x] 4.3 對最新來源 429／5xx／timeout／invalid response 保存安全失敗與 next retry，且不清除 D1 coverage
- [x] 4.4 加入無流量新週、同週重跑、全站 single-flight、partial target、來源失敗與快照優先級 endpoint tests

## 5. 背景歷史 runner 與缺週補洞

- [x] 5.1 擴充 `scripts/tdcc-history-backfill.mjs`，由受保護 API claim 有限 symbol／week 批次，不再要求 workflow 寫死目標清單
- [x] 5.2 實作官方日期集合與 D1 distinct dates 比對，只建立新 symbol missing weeks 或既有 coverage gap，維持實際 `dataDate`
- [x] 5.3 實作 runner lease heartbeat、總時間上限、單一併發、最低一秒間隔、checkpoint 與下次排程續跑
- [x] 5.4 讓 CAPTCHA、封鎖、候選不一致、HTML 漂移與使用規範禁止轉為 blocked 並立即停止；可重試錯誤使用有限退讓
- [x] 5.5 透過既有受保護 ingest 與相同 parser／validator 寫入每週 batch，重跑不得增加 rows 或 distinct week count
- [x] 5.6 加入新普通股、新 ETF、六碼 ETF、pre-listing、gap-only、批次中斷、blocked、可重試與秘密不外洩 runner tests
- [x] 5.7 將 GitHub headless browser 無法穩定取得表單的實作改為官方頁面 GET／POST session，驗證 synchronizer token、cookie、結果證券代號與 17 列資料
- [x] 5.8 新增受保護的明確 symbol／reason blocked 重試操作，僅供 parser 修正後由 operator 重新排入，不自動繞過來源封鎖
- [x] 5.9 將 TDCC 合法「查無此資料」保存為逐週 `not_published` gap 並繼續批次，不誤判成 `invalid_response`

## 6. GitHub Actions durable scheduler

- [x] 6.1 新增 private repository scheduled workflow，每日執行 latest refresh 後 claim 有限歷史批次，並提供 `workflow_dispatch`
- [x] 6.2 設定 GitHub concurrency group、job timeout、最小權限、Node runtime cache 與失敗時安全摘要，不輸出 request header 或秘密
- [x] 6.3 以 `SITES_BYPASS_TOKEN`、`TDCC_CONTINUOUS_BACKFILL_SECRET` 等 GitHub secrets 注入 runtime；加入 secrets 缺漏時 fail closed 的 preflight
- [x] 6.4 撰寫不含秘密的設定／旋轉／停用 runbook，明確說明停止 workflow 不會刪除既有 D1 資料
- [x] 6.5 加入 workflow syntax、固定目標禁止、secret interpolation、concurrency、schedule 與手動重跑 contract tests

## 7. API、health 與副圖狀態

- [x] 7.1 擴充 `/api/health`，回傳 scheduler heartbeat、最近成功 run、最新官方 `dataDate`、target／queued／running／blocked 計數及 safe reason
- [x] 7.2 擴充個股籌碼 API，回傳目前 symbol 的 coverage、missing weeks、queue status、completed／expected weeks 與最後成功時間，不沿用全域 job 誤導
- [x] 7.3 更新大戶／散戶 pane 狀態：等待背景回補、背景回補中、回補未完成、來源阻擋、歷史已更新與「目前僅 1 期／尚無前週比較」
- [x] 7.4 確認 blocked／partial 仍繪製既有比例線與週增減柱，非發布日 tooltip 維持 gap 且不得顯示其他 symbol 狀態
- [x] 7.5 加入普通股／ETF 的 queued、running、completed、partial、blocked、scheduler stale、逐 symbol 隔離與可及性 UI tests

## 8. 實際背景驗收與部署

- [x] 8.1 在測試 D1 以一檔既有普通股及一檔 ETF 執行 `workflow_dispatch` smoke，驗證 latest、claim、heartbeat、ingest 與 complete 全流程
- [x] 8.2 建立測試用新增台股事件，確認不改 workflow／不重新部署也會在下一個排程週期自動 enqueue、回補歷史並納入未來週快照
- [x] 8.3 驗證無前端流量時 scheduled workflow 仍更新 heartbeat；模擬漏週後確認下一次 run 只補 missing week
- [x] 8.4 執行 `node --check`、完整 Worker／前端／workflow tests、`npm run build`、`openspec validate --all --strict` 與 committed secret scan
- [x] 8.5 依 Sites 流程部署 D1 migration、Worker 與 UI，設定 GitHub／Sites secrets 後手動觸發正式 smoke；不得在操作記錄輸出秘密
- [x] 8.6 驗證正式 `/api/health`、普通股／ETF coverage、GitHub run、瀏覽器副圖與 TDCC 官方抽樣一致，再啟用 daily schedule
- [x] 8.7 觀察至少一個新 TDCC 發布週，確認無人開圖仍自動保存新 `dataDate`；若來源 blocked，驗證告警與既有資料 fallback
