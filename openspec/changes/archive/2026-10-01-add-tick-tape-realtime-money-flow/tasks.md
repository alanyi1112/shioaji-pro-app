## 1. 資金流向 domain

- [x] 1.1 建立資金流向 point／snapshot 型別與純 `MoneyFlowAccumulator`，以整數新台幣維護整體、大單、非大單及未知方向摘要
- [x] 1.2 實作 `tickType=1` 正值、`tickType=2` 負值、其他為零的方向規則，沿用合法一般整股成交與 `tradeAmountTwd` 契約
- [x] 1.3 實作 `HH:mm` 分鐘聚合：同分鐘更新最後點、跨分鐘新增點，並以真實分鐘位置保留無成交時間間隔
- [x] 1.4 加入 domain tests，涵蓋買賣抵銷、未知方向、同分鐘多筆、跨分鐘、大單補集、開盤／13:25 起成交及不合格事件 fail closed
- [x] 1.5 以百萬元顯示前的原始整數 oracle 驗證每個點皆精確滿足 `整體 = 大單 + 非大單`，且運算過程不預先四捨五入

## 2. 成交 session 與大單設定整合

- [x] 2.1 將 accumulator 接入 `SessionTapeClassifier.append` 的去重後、`isLarge` 判定後流程，每筆 live tick 只更新目前分鐘狀態
- [x] 2.2 由 `useTickTapeSession` 暴露與 `result`、分價量表相同 classifier revision 的資金流向 snapshot，不新增 history loader、SSE 或 cache schema
- [x] 2.3 讓大單設定變更、replay yield、AbortController、generation 及重算期間新成交同步重建資金流向，完成後與其他衍生結果原子切換
- [x] 2.4 擴充 session tests，驗證歷史／SSE 重疊只計一次、亂序補齊、設定重播、跨商品／交易日隔離及舊 generation 拒收
- [x] 2.5 驗證未知方向筆數／金額隨 replay 與 live append 正確累加，且不改變三種淨額

## 3. 資金流向 UI

- [x] 3.1 在 `TickTape` 增加「資金流向」第三個檢視，只對 `TSE`／`OTC` 的 `STK` 提供，且不加入「即時／月」切換
- [x] 3.2 實作響應式 SVG 三線圖，包含整體／大單／非大單圖例、零軸、09:00 起的真實時間刻度，以及涵蓋零與全部極值的共同 Y 軸
- [x] 3.3 實作最新分鐘在前的「時間／整體淨額／大單淨額／非大單淨額」表格，以百萬元顯示兩位小數並依正／負／零呈現可辨識語意
- [x] 3.4 呈現「主動買賣成交淨額」說明、未知方向未納入摘要與目前大單規則，介面不得使用「大戶／散戶／主力／法人」身分宣稱
- [x] 3.5 沿用 loading／partial／verified／confirmed_empty／failed、已載入範圍與 recomputing 狀態；空資料不得產生零值假曲線
- [x] 3.6 調整窄面板、短面板、深色主題與獨立視窗樣式，確保三線圖、圖例、四欄與至少一列資料可讀，且沒有不必要的水平捲軸
- [x] 3.7 保持分鐘表格有界 DOM、使用者捲離後閱讀位置穩定，最新分鐘更新不得強迫跳回頂端

## 4. 自動化與資源驗證

- [x] 4.1 加入 component／browser tests，驗證三種檢視切換不新增 history request、SSE subscription、login、cache mutation 或交易寫入
- [x] 4.2 加入圖表與表格 tests，驗證三線點位、零軸、Y domain、真實時間間隔、最新在前、正負格式、未知方向與空狀態
- [x] 4.3 加入 248px 窄面板、短面板及獨立視窗 regression，量測無水平 overflow、欄位未裁切、SVG 可見及 cleanup 正確
- [x] 4.4 以 100,000 與 500,000 筆 fixture 對獨立 oracle 核對分鐘序列、三種淨額與未知方向摘要，記錄 replay 可取消及 DOM 有界證據
- [x] 4.5 執行 scoped Vitest／browser tests、TypeScript、lint、build、`git diff --check` 與 OpenSpec strict validation，保留非本 change 的既有失敗而不粉飾
- [x] 4.6 修正共用成交 session 在密集 live tick 時逐筆重掃全日連續性的效能問題；增量核對不得改變缺口 fail-closed 與有界補齊規則
- [x] 4.7 修正契約快取只收到 BidAsk 時仍誤標整個商品已訂閱的狀態；後續只重試缺少的 Tick，避免已成功類型重送
- [x] 4.8 沿用共用行情 port 的手動唯讀診斷與有界指定商品 trace；以測試確認精確 refcount／最後 port cleanup、無額外 SSE／訂閱，並保留未知方向實盤尚未出現的驗收限制

## 5. Shioaji simulation 真實盤中驗收

- [x] 5.1 在正常交易時段以流動性足夠的 `TSE`／`OTC` 股票驗證首次歷史載入、coverage、分鐘點與三種淨額，保存時間、商品、來源日期、row／volume 數及 network evidence
- [x] 5.2 驗證 `/api/v1/data/ticks` 與既有 `/api/v1/stream/data` 共用同一 session，至少一筆真實 SSE 成交只更新一次正確分鐘、方向及大單／非大單淨額
- [x] 5.3 驗證斷線／重連、缺口補齊及 partial → verified 不會清除既有點位或重複累計；未知方向若有真實來源事件須列明細並核對淨額不變，若來源為 0 筆則記錄母體與「未觀察」，用自動化 domain／browser 測試驗證該分支，不以來源事件必現為結案條件
- [x] 5.4 在成交明細獨立視窗驗證實際 SSE event、共享 refcount、關閉 cleanup、無重複分鐘列與閱讀位置；只有 REST 而沒有 SSE event MUST 保持未完成
- [x] 5.5 驗收全程確認 production 停止、無交易寫入、無新增行情 subscription 或服務啟停，並將成功、未通過與來源限制分開記錄
- [x] 5.6 將自動化及真實盤中結果寫入 verification 記錄並重新執行 strict validation；只有所有必要證據通過才可勾選完成及評估歸檔
