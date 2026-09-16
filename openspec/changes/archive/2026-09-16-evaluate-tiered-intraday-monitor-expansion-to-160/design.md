## Context

2026-09-11 固定 20 檔已完成單日功能驗收。舊方案要求 50 → 100 → 160，造成額外完整交易日等待；使用者已選擇直接 160，失敗時保留 20。舊 50／100 manifests、離線 evidence 與 v1 plans 保留為歷史，不能用作新版執行 authority。

## Goals / Non-Goals

- 主路徑為可信 20 檔 GO → 160 離線全量驗證 → 160 可信前日基準＋一個完整盤中日 → 明確 GO／NO-GO。
- 160 GO 後省略 50／100；160 NO-GO 不自動測較小容量，也不升高正式 active limit。
- 160 驗收日直接完成產品盤中選股路徑：同一批 sealed 1 分 K 同時寫入正式 evidence DB、計算 trigger 並由本機 SSE 投影到面板。
- 不將 synthetic fixture、HTTP accepted、SSE connection 數解讀為 provider 容量。
- 不從本次評估／程式修改推定 production 或 broker write 權限；必要服務重啟、160 simulation live subscription 與 Codex 審閱依使用者本次明確授權執行。

## Decisions

### 1. 前置證據與流程版本

前置 verifier 接受 `intraday-monitor-functional-acceptance-bundle/1`（可信前日基準＋一個完整盤中日）或舊版有效兩日 bundle，並驗證匹配的 GO／hash／20 檔核准值。直接 160 Gate 的 required prior stage 是 20。plan 與 execution token 使用 v3；拒絕將舊逐級 token 沿用至直接測試。

### 2. 相同 cohort 的前日基準與單日驗收

160 檔先保存前一適用交易日各 270 分鐘的 1 分 K 累積成交量基準，共 43,200 筆，再以一個完整盤中日驗收同分鐘量比與首次觸發。正常歷史基準須逐檔核對身分、雙抓 hash、完整分鐘、單位及一般交易時段總量；historical baseline 不計入 live 日。第二個盤中日只作非阻擋穩定性追蹤，獨立保存，不加入本次單日功能 bundle。若歷史基準不可驗證，維持 waiting_baseline，不能補造資料；才需先採集一日基準。同一 session 不換股、不輪替、不重複採集，不以缺資料補零。正式 runner 必須證實交易日緊接、generation、逐檔內容與資源，不能只憑 summary booleans。

完整盤中日沿用 `intraday-relative-volume-monitor` 的延後收盤規則。個股若達暫緩收盤標準，13:30 不進行收盤撮合並延至 13:33；因此 exact 160 transport 不得在 13:30 或 13:31 解除訂閱。runner 固定維持相同 cohort 至 13:33 後的 90 秒傳輸寬限，最早 13:34:30 才核發 close authority。合法 13:33 KBar 或 provider 在寬限期內送達的 13:30 revised KBar，必須併入 canonical `13:30` 累積端點並保存逐檔 `closeMode`；13:31–13:33 不另造 regular-session minute rows。未知編碼、前置 sequence 不連續、量倒退或硬截止前未完成，該商品與整日均 fail closed。

### 3. 儲存空間與記憶體

實測方法與結果見 `acceptance/direct-160-capacity-assessment-2026-09-11.md`。新 `direct-160-storage.mjs` 專供 160 檔離線／後續 live 路徑，既有 fixed-20 writer／hash 上限不變。

| 項目 | 上限／保留 |
| --- | ---: |
| 單日 session canonical | 32 MiB |
| 單份 capture output | 64 MiB |
| 兩日 bundle canonical／output | 128 MiB |
| offline fixture | 128 MiB |
| 單次 stream bytes（後續 live 接線） | 128 MiB |
| 單 frame（後續 live 接線） | 128 KiB |
| 單 log（後續 live 接線） | 16 MiB，禁止原始 payload |
| 產品 evidence DB＋WAL growth | 64 MiB（43,200 observations＋160 triggers 實測峰值 42,327,712 bytes） |
| 最低可用磁碟 | 8 GiB |
| 160 plan RSS | 1 GiB |

兩個 daily capture＋兩個原子暫存上限 256 MiB、bundle＋暫存 256 MiB、fixture＋暫存 256 MiB、logs／metadata 64 MiB、DB／WAL 另保留 64 MiB，工作集保守上限 896 MiB。產品 schema 的 160 baseline＋43,200 observations＋160 triggers 實測 final DB＋WAL 38,260,736 bytes、盤中 working peak 42,327,712 bytes；因此新版產品 plan 使用 64 MiB DB growth，保留 24,781,152 bytes／1.59 倍峰值空間。舊 32 MiB plan 保留且不得用於產品化完整日。8 GiB 保留約為工作集上限 9.1 倍，並可容納作業系統／其他服務漂移；不是永久保留所有 run 的容量承諾。

每次建立 evidence 前重新查可用空間，不足、量測不合法或輸出超限時拒絕；只清除本次未發布暫存，不清除歷史或成功 evidence。原子 `wx` 暫存、fsync、link no-clobber、讀回 SHA-256 避免重演收盤後雜湊與覆寫問題。新增 retained runs 時重新 preflight；不得偷偷輪替或刪除被 bundle 引用的檔案。

### 4. 資源判定不能混用

