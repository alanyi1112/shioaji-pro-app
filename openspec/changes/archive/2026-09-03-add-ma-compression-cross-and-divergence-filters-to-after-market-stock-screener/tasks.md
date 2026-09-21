## 1. 固定來源與公式契約

- [x] 1.1 盤點 v3 的官方日線 parser、D1 tables／indexes、60-session planner、publisher、repository、route、前端 criteria／偏好與驗收工具，記錄不可退化責任鏈。
- [x] 1.2 分別以實際 TWSE／TPEx 最新與歷史全市場日報核對 requested date、open／high／low／close、成交量欄名、股／張單位、價格基礎、授權、自動化限制與普通股覆蓋，將非敏感結論寫入 source review。
- [x] 1.3 建立兩市場正常、成交量含千分位／零值、缺欄、非法值、日期錯置、schema 漂移與部分市場回應 fixtures，證明不相容來源 fail closed。
- [x] 1.4 將 SMA 糾結／準備／交叉、price pivot、一般型背離、MACD histogram 零軸及候選 pair tie-breaker 寫成 typed formula contract 與表格 fixtures。
- [x] 1.5 以獨立手算案例核對邊界：門檻相等、均線相等、pivot high／low 相等、2+2 確認、5／30 日間距、3 日新鮮度、1% 價差及指標暖機不足。

## 2. 建立 130 日官方 OHLCV 底稿

- [x] 2.1 新增 additive D1 migration，為 canonical 歷史資料補上精確 `volume_shares` 與必要 source／mapping metadata；既有 v3 schema、資料與讀取保持相容。
- [x] 2.2 更新 OHLCV domain／repository，以十進位字串安全保存非負整數股數並嚴格驗證 OHLC、日期、單位、來源版本與較新稀疏回應。
- [x] 2.3 擴充 TWSE／TPEx 官方歷史 adapter，依已核對欄位輸出 canonical OHLCV、payload hash、fetchedAt 與逐列 invalid reason，不以成交值、Snapshot 或其他來源推算成交量。
- [x] 2.4 將 planner 擴充為 130 個官方交易日，使用 `market + session + sourceMappingVersion + dataCapability=ohlcv-v4` deterministic target／receipt，舊 OHLC receipt 不得誤算為 OHLCV 完成。
- [x] 2.5 實作既有 60 日補 volume、額外約 70 日 OHLCV、新增商品自上市日起補資料及每日 window 前移一日的最小缺口規劃。
- [x] 2.6 保留 single-flight、request／time budget、完整 fetch＋body timeout、Retry-After、合法冷卻、有界 retry、checkpoint／cursor 與中斷續跑，並讓 target／processed／remaining／failed／overdue 守恆。
- [x] 2.7 更新 retention，保留最新 130 session 與仍被 snapshot 引用的錨點，不刪除 candle history、TDCC、清單、交易或其他產品資料。
- [x] 2.8 補齊 migration、parser、repository、planner、續跑、rate-limit、新商品、retention 與 v3 相容 focused tests。

## 3. 實作均線與背離純函式核心

- [x] 3.1 實作未四捨五入的 SMA5／10／20、spreadPct、最近 10 日特徵、SMA5−SMA20 gap 與資料不足 reason。
- [x] 3.2 實作多頭準備突破、黃金交叉、空頭準備跌破、死亡交叉、任一多頭及任一空頭三態判定，嚴格區分 P 糾結與 D 糾結終點。
- [x] 3.3 實作左右各 2 根的嚴格 price pivot、5–30 日 pair、3 日新鮮度、1% 價差與 deterministic 最新 pair 選擇。
- [x] 3.4 以 canonical OHLCV 串接 OBV、RSI5、RSI10、KD-K(9,3,3)、MACD line／histogram(12,26,9)，固定暖機起點與非法輸入語意。
- [x] 3.5 實作六種來源的一般型多／空背離；MACD histogram 增加正負零軸及 zero-reset 開／關兩版，hidden divergence 不得混入。
- [x] 3.6 定義 compact v4 evidence、formula／normalization version、unknown reason 與 deterministic hash，不保存不必要的完整原始序列。
- [x] 3.7 建立均線、pivot、各指標背離、零軸、相等邊界、暖機缺口、非法成交量與重算 deterministic 的完整 unit／property-style tests。

## 4. 建立 v4 publisher、repository 與唯讀 API

- [x] 4.1 新增 v4 snapshot／row／technical evidence／progress／criteria 型別與 additive persistence，明確隔離 v1／v2／v3／v4 ID、cache、cursor 與 formula version。
- [x] 4.2 實作 v4 publisher，以同一 130-session canonical OHLCV 產生最近 10 日均線特徵、六種指標、price pivot 與背離矩陣。
- [x] 4.3 實作 v4 publication gate，核對 universe、兩市場 targets／receipts、staging row、source／formula version、daily／technical anchors 與 `effectiveSessionDate` 後才原子發布。
- [x] 4.4 更新 repository 讀取及 snapshot retention，防止 partial market、mixed-session、mixed-version 或較新稀疏資料覆蓋最後合法快照。
- [x] 4.5 擴充 status／results route 的固定 schema，驗證均線 mode、2–10 日、0.1–5.0%、背離來源／方向、zero-reset、排序、頁大小與 cursor。
- [x] 4.6 正規化停用或不適用參數並建立 v4 criteria fingerprint；route 只套用 immutable features，不查 canonical 原始表臨時計算。
- [x] 4.7 將兩個新分支納入既有 `all`／`any` 三態與逐分支缺漏，維持 matched／notMatched／unknown 全市場守恆及穩定排序／分頁。
- [x] 4.8 實作 v3 相容投影：新條件全關時保留當期合法 v3 查詢；任一新條件開啟但 v4 未 ready 時回 preparation pending，不重解釋舊 rows。
- [x] 4.9 以 route／publisher／repository tests 證明重複 GET、排序、翻頁、惡意參數與 pending v4 的 provider、DDL、dispatch、Shioaji、交易呼叫均為零。

