## ADDED Requirements

### Requirement: 成交明細提供全部與大單頁籤
系統 SHALL 在成交明細面板提供「全部」與「大單 N」頁籤，其中 `N` 為目前商品、交易日與面板生命週期內已保留的大單筆數。兩個頁籤 SHALL 使用相同成交欄位、列格式、時間格式及漲跌方向色彩。

#### Scenario: 切換至大單頁籤
- **WHEN** 使用者按下「大單 N」
- **THEN** 系統只顯示已在偵測當下符合大單條件的成交，且列格式與全部成交一致

#### Scenario: 沒有大單
- **WHEN** 目前尚無符合條件的大單
- **THEN** 系統顯示「大單 0」與明確的空狀態，不回退顯示全部成交

#### Scenario: 一般面板與 popout 一致
- **WHEN** 相同商品與成交事件分別呈現在一般成交明細與 popout
- **THEN** 兩處使用相同頁籤、條件文字與分類結果

### Requirement: 大單門檻採固定與動態條件取高
系統 MUST 對每筆合格成交計算 `tradeAmount = price × volume(common_lot) × 1,000`。固定門檻 MUST 為 `max(400,000 TWD, price × 5 × 1,000)`；具有至少 30 筆前置合格成交時，動態門檻 MUST 為前 120 筆前置合格成交金額的 P70，最終門檻 MUST 為固定門檻與動態門檻取高。`tradeAmount >= threshold` 時 SHALL 分類為大單。

#### Scenario: 低價股受四十萬元保底約束
- **WHEN** 成交價為 15 元且前置動態門檻低於 40 萬元
- **THEN** 系統使用 40 萬元門檻，27 張成交符合而 26 張成交不符合

#### Scenario: 高價股受五張價值約束
- **WHEN** 成交價為 400 元且前置動態門檻低於 200 萬元
- **THEN** 系統使用 200 萬元門檻，5 張成交符合而 4 張成交不符合

#### Scenario: 動態 P70 高於固定門檻
- **WHEN** 已有至少 30 筆前置合格成交，且其最近 120 筆成交金額 P70 高於固定門檻
- **THEN** 系統使用 P70 作為該筆成交的大單門檻

#### Scenario: 門檻邊界包含等號
- **WHEN** 單筆成交金額恰好等於偵測門檻
- **THEN** 系統將該筆成交分類為大單

### Requirement: 動態門檻只使用前置合格成交
系統 MUST 在分類目前成交後才將其加入動態樣本。P70 MUST 將最多 120 筆前置合格成交金額由小到大排序，使用 nearest-rank 的零基索引 `ceil(0.70 × n) - 1`。前置樣本少於 30 筆時 SHALL 只使用固定門檻，且 SHALL 顯示「動態門檻暖機中 n/30」。

#### Scenario: 候選成交不影響自己的門檻
- **WHEN** 一筆極大成交到達且分類前已有 30 筆合格成交
- **THEN** 系統只使用原本 30 筆的分布計算該筆門檻，分類完成後才將其加入後續樣本

#### Scenario: 暖機未滿三十筆
- **WHEN** 分類前只有 29 筆合格成交
- **THEN** 系統不使用 P70，採固定門檻並顯示「動態門檻暖機中 29/30」

#### Scenario: 動態樣本有界
- **WHEN** 已累積超過 120 筆合格成交
- **THEN** 系統只使用時間上最近的 120 筆前置合格成交計算 P70

### Requirement: 只分類可驗證的台股整股連續成交
系統 SHALL 只分類台灣上市或上櫃 `STK`、`volume > 0`、價格與時間有效、`intraday_odd` 不為 true 且 `simtrade` 不為 true 的成交。成交時間 MUST 晚於 `09:00:00` 且早於 `13:25:00`（Asia/Taipei）；不符合者 MUST NOT 進入動態樣本或大單紀錄。

#### Scenario: 排除盤中零股與模擬成交
- **WHEN** tick 的 `intraday_odd=true` 或 `simtrade=true`
- **THEN** 系統不分類該 tick，且該 tick 不影響後續動態門檻

#### Scenario: 排除無效價格或成交量
- **WHEN** tick 的價格無效或 `volume <= 0`
- **THEN** 系統 fail closed，不分類、不記錄也不納入樣本

#### Scenario: 排除開收盤集合競價範圍
- **WHEN** tick 時間為 `09:00:00` 或不早於 `13:25:00`
- **THEN** 系統不分類該 tick，且不以其成交金額更新動態門檻

#### Scenario: 不支援的商品類型
- **WHEN** 目前商品為 `WRT`、`FUT`、`OPT`、`IND` 或非台灣上市／上櫃 `STK`
- **THEN** 系統顯示大單分類不適用，且不產生大單紀錄

