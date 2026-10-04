## 1. 分價彙總 domain

- [x] 1.1 建立可獨立測試的 price-volume distribution 型別與 accumulator，以正規化成交價增量維護總量、買方量、賣方量、未知量、大單量及全域價量乘積
- [x] 1.2 實作總成交均價、大單成交均價、總佔比、大單佔比、最大 bucket 相對長度及開／現／高／低標記 view model，明確處理零分母與標記重疊
- [x] 1.3 加入 domain tests，涵蓋多價位、同價位多方向、未知方向、整股單位、精度、無成交、無大單、相同內容獨立成交及不合格事件 fail closed

## 2. Session 與大單分類整合

- [x] 2.1 將 accumulator 接入 `SessionTapeClassifier` 的去重後 append／replay 流程，每筆 live tick 只增量更新對應 bucket，不在 render 重掃完整 rows
- [x] 2.2 讓大單設定變更、AbortController、generation 與重算期間新成交沿用既有原子切換流程，同步產生相同設定 revision 的 distribution
- [x] 2.3 將 distribution snapshot 與 coverage、已載入範圍、recomputing 狀態由 `useTickTapeSession` 提供給 UI，且不改寫 IndexedDB 原始 tick cache 格式
- [x] 2.4 擴充 session tests，驗證開盤／13:25 起成交只進總量、不繞過大單資格，並驗證亂序、重疊、設定重播與跨商品／交易日隔離

## 3. 分價量表 UI

- [x] 3.1 在 `TickTape` 增加「成交明細／分價量表」檢視切換，保留成交明細內的「全部／大單」、大單設定及資訊對話框，且只對 `TSE`／`OTC` 的 `STK` 提供有效入口
- [x] 3.2 實作總成交均價與大單成交均價摘要；使用商品 formatter、common lot（張）與一位小數佔比，無大單或無成交時顯示明確不可計算／空狀態
- [x] 3.3 實作由高至低的成交價、方向堆疊成交量圖、大單佔比、總佔比與成交量欄位，為買方／賣方／未知提供顏色以外的可及性語意
- [x] 3.4 實作開／現／高／低多標記、首次切入自動帶到目前價、主動捲動後保持閱讀位置及回到目前價控制
- [x] 3.5 在分價檢視呈現 loading／partial／verified／confirmed_empty／failed、已載入範圍與重算狀態；partial 時不得宣稱完整日高低或完整全日佔比
- [x] 3.6 調整 compact panel、較窄獨立視窗與深色主題樣式，維持有界 DOM、數字對齊、欄頭可讀及鍵盤操作

## 4. 自動化與資源驗證

- [x] 4.1 加入 component／browser tests，驗證檢視切換不新增 history request 或 SSE subscription、主面板與獨立視窗語意一致且關閉時 refcount／cleanup 正確
- [x] 4.2 加入 UI tests，驗證摘要公式、方向色段、百分比、標記重疊、目前價定位、partial／failed／empty 狀態、大單設定同步及不支援商品邊界
- [x] 4.3 以 100,000 與 500,000 筆 fixture 對獨立 oracle 核對 bucket 與摘要，記錄 replay 可取消、DOM 有界及即時 append 不執行完整 rows 掃描的證據
- [x] 4.4 執行 scoped Vitest／browser tests、TypeScript、lint、build 與 `git diff --check`，保留任何非本 change 的既有失敗而不粉飾
- [x] 4.5 修正高成交量商品每筆 live tick 重新排序／掃描全日成交的效能問題；連續的新成交改為增量核對，歷史載入或亂序時才完整檢查，並加入大量資料回歸測試
- [x] 4.6 修正契約快取將 Tick／BidAsk 任一成功誤認為全部訂閱成功；只對未成功的類型允許後續重試，不重送已確認的類型，並加入部分成功回歸測試
- [x] 4.7 在既有共用行情 port 加入手動唯讀診斷，輸出路徑、來源／port 生命週期、事件計數與有界指定商品 trace；驗證查詢不新增 EventSource 或訂閱，並明示 fallback 限制

## 5. Simulation 真實盤中驗收

- [x] 5.1 在 Shioaji simulation 與正常交易時段，以流動性足夠的 `TSE`／`OTC` 股票驗證首次歷史載入、coverage、總量及至少一筆真實 SSE 更新，逐項保存時間、商品、來源日期、row／volume 數及 network evidence
- [x] 5.2 驗證 `/api/v1/data/ticks` 與 `/api/v1/stream/data` 共用同一 session，新成交只增加一次正確價位與方向量，斷線／重連期間保持 partial 並有界補齊
- [x] 5.3 在獨立視窗驗證實際 SSE event、共享 refcount、關閉 cleanup、無重複列與閱讀位置；只有 REST 而沒有 SSE 的結果 MUST 保持未完成
- [x] 5.4 驗收全程確認 production 停止、無交易寫入、無新增行情 subscription 或服務啟停，並將成功、未通過與來源限制分開記錄
- [x] 5.5 執行 OpenSpec strict validation，將自動化及真實盤中結果寫入 verification 記錄；只有所有必要證據通過才可勾選完成並進入 archive 評估
