## ADDED Requirements

### Requirement: 籌碼資料提示必須位於副圖尾端且可關閉

系統 MUST 將籌碼資料 warnings 顯示在目前 panel 的所有已選籌碼副圖群組之後，不得插在技術指標與第一個籌碼副圖之間。提示 MUST 提供鍵盤可操作且有明確 accessible name 的關閉按鈕。

#### Scenario: 多層副圖顯示資料提示
- **WHEN** 多層副圖已載入一個以上的籌碼群組且 API 回傳 warnings
- **THEN** 提示 MUST 出現在最後一個籌碼群組之後
- **AND** 提示 MUST NOT 覆蓋副圖內容或阻擋副圖互動

#### Scenario: 使用者關閉目前提示
- **WHEN** 使用者啟動提示的關閉按鈕
- **THEN** 目前 panel 的提示 MUST 立即隱藏
- **AND** 相同商品、週期與完全相同 warning 內容重新載入時 MUST 維持隱藏

#### Scenario: 提示內容或圖表身分改變
- **WHEN** 使用者已關閉提示，之後商品、週期或 warning 內容改變
- **THEN** 新提示 MUST 重新顯示
- **AND** 關閉狀態 MUST NOT 永久隱藏後續不同資料狀態
