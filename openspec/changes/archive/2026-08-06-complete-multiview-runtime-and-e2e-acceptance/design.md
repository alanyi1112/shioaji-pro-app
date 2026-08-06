## Context

MultiView 已由 `127.0.0.1:5174` 提供本機服務，RealTimeStock 位於 `127.0.0.1:5173`，Shioaji simulation API 位於 `127.0.0.1:8080`。目前功能測試與部分瀏覽器驗收已證明來源切換、單一 SSE、指標重算及 OrderTicket bridge 的核心行為，但使用者從「版面」直接開啟 5174；若 5174 未啟動，瀏覽器只顯示連線錯誤，應用程式無法提供診斷或重試。既有測試也沒有把八圖效能與 runtime lifecycle 證據保存成可重現的安全摘要。

此 change 只在 simulation 與 loopback 執行。使用者先前已明確取消 production-readonly，本 change 不得以實際切換非 simulation 來驗收；非 simulation 邊界改在 repo 外臨時 state 與 synthetic mode response 中測試。

## Goals / Non-Goals

**Goals:**

- 讓 5174 未啟動時仍可從 5173 看見原因、目前狀態與精確重試操作。
- 以安全計數驗證同一 document 只有一條 SSE、重複商品不重複訂閱、快速切換採 latest-wins，且指標與 full recompute 一致。
- 保存 1／2／3／4／6／8 圖的 CPU、記憶體、request、render churn 與畫面穩定度證據。
- 在 simulation 完成完整瀏覽器矩陣與 runtime 啟動、重啟、備份／restore、uninstall 保留資料驗收。
- 將需要中斷桌面 session 的 macOS 重新登入留在最後，執行前明確提示並確保可接續。

**Non-Goals:**

- 不啟用或測試 production、production-readonly、CA 或真實交易。
- 不改變 Yahoo、Shioaji、非台股 provider 或技術指標公式。
- 不把觀測資料上傳、寫入行情 D1 或保存完整商品清單／行情內容。
- 不處理盤後 market／chip／history seed；該工作由另一個 change 負責。

## Decisions

### 1. 以 5173 launcher page 擁有故障前的使用者體驗

「版面」改為同步開啟 5173 的 MultiView launcher page。launcher 只對 loopback 5174 執行有 timeout 的 health 請求；正常時導向 5174，失敗時留在 5173 顯示 5174、8080 business session、fallback 與盤後資料狀態及重試按鈕。相較於直接開啟 5174，此方式在目標 process 不存在時仍能呈現 UI，且不修改目前 workspace。

### 2. 觀測資料保留在 browser document 且只允許固定安全 schema

MultiView realtime coordinator、request coordinator 與 indicator scheduler 將更新 document-local acceptance metrics，只包含版本、panel count、SSE open count、active canonical demand count、subscribe／unsubscribe／request／render／full-recompute 計數、最後安全 reason code 與 bounded duration。不得包含 symbol、URL query、行情 payload、個人清單、帳戶或 secret。瀏覽器驗收可讀取該快照，但一般 UI 不常駐顯示 debug 資訊。

選擇 document-local 而不是新增 Worker persistence，是因為要量測的是當前頁面的訂閱與 render lifecycle；寫入 D1 會混淆跨頁 session，也增加個人行為資料保存風險。

### 3. 效能驗收採可重現矩陣與相對門檻

依序切換 1／2／3／4／6／8 圖，加入至少一個重複商品，再執行快速商品切換與 background／foreground 循環。每個階段保存 panel、SSE、active demand、request、render、JS heap（平台可用時）、long task 與畫面錯誤摘要。門檻以「單 document SSE 不超過 1、重複商品不增加 canonical subscription、離開頁面後 demand 可歸零、無持續成長或未處理錯誤」為硬條件；CPU／heap 採前後差與 bounded trend，不以單次機器絕對值作跨裝置保證。

### 4. 非 simulation 只做隔離 control-plane 驗證

新增可測試的 mode gate／runtime plan 函式，使用臨時目錄與 synthetic `/info` 回應證明非 simulation 時不啟動 5174、adapter 在契約解析前回 `simulation_required`。不得切換目前 8080、不得建立 production job、不得讀正式行情或交易資料。

### 5. 生命週期驗收先備份再做可回復操作

先記錄本機 D1 hash、schema、個人清單 row count 與備份清單，再驗證 restart。restore 與 uninstall 使用明確、精確路徑；restore 先對備份執行 integrity check，uninstall 必須保留 D1、備份與設定，之後重新 install／start 並比對 hash／row count。macOS 重新登入是唯一會中斷目前 Codex session 的步驟，必須排在其他任務完成後並由使用者確認執行時點。

## Risks / Trade-offs

- [launcher health 受 CORS 或 5174 半啟動影響] → 5174 health 明確允許 5173 loopback origin，launcher timeout 後保守顯示服務不可用而非猜測。
- [觀測程式本身增加熱路徑成本] → 只更新整數計數與 bounded ring summary，不記錄每筆 Tick，也不觸發額外網路請求。
- [瀏覽器未提供 heap API] → 保留 `unsupported`，仍以 long task、request、SSE、render churn 與穩定度驗收，不偽造數值。
- [uninstall／restore 造成資料損壞] → 精確路徑、操作前備份、操作後 hash／row count／integrity check，失敗立即停止並保留原資料。
- [重新登入中斷工作] → 最後執行，先保存 OpenSpec 與驗收證據；未經當次確認不自動登出。

## Migration Plan

1. 補 launcher 與 health schema，不改變 5174 正常入口內容。
2. 加入 document-local metrics 與 contract tests，再執行多圖瀏覽器矩陣。
3. 完成 simulation 來源、週期、清單、fallback、handoff、指標與 OrderTicket 驗收。
4. 以隔離 state 完成非 simulation fail-closed，接著驗證目前 simulation runtime restart。
5. 備份 D1，完成 restore／uninstall 保留資料與重新安裝驗收。
6. 最後向使用者確認 macOS 重新登入時點；登入後驗證 simulation、5173、5174、8080 與資料 hash。

回滾時將「版面」入口恢復直接 5174 URL、停用 acceptance metrics，保留既有 runtime 與本機 D1；不需要刪除任何使用者資料。

## Open Questions

- macOS 重新登入的實際時間由使用者決定；在完成前該項任務維持未勾選。
