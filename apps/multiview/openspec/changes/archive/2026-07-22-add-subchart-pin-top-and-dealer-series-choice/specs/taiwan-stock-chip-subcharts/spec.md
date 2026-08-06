## ADDED Requirements

### Requirement: 籌碼資料群組一鍵置頂

每個籌碼副圖既有的右鍵功能表 MUST 固定提供「置頂」操作；在方式 B 可排序狀態下，系統 MUST 將該 pane 所在的完整資料群組移到籌碼副圖區第一個群組位置，並維持群組內 canonical child order。置頂 MUST 沿用既有 `tabId + canonical symbol` 群組順序保存，且不得重新請求 pane 資料。

#### Scenario: 將中間群組一鍵置頂
- **WHEN** 使用者在方式 B 對非第一個群組內任一籌碼 pane 開啟右鍵功能表並選擇「置頂」
- **THEN** 該 pane 所在的完整 group wrapper MUST 一次移到籌碼副圖區第一個群組位置
- **AND** 群組內目前可見 panes MUST 維持 canonical child order，其他群組 MUST 依原相對順序向後補位
- **AND** 系統 MUST 只保存一次偏好、執行一次必要 layout refresh，且不得重新請求資料

#### Scenario: 已在最上方的群組
- **WHEN** 使用者開啟目前第一個資料群組內任一籌碼 pane 的右鍵功能表
- **THEN** 功能表 MUST 顯示「置頂」但設為 disabled
- **AND** 選擇狀態、DOM 順序、偏好與資料請求 MUST 保持不變

#### Scenario: 單層副圖模式顯示置頂狀態
- **WHEN** 使用者在方式 A 的籌碼 pane 開啟右鍵功能表
- **THEN** 功能表 MUST 顯示「置頂」但設為 disabled
- **AND** 系統 MUST NOT 改變方式 A 的作用種類、技術副圖或籌碼 pane 選擇

#### Scenario: 重新載入後恢復置頂順序
- **WHEN** 使用者完成群組置頂後重新載入頁面，或切換商品後再返回原商品
- **THEN** 系統 MUST 依該 `tabId + canonical symbol` 保存狀態恢復群組順序
- **AND** MUST NOT 將置頂順序套用到其他 tab 或 symbol

### Requirement: 自營商組成項目選擇

自營商副圖的既有右鍵「線圖項目」MUST 提供「自行」、「避險」與「合計」三個可見 series，分別使用來源資料的 `dealerSelfNetShares`、`dealerHedgingNetShares` 與 `dealerTotalNetShares`；首次使用或既有偏好沒有自營商設定時 MUST 預設只顯示「自行」。自營商至少 MUST 保留一個可見項目，圖形、逐日讀值與右側數值軸 MUST 依目前選取項目同步更新。

#### Scenario: 首次顯示自營商副圖
- **WHEN** 目前 tab 與 symbol 沒有保存 `dealer-flow` 的 series 選擇
- **THEN** 自營商副圖 MUST 預設只繪製「自行」柱狀 series
- **AND** 右鍵功能表 MUST 將「自行」顯示為已勾選，將「避險」與「合計」顯示為未勾選

#### Scenario: 切換自營商顯示項目
- **WHEN** 使用者從自營商右鍵功能表選取「避險」、「合計」或多個項目
- **THEN** pane MUST 只繪製目前選取且具有實際資料的 series
- **AND** header 逐日讀值 MUST 只顯示目前選取項目的同日數值與各自方向
- **AND** 右側數值軸 MUST 依目前可見的第一個有效自營商 series 維持可讀

#### Scenario: 取消最後一個自營商項目
- **WHEN** 使用者嘗試取消自營商目前最後一個已勾選項目
- **THEN** 系統 MUST 保留該項目的勾選與圖形
- **AND** MUST NOT 保存空的 `dealer-flow` series 選擇或顯示空白 pane

#### Scenario: 保留既有自營商選擇
- **WHEN** 既有 `seriesByPane['dealer-flow']` 含一個以上合法項目
- **THEN** 系統 MUST 恢復該 tab、symbol 與 pane 的合法選擇
- **AND** MUST NOT 因新預設為「自行」而覆寫既有選擇，未知項目則 MUST 安全忽略

#### Scenario: 自營商組成資料缺漏
- **WHEN** 某交易日的已選自營商項目為 `null`，但其他未選項目或合計仍有資料
- **THEN** 系統 MUST 將該已選項目標示為「無資料」並保留 series gap
- **AND** MUST NOT 以合計反推自行或避險，也不得以 0 或其他項目補值
