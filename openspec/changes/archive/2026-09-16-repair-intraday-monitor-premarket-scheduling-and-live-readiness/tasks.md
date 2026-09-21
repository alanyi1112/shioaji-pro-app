## 1. 封存 2026-09-15 事故證據

- [x] 1.1 等待現行 exact 160 capture 於 13:34:30（Asia/Taipei）自然結束，保存 capture、failure sidecar、process generation、首筆 SSE、逐分鐘 coverage 與資源量測；收盤前不得為本 change 重啟或替換該程序
- [x] 1.2 將 2026-09-15 標記為 partial／NO-GO，明列 08:45 主排程未建立 run、08:49:30 simulation API 冷啟動、08:50:43 capture 啟動、09:11:02 首次收到 09:10 KBar，以及 09:01–09:09 未由 live stream 送達
- [x] 1.3 對照歷史 REST KBar 保存「來源已有資料、live transport 未及時送達」的可重現證據，且不建立 160 activation、不覆寫 `liveDelivered`、不把當日列為完整盤中驗收
- [x] 1.4 保存收盤結果：41,752 observations、9 triggers、156 檔各 261 筆、2395.TW／3023.TW／3680.TWO／6770.TW 各 259 筆且止於 13:28，以及被動圖表 evidence 缺失；確認產品維持 `no_go` 與 active limit 20

## 2. 修正時間解析與排程驗證

- [x] 2.1 建立共用交易日排程模型，預設以 `Asia/Taipei` 解析使用者時間，產生 canonical UTC instant、台北時間顯示值與交易日
- [x] 2.2 建立 schedule receipt，保存 `requestedLocalTime`、`timeZone`、`scheduledForUtc`、`computedLocalTime`、scheduler id、讀回時間及一致性結果
- [x] 2.3 建立排程建立／修改後的 read-back Gate；computed local time 不一致、已過期或無 run claim 時立即 fail closed 並產生 incident
- [x] 2.4 補上夏令時間無關地區、UTC 誤解成台北時間、跨日、非交易日與下一適用交易日的單元測試

## 3. 建立本機 durable 盤前 orchestrator

- [x] 3.1 建立具 single-owner run registry 與 exclusive claim 的 premarket orchestrator，讓 heartbeat、備援與人工入口不能重複啟動 capture 或第二條 KBar SSE
- [x] 3.2 建立 macOS LaunchAgent 安裝、移除、狀態及 dry-run 指令，固定由本機 durable scheduler 執行關鍵盤前流程
- [x] 3.3 設定 08:20 啟動或確認 simulation API、08:35 暖機檢查、08:45 prerequisite、08:50 capture 的台北時間節點，並保存每一步開始、結束、退出碼與 generation
- [x] 3.4 讓 Codex heartbeat 改為讀取 durable evidence、診斷與回報，不再是唯一關鍵啟動入口；驗證 heartbeat 未喚醒時 durable runner 仍會執行
- [x] 3.5 以非交易時段 dry-run 驗證同日重入、process crash、主入口缺席與備援競爭時都只會產生一個有效 claim

## 4. 補強盤前暖機與服務 Gate

- [x] 4.1 將 runtime mode、API generation、business session、2330 Snapshot、Web、MultiView、baseline、exact cohort、磁碟空間及 broker-write blockade 拆成可稽核 Gate
- [x] 4.2 規定 08:20 後 generation 穩定，並在 08:35 與 08:45 各保存一次完整結果；08:45 後才冷啟動或任一 Gate 未知時標記 cold-start risk 與 NO-GO
- [x] 4.3 將 simulation API、orchestrator 與 capture 的 stdout／stderr 改寫入權限 0600 的去敏 JSONL 日誌，按日輪替、保留至少五個交易日並設容量上限
- [x] 4.4 驗證日誌不含帳號、token、API key、憑證或 raw secret，且能還原 process start、generation、subscribe、first event、錯誤與 close seal 時序
- [x] 4.5 修正跨交易日 external `exit_claim` 未被完整帳戶對帳釋放的問題；以模擬帳戶雙重空 working-set 證據、repository transaction、event journal 與零券商寫入完成既有 blocker 維修，並確認 simulation API 已載入受限 JSONL wrapper

## 5. 分離 KBar control plane 與 data plane