## 5. 整合選股 UI、偏好與圖表連動

- [x] 5.1 擴充前端 API decoder 與 domain schema，拒絕未知 v4 枚舉、版本、非有限數、證據缺欄、日期錯置與守恆不符回應。
- [x] 5.2 將合法 v3 偏好單向遷移至 v4，新條件預設關閉；保存 mode、糾結日數／寬度、背離來源／方向／zero-reset 並 fail closed 處理未知版本。
- [x] 5.3 在既有選股面板新增均線與背離 fieldset、可讀說明、條件相依停用及 inline validation，維持已提交 criteria 與未套用 draft 隔離。
- [x] 5.4 呈現 v4 preparation／coverage／unknown 狀態；新條件未 ready 時不得保留可點選或可加入清單的舊 rows，既有 v3 條件仍依相容規則可用。
- [x] 5.5 在結果卡／詳情顯示均線 P／D、SMA5／10／20、糾結窗與 spread，或背離 pivot／confirm 日期、價位、指標、間距、價差與 zero-reset evidence。
- [x] 5.6 維持結果點選只連動同頁指定未鎖定 K 線圖；只有明確按「加入清單」才加入「選股」清單，來源頁、其他圖表、下單草稿與行情訂閱不變。
- [x] 5.7 調整面板內捲動與 responsive styles，讓 600 CSS px 高 viewport、最小面板寬度、特大字級、鍵盤與 focus 狀態皆可完整操作。
- [x] 5.8 補齊 domain、API、preference migration、draft race、結果 evidence、watchlist／chart side effect、browser accessibility 與 screenshot regression tests。

## 6. 執行本機全市場資料準備與獨立驗證

- [x] 6.1 在不啟停既有 runtime 的前提下執行本機 v4 bounded bootstrap，完成既有 60 日成交量與新增 session OHLCV 回補；每輪保存非敏感 progress evidence。
- [x] 6.2 核對本機 D1 integrity、additive schema、130-session plan、TWSE／TPEx 逐日期筆數、成交量單位、source mapping、listing-date 缺口與 receipt／progress 守恆。
- [x] 6.3 將 v4 full run 推進至 remaining／failed／overdue 為零或全部為規格允許且逐筆可解釋的正式終態，再核對 staging universe row count 與 anchors 後發布。
- [x] 6.4 以獨立 verifier 從 canonical OHLCV 全市場重算六種均線模式、六種背離來源／兩方向／zero-reset，逐筆對帳 publisher evidence hash、API 全分頁集合與守恆計數。
- [x] 6.5 驗證上市、上櫃、新商品、停牌／零量、insufficient history、未加入清單且非排行前百名、pass／fail／unknown 代表案例，不以 fixture 或單檔取代。

## 7. 完成實際 UI 與無副作用驗收

- [x] 7.1 在本機完整交易終端開啟選股版面，逐項驗收均線六模式、各背離來源／方向、參數驗證、AND／OR、排序、翻頁、pending、unknown 與 evidence 顯示。
- [x] 7.2 點選代表性均線與背離結果，核對指定日 K 圖商品、資料日期與可見圖形，並確認 chart-local Snapshot、來源主頁及其他分頁不被過時 response 污染。
- [x] 7.3 以 owner 本機操作驗證「加入清單」只在明確按鈕動作發生、hover／鍵盤可用，其他點選不改自選清單、TDCC 佇列、交易／智慧下單或行情訂閱。
- [x] 7.4 在 600 CSS px 高度、最小面板寬度、特大字級與調整視窗高度情境核對面板不超出 viewport、內容可捲動、焦點可見且 console 無錯誤。
- [x] 7.5 保存不含帳密、token 或個資的 source、DB、API、DOM／canvas、console 與無副作用 evidence 至 `verification.md`；只有實際通過項目才勾選。

## 8. 完整回歸與 OpenSpec 收尾

- [x] 8.1 執行所有新模組及受影響 OHLCV、indicator、publisher、route、選股、workspace、watchlist 與 chart focused tests，修正所有回歸。
- [x] 8.2 執行完整 `pnpm test`、browser tests、lint、型別檢查與 root／MultiView build，記錄命令、總數與結果。
- [x] 8.3 執行 `openspec validate --all --strict` 與 `git diff --check`，核對 proposal、design、specs、tasks、verification 與程式差異一致且未納入無關 dirty tree。
- [x] 8.4 最終對照每項 Requirement／Scenario 與實際 evidence，確認沒有把 v3、fixture、HTTP 200 或單一商品成功冒充 v4 全市場完成，才將 change 標記可歸檔。