### Requirement: 大單分類結果保存偵測當下證據
系統 SHALL 對每筆大單保存穩定成交鍵、canonical 商品鍵、交易日、時間、價格、common-lot 張數、成交金額、`thresholdAtDetection`、`ruleVersion` 與資料來源。已分類結果 MUST NOT 因後續成交改變門檻而回溯改寫。

#### Scenario: 後續門檻上升
- **WHEN** 一筆成交已分類為大單，之後的 P70 上升到高於該筆成交金額
- **THEN** 該筆仍保留為大單，並維持原本的 `thresholdAtDetection`

#### Scenario: 重播相同事件
- **WHEN** 相同穩定成交鍵再次進入分類器
- **THEN** 系統回傳原分類結果而不建立第二筆大單或第二次更新樣本

### Requirement: 歷史與即時成交須去重且依時間分類
系統 MUST 將 history 與 live ticks 正規化為一致的商品、交易日、時間、價格、common-lot 張數及 `tick_type`，並以其組成穩定成交鍵。歷史回放 MUST 依時間順序分類；history/live 重疊的相同鍵 SHALL 只計算一次。

#### Scenario: 歷史與即時成交重疊
- **WHEN** history preload 與 SSE 各自提供同一商品、日期、時間、價格、張數與 `tick_type` 的成交
- **THEN** 系統只保留一列、一次樣本更新及至多一筆大單紀錄

#### Scenario: 歷史資料順序不一致
- **WHEN** history preload 回傳非時間遞增的 ticks
- **THEN** 系統先依標準化時間穩定排序，再以逐筆前置資料計算分類

### Requirement: 商品、交易日與串流世代彼此隔離
系統 SHALL 在 canonical 商品、交易日或 stream generation 改變時隔離或重設全部成交、大單紀錄、動態樣本、選定頁籤對應狀態及門檻顯示；舊世代的延遲事件 MUST NOT 污染新世代。

#### Scenario: 使用者切換商品
- **WHEN** 成交明細從商品 A 切換至商品 B
- **THEN** 商品 A 的樣本與大單不得出現在商品 B，商品 B 重新以自身 history/live 建立狀態

#### Scenario: 交易日切換
- **WHEN** 同一商品進入新的 Asia/Taipei 交易日
- **THEN** 前一交易日的動態樣本與大單紀錄不得用於新交易日

#### Scenario: 舊串流世代晚到
- **WHEN** 重連後收到舊 generation 的延遲 tick
- **THEN** 系統拒絕該事件，不更新目前列表或門檻

### Requirement: 面板顯示可解釋的大單條件
系統 SHALL 在「大單」頁籤顯示目前有效金額門檻，並顯示「門檻＝40 萬元、5 張價值、近 120 筆 P70 三者取高」。系統 MUST 使用「大單」名稱，不得使用「大戶」，且 MUST NOT 顯示「大單成交篩選，並非交易者身分判定」。

#### Scenario: 固定門檻階段
- **WHEN** 前置樣本少於 30 筆
- **THEN** 系統顯示固定有效門檻、規則摘要及暖機進度

#### Scenario: 動態門檻生效
- **WHEN** 前置樣本至少 30 筆且 P70 為三者最高
- **THEN** 系統顯示 P70 導出的目前門檻及相同規則摘要

#### Scenario: 介面用詞
- **WHEN** 使用者檢視成交明細頁籤與條件區
- **THEN** 介面只使用「大單」稱呼，且不出現已禁止的身分免責句

### Requirement: 成交與大單列表維持有界記憶體
系統 SHALL 將「全部」列表限制為最近 120 筆，並將目前商品、交易日與面板生命週期內的「大單」列表限制為最近 500 筆。淘汰舊 UI 列 MUST NOT 造成仍在最近 120 筆動態樣本中的資料被錯誤重複計入。

#### Scenario: 全部成交超過上限
- **WHEN** 目前商品收到第 121 筆不重複成交
- **THEN** 全部列表淘汰最舊一筆並維持 120 筆

#### Scenario: 大單超過上限
- **WHEN** 目前商品與交易日累積第 501 筆大單
- **THEN** 大單列表淘汰最舊一筆並維持 500 筆，分類器仍保持正確的有界前置樣本

### Requirement: 大單觀察不得改變行情或交易狀態
系統 SHALL 復用成交明細既有 history 與 SSE 資料，不得為大單頁籤新增第二個行情 subscription、重複 login、broker write、production 啟用或任何下單行為。

#### Scenario: 開啟大單頁籤
- **WHEN** 使用者從全部切換至大單頁籤
- **THEN** 系統只切換本機衍生顯示，不新增、取消或重建行情 subscription

#### Scenario: 關閉大單頁籤或面板
- **WHEN** 使用者切回全部或關閉成交明細面板
- **THEN** 系統遵循成交明細既有生命週期，不呼叫任何交易寫入 API