- [x] 5.1 修改 bounded transport，使 subscribe 成功只輸出 `subscription_requested` 與 control-plane receipt，不直接宣告 data ready
- [x] 5.2 修改 direct 160 product runtime，逐檔初始狀態改為 `awaiting_first_kbar`；只有收到符合 trade date、generation、contract identity、source version 與分鐘格式的 KBar 才轉為 `active`
- [x] 5.3 重新計算 `dataActive` 與 `boundedTransportReady`，前者只計有 first-event evidence 的唯一商品，後者須 exact cohort 全數 active 且 stream 未 degraded
- [x] 5.4 補上 0／159／160 檔收到首筆行情、重複事件、錯誤 generation、錯誤交易日與 contract identity 不符的狀態機測試
- [x] 5.5 更新 API 與盤中選股面板，分別呈現訂閱已接受、等待首筆行情、實際 active、degraded 與缺少商品，不得以單一綠燈掩蓋部分失敗

## 6. 實作第一分鐘 canary 與有界恢復

- [x] 6.1 調整 runner 啟動順序，在 08:50 前先建立 SSE，再以 exact cohort 與 current generation 提交一次 subscribe
- [x] 6.2 實作 09:02:15（Asia/Taipei）canary，逐檔檢查 09:01 completed KBar，保存 received／missing 清單與 first-event latency
- [x] 6.3 任一商品缺少 09:01 KBar 時立即建立 incident、回報並將當日 `liveAvailabilityComplete=false`，後續恢復不得改寫該歷史結果
- [x] 6.4 僅允許同一 run claim 對相同 cohort 執行一次 unsubscribe／resubscribe recovery，禁止商品輪替、第二條不受控 SSE 與無界 retry
- [x] 6.5 補上全數準時、159 檔、全數延至 09:10、SSE 斷線與一次 recovery 成功／失敗的整合測試
- [x] 6.6 讓 adapter 已驗證並接受的逐檔第一筆 KBar 立即建立 data-plane first-event evidence，09:02:15 canary 不得因 one-bar-delay 封存策略而多等下一分鐘才看見 09:01

## 7. 接入有界 REST KBar 缺口修復

- [x] 7.1 將既有 bounded KBar bootstrap 接入 direct 160 正式 runner，只允許修復 09:01 至首個 live minute 前一分鐘或 reconnect gap 的已完成分鐘
- [x] 7.2 逐檔驗證欄位等長、交易日、contract identity、時區、一般交易時段、`common_lot` 單位、分鐘遞增與完整 coverage
- [x] 7.3 對固定 completed watermark 執行兩次相同範圍讀取與 hash 比對，並核對 REST／SSE overlap minute 的 volume；不一致時保存 conflict 並將商品標為 degraded
- [x] 7.4 保存 `source=shioaji-kbars-bootstrap`、REST generation、source version、fetch time、range hash、對應 live generation 與 `liveDelivered=false`
- [x] 7.5 補上 REST 雙抓穩定、不完整欄位、缺分鐘、重疊值衝突、重複 row、未完成分鐘與超出有界範圍的測試
- [x] 7.6 讓正式 runner 等到逐檔第一個 live minute 後才界定完整 startup gap，以該 live minute 作 REST／SSE overlap；bootstrap 完成前暫存 live observation，成功後按 09:01 起依序重放，失敗則降級且不得觸發

## 8. 修正累積量、量比與通知權限

- [x] 8.1 將 current cumulative volume 改為從 09:01 canonical 1 分 K Volume 依序累加，不得以第一筆 live KBar 當成開盤累積起點
- [x] 8.2 任一商品自 09:01 至 completed watermark 有 unknown 時設為 `waiting_continuity`，停止正式量比 trigger 與通知
- [x] 8.3 bootstrap 驗證完成後重建累積序列，僅從第一個完整可比較分鐘恢復評估；補算的歷史 trigger 必須保留 `notificationAuthority=false`
- [x] 8.4 補上 09:10 才收到首筆行情、部分 bootstrap、完整 bootstrap、資料 revision 與 REST／SSE conflict 的量比回歸測試

## 9. 統一 evidence、回報與驗收判定

