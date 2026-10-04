## ADDED Requirements

### Requirement: 成交明細必須提供分價量表檢視
系統 MUST 在台灣上市／上櫃 `STK` 的成交明細面板提供「成交明細／分價量表」檢視切換。切換 MUST 重用目前商品與交易日的同一份 history、SSE、去重資料及 coverage，不得新增行情 subscription、重複登入、重新抓取歷史或呼叫交易寫入 API。既有「全部／大單」、大單設定與資訊入口 MUST 在成交明細檢視維持原有功能；主面板與獨立視窗語意 MUST 一致。

#### Scenario: 開啟分價量表
- **WHEN** 使用者在支援的台股商品選擇「分價量表」
- **THEN** 系統 MUST 使用目前已載入 session 衍生分價資料並顯示該檢視
- **AND** MUST NOT 新增、取消或重建行情 subscription，也不得觸發下單或 production 模式

#### Scenario: 不支援商品
- **WHEN** 商品不是 `TSE`／`OTC` 的 `STK`
- **THEN** 系統 MUST 不提供可誤認為有效的完整分價量表
- **AND** 既有成交明細功能 MUST 維持可用

### Requirement: 分價量表必須依精確成交價彙總可驗證整股成交
系統 MUST 只使用目前交易日既有成交明細納入的合法整股、非試撮、非 14:00 定價成交，依商品價格正規化後的精確成交價建立 bucket。每個 bucket MUST 保存全部成交量、買方量、賣方量、未知方向量及大單量，並由高價至低價排列。`tickType=1` MUST 歸為買方、`tickType=2` MUST 歸為賣方，其他值 MUST 歸為未知；未知量 MUST 列入總量但不得冒充買方或賣方。

#### Scenario: 同價位多筆成交
- **WHEN** 同一價位收到多筆已去重成交，且包含買方、賣方與未知方向
- **THEN** 系統 MUST 將各方向張數分別累加，且 bucket 總量 MUST 等於三者總和

#### Scenario: 排除不合格成交
- **WHEN** tick 為零股、試撮、無效價格、`volume <= 0` 或 14:00 定價交易
- **THEN** 系統 MUST 沿用成交明細 fail-closed 規則排除該筆
- **AND** 該筆 MUST NOT 改變任何分價統計、均價或標記

#### Scenario: 歷史與即時重疊
- **WHEN** history 與 SSE 包含同一可確認成交
- **THEN** 系統 MUST 在既有去重後只更新一次 bucket
- **AND** 兩筆可確認為獨立但內容相同的成交 MUST 各自保留

### Requirement: 摘要與佔比必須使用固定且可核對的公式
系統 MUST 顯示總成交均價與大單成交均價。總成交均價 MUST 為 `Σ(price × volume) ÷ Σvolume`；大單成交均價 MUST 為目前設定 revision 下 `isLarge=true` 成交的 `Σ(price × volume) ÷ Σvolume`。每列總佔比 MUST 為該價位全部成交量除以 session 全部成交量；每列大單佔比 MUST 為該價位大單成交量除以相同的 session 全部成交量。價格 MUST 使用商品既有 formatter，成交量 MUST 以 common lot（張）呈現，百分比顯示一位小數但運算不得先截斷。

#### Scenario: 計算兩種均價與佔比
- **WHEN** session 有多個價位且部分成交被分類為大單
- **THEN** 系統 MUST 依成交量加權算出兩種均價
- **AND** 全部價位的未四捨五入總佔比加總 MUST 為 100%
- **AND** 任一價位大單佔比 MUST 使用 session 全部成交量作分母，而非該價位成交量

#### Scenario: 沒有大單
- **WHEN** session 有成交但目前設定下沒有任何大單
- **THEN** 大單成交均價 MUST 顯示 `—` 或等價不可計算狀態
- **AND** 系統 MUST NOT 顯示 `0` 或虛構價格

#### Scenario: 沒有成交
- **WHEN** coverage 已確認當日無成交
- **THEN** 系統 MUST 顯示已確認無成交，且不得產生價格列、均價或除以零結果

### Requirement: 成交量圖必須同時表達相對量與成交方向
每個價位的成交量圖 MUST 以該 bucket 總量相對目前最大 bucket 縮放整體長度，並在同一軌道中依買方、賣方與未知方向量堆疊。買方、賣方與未知 MUST 使用可區分的既有漲、跌、中性色，且不得只靠顏色傳達方向；欄名、可及性文字或等價語意 MUST 能說明各段。

#### Scenario: 最大成交價位
- **WHEN** 一個 bucket 是目前成交量最大值
- **THEN** 其成交量圖 MUST 使用完整可用寬度
- **AND** 其他 bucket MUST 依與最大值的比例縮放

#### Scenario: 含未知方向
- **WHEN** bucket 的部分成交 `tickType` 無法判斷方向
- **THEN** 未知量 MUST 使用獨立中性色段呈現並包含在總長度中
- **AND** 買方與賣方段 MUST NOT 吸收未知量

### Requirement: 分價量表必須使用可證明的大單語意
介面 MUST 使用「大單成交均價」與「大單佔比」，不得把金額／張數／百分位分類結果稱為「大戶」或宣稱為交易者身分。大單量 MUST 沿用成交明細目前設定 revision 的逐筆 `isLarge` 結果；開盤瞬間與 13:25 起成交可進入全日總量，但依既有大單資格規則不得進入大單量。設定變更 MUST 依時間順序重播當日資料並原子切換新的分價結果。

