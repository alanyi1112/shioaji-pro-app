## 1. 建立可稽核的 approval 與 session 資料模型

- [x] 1.1 盤點現行 `direct-160-product-runtime`、premarket config、scheduler receipt、API status 與 UI view-model 的欄位來源，建立舊欄位到 approval／session／capacity／baseline／freshness 的明確對照與 migration fixture
- [x] 1.2 實作 durable capacity approval schema 與 repository，保存 approved limit、stage、decision、reviewer type、非敏感 reviewer identity、reviewedAt、evidence trade date、bundle hash 與授權 provenance
- [x] 1.3 實作每日 session manifest schema 與 repository，保存 session identity、交易日、上一適用交易日、revision、cohort／baseline／artifact／approval hashes、API generation、phase、freshness 與逐檔狀態
- [x] 1.4 實作舊 v1 product state 的唯讀 migration，使 2026-09-16 證據只匯入 historical approval／history，且不能產生 current-session、subscription、results 或 notification authority
- [x] 1.5 為 schema validation、原子寫入、exclusive claim、重複 migration 與損毀檔案 fail-closed 行為新增單元測試

## 2. 建立 archive-stable runtime artifact bundle

- [x] 2.1 實作 runtime artifact bundle importer，將 cohort、plan、baseline prerequisite 與 verifier metadata 寫入 `Application Support/RealTimeStock/IntradayMonitor/runtime-artifacts/<bundle-hash>/`
- [x] 2.2 在 bundle manifest 保存 repo-relative source、原始 change／archive identity、schema、SHA-256、建立時間與相依關係，並以 content hash 去重及原子發布
- [x] 2.3 實作執行期 bundle resolver，只接受 manifest 指定內容與 hash，不使用 active-change 絕對路徑、symlink、basename 搜尋或最近檔案 fallback
- [x] 2.4 新增 active change 歸檔後仍可解析、缺檔、hash 不符、schema 不符及匯入中斷不覆寫既有 bundle 的測試

## 3. 修復每日交易日 rollover 與 durable scheduler 證據

- [x] 3.1 對接專案既有官方交易日 authority，以 `Asia/Taipei` 判定 authority trade date、是否為適用交易日及 previous trade date；authority 不可用時回報 `calendar_authority_unavailable`
- [x] 3.2 重構 08:20 premarket step，使其在適用交易日以 exclusive claim 原子建立唯一 current-session manifest，並移除固定 `tradeDate=2026-09-16` 的執行依賴
- [x] 3.3 更新 08:35、08:45、08:50 steps，要求它們讀取並核對同一 session id、scheduler computed fire time、API generation 與所有 artifact hashes
- [x] 3.4 實作帶 authority 來源的 non-trading receipt，以及 `session_rollover_missing`、`session_trade_date_stale`、Gate failure 與 capture started 的互斥 outcome
- [x] 3.5 為每個排程時點持久化 computed fire time、實際開始時間、台北日期、session id、step claim、rollover outcome 與 reason，並提供維運查詢介面
- [x] 3.6 新增跨午夜、連假／非交易日、重複觸發、過去日期 legacy config、revision mismatch 與四步共享 manifest 的 scheduler／orchestrator 測試
- [x] 3.7 實作 13:35 後每日有界、唯讀的 160 檔歷史 1 分 K 基準採集與驗證排程，保留磁碟門檻，流量啟動門檻由 3.9 的實測動態預算取代；僅完整且日期、cohort hash 一致時發布隔日精確 `baseline-set.json`
- [x] 3.8 為基準排程保存 append-only claim、官方日曆與來源／建檔成功或失敗 receipt，提供唯讀查詢並測試休市、來源 partial、流量不足、重複觸發與不覆寫
- [x] 3.9 以相同 cohort、近期完整驗證的 provider usage delta 建立有界動態預算，移除固定 256 MiB 啟動門檻；樣本或 usage 欄位不足 fail closed，budget 與來源雜湊保存於嘗試收據
- [x] 3.10 採集器依動態預算逐請求檢查 provider 剩餘額度、單次回應上限與未完成商品預估量；超限即停止並保留 partial，不降低雙抓／逐筆／單位／日期驗證
- [x] 3.11 建立同日最多三次、13:35／14:15／14:55 的失敗後有界重試；每次來源與 claim／budget／receipt 獨立不可覆寫，完整驗證後才原子發布精確隔日基準
- [x] 3.12 新增相同與不同 cohort、少於兩筆樣本、quota 欄位失真、採集中額度驟降、失敗保留、重複／並行執行、成功後 no-op 及舊首次收據相容測試
- [x] 3.13 釐清 2026-09-24 官方日曆 `fetch_failed` 與 08:35／08:45 缺席的原始證據，區分可證明原因與無法追溯的網路細節，不補造歷史收據
- [x] 3.14 實作獨立且有界的歷史基準補建，驗證官方來源交易日／下一適用交易日、既有 simulation session、動態預算及 160/160 完整性；原排程收據不可覆寫，補建須明示非排程成功
- [x] 3.15 保存 2026-09-24 → 2026-09-29 實際補建 claim／budget／來源／驗證／發布收據與前後安全狀態，執行 focused tests、strict validation 與 diff check；翌日 live acceptance 仍由 7.4–7.7 個別判定
- [x] 3.16 官方 TWSE／TPEx 日曆讀取加入單次逾時及同一步驟最多三次重試，雙來源仍須完整驗證；三次失敗保留 `calendar_authority_unavailable` 收據且不建立 session claim，加入短暫失敗、全失敗及未回應的回歸測試
- [x] 3.17 依 2026-09-30 原始失敗證據，改由盤後已發布的完整基準所附 TWSE／TPEx 官方日曆供盤前四步本機驗證，盤後 TWSE OpenAPI 優先、舊端點備援；08:35／08:45 可在零今日資料活動與完整 Gate 下自動恢復 08:20 日曆失敗，保留原收據與非 08:20 成功語意，加入回歸測試