- [x] 9.1 定義共用事件 schema，涵蓋 scheduler、service、generation、Gate、subscribe receipt、first-event summary、canary、recovery、bootstrap、failure sidecar 與 close seal
- [x] 9.2 對排程未建立 run、computed time 偏移、服務 Gate 失敗、canary 失敗、exact cohort 未全 active、SSE 中斷、bootstrap 不完整與 failure sidecar 實作主動回報
- [x] 9.3 對 13:34:30 capture 完成與最終 GO／NO-GO 實作里程碑回報；狀態健康且沒有新里程碑時保持安靜
- [x] 9.4 在 evidence bundle 分開輸出 `dataContinuityComplete` 與 `liveAvailabilityComplete`，並禁止 REST repair 把第一分鐘 live failure 改成成功
- [x] 9.5 更新 Codex 審閱規則：只有 exact 160 每檔一般盤 expected-minute set、所有適用延後收盤資料、09:01 live canary、盤中量比與結果面板可用、資源、replay、close、SSE reconnect 與安全 Gate 全數通過才可核准 Stage 160
- [x] 9.6 將逐檔 nominal close、延後收盤狀態、expected-minute set、最後事件、權威 close evidence 與 seal time 納入 repository 與 bundle；13:30 不得觸發全 cohort 一次性封存
- [x] 9.7 補上單檔延後收盤、延後期間無成交、close evidence 遺失與安全截止點仍 unknown 的整合測試，禁止補造零成交分鐘
- [x] 9.8 統一 capture output、failure sidecar、registry、status API 與 monitor 的 canonical path contract，補上 `<capture>.failure.json` 路徑、runner receipt 及「sidecar 已存在但監督查錯檔名」測試
- [x] 9.9 修正被動圖表 freshness 觀測：以 visual commit DOM mutation 即時取樣、5 秒補償檢查及 recorder 端 10 秒硬門檻排除舊 commit；增量繪圖失敗時以 canonical in-memory bars 有界重建 series，仍失敗則留下 DOM 診斷且不得偽造 commit

## 10. 收盤後驗證與下一交易日準備

- [x] 10.1 執行受影響的 unit、integration、replay 與 UI 測試，並確認既有 Stage 20、盤中選股、選股篩選、成交明細及盤後籌碼選股沒有回歸
- [x] 10.2 在不連 production、不下單的非交易時段完成 scheduler rehearsal、simulation cold／warm start、single-owner、磁碟容量與 log rotation 驗證
- [x] 10.3 產生下一適用交易日的 exact 160 baseline／cohort checksum、schedule receipt、容量預估、盤前檢查表與 rollback 指令
- [x] 10.3.1 修正 08:20 Gate：只有 simulation mode、有效 API generation、business session 與 2330 Snapshot 同時成功才可建立 generation anchor；否則走安全 simulation lifecycle，仍失敗即產生 incident 並 fail closed
- [x] 10.4 在下一適用交易日依 08:20／08:35／08:45／08:50／09:02:15 節點執行 live 驗收，盤中持續保存逐分鐘 coverage、資源與功能可用性 evidence
- [x] 10.5 於該交易日逐檔實際收盤完成後，封存一般盤 expected-minute set、所有適用延後收盤資料、close evidence 與 GO／NO-GO；只有全部 Gate 通過才建立 160 activation，否則保留 active limit 20

## 11. 實作受限收盤尾端例外與盤後回補

- [x] 11.1 定義少於 5 檔、每檔至多最後 5 個連續分鐘的尾端缺口政策；09:01 canary、盤中連續性與既有安全 Gate 不得放寬
- [x] 11.2 建立盤後 REST KBar 雙抓 worker，驗證完整 270 分鐘、canonical hash 一致及 live cumulative prefix 完全相符，回補列標記 `liveDelivered=false`
- [x] 11.3 建立引用 immutable source capture hash 的 derived acceptance；原始 capture 與首次 NO-GO 不得覆寫，超界或不一致時維持 active limit 20
- [x] 11.4 更新 bundle、Codex review、activation 與下一交易日 runner，使有效 derived acceptance 可核准 160，且 historical tail 不具通知、production 或 broker-write 權限
- [x] 11.5 補上 1 檔 2 分鐘成功、4 檔 5 分鐘邊界成功、5 檔拒絕、早段缺口拒絕、非連續缺口拒絕、雙抓漂移與 live prefix 衝突測試
- [x] 11.6 對 2026-09-16 的 3026.TW 執行雙抓回補與 Codex 重新審閱；保存新 GO／NO-GO dossier、驗證 active limit，且不刪除原始 NO-GO evidence
