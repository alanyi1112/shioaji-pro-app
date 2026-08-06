## MODIFIED Requirements

### Requirement: 我的清單台股會自動建立籌碼預熱目標

系統 MUST 從系統預設台股清單與所有使用者已啟用的清單項目，動態找出符合 eligibility 的 TWSE／TPEx 普通股及 ETF，並以全站去重 symbol 建立日籌碼預熱與 TDCC 歷史回補目標；workflow MUST NOT 固定寫死 symbol，也 MUST NOT 擴張成未加入網站的既有全市場掃描。日資料預熱成功不得取代 TDCC 最低 51 週歷史完成判定。

#### Scenario: 使用者新增合格普通股或 ETF
- **WHEN** 使用者將尚未完整快取籌碼資料的合格台股加入「我的清單」
- **THEN** 系統 MUST 立即建立或更新該 symbol 的日籌碼預熱與 TDCC 背景回補目標
- **AND** 下一次 durable scheduler MUST 再次檢查並補齊未完成資料

#### Scenario: 日資料成功但 TDCC 仍不足
- **WHEN** 法人、外資持股、融資券及借券預熱成功，但 TDCC 只有 1 至 50 週
- **THEN** health MUST 分別反映日資料 ready 與 TDCC queued／partial
- **AND** runner MUST 仍可 claim 該 symbol，不得因日資料完成而略過 TDCC 歷史

#### Scenario: 相同台股出現在多個清單
- **WHEN** 同一 symbol 被多個使用者或多個頁籤加入
- **THEN** 背景預熱 MUST 只保留一個全站資料目標
- **AND** D1 資料 MUST 供所有相同 symbol 的圖表共用

#### Scenario: 非合格商品或已停用商品
- **WHEN** 清單項目不是支援的台股普通股／ETF，或已被停用且不再屬於其他有效目標
- **THEN** 系統 MUST NOT 建立新的籌碼預熱工作
- **AND** 既有已驗證資料 MAY 保留供診斷與快取使用