## 4. 強制 current-session data-plane 與觸發權限

- [x] 4.1 實作 current-session authority validator，完整核對 authority／session trade date、鎖定與儲存 revision、cohort／baseline／bundle／approval hashes、API generation、phase 與 freshness budget
- [x] 4.2 將 subscription coordinator、KBar observation、completed-minute 推進、量比計算、trigger ledger 與 notification Gate 接到 authority validator，任一 conjunct 失敗即 fail closed
- [x] 4.3 將 control-plane requested／accepted 與逐檔第一筆合法 KBar 的 data-plane active 分開紀錄，且 historical receipt 不得計入今日統計
- [x] 4.4 實作互斥逐檔 state normalization，使 configured、eligible、admitted、dataActive、waitingGate、waitingPilotLimit、waitingCapacity、waitingBaseline、degraded 可稽核且總和等於 configured
- [x] 4.5 實作獨立 baseline summary，分別統計 complete、missing、stale、unknown 與實際 baseline trade dates，不從 `waitingBaseline` 反推完整度
- [x] 4.6 新增 stale trade date、revision／generation mismatch、過期 evidence、40 檔 pilot limit、11 檔 degraded 與 baseline unknown 的 domain／runtime 測試
- [x] 4.7 在開盤前未訂閱、無 KBar／結果的嚴格條件下實作 generation epoch 受控恢復，保留舊 identity 與 append-only transition receipt；任何已活動或不明狀態仍 fail closed
- [x] 4.8 新增換代前後、重複 recovery、已訂閱／已收 KBar、baseline 或 config 不一致、失敗收據保留及完整 Gate 重驗的測試

## 5. 更新本機 API 狀態投影與相容行為

- [x] 5.1 更新 `/status` 與 `/diagnostics` 回應，加入 `approval`、`session`、`capacity`、`baselineSummary`、`freshness` 及具體 stale／failure reason
- [x] 5.2 更新 `/results`，使非 current、identity 不一致或 evidence 不新鮮時只回傳空的今日結果，或以不可誤認的欄位明確標記歷史結果
- [x] 5.3 保留必要 legacy 欄位供相容 client 使用，但停止由 `evaluationState=go`、HTTP 200、頁面 heartbeat、lease 或 persisted rows 推論 today live
- [x] 5.4 新增舊 server response 正規化、current session 缺失、歷史 GO、今日 running 與 freshness budget 邊界的 local API／gateway contract tests

## 6. 修正盤中監控面板的狀態語意

