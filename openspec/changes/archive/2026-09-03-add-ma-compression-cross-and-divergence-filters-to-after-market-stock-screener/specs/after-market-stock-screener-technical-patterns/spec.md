## ADDED Requirements

### Requirement: 均線糾結與交叉必須使用固定且可重現的公式

系統 MUST 以截至 snapshot `effectiveSessionDate` 的官方 canonical close 計算 SMA5、SMA10、SMA20，並以 `(三條均線最大值 - 最小值) / SMA20 * 100` 計算每日糾結寬度。糾結 MUST 要求使用者設定的 2–10 個連續交易日皆小於等於 0.1–5.0% 的設定門檻；資料不足、日期不相鄰、分母非法或任一均線無效 MUST 回 unknown，不得以顯示四捨五入後數值判定。

#### Scenario: 連續三日符合百分之一糾結

- **WHEN** `compressionDays=3`、`maxSpreadPct=1`，截至指定終點的三個相鄰交易日 spreadPct 均小於等於 1
- **THEN** 糾結分支 MUST pass，並保存三日未四捨五入 spreadPct 與 SMA5／10／20 evidence

#### Scenario: 其中一日超過門檻

- **WHEN** 糾結窗任一日 spreadPct 大於門檻，即使 D 當日低於門檻
- **THEN** 糾結分支 MUST fail，不得只看最新一日

### Requirement: 準備突破與黃金死亡交叉必須區分確認時點

多頭準備突破 MUST 要求糾結窗結束於 D、`SMA5(D) <= SMA20(D)`、SMA5 與 SMA20 的差距由 P 至 D 收斂，且 `close(D)` 嚴格高於 SMA5／10／20；空頭準備跌破 MUST 使用相反方向與 `close(D)` 嚴格低於三條均線。黃金交叉 MUST 要求糾結窗結束於 P、`SMA5(P) <= SMA20(P)` 且 `SMA5(D) > SMA20(D)`；死亡交叉 MUST 要求 `SMA5(P) >= SMA20(P)` 且 `SMA5(D) < SMA20(D)`。P、D MUST 為相鄰完整官方交易日，D MUST 等於 `effectiveSessionDate`。

#### Scenario: 糾結後最新日黃金交叉

- **WHEN** 截至 P 的完整糾結窗 pass，P 的 SMA5 小於等於 SMA20，D 的 SMA5 嚴格大於 SMA20
- **THEN** 黃金交叉確認 MUST pass，並回傳 P／D 均線、糾結窗及交叉日期

#### Scenario: 尚未交叉的多頭準備

- **WHEN** 糾結截至 D 成立、SMA5 仍小於等於 SMA20、差距收斂且 D 收盤嚴格高於三條均線
- **THEN** 多頭準備突破 MUST pass，但黃金交叉確認 MUST NOT pass

#### Scenario: 碰線不算完成交叉

- **WHEN** D 的 SMA5 等於 SMA20
- **THEN** 黃金與死亡交叉確認 MUST 均為 fail；系統不得以畫面四捨五入或顏色判定交叉

### Requirement: 一般型背離必須以已確認 price pivot 判定

系統 MUST 以左右各 2 根完整 K 棒的嚴格 high／low 建立已確認 price pivot，兩個中心相距 MUST 為 5–30 個交易日，第二中心距 D 不超過 3 個交易日，且兩個價位差至少 1%。多頭一般背離 MUST 要求第二個 price low 嚴格較低、第二個同日指標值嚴格較高；空頭一般背離 MUST 要求第二個 price high 嚴格較高、第二個同日指標值嚴格較低。候選 pair MUST 依第二中心最新、第一中心最新的順序唯一決定；pivot 未確認、相等、指標尚未暖機或資料缺漏 MUST 回 unknown 或 fail 的明確 reason，不得使用未來資料或圖形目測。

#### Scenario: 已確認的 RSI 多頭背離

- **WHEN** 兩個合法 pivot low 的第二低點較低、同日 RSI 值較高，價差、間距與新鮮度皆符合，且右側兩根 K 棒已完成
- **THEN** RSI 多頭背離 MUST pass，並回傳兩個中心日、價位、RSI、確認日與參數版本

