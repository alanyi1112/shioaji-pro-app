## 1. 固定來源與完成授權整理

- [x] 1.1 保留並記錄 RealTimeStock 現有、與本 change 無關的工作樹異動，確認後續匯入與 commit 不包含先前取消 change 的檔案。
- [x] 1.2 在乾淨、隔離的 checkout 取得 `MultiChartOnCodexSite` 遠端最新分支，記錄 branch、完整 SHA、commit 時間與相對 `main` 的差異，不直接複製目前 sibling repo 的未追蹤檔案。
- [x] 1.3 盤點參考 repo 的作者持有範圍、外部貢獻、vendored 程式、字型、圖示、資料樣本與套件授權；授權不明項目須先替換、取得許可或排除，並保存可驗證清單。
- [x] 1.4 在參考 repo 補齊自有程式 `AGPL-3.0-only` 的 `LICENSE`、`package.json` license、README 來源與修改聲明，以及 `THIRD_PARTY_NOTICES.md` 與 Apache-2.0 授權副本。
- [x] 1.5 將 Lightweight Charts 固定為本機 dependency v5.0.9，移除 unpkg／浮動 CDN 載入，並在 UI 保留符合套件要求的 TradingView attribution；本 change 不升級圖表套件版本。
- [x] 1.6 以忽略未知 lifecycle scripts 的方式安裝參考 repo dependency，完成完整 dependency／license／秘密字串掃描、build、test 與 full audit，修正阻擋問題後產生新的乾淨授權基準 SHA。

## 2. 匯入 MultiView 並建立可追溯專案結構

- [x] 2.1 將第 1 節固定 SHA 以保留來源歷史的 subtree 或等效方式匯入 `apps/multiview/`，不得夾帶來源 repo 的 `.git`、build output、D1 state、秘密或個人資料。
- [x] 2.2 建立 `apps/multiview/UPSTREAM.md`，記錄來源 URL、branch、完整 SHA、匯入日期、授權、原始功能基準、本地修改與後續 upstream 更新程序。
- [x] 2.3 建立或調整根目錄 pnpm workspace 與一致的 install、dev、build、test、lint、typecheck 入口，同時保留 RealTimeStock 與 MultiView 各自可獨立執行的 package boundary。
- [x] 2.4 加入 CI／本機檢查，驗證匯入 revision、AGPL／Apache／NOTICE／attribution、禁用外部圖表 CDN，以及未授權 vendored 檔案不會重新進入 bundle。

## 3. 建立 loopback-only MultiView runtime 與本機資料層

- [x] 3.1 將 MultiView Web／Worker 改為預設只監聽 `127.0.0.1:5174`，提供獨立 health，並確保 5174 故障不影響既有 5173 與 8080。
- [x] 3.2 將 D1／Miniflare state、備份與 migration metadata 放到 repo 外、權限受限的 RealTimeStock Application Support 路徑，提供初始化、schema revision 與精確路徑診斷。
- [x] 3.3 實作 migration 前備份、transaction migration、`PRAGMA integrity_check`、coverage gate、原子啟用與可回復 restore；一般 uninstall 預設保留 D1、備份、清單及設定。
- [x] 3.4 擴充 `scripts/realtimestock-runtime` 與 LaunchAgent install／status／restart／uninstall，統一管理 5174，且重新登入或重開機仍以 simulation 為預設。
- [x] 3.5 在 runtime status 分列 8080 listener／mode／business request、5173、5174、D1 integrity、即時來源與盤後 pipeline，不以單一 HTTP 200 或 SSE heartbeat 代表整體正常。

## 4. 建立 Shioaji data-only adapter 與安全邊界

- [x] 4.1 在 MultiView origin 建立 `/local-shioaji/api/v1/...` proxy，只 allowlist `info`／必要 health、contract base／info、snapshots、kbars、SSE subscribe／unsubscribe 與 data stream。
- [x] 4.2 對 adapter 的 path、method、body schema、symbol count、response size、loopback target 與 timeout 做 fail-closed 驗證，所有 order、account、CA、token、server 管理與未知路徑回 `403` 且不得轉送。
- [x] 4.3 將 adapter log 限制為去識別化計數與 reason code，不記錄 request body、response 行情、帳戶識別、秘密、CA 或完整商品清單，並加入秘密掃描測試。
- [x] 4.4 實作 simulation 啟動後的 SSE 清理、重新 bootstrap 與 fallback；非 simulation 模式停止 5174 或回 `simulation_required`，不得取得該模式行情。
- [x] 4.5 加入路由、bundle 與動態請求安全測試，證明 `apps/multiview/` 不 import 交易函式、不包含可達 order proxy，且非 simulation 不轉送契約、Snapshot、Kbars 或串流。