離線 peak RSS、序列化耗時與檔案大小只是離線證據。短時間 CPU burst 不當作完整盤中 CPU 平均；固定 1 GiB 新預算仍須在 live 啟動前核對全機 headroom。DB 寫入／WAL、完整 UI、持續記憶體、live latency 的測試尚須完成。event latency 必須清楚區分 p95 與最大值，不以 p95 冒稱每筆低於門檻。

### 5. NO-GO、審閱與產品啟用

沒有更高且可驗證的核准紀錄時，失敗一律保留 20；不能因 attemptedStage=160 就回復到未測試的 100。50／100 若未來作診斷，需獨立決策與 manifest。使用者已明確委託 Codex 審閱 160 結果；activation 工具只在完整 bundle、review hash、同一 trade date／manifest／baseline 皆相符時，將本機產品狀態原子改為 `approvedActiveLimit=160`。validator 本身仍只有 `readyForHumanReview`，不能自行產生 GO。

### 6. 驗收與產品只使用一條資料鏈

驗收 runner 安裝同 cohort 的 160 份可信前日 baseline，並把 recorder 接受的 sealed observation 先寫入正式 evidence repository，再計算同分鐘量比與首次 trigger。產品狀態檔只保存可公開的摘要、逐檔完成分鐘與核准狀態；帳密、token 與 provider 推定值不得寫入。Vite local API 每次讀取狀態檔，執行中以 `boundedTransportReady=true` 顯示 160 data-active；SSE 從 DB 逐筆讀取新 trigger，事件游標必須能在任何一筆中斷後精確續傳。

驗收開始時通知權限維持 false。GO 之後才允許後續正式 session 依既有使用者通知設定處理 live trigger；歷史 replay 永遠不得通知。驗收完成後只有 review/active-limit 狀態改變，provider physical usage、global ownership、release 與 headroom 仍保持 unknown。

### 7. 完整功能健康證據

正式 capture 除了 43,200 個 minute slots 與 deterministic replay，還必須保存產品 evidence DB／WAL 實際成長、盤中 API 顯示 160 data-active、同日被動 DOM 圖表更新證據，以及 local trigger SSE 的斷線重連與零重複通知。缺任一項時不得建立可審閱 bundle。盤前可以重啟已授權的 simulation／Web／MultiView 服務，但每次重啟後必須重新驗證 fresh generation、2330 Snapshot、5173、5174 與 config/cohort 完全一致。

## Risks / Trade-offs

- 跳過中間容量後，160 若失敗不能直接知道可用上限位於 50 或 100；保留 20，之後才做定位測試。
- provider counting／release／headroom 仍 unknown，160 實際可用性須靠完整 live receipts 與逐分鐘證據。
- synthetic 映射不能反映 160 檔真實流動性、缺分鐘與網路 burst；不得把離線成功標為 live GO。
- 多份 JSON 在 parse／canonical／hash／readback 時會產生記憶體峰值，不能只計 raw 檔案 bytes。

## Migration Plan

1. 完成前置 bundle 相容、直接 Gate、v3 plan/token 與保留 20 rollback。
2. 保存兩日 160 synthetic 實測、磁碟／RSS 預算及 immutable 新 plan。
3. 補齊 live transport／recorder／launcher 的 exact 160、容量 profile、產品 DB／SSE 接線與單次 session 安全約束，並完成端到端離線資料與 UI／DB 測試。
4. 按官方交易日與另行核對的執行授權，建立 160 檔可信前日基準及一個完整盤中日三件式 evidence。
5. 依使用者委託完成 GO／NO-GO、dossier 與必要驗證；GO 後保存 review 並原子啟用正式 active limit 160，NO-GO 保留 20。


## 2026-09-11 單日驗收修正與基準準備

使用者明確要求沿用 20 檔的 1 分 K Volume 累加算法。新版 plan／token 為 v3，bundle 為 v2；160 bundle 必須附 exact cohort 的正常歷史 baseline set，且 session.baselineHash 必須匹配。缺少任一基準、日期不連續、hash 不符時不能取得審閱資格。舊 v2 plan 與既有 evidence 均保留，不改寫歷史。

`collect-direct-160-baseline.py` 僅在當日收盤後，經既有 loopback simulation API，逐檔取得身分、兩次歷史 1 分 K 與一般交易時段逐筆核對資料；串行間隔 1 秒，單次 20 秒、有界回應／總期限／磁碟與流量保留，不自動重試。`build-direct-160-baseline.mjs` 從本機原始資料純離線建立每檔 baseline；正式比較值只取 1 分 K 累積量。逐筆資料僅作獨立完整性核對，不取代量比來源。資料寫入 Application Support，repo 僅保存工具與小型驗證報告。

歷史基準準備沒有 160 live transport authority；live recorder、DB／UI 與盤前 preflight 待辦保持未完成。基準缺口不得自動換股、填零或沿用更早交易日；盤中啟動前若使用者明確授權換股，必須建立新的 cohort／plan／baseline 版本並保留舊資料。

2026-09-11 使用者明確要求替換缺資料商品，於 live 尚未開始前以 configured 清單中的 6187.TWO 萬潤替換 2926.TWO 誠品生活，其餘 159 檔順序不變。新基準全量驗證結果與當前 artifact 路徑見 acceptance/direct-160-replacement-6187-readiness-2026-09-11.json。舊文件中的 159／160 是替換前歷史狀態。