#### Scenario: 第二 pivot 尚缺右側確認

- **WHEN** 最新低點外觀符合背離但右側未有兩根完整官方 K 棒
- **THEN** 系統 MUST 回 `pivot_unconfirmed`／unknown，不得提前列為符合

#### Scenario: 候選 pair 不唯一

- **WHEN** 視窗內有多組符合間距的 price pivot
- **THEN** 系統 MUST 固定選擇第二中心最新、再選第一中心最新的 pair，使重算結果 deterministic

### Requirement: 背離來源與 MACD 零軸語意必須明確

背離來源 MUST 提供 OBV、RSI5、RSI10、KD-K(9,3,3)、MACD line(12,26,9) 與 MACD histogram(12,26,9)，方向 MUST 提供多頭、空頭與任一方向。各來源 MUST 取 price pivot 同一交易日的 canonical 指標值；OBV MUST 使用官方 `volume_shares`。MACD histogram 多頭兩點 MUST 皆小於零，空頭兩點 MUST 皆大於零；啟用 `requireZeroReset` 時兩點之間 MUST 到達或穿越零軸。第一版 MUST NOT 將 hidden divergence 納入任一選項。

#### Scenario: OBV 價量多頭背離

- **WHEN** 第二個合法 price low 較低而同日 OBV 較高，且兩段 OBV 均使用完整官方股數成交量
- **THEN** 價量背離 MUST pass，evidence MUST 標明成交量單位為股與 source mapping version

#### Scenario: MACD 能量柱未通過零軸限制

- **WHEN** 兩個低點的 histogram 均在零軸下且形成多頭背離，但使用者要求 zero reset 而中間未到達零軸
- **THEN** 該分支 MUST fail 並顯示 `zero_reset_not_met`，不得退回不要求 reset 的結果

#### Scenario: 任一背離方向含 unknown

- **WHEN** 多頭背離 fail、空頭背離 unknown 且方向選擇為任一
- **THEN** 背離分支 MUST 為 unknown；只有任一方向 pass 才 pass，全部 fail 才 fail

### Requirement: 新技術條件必須納入全條件三態與 v4 evidence

均線與背離分支 MUST 和成交量、千張大戶、分型及布林條件共同使用既有 `all`／`any` 三態真值表。v4 API MUST 回傳 snapshot／formula／criteria version、實際參數、逐分支 verdict／reason、均線窗或 pivot pair evidence 與 hash；排序、cursor 與 cache MUST 綁定同一 v4 snapshot 及 criteria fingerprint。系統 MUST 維持 `matched + notMatched + unknown = total`，停用分支不得要求其資料 ready。

#### Scenario: all 模式的背離資料不足

- **WHEN** 均線 pass、背離 unknown，且其他啟用條件皆 pass
- **THEN** 外層 all MUST 為 unknown，並保留背離缺漏原因

#### Scenario: any 模式已有黃金交叉

- **WHEN** 黃金交叉 pass、背離 unknown，且模式為 any
- **THEN** 外層 MUST pass，但 API 與 UI 仍 MUST 呈現背離 unknown evidence

### Requirement: v4 技術集合必須可由官方 OHLCV 全市場重算

每次準備發布 v4，系統 MUST 以相同 universe、130-session canonical OHLCV、公式版本與固定參數獨立重算均線特徵、price pivots、六種指標及背離矩陣，並與 staging evidence、API 全分頁集合及守恆計數一致。Fixture、單一商品或 chart K 棒成功 MUST NOT 代替全市場 evidence。

#### Scenario: 全市場逐檔稽核 v4

- **WHEN** v4 full run 的 remaining／failed／overdue 均為零
- **THEN** 驗收 MUST 核對每個 pass symbol 的 session、均線或 pivot／指標公式、source／formula version、evidence hash 與 API 集合
- **AND** 任一價格、成交量、日期、指標暖機、pivot 確認或零軸條件不一致時 MUST 阻止完成宣告
