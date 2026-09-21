## MODIFIED Requirements

### Requirement: 兩個選股條件必須各自提供可選的最低成交值限制

成交量與千張大戶條件 MUST 各自提供「最低成交值」開關與以萬為單位的十進位門檻。成交值限制 MUST 只在所屬主要條件啟用時有效，並只與該條件作 AND；父條件關閉時，子成交值控制 MUST disabled 或正規化為 inactive，MUST NOT 參與查詢、criteria fingerprint、verdict 或缺漏統計。成交值 MUST NOT 單獨成為可通過的第三條件；兩個條件之間仍依使用者選擇的 `all`／`any` 組合。門檻 MUST 限 0.01–10,000,000 萬、最多兩位小數，並精確換算為新臺幣整數元比較。成交值門檻 MUST 顯示於控制項與「已套用」摘要，API MUST 保留判定 evidence；結果卡 MUST NOT 顯示成交值數值、日期或重複的分支成交值資訊。

#### Scenario: 成交量條件啟用成交值

- **WHEN** 商品成交量為前一交易日三倍，成交值低於該條件設定的最低成交值
- **THEN** 成交量條件 MUST 為 fail，API evidence MUST 分別保存量增判定與成交值限制判定
- **AND** UI MUST 由控制項與「已套用」摘要呈現成交值門檻，不在結果卡顯示成交值明細

#### Scenario: OR 模式不得由成交值單獨通過

- **WHEN** 兩個主要條件均未達標，但商品成交值高於任一已啟用門檻
- **THEN** `any` 組合 MUST 仍為 fail，成交值 MUST NOT 單獨使商品入選

#### Scenario: 停用主要條件但子開關保存為真

- **WHEN** 大戶主要條件關閉，而舊偏好或草稿中的大戶最低成交值仍為 enabled
- **THEN** request 與 fingerprint MUST 將該子條件視為 inactive，結果卡 MUST 不顯示任何大戶成交值
- **AND** 成交量主要條件的合法成交值仍可參與判定，但結果卡 MUST 不顯示該數值

#### Scenario: 停用成交值限制

- **WHEN** 某條件的成交值開關關閉，且商品缺少當日成交值
- **THEN** 該條件 MUST 只依原本訊號判定，不得因未啟用的成交值資料缺漏變成 unknown

#### Scenario: 大戶條件需要當日成交值

- **WHEN** 使用者只啟用大戶條件並開啟其最低成交值限制，但最新共同交易日 D 缺少合法成交值
- **THEN** 該商品的大戶條件 MUST 為 unknown 並指出 D 與缺漏欄位，不得沿用較早交易日成交值

#### Scenario: 兩個父條件都啟用相同 D 成交值

- **WHEN** 成交量與大戶主要條件都啟用各自成交值限制，且兩者 evidence 指向同一 D、數值與來源
- **THEN** API MUST 保存兩個分支各自 verdict，UI MUST 只在控制項與「已套用」摘要呈現成交值門檻，結果卡 MUST NOT 顯示共同成交值或個別分支成交值