## 5. 整合版面入口、週期限制與獨立設定

- [x] 5.1 在 RealTimeStock「版面」選單加入 `MultiView（開新分頁）` action，於同步使用者事件中開啟可設定的 loopback URL，不修改、儲存或重設目前 workspace。
- [ ] 5.2 在新分頁提供 5174 未啟動、Shioaji 離線、使用延遲 fallback、盤後資料異常與正常可用的可見狀態及重試指引。
- [x] 5.3 將 MultiView config、週期選單、URL parser、localStorage migration、prefetch、batch 與 candles API 的週期 allowlist 統一為 `1d`、`1wk`、`1mo`，預設 `1d`。
- [x] 5.4 驗證舊分 K／分時設定、query string、手動 API request 與隱藏入口都不能啟用 intraday，同時保留日／週／月切換。
- [x] 5.5 保持 RealTimeStock watchlist 與 MultiView「我的清單」的資料、商品、排序與儲存 key 完全獨立，不新增雙向同步。
- [x] 5.6 驗證非台股商品仍使用原 provider、歷史與技術指標，只套用日／週／月限制；不得送入 Shioaji adapter。

## 6. 實作台股契約解析與來源狀態

- [x] 6.1 建立 MultiView canonical symbol 到 Shioaji contract 的資料模型；`.TW`／`.TWO` 經 contract API 取得 `security_type`、`exchange`、`code`、`target_code`，`^TWII` 明確映射 `IX0001`。
- [x] 6.2 對 contract、Snapshot、Kbars 與 SSE payload 做 shape、交易日、Asia/Taipei timestamp、sequence 與 OHLC 合法性驗證；失敗時不得猜測 contract 或更新圖表。
- [x] 6.3 提供頁面層級 `自動`、`Shioaji 即時`、`Yahoo 延遲`模式，預設 `自動`，並在每個 panel 顯示實際 provider、來源時間、新鮮度與 realtime／delayed／stale／unavailable 狀態。
- [x] 6.4 實作自動 fallback 與手動來源模式：fallback 原子替換當期 payload，不混接兩個來源的 OHLCV；強制 Shioaji 失敗時顯示 unavailable，強制 Yahoo 時釋放即時 demand。
- [x] 6.5 分別追蹤 price 與 volume availability；IND 或缺量商品不得以 amount、昨量、零值或 Yahoo volume 冒充 Shioaji 即時量，volume-based 指標須顯示 canonical-only／unavailable。

## 7. 實作即時日週月 K 棒與訂閱協調器

- [x] 7.1 以既有 completed canonical history 為基底，用 Snapshot bootstrap 並以 SSE 更新當期 provisional 日 K，禁止把 Tick 全量或 provisional bar 寫入 D1 completed history。
- [x] 7.2 由同 period completed 日 K 加上當日 provisional 聚合週／月 K，先依 period key 移除既有 provisional，確保 OHLCV 只計算一次並處理月初／週初情境。
- [x] 7.3 每個 MultiView document 建立至多一條 Shioaji SSE，依解析後 contract 去重、reference count、短 cooldown unsubscribe，並在 visibility、reconnect、panel 切換與 destroy 正確清理。
- [x] 7.4 以 generation／sequence 防止快速切換、斷線重連或舊 request 的晚到事件污染目前商品及 interval。
- [x] 7.5 收盤後只有既有 TWSE／TPEx verification 與 session date 對齊成功才能以 canonical 日 K 取代 provisional，並重聚合週／月；pending／mismatch 必須保持可見。

## 8. 實作即時技術指標更新與效能控制

- [x] 8.1 在接受 provisional bar 後，以既有固定公式重算目前選取主圖／副圖指標的必要尾端，涵蓋 MA、BOLL、KD、MACD、RSI、ATR 與資料合法時的 volume indicators。
- [x] 8.2 對遞迴指標保存完整前序狀態或等價 checkpoint，建立與相同 candles full recompute 一致的 fixture 測試，避免只依可視 window 計算。
- [x] 8.3 對每個 `symbol + interval + indicator signature` 建立單一 latest-wins job，以 animation frame 或 100～250ms 節流，切換 interval 時取消或丟棄舊 generation。
- [x] 8.4 更新 Tick 時重用既有 pane／series，不得每筆 Tick 重抓完整 candles、重建 pane 或寫 D1；加入 request count、SSE count、subscribe count 與 render churn 量測。
- [ ] 8.5 以 1／2／3／4／6／8 圖、重複商品、快速切換與背景／前景循環驗證 CPU、記憶體、訂閱去重、指標正確性與畫面穩定度。

