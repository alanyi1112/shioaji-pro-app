# after-market-stock-screener-technical-patterns Specification

## Purpose
TBD - created by archiving change add-technical-pattern-filters-to-after-market-stock-screener. Update Purpose after archive.
## Requirements
### Requirement: 選股面板必須提供兩種分型算法與方向
系統 MUST 在收盤後「選股」面板提供可獨立啟用的「K 棒分型」條件。算法 MUST 包含「原始三 K」、「纏論包含處理」與「任一算法」；方向 MUST 包含「底分型」、「頂分型」與「任一方向」。選擇任一時 MUST 採三態 OR，不得把子條件 unknown 當成 fail，也不得要求互斥頂／底同時成立。

#### Scenario: 選擇原始三 K 底分型
- **WHEN** 使用者啟用分型條件並選擇「原始三 K」與「底分型」
- **THEN** 系統只以原始三 K 底分型判定該分支，且不要求纏論算法也成立

#### Scenario: 選擇任一算法及任一方向
- **WHEN** 任一算法／方向組合中至少一個子判定 pass
- **THEN** 分型分支 MUST 為 pass；只有全部 fail 才為 fail，沒有 pass 且至少一個 unknown 時 MUST 為 unknown

### Requirement: 原始三 K 分型必須嚴格且已確認

系統 MUST 只使用結束於 snapshot `effectiveSessionDate` 的最新三個相鄰、完整、已驗證官方市場交易日 A、B、C 判定原始三 K，C 必須同時為最新完整交易日及確認日。頂分型 MUST 要求 B 的 high 嚴格高於 A／C high 且 B 的 low 嚴格高於 A／C low；底分型 MUST 要求 B 的 low 嚴格低於 A／C low 且 B 的 high 嚴格低於 A／C high。相等、缺日、非法 OHLC、C 早於日量 D 或仍使用上一期 snapshot MUST NOT pass。

#### Scenario: 最新交易日確認底分型

- **WHEN** A／B／C 日期相鄰、C 等於 `effectiveSessionDate`，且 B.low 低於 A.low、C.low，B.high 也低於 A.high、C.high
- **THEN** 系統 MUST 回傳已確認底分型，並顯示 B 為中心日、C 為確認日

#### Scenario: 高低價相等

- **WHEN** B 任一必要 high／low 與相鄰 K 棒相等
- **THEN** 系統 MUST 將該方向判為 fail，不得以包含、四捨五入或視覺近似判為分型

#### Scenario: 右側 K 棒尚未完成

- **WHEN** 只有左棒與中心棒，C 尚非完整交易日，或 C 不等於當期 `effectiveSessionDate`
- **THEN** 系統 MUST 回 unknown／pending，且不得顯示為已確認分型

#### Scenario: 收盤後交易日推進

- **WHEN** `effectiveSessionDate` 由 D-1 推進至 D
- **THEN** 系統 MUST 以新的 A／B／C 視窗重新判定全市場，不得沿用以 D-1 為確認日的 pass 集合

### Requirement: 纏論分型必須可重現包含關係處理
系統 MUST 依已驗證 OHLC 的包含區間、明確上／下方向與固定合併公式建立標準化 K 棒。向上合併 MUST 各取較高 high／low，向下合併 MUST 各取較低 high／low；方向無法由前兩根無包含有效 K 棒唯一決定時 MUST 回 `containment_direction_unknown`。每根標準化 K 棒 MUST 保存原始日期範圍，最後再以相同嚴格三 K 規則判定頂／底分型。

#### Scenario: 向上包含合併後確認頂分型
- **WHEN** 相鄰 K 棒具有包含關係、既有有效高低點同步上移，且合併後最後三根標準化 K 棒符合嚴格頂分型
- **THEN** 系統 MUST 回傳纏論頂分型及每根標準化 K 棒的原始日期範圍

