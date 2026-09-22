## MODIFIED Requirements

### Requirement: 每筆選股結果必須提供獨立的加入清單動作

選股結果卡片右上方 MUST 提供可辨識為「加入清單」的獨立按鈕。按鈕在可操作狀態被 pointer hover 時 MUST 以清楚的前景色、邊框與背景 highlight 回饋，且不得只依賴游標變化。按鈕與結果內容的 mouse、touch 及 keyboard action MUST 互斥：只有明確啟用按鈕才可要求同步修改 Shioaji「選股」與 MultiView「選股篩選」；點選或以鍵盤啟用結果內容 MUST 只沿用 K 線連動，MUST NOT 隱性加入商品。

#### Scenario: 從結果右上方加入商品

- **WHEN** 使用者在一筆合法選股結果按下「加入清單」
- **THEN** 系統 MUST 只送出該商品的 Shioaji「選股」與 MultiView「選股篩選」指定 mutation，不得同時送出 chart pick 或改動交易商品與草稿

#### Scenario: 點選結果內容不加入清單

- **WHEN** 使用者點選或以鍵盤啟用結果內容而未啟用「加入清單」
- **THEN** 系統 MUST NOT 建立清單、加入商品或顯示商品已加入

#### Scenario: 鍵盤走訪結果卡片

- **WHEN** 使用者以鍵盤走訪結果卡片
- **THEN** 結果內容與「加入清單」MUST 各自取得可見焦點及可辨識名稱，啟用任一 action MUST NOT 穿透到另一 action

#### Scenario: Hover 加入清單按鈕

- **WHEN** pointer hover 在可操作的「加入清單」按鈕
- **THEN** 按鈕 MUST 顯示可辨識的 highlight，移開後 MUST 恢復原樣，且不得觸發 chart pick 或任一清單 mutation

### Requirement: 加入狀態必須以兩端後端確認為準並可重試收斂

加入清單按鈕 MUST 區分可操作、加入中、兩端已加入／原已存在、部分成功與失敗狀態。只有 Shioaji 與 MultiView 各自的後端 create／add 成功，或重抓後確認 canonical 商品已存在，才可顯示整體成功。任一端成功後系統 MUST 保留其真實結果，不得因另一端失敗而補償刪除；重新操作 MUST 以兩端冪等 mutation 收斂未完成端。Shioaji 成功後系統 MUST 發出不含機密資料的同源清單失效通知，使其他主頁重抓最新清單；通知與 MultiView 同步 MUST NOT 改變其他頁目前作用中的清單。

#### Scenario: 兩端完成持久化

- **WHEN** 兩端後端確認商品分別存在於 Shioaji「選股」與 MultiView「選股篩選」
- **THEN** 按鈕 MUST 顯示整體已加入，重新載入兩個應用後仍 MUST 在兩個目標各看見該商品一次

#### Scenario: 兩端原已存在

- **WHEN** Shioaji 與 MultiView 都確認 canonical 商品原已存在
- **THEN** 介面 MUST 顯示「兩邊原已存在」或等價成功狀態，不得建立重複項目

#### Scenario: Shioaji 成功但 MultiView 失敗

- **WHEN** Shioaji 已確認加入，而 MultiView 未能確認商品存在
- **THEN** 介面 MUST 顯示 Shioaji 已完成、MultiView 未完成及可重試狀態，且 MUST NOT 刪除 Shioaji 已加入商品或宣稱兩端完成

#### Scenario: MultiView 成功但 Shioaji 失敗

- **WHEN** MultiView 已確認加入，而 Shioaji 未能確認商品存在
- **THEN** 介面 MUST 顯示 MultiView 已完成、Shioaji 未完成及可重試狀態，且 MUST NOT 刪除 MultiView 已加入商品或宣稱兩端完成

#### Scenario: 重試部分成功

- **WHEN** 使用者對部分成功的商品重新啟用加入動作
- **THEN** 系統 MUST 以冪等請求保留已成功端的一筆資料並重試未完成端，直到兩端確認或再次顯示真實失敗

#### Scenario: 其他頁目前使用不同清單

- **WHEN** 選股分頁成功加入商品，而 Shioaji 或 MultiView 目前作用中的頁籤不是同步目標
- **THEN** 兩個應用 MUST 可刷新清單 metadata，但 MUST 保持原作用中頁籤、原選取商品及圖表／交易狀態不變

### Requirement: 加入清單不得產生交易、資料回補或 runtime 副作用

加入清單流程 MUST 僅呼叫合約／商品解析、固定用途 gateway 與兩端清單讀寫能力，MUST NOT 發出委託、智慧下單、帳務寫入、行情訂閱、選股或籌碼資料回補、provider 抓取、DDL 或 runtime 啟停請求。

#### Scenario: 加入一檔選股商品

- **WHEN** 使用者成功、部分成功或失敗地嘗試同步一筆選股結果
- **THEN** 交易草稿、下單商品、simulation／production 模式、5173／5174 服務、選股 snapshot、籌碼 pipeline 與既有行情連線 MUST 保持不變

## RENAMED Requirements

- FROM: `### Requirement: 加入狀態必須以後端確認為準並跨分頁收斂`
- TO: `### Requirement: 加入狀態必須以兩端後端確認為準並可重試收斂`
- FROM: `### Requirement: 加入清單不得產生交易或 runtime 副作用`
- TO: `### Requirement: 加入清單不得產生交易、資料回補或 runtime 副作用`