## 9. 搬移盤後資料、回補與本機排程

- [x] 9.1 將既有 Yahoo、TWSE、TPEx、TDCC、FinMind provider、欄位、單位、頻率、source date、缺值與 verification 語意移至本機 Worker／D1，禁止補零或 forward-fill 未發布資料。
- [x] 9.2 實作本機 latest、history、TDCC continuous 與 PE backfill internal routes／scheduler，以 run-specific id、checkpoint、lease、retry、changed-only write 與有界 overdue 補跑確保可重入。
- [ ] 9.3 實作前先唯讀確認 Cloudflare 權威 D1 export 的既有授權、schema 與 coverage；有合法授權時只匯出 market／chip／history data，沒有時不得讀 cookie 或建立 bypass，改走官方 bounded backfill。
- [ ] 9.4 初始 seed 或回補前備份本機 SQLite，使用 transaction 匯入，完成 `PRAGMA integrity_check`、row count／日期 coverage 與代表 `.TW`、`.TWO`、TDCC、PE 商品驗收。
- [x] 9.5 建立 run／coverage 為基礎的健康狀態，顯示 source date、processed、remaining、failed、retry、blocked 與 D1 integrity；HTTP 200 或排程曾觸發不得冒充完成。
- [ ] 9.6 驗證所有既有盤後 pane、下載、回補與缺值畫面可從本機 D1 正常使用；若歷史 coverage 未實際補齊，對應任務與 UI 必須維持 incomplete。
- [x] 9.7 若需要保留參考 repo 的個人設定，只遷移目前使用者的 MultiView tabs／instruments 並映射為本機 opaque user；不得搬移 Access／audit／secret 或合併 RealTimeStock watchlist。

## 10. 建立右鍵下單面板橋接

- [x] 10.1 在 MultiView 主圖右鍵選單加入「下單」，只對已解析且 RealTimeStock 支援的台灣 STK／WRT 啟用；IND、非台股與不支援 contract 顯示停用原因。
- [x] 10.2 以同步 `window.open` 或等效既有 popout 契約開啟／聚焦 5173 `OrderTicket`，只傳 contract code 與必要 security type／exchange，並由 ticket 重新解析商品。
- [x] 10.3 對 bridge query／message 建立最小 schema；含 account、side、price、quantity、order type、order action、CA 或 token 的 payload 必須整體拒絕。
- [x] 10.4 處理 popup blocker、5173 未啟動、contract 失敗與 timeout，只顯示可回復錯誤及操作指引，禁止 fallback 成直接交易或未驗證商品。
- [x] 10.5 在 simulation 驗證面板連動與既有送單確認流程；非 simulation 模式必須在契約解析前 fail closed，本 change 不執行正式環境行情驗收，也不建立 `production-trading`。

## 11. 整合驗證、文件與交付門檻

- [x] 11.1 完成 RealTimeStock 與 `apps/multiview/` 的 lint、typecheck、unit、contract、browser、build、dependency audit、license scan、secret scan 與 `git diff --check`。
- [ ] 11.2 在 simulation 實際驗證版面新分頁、日／週／月、兩套獨立清單、非台股原來源、台股即時／延遲模式、斷線 fallback、canonical handoff、技術指標與右鍵 OrderTicket。
- [ ] 11.3 逐一驗證 1／2／3／4／6／8 圖與重複商品，保存單一 SSE、訂閱數、request 數、指標 full-recompute 對照、畫面穩定與效能證據。
- [ ] 11.4 驗證 MultiView 啟動、重啟、Mac 重新登入後 simulation 預設、非 simulation 停止／拒絕、D1 備份／restore 與 uninstall 保留資料。
- [x] 11.5 更新 README／本機操作文件，說明授權與來源、服務 ports、資料位置、simulation-only、fallback、排程、備份／回復、OrderTicket 安全邊界及未來正式環境功能另立 change 的要求。
- [x] 11.6 執行此 change 的 OpenSpec strict validation，核對 proposal、design、spec、tasks、實作與驗證證據一致後，才進入 archive／commit／push 流程。