#### Scenario: 包含方向不明
- **WHEN** 初始或中間包含關係無法由前兩根無包含有效 K 棒唯一判定向上或向下
- **THEN** 系統 MUST 回 unknown／`containment_direction_unknown`，不得以收盤漲跌或資料順序猜測

#### Scenario: 合併後沒有獨立右棒
- **WHEN** 最新交易日被合併進候選中心棒且其後尚無獨立標準化 K 棒
- **THEN** 系統 MUST 視為尚未確認，不得 pass

### Requirement: 布林反轉 K 必須要求首次穿越與指定 K 棒結構

系統 MUST 固定使用結束於 snapshot `effectiveSessionDate` 的 canonical 官方未調整 OHLC 計算 BOLL(20,2)。前一官方市場交易日 P 的收盤 MUST 位於含邊界的通道內；最新完整交易日 D 必須等於 `effectiveSessionDate`，才能以嚴格不等號首次穿越。下軌模式 MUST 同時滿足 `closeD < lowerD`、陽 K `closeD > openD` 與下影線 `lowD < openD`；上軌模式 MUST 同時滿足 `closeD > upperD`、陰 K `closeD < openD` 與上影線 `highD > openD`。模式 MUST 提供下軌、上軌與任一型態。

#### Scenario: 首次跌破下軌並形成陽 K 下影

- **WHEN** P 收盤介於 P 的 lower／upper，且 D 等於 `effectiveSessionDate`、close 低於 lower、close 高於 open、low 低於 open
- **THEN** 下軌陽 K 下影分支 MUST pass，並回傳 P／D OHLC、bands、日期與影線證據

#### Scenario: 首次突破上軌並形成陰 K 上影

- **WHEN** P 收盤介於 P 的 lower／upper，且 D 等於 `effectiveSessionDate`、close 高於 upper、close 低於 open、high 高於 open
- **THEN** 上軌陰 K 上影分支 MUST pass，並回傳 P／D OHLC、bands、日期與影線證據

#### Scenario: 前一日已在通道外

- **WHEN** P 的收盤低於 lower 或高於 upper
- **THEN** 即使 D 仍位於相同通道外且 K 棒結構符合，系統 MUST NOT 判為首次穿越

#### Scenario: 碰軌、十字線或顏色相反

- **WHEN** D 收盤等於 band、open 等於 close、下軌型態為 `close < open`、上軌型態為 `close > open`，或指定方向的影線長度為零
- **THEN** 對應反轉 K MUST 為 fail，不得以台股畫面顏色、顯示四捨五入或名稱猜測取代 OHLC 比較

### Requirement: 技術型態必須加入既有全條件三態邏輯
系統 MUST 讓分型與布林反轉 K 分支和成交量、千張大戶分支共同使用既有 `all`／`any`。停用的分支 MUST 不參與判定；啟用分支的資料缺漏 MUST 保存逐分支 unknown reason。系統 MUST 維持 `符合 + 不符合 + 無法判定 = 全市場母體`。

#### Scenario: all 模式包含技術與籌碼條件
- **WHEN** 使用者啟用成交量、分型與大戶條件並選擇 all
- **THEN** 只有三個分支皆 pass 才能列為符合，任一 fail 即不符合，沒有 fail 且至少一個 unknown 才列為無法判定

#### Scenario: any 模式已有一個技術條件通過
- **WHEN** 分型 pass、布林 unknown 且其他啟用條件皆未 pass
- **THEN** 外層 any MUST 為 pass，並仍在 evidence 顯示布林 unknown

### Requirement: API 與結果必須提供可稽核型態證據
v3 API MUST 回傳 snapshot／formula／criteria version、分型算法與方向、中心／確認日期、標準化 K 棒原始日期映射、P／D OHLC、P／D BOLL bands、影線判定、逐分支 verdict 與 unknown reason。排序與 cursor MUST 綁定同一 snapshot 與 criteria fingerprint，且所有並列 MUST 以股票代碼穩定排序。

