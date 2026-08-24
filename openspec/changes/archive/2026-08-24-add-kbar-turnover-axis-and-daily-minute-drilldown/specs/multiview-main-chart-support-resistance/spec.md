## MODIFIED Requirements

### Requirement: MultiView 必須依來源週期保存 reference 並向較短週期繼承
MultiView MUST 以 `canonical symbol + source interval` 在目前 panel document session 保存各來源週期的 enabled formulas、reference、anchor 與 pinned 狀態。週期階層 MUST 為 `月 > 週 > 日 > 60m > 15m > 5m > 1m`；來源週期建立的壓撐投影 MUST 顯示於相同或更短週期，且不得反向顯示於較長週期。直接單擊合法 K 棒與「回到最新」MUST 只改變目前來源週期的所有 enabled formulas；包含日 K 在內的單擊 MUST 立即處理，不得為等待雙擊而加入 bounded delay。

#### Scenario: 點選其他 K 棒
- **WHEN** 任一壓撐公式已啟用且使用者單擊該 panel 的其他合法 K 棒
- **THEN** 所有 enabled formulas MUST 原子改用該 reference 並以該 K 棒為 anchor
- **AND** UI MUST 顯示共用 reference 日期、適用期與 completed／provisional 狀態

#### Scenario: 日 K 單擊不等待導覽雙擊
- **WHEN** 任一壓撐公式已啟用且使用者在日 K 主圖單擊合法 K 棒
- **THEN** reference MUST 在該次 click task 內更新，不得等待 260ms 或其他雙擊判定窗
- **AND** 後續合法 `dblclick` MUST 由 panel 導覽開啟單圖

#### Scenario: 週線與月線 reference
- **WHEN** 使用者在週 K 或月 K 啟用任一壓撐公式
- **THEN** 系統 MUST 分別使用下一交易週或下一交易月投影契約
- **AND** 不得退化為 daily reference 或移除週／月 K 選項

#### Scenario: 日線投影留置於所有分鐘週期
- **WHEN** 使用者在日 K 啟用任一壓撐公式後切換至 60m、15m、5m 或 1m
- **THEN** 各分鐘圖 MUST 保留並顯示該日線來源的相同 reference 與價位
- **AND** 分鐘圖不得重新計算、改寫或反向清除日線來源投影

#### Scenario: 長週期投影向較短週期繼承
- **WHEN** 使用者在月、週、日、60m、15m 或 5m 建立壓撐投影後切換至階層中較短週期
- **THEN** 系統 MUST 合併顯示所有適用來源週期的投影
- **AND** 較短週期建立的投影 MUST NOT 顯示於任何較長週期

#### Scenario: 來源 K 棒在較短週期定位
- **WHEN** 較長週期投影顯示於較短週期圖表
- **THEN** 線段左側起點 MUST 對應該來源 K 棒涵蓋期間的第一根可見短週期 K 棒並向右延伸
- **AND** 只有該 reference 不在目前資料窗時，才可把起點夾到 plot 左側安全邊界