#### Scenario: 修改大單設定
- **WHEN** 使用者套用新的金額、張數、樣本、百分位、暖機或 AND／OR 設定
- **THEN** 系統 MUST 使用新設定從當日開盤順序重算大單均價與各價位大單量
- **AND** 重算期間 MUST 標示狀態、保留一致的上一版結果，完成後才原子切換

#### Scenario: 開收盤成交
- **WHEN** 開盤瞬間或 13:25 起的合法整股成交存在於完整日資料
- **THEN** 該成交 MUST 納入總成交量、總佔比及總成交均價
- **AND** 該成交 MUST NOT 因分價量表而繞過既有大單資格規則

### Requirement: 價位標記與捲動必須反映同一 session
系統 MUST 以同一份已載入 session 的第一筆、最後一筆、最高價與最低價產生「開」、「現」、「高」、「低」標記。多個標記位於同一價位時 MUST 全部可辨識。首次切入分價量表 MUST 將「現」所在價位帶入可見範圍；使用者主動捲離後，新成交 MUST NOT 強迫改變閱讀位置。

#### Scenario: 首次進入分價量表
- **WHEN** session 已有成交且使用者由成交明細切入分價量表
- **THEN** 系統 MUST 將最新成交價位捲入可見範圍並標示「現」

#### Scenario: 標記重疊
- **WHEN** 開盤價、目前價、最高價或最低價有兩個以上落在相同 bucket
- **THEN** 該列 MUST 呈現所有適用標記，不得任意覆蓋或遺失

#### Scenario: 閱讀歷史價位時新成交到達
- **WHEN** 使用者已主動捲離目前價且 SSE 新成交更新 bucket
- **THEN** 系統 MUST 增量更新統計但維持使用者閱讀位置
- **AND** MUST 提供回到目前價或等價控制

### Requirement: 完整性狀態必須約束分價統計宣稱
分價量表 MUST 顯示成交明細既有 `loading`、`partial`、`verified`、`confirmed_empty` 或 `failed` coverage 與已載入範圍。只有已核實資料可宣稱截至目前的完整分布；partial、loading 或 failed 時可保留可用統計，但 MUST 明示「部分資料」或失敗原因，且不得將目前 bucket 極值冒稱為已核實當日高低。既有已驗證成交在斷線、補齊或重算期間 MUST NOT 消失。

#### Scenario: 歷史尚未補齊
- **WHEN** 分價量表的 coverage 為 `partial` 或 `loading`
- **THEN** 系統 MUST 顯示不完整狀態與可用範圍
- **AND** 佔比與均價 MUST 明確只代表已載入資料，不得標示為完整全日結果

#### Scenario: 串流斷線後恢復
- **WHEN** SSE 斷線後重連且缺口補齊尚未驗證
- **THEN** 系統 MUST 保留既有 bucket、標示 partial 並執行既有有界補齊
- **AND** 完成去重與 continuity 驗證前 MUST NOT 改稱 verified

#### Scenario: EventSource 看似開啟但事件靜止
- **WHEN** 共用 SSE 連續 60 秒沒有收到心跳或其他事件，即使 `readyState` 仍為 `OPEN`
- **THEN** 系統 MUST 依序關閉舊來源後才建立唯一替代來源，保留共享 ports 與已載入 bucket，並標示 partial
- **AND** MUST NOT 在缺口核實前將舊統計宣稱為最新完整資料

### Requirement: 大量成交必須以增量統計與有界 DOM 呈現
系統 MUST 在成交分類／replay 過程增量維護價位 bucket，不得因每筆 live tick 而重新掃描完整日全部 rows。歷史 replay MUST 保留既有分批 yield、取消與 generation 防護；價位表 MUST 使用虛擬化或等效有界 DOM。切換檢視不得淘汰完整日成交或改寫 IndexedDB 原始 cache。

#### Scenario: 即時新增一筆成交
- **WHEN** 已有大量完整日成交且收到一筆合法新 tick
- **THEN** 系統 MUST 只增量更新對應 bucket、摘要與必要排序狀態
- **AND** MUST NOT 對全部成交重新執行逐筆彙總

#### Scenario: 500,000 筆 replay
- **WHEN** 使用 500,000 筆上限 fixture 建立 session 與分價統計
- **THEN** bucket 總量、摘要及方向加總 MUST 與獨立 oracle 相同
- **AND** replay MUST 可取消、UI DOM MUST 維持有界，且不得靜默截斷

### Requirement: 真實盤中驗收必須證明歷史與 SSE 共用且無交易副作用
功能完成宣告 MUST 包含 Shioaji simulation 的真實盤中驗收，證明首次載入使用既有 `/api/v1/data/ticks`、後續成交由既有 `/api/v1/stream/data` 更新、價位量不重複且 coverage 與實際 network evidence 一致。單元測試、mock SSE 或 source inspection 不得單獨替代此驗收。驗收 MUST 保持 production 停止、不得送出委託或改變行情服務生命週期。

#### Scenario: 盤中首次載入與即時更新
- **WHEN** 在 simulation 模式開啟流動性足夠的台股分價量表並等待新成交
- **THEN** network evidence MUST 顯示有界歷史查詢及既有 SSE 成交事件
- **AND** 新成交 MUST 只增加一次正確價位、方向量與總量
- **AND** production 與交易寫入 MUST 維持停用

#### Scenario: 獨立視窗驗收
- **WHEN** 從成交明細的獨立視窗開啟分價量表
- **THEN** 視窗 MUST 實際接收共用 SSE 並維持正確 refcount／cleanup
- **AND** 只出現 REST 歷史請求而沒有 SSE event 的結果 MUST 視為未通過
