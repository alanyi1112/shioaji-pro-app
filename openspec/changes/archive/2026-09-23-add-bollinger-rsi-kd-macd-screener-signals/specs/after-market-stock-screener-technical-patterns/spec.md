## ADDED Requirements

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
