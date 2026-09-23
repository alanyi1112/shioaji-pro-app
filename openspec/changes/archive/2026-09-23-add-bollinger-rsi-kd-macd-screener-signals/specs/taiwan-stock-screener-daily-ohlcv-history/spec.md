## ADDED Requirements

### Requirement: v7 指標底稿必須由同一 130-session canonical OHLCV 決定性建立

publisher MUST 從結束於 snapshot `effectiveSessionDate` 的同一份逐商品 130 個官方交易日 canonical 未還原 OHLCV 建立 BOLL(20,2)、Wilder RSI5／RSI10、KD(9,3,3)、MACD(12,26,9) 及前期量能基準。D／P／P2 與 volume baseline MUST 依官方 session sequence 取得；不得使用圖表 cache、瀏覽器資料、Shioaji Snapshot、非官方補值或跨商品資料。相同 universe、rows 與 formula version 重算 MUST 產生相同 evidence 與 hash。

#### Scenario: 同一底稿重算

- **WHEN** 相同 universe revision、130-session rows、criteria 與 formula version 重跑 v7 publisher
- **THEN** 所有新訊號 verdict、evidence hash、守恆計數與排序 MUST 完全相同

#### Scenario: 只有 row count 但中間缺日

- **WHEN** 商品有至少 130 rows，但必要官方 session sequence 存在未分類缺口
- **THEN** 受影響的新訊號 MUST 為 unknown，publisher 不得以 row count 或最近有值列取代 continuity

#### Scenario: RSI 與 MACD 暖機不足

- **WHEN** 新上市商品的合法歷史不足以建立所選指標
- **THEN** 系統 MUST 保存可取得 rows 並回 `indicator_warmup`，不得縮短 period、預填初值或使用上市前 K 棒

### Requirement: v7 發布必須以雙市場 coverage 與逐商品日期一致性為 gate

v7 staging MUST 處理完整 TWSE／TPEx 普通股母體，並保存 target、processed、pass、fail、unknown、逐訊號缺漏及逐市場 coverage。只有每個商品的 OHLCV through date、universe revision、normalization version 與 `effectiveSessionDate` 一致，且 full-run receipt 守恆，才可原子發布 ready v7。任一市場單邊較新、mixed-session、remaining、unexplained failed 或 evidence hash 不一致 MUST 阻止 ready；不得破壞最後合法 v6 或更舊 snapshot。

#### Scenario: TWSE 完整但 TPEx 尚有缺口

- **WHEN** TWSE 新訊號底稿完成，而任一必要 TPEx 商品或 session 尚未成為正式終態
- **THEN** publisher MUST 保留 v7 preparation pending，不得發布只有上市商品完整的全市場 snapshot

#### Scenario: v7 失敗時保留 v6

- **WHEN** v7 重算因公式、coverage 或 D1 寫入失敗
- **THEN** 最後合法 v6 snapshot、cursor 與既有條件查詢 MUST 保持可用，失敗 v7 staging 不得成為 latest

### Requirement: UI 與 GET 不得觸發 v7 指標補算或來源工作

選股 status／results GET、UI 重整、條件展開、排序與翻頁 MUST 只讀既有 v7 immutable snapshot／progress。新條件未 ready 時 MUST 顯示 preparation pending、最後合法舊版投影或逐條件 unknown；MUST NOT 直接執行公式回補、官方來源抓取、DDL、Shioaji Kbars／Snapshot、行情訂閱或 runtime lifecycle。

#### Scenario: 使用者反覆調整 MACD 門檻

- **WHEN** 使用者反覆提交合法 MACD criteria 或翻頁
- **THEN** provider、回補、Shioaji、交易及 runtime 呼叫計數 MUST 維持零，服務只查詢已發布底稿

### Requirement: v7 正式驗收必須重算全市場訊號與量能證據

完成前 MUST 對實際本機 D1 核對 schema、130-session 官方 session plan、TWSE／TPEx 母體、逐商品 continuity、formula／normalization version、逐訊號 pass／fail／unknown、量能 baseline、守恆與原子發布；並對每種 BOLL、RSI、KD、MACD 模式至少保存一個可重算 pass 或明確證明當期零筆，以及邊界 fail／unknown fixture。只有 fixture、單一商品、HTTP 200 或全域完成時間 MUST NOT 代替全市場 evidence。

#### Scenario: 宣告 v7 full run 完成

- **WHEN** v7 full run 的 remaining、unexplained failed 與 overdue 準備標記為零
- **THEN** 驗收 MUST 比對 API 分頁全集、逐模式集合、代表商品公式、evidence hash 與每市場守恆後才能完成

#### Scenario: 實際 UI 驗收

- **WHEN** live D1 篩出不在個人清單且非排行前百名的新訊號商品並由 UI 點選
- **THEN** 指定日 K 圖 MUST 顯示同商品與可核對日期，console 無新增錯誤，且清單、行情連線、simulation runtime 與交易狀態不變