#### Scenario: 檢視纏論分型結果
- **WHEN** 使用者展開一筆纏論分型符合結果
- **THEN** 系統 MUST 顯示確認日、方向、合併後三 K 及各自原始日期範圍，不得只顯示「符合」

#### Scenario: 跨 snapshot 翻頁
- **WHEN** 使用者使用舊 snapshot／criteria 的 cursor，而最新 snapshot 已切換
- **THEN** 系統 MUST 固定原 snapshot 或明確回 snapshot expired，不得混合兩版結果

### Requirement: 偏好與舊版結果必須安全遷移
系統 MUST 將合法 v2 偏好一次性遷移至 v3，兩個新技術條件預設關閉，既有條件、成交值、組合及排序保持不變。v1／v2 snapshot、cursor 或未知偏好版本 MUST NOT 由 v3 公式重新解釋。

#### Scenario: 首次讀取 v2 偏好
- **WHEN** 使用者已有合法 v2 選股偏好且尚無 v3 偏好
- **THEN** 系統 MUST 建立新技術條件皆關閉的 v3 偏好，並保留其餘合法設定

#### Scenario: 最新 snapshot 尚為 v2
- **WHEN** v3 UI 只讀到合法 v2 snapshot
- **THEN** 系統 MUST 顯示 v3 preparation pending 或安全 v2 行為，不得用 v3 條件重算 v2 rows

### Requirement: 點選技術型態結果不得產生其他產品副作用
點選分型或布林結果 MUST 只更新使用者指定的未鎖定 K 線圖商品，沿用既有圖表選擇政策。系統 MUST NOT 加入自選清單、改動其他圖表、下單／智慧下單商品、草稿、行情訂閱或交易狀態。

#### Scenario: 點選未加入清單的分型股票
- **WHEN** 使用者點選一檔不在自選清單的分型結果且已有指定未鎖定圖表
- **THEN** 只有該圖表 MUST 切換到該商品，自選清單與所有交易狀態 MUST 保持不變

#### Scenario: 所有圖表皆鎖定
- **WHEN** 使用者點選結果但沒有可用未鎖定圖表
- **THEN** 系統 MUST 要求解鎖或明確新增日 K 圖，不得擅自覆寫任一圖表

### Requirement: 技術型態集合必須與當期官方 OHLC 全市場重算一致

每次準備發布 v3，系統 MUST 以該 snapshot 的 canonical OHLC、session window 與公式版本獨立重算原始三 K、纏論分型與兩種 BOLL pass／fail／unknown 集合，並與保存的 technical evidence、API 分頁全集及守恆計數一致。只有 fixture、單一商品或純函式測試成功 MUST NOT 取代本機全市場 evidence。

#### Scenario: 全市場逐筆稽核

- **WHEN** v3 full run 的 remaining／failed／overdue 均為零
- **THEN** 驗收 MUST 比對每個 pass symbol 的 A／B／C 或 P／D、公式條件、evidence hash 與 API 集合
- **AND** 任一日期、OHLC、陽陰 K、影線或 band 條件不一致時 MUST 阻止完成宣告

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

### Requirement: 布林位置必須使用固定 BOLL 與正規化中軌距離

系統 MUST 從結束於 `effectiveSessionDate` 的 canonical 官方未還原 OHLC 計算 BOLL(20,2)。上軌外 MUST 以 `closeD > upperD` 判定，下軌外 MUST 以 `closeD < lowerD` 判定；碰軌等號 MUST 為 fail。中軌附近 MUST 以 `abs(closeD-middleD)/(upperD-lowerD)*100 <= tolerancePercent` 判定，預設 10%，並依任意／上升／下降選項比較 P／D 中軌。判定 MUST 使用未四捨五入值；band 缺漏、寬度非正或 P／D 不相鄰 MUST 為 unknown。既有布林反轉 K 的首次穿越與 K 棒結構規則 MUST 保持不變。