- [x] 6.1 更新 `intraday-monitor-api` 型別與單一 view-model 正規化層，缺少新欄位時一律投影為「歷史狀態／今日未證實」
- [x] 6.2 將面板拆成「容量核准」與「今日監控」兩個可辨識區塊，分別顯示 durable decision 與 current-session phase、trade date、data active、control-plane、第一筆 KBar 及 freshness
- [x] 6.3 依 provenance 顯示 reviewer 文案；`codex_delegated` 必須呈現「Codex 代理審閱」，只有 `human` 才能呈現人工簽核語意
- [x] 6.4 同時顯示互斥 state counts 與獨立 baseline summary，並將 provider usage／ownership 等 unknown 與 current-session blocker 分開呈現
- [x] 6.5 新增 2026-09-16 GO／2026-09-22 current session 缺失、149 檔 data active、waitingBaseline=0 但 baseline unknown 非零及各 mismatch reason 的 view-model 與 browser tests
- [x] 6.6 修正空結果區文案，今日 session 或 freshness 缺失時不得宣稱監控已啟動；新增 view-model 與 browser 回歸測試
- [x] 6.7 將被動 K 線證據收集器由監控面板移到主工作區常駐層，僅今日 Stage 160 running、真實可見且同日來源時間前進時提交；測試無面板、昨日重繪、非 current、解除觀測與不新增行情訂閱
- [x] 6.8 修正產品 sink 仍依前一日可變 `complete_go` 判定今日 Stage 160 啟動的殘留耦合；使用正式 approval 與今日 current session，保留單一 generation claim、安全 Gate 與失敗證據，新增前次狀態缺失／當日非 current 回歸測試
- [x] 6.9 將正式產品 sink 靜態輸入抽成唯讀預檢，接入盤前 Gate；前次 failed、核准缺失與今日 session 失效測試分開驗證
- [x] 6.10 正式擷取失敗即時本機警示及 08:52／13:40 獨立稽核，保存通知交付收據並確認 LaunchAgent 實際載入及當日補查結果
- [x] 6.11 將被動圖表證據降為選用 UI 診斷；背景收尾、正式驗收 validator 與尾端缺口 review 均依已接受合法 KBar、封閉分鐘 observation、重連與安全 Gate 判定，不要求使用者切到 1 分 K 或保持圖表可見，缺失記明原因且不造數值，增加無圖表但有真實資料、無真實資料及重連失敗回歸測試
- [x] 6.12 修正結果清單大量卡片受 flex 排版壓縮而不可讀，維持卡片高度與清單捲動；將即時觸發及歷史重播筆數分開標示，加入大量結果的瀏覽器回歸測試
- [x] 6.13 修正新增「啟動來源」後 480px 面板的今日監控狀態欄水平溢出；保留完整 title 與狀態值、視覺裁切過長文字，更新 13 欄及無水平溢出的瀏覽器測試
- [x] 6.14 修正正式擷取收盤等待仍使用 `running` 兩分鐘 freshness 的缺口；在新鮮且身分一致的收盤窗口轉入有界 `closing`，不刷新真實 evidenceAt，保持 13:30／13:33 來源與逐檔連續性驗證，安全彙總 sink 拒收原因，加入 13:34:30 及 fail-closed 回歸測試，保留 2026-10-02 失敗證據

## 7. 安裝、驗證與跨交易日 live acceptance

- [x] 7.1 先以 dry-run 驗證現有 approval migration、runtime bundle、下一適用交易日與四個 step manifests，不修改或刪除 2026-09-16 原始 evidence
- [x] 7.2 更新 durable premarket 設定與 LaunchAgent 後，讀回 scheduler 計算的四個實際 next trigger，逐一換算並確認為 `Asia/Taipei` 08:20、08:35、08:45、08:50
- [x] 7.3 執行相關 Node／Vitest 測試、TypeScript 檢查、build、OpenSpec strict validation 與 `git diff --check`，保存精確命令及結果
- [ ] 7.4 在第一個適用交易日保存 official authority、baseline、session、scheduler receipts、逐檔 control-plane／data-plane 與 freshness evidence，不以人工改日期取代自動 rollover
- [ ] 7.5 在下一個適用交易日確認 durable scheduler 自動建立新 session，並於 09:02 後驗證 current identity、第一筆合法 KBar、sealed-minute 同分鐘比較、results 與 notification Gate
- [ ] 7.6 產出跨兩個適用交易日的 acceptance dossier，保留 partial／failed／unknown 證據；只有所有 current-session Gate 與 UI/API 語意通過時才標記 ready for archive
- [ ] 7.7 唯讀核對基準建檔排程實際 next trigger、receipt 與原始流量保留，並在下一適用交易日以真實 simulation session 驗證 160 檔基準及受控換代政策；離線測試不得取代 live acceptance
- [x] 7.8 於 2026-09-29 開盤前唯讀核對已發布歷史基準、官方交易日 authority、四個 scheduler 時點及 simulation 安全 Gate，記錄可證實與待實盤驗收項目，不補造排程或 live 證據