#### Scenario: 收盤嚴格位於上軌外

- **WHEN** D 等於 `effectiveSessionDate` 且未四捨五入的 `closeD > upperD`
- **THEN** 上軌外分支 MUST pass 並保存 D 的 close／upper／middle／lower 與公式版本

#### Scenario: 收盤碰到上軌

- **WHEN** 未四捨五入的 `closeD == upperD`
- **THEN** 上軌外分支 MUST fail，不得因顯示精度或台股顏色視為突破

#### Scenario: 中軌附近且中軌上升

- **WHEN** 正規化距離不大於使用者門檻，方向選擇上升且 `middleD > middleP`
- **THEN** 中軌附近分支 MUST pass，evidence MUST 同時提供距離分子、通道寬度、百分比及 P／D 中軌

#### Scenario: 通道寬度為零

- **WHEN** `upperD <= lowerD` 或任一 band 不可驗證
- **THEN** 中軌附近 MUST 為 unknown 並回 `invalid_bollinger_width` 或 `indicator_warmup`，不得除以零或改用固定價差

### Requirement: RSI 與 KD 極值區交叉必須使用相鄰交易日未四捨五入值

RSI MUST 固定使用既有 Wilder RSI5 為快線、RSI10 為慢線；KD MUST 固定使用既有 KD(9,3,3) 的 K 為快線、D 為慢線。低檔黃金交叉 MUST 同時滿足 `fastP <= slowP`、`fastD > slowD`，以及 P 或 D 至少一日的快慢值皆小於等於低檔門檻。高檔死亡交叉 MUST 同時滿足 `fastP >= slowP`、`fastD < slowD`，以及 P 或 D 至少一日的快慢值皆大於等於高檔門檻。P／D MUST 為相鄰已完成官方交易日；暖機不足或任一必要值缺失 MUST 為 unknown。

#### Scenario: RSI 低檔黃金交叉

- **WHEN** P 的 RSI5 不高於 RSI10、D 的 RSI5 嚴格高於 RSI10，且 P 或 D 的兩線都不高於低檔門檻
- **THEN** RSI 低檔黃金交叉 MUST pass 並保存 P／D 的 RSI5、RSI10、門檻與交叉方向

#### Scenario: KD 高檔死亡交叉

- **WHEN** P 的 K 不低於 D、最新日 K 嚴格低於 D，且 P 或最新日至少一日的 K／D 都不低於高檔門檻
- **THEN** KD 高檔死亡交叉 MUST pass 並保存 KD(9,3,3) 公式與 P／D 值

#### Scenario: 畫面相等但原始值未交叉

- **WHEN** 格式化後的快慢線看似相等或交叉，但 canonical 未四捨五入值不符合嚴格 D 側條件
- **THEN** 分支 MUST fail，不得依格式化文字或圖形交點判定

#### Scenario: 極值區只包含單一線

- **WHEN** 交叉成立但 P 與 D 都沒有任何一日同時讓快慢兩線位於指定高／低檔區
- **THEN** 對應極值區交叉 MUST fail，不得只以快線單獨進入極值區判定

### Requirement: MACD 訊號必須明確區分零軸接近、穿越與軸側交叉

系統 MUST 固定使用 MACD(12,26,9) 的 DIF 與 DEA。向上穿越零軸 MUST 為 `DIFP <= 0 && DIFD > 0`，向下穿越 MUST 為 `DIFP >= 0 && DIFD < 0`。黃金／死亡交叉 MUST 分別使用 `DIFP <= DEAP && DIFD > DEAD` 與 `DIFP >= DEAP && DIFD < DEAD`；選擇零軸下或上時，P／D 的 DIF 與 DEA MUST 全部嚴格位於指定軸側。任一黃金／死亡交叉不得另加軸側限制。

從下方／上方接近零軸 MUST 要求 D 仍在指定軸側、`abs(DIFD)/closeD*100` 不大於可調門檻，且 P2→P→D 連續兩段 `abs(DIF)` 嚴格縮小；預設門檻 0.25%，允許 0.01–5.00%。close 非正、必要 session 不相鄰或任一值未暖機 MUST 為 unknown。

#### Scenario: 從零軸下連續接近

- **WHEN** P2、P、D 的 DIF 都小於零、絕對值連續兩段嚴格縮小，且 D 的價格正規化距離不大於門檻
- **THEN** 從下方接近零軸 MUST pass 並保存三日 DIF、D close、正規化距離與門檻

#### Scenario: 已經穿越零軸

- **WHEN** DIF 在 D 已由非正轉為正
- **THEN** 向上穿越零軸 MAY pass，但從下方接近零軸 MUST fail，不得讓同一模式同時表示穿越前與穿越後

#### Scenario: 零軸下黃金交叉

- **WHEN** DIF／DEA 在 P 與 D 都嚴格小於零，且快線由不高於慢線轉為嚴格高於慢線
- **THEN** 零軸下黃金交叉 MUST pass；零軸上黃金交叉 MUST fail

#### Scenario: 接近距離縮小但不是連續兩段

- **WHEN** D 比 P 靠近零軸，但 P 未比 P2 靠近
- **THEN** 接近零軸 MUST fail，不得只比較單一日變化或使用趨勢目測

### Requirement: 訊號內量能確認必須排除當日基準並使用官方股數

啟用量能確認時，系統 MUST 使用 D 的 canonical `volume_shares` 與 D 之前連續 N 個可驗證官方交易日的平均 `volume_shares`，基準 MUST 排除 D。量能倍數 MUST 以未四捨五入值判定 `volumeD >= ratio * averagePriorN`；啟用流動性下限時，`averagePriorN` MUST 同時不低於使用者以張設定、換算後的股數下限。技術訊號與量能確認 MUST 在同一分支內依 AND 三態合併；前期缺 session、零／無效基準、單位不明或 volume 缺漏 MUST 為 unknown。

#### Scenario: 技術成立且量能達標

- **WHEN** 技術訊號 pass、前期 20 日平均量完整，且 D 量恰好等於 1.2 倍基準並達流動性下限
- **THEN** 該完整分支 MUST pass，等號不得因格式化誤判為 fail

#### Scenario: 技術成立但量能資料缺漏

- **WHEN** 技術訊號 pass，但前期 N 日中存在未分類缺口或不可驗證成交量
- **THEN** 完整分支 MUST 為 unknown 並保存 `missing_volume_baseline`，不得縮短基準窗或以零補值

#### Scenario: 技術已 fail 且量能 unknown

- **WHEN** 技術訊號 fail、量能確認 unknown
- **THEN** 該分支 MUST 為 fail，同時保留量能缺漏診斷，外層守恆不得把同一商品重複計數

### Requirement: 新技術分支必須納入既有三態與可重算 evidence

四個新分支 MUST 與既有條件共同使用 `all`／`any` 三態真值表。v7 evidence MUST 保存實際模式、參數、D／P／P2、必要 indicator／band／volume 值、逐子條件 verdict／reason、formula version 與 hash；停用分支 MUST 不要求資料 ready。排序、cursor、cache 與分頁 MUST 綁定同一 v7 snapshot 及 criteria fingerprint。

#### Scenario: any 模式已有 MACD pass

- **WHEN** MACD 分支 pass、RSI 分支 unknown，外層為 `any` 且其他啟用分支未 pass
- **THEN** row MUST 為 matched，RSI unknown reason 仍須保留

#### Scenario: all 模式含量能 unknown

- **WHEN** 所有技術訊號本身 pass，但其中一個啟用的量能確認 unknown，外層為 `all`
- **THEN** row MUST 為 unknown，且 `matched + notMatched + unknown = total` MUST 仍成立
