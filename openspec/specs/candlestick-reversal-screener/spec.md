# candlestick-reversal-screener 規格

## Purpose

定義盤後 K 線反轉型態選股的精確判定、完整官方交易日資料、可設定條件、三態守恆與可重算證據，支援紅三兵、看跌吞噬、晨星、三隻烏鴉及刺透，並維持版本化凍結資料與唯讀查詢契約。

## Requirements

### Requirement: 反轉形態必須使用完整官方交易日與精確 OHLC

系統 MUST 只以同一 snapshot `effectiveSessionDate` D 及逐市場已驗證官方交易日 grid 的 canonical 未還原 OHLC 判斷；陽線 MUST 定義為 close > open、陰線為 close < open，open = close MUST NOT 當成任一方向。必要日期缺漏、重複、非法 OHLC、日期不相鄰或已知跨價格不可比事件 MUST 回 unknown 與明確 reason，不壓縮商品缺日、不造零量假 K、不以畫面顏色或顯示四捨五入代替比較。價格及比例 MUST 以 canonical units／精確交叉乘處理。

#### Scenario: 國際配色不影響陰陽定義

- **WHEN** 相同 canonical K 棒在不同主題或來源影片使用不同顏色
- **THEN** 判定 MUST 仍只依 open／close，結果與 evidence hash MUST 不因主題而變

#### Scenario: 商品缺一個必要交易日

- **WHEN** 市場有該交易日但商品缺必要 K 棒
- **THEN** 對應子型態 MUST unknown 並列出缺日，不能將左右兩天接成相鄰棒

#### Scenario: 官方臨時休市

- **WHEN** 官方市場 session grid 排除已核實的臨時休市日
- **THEN** 系統 MUST 使用修正後相鄰交易日，不能要求休市日有棒或從行情空批次自行判休市

### Requirement: 形狀與前期趨勢必須可設定且排除型態本身

系統 MUST 使用型態首棒之前 3–60 日的 close 計算 OLS 斜率分子及首尾收盤變動，預設 5 日、最低變動幅度 0%；上漲 MUST 斜率為正且漲幅嚴格大於設定幅度，下跌 MUST 斜率為負且跌幅絕對值嚴格大於設定幅度。橫盤或兩項方向相反 MUST fail。

長實體 MUST 同時符合 body/range 大於等於門檻及 body 大於等於前期實體中位數的設定倍數，預設為 60%、20 日參考窗及 1.0 倍；參考窗 MUST 結束於型態首棒之前。小實體 MUST body/range 小於等於預設 30%；近高／低點 MUST 使用剩餘影線占 range 不超過預設 20%。合法範圍 MUST 為長實體 50–90%、小實體 0–40%、參考窗 5–60 日、相對倍數 0.5–3.0、近高低距離 0–30%、最低趨勢幅度 0–20%。range=0 的合法棒 MUST 不符合必要形狀且不除零；必要實體中位數為零 MUST unknown。未使用的形狀暖機 MUST 不影響其他子型態。

#### Scenario: 型態內三棒上漲但前期不是下跌

- **WHEN** 紅三兵形狀成立，但排除型態棒的前期趨勢為上漲或橫盤
- **THEN** 紅三兵反轉 MUST fail，不能用三根陽線本身證明先前下跌

#### Scenario: 長實體在門檻邊界

- **WHEN** 正振幅 K 棒的 body/range 恰等於長實體門檻且符合中位數倍數
- **THEN** 長實體形狀 MUST pass，但不因此免除其他必要條件

#### Scenario: 只選吞噬而長實體參考窗不足

- **WHEN** 吞噬與前期趨勢的必要資料完整，未啟用其他型態或選用過濾
- **THEN** 不適用的長實體中位數窗 MUST 不使吞噬變為 unknown

### Requirement: 紅三兵必須符合前期下跌與三根陽線結構

紅三兵 MUST 要求形成前趨勢下跌、依序 A／B／C 為三根長陽線、closeA < closeB < closeC、B／C 的 open 嚴格位於前一棒 bodyLow／bodyHigh 內，且每根 `(high-close)/range` 小於等於近高點門檻。型態未通過必要條件 MUST fail，不能只以三根陽線或高於昨收當作通過。

#### Scenario: 完整紅三兵

- **WHEN** 前期下跌、三根完整日棒符合長陽、開盤位置、逐根收高及近高點條件
- **THEN** 紅三兵形態 MUST pass 並保存逐棒比較證據

#### Scenario: 其中一根長上影或開盤在實體外

- **WHEN** 任一必要棒不符近高點或 B／C open 不在前棒實體嚴格內部
- **THEN** 紅三兵 MUST fail，即使三根皆陽線且收盤提高

### Requirement: 看跌吞噬必須嚴格包覆實體而非影線

看跌吞噬 MUST 要求形成前上漲、A 陽、B 陰、openB > closeA 且 closeB < openA。只吞影線、方向錯誤、任一端恰相等或 A 為十字線 MUST fail；影線沒有被全部包覆 MUST 不單獨使成立的實體吞噬失敗。結果 MUST 提供第二／第一棒實體倍數，但不隱性新增未設定的倍數限制。

#### Scenario: 實體吞噬但沒有吞掉影線

- **WHEN** 前期上漲，A／B 的陰陽與嚴格實體包覆成立，B high／low 未完全覆蓋 A 影線
- **THEN** 形態 MUST pass，不以完整振幅吞噬作額外必要條件

#### Scenario: 端點相等

- **WHEN** openB = closeA 或 closeB = openA
- **THEN** 嚴格看跌吞噬 MUST fail，不以四捨五入或浮點容差改成 pass

### Requirement: 晨星第三根收盤必須嚴格超過首根實體一半

晨星 MUST 要求形成前下跌、A 長陰、B 小實體、C 長陽及 `closeC > closeA + p*(openA-closeA)`；p 預設 50%，只允許 50–100%。預設中點比較 MUST 等價 `2*closeC > openA+closeA`，不以 highC、C 實體長度、最高最低振幅中點或已四捨五入值代替。openB=closeB 且 rangeB>0 MUST 標示 `morning-doji-star`；使用者停用十字子型時該候選 MUST fail，不當作一般晨星。

跳空模式 MUST 預設 `strict-body-gap`，要求 bodyHighB < bodyLowA 且 bodyLowC > bodyHighB；`no-gap-required` MUST 只取消這兩條並在 criteria／evidence 標示變體，其餘必要條件不變。

#### Scenario: 收盤恰等於中點

- **WHEN** A open=100、close=90，C close=95，其餘條件皆成立
- **THEN** 晨星 MUST fail；C high 超過 95 也不能使其通過

#### Scenario: 收盤超過中點

- **WHEN** A open=100、close=90，C close=95.01，且其餘必要條件完整成立
- **THEN** 預設回補條件 MUST pass，evidence MUST 顯示精確比較及 50% 設定

#### Scenario: 不強制跳空變體

- **WHEN** 其餘必要條件成立但缺實體跳空，使用者選擇不強制跳空
- **THEN** 形態 MUST 依變體判定，結果與說明 MUST 明示 gap mode，不宣稱該變體已達原研究 78%

### Requirement: 三隻烏鴉必須要求前期上漲與逐根收低

三隻烏鴉 MUST 要求形成前上漲、A／B／C 均為長陰、closeA > closeB > closeC、lowA > lowB > lowC、B／C open 嚴格落在前棒實體內，以及每根 `(close-low)/range` 不超過近低點門檻。`firstCrowOpenWithinPriorBody` MUST 預設 true，額外要求 A open 嚴格在 A 前一棒實體內；關閉此限制時 MUST 保存模式與來源差異，不取消第 2／3 根的要求。

#### Scenario: 下跌趨勢中的三根陰線

- **WHEN** 三根陰線符合逐根收低，但形成前趨勢已下跌
- **THEN** 烏鴉反轉 MUST fail，不將下跌延續當成由漲轉跌

#### Scenario: 首根開盤限制關閉

- **WHEN** 其餘必要條件成立但 A open 在前棒實體外，使用者關閉首根額外限制
- **THEN** MUST 按保存的模式判定，B／C 的嚴格開盤限制仍不可取消

### Requirement: 刺透必須嚴格回補首棒實體且與看多吞噬分離

刺透 MUST 使用兩個相鄰完整交易日 A／B，要求形成前下跌、openA > closeA、closeB > openB、openB <= closeA、closeB < openA 及 `closeB > closeA + p*(openA-closeA)`。p MUST 預設 50%，可調 50–99.99%、最多兩位小數，精確比例不得四捨五入後再比較；50% MUST 使用 `2*closeB > openA+closeA`。只由 highB 超過中點、closeB 恰等中點、closeB >= openA、任一棒為十字 MUST fail。MUST 不將首根 high／low 的中點代替實體中點，不自動把不符刺透者改算看多吞噬命中。

開盤模式 MUST 預設 `research-close`；可選 `below-prior-low` MUST 額外要求 openB < lowA，不放寬任何基本條件。`piercingRequireLongFirstBody` MUST 預設 false，啟用才要求 A 符合共用長實體門檻與中位數參考窗；停用時該暖機 MUST 不進入 readiness 或 active fingerprint。系統 MUST 保存回補比例、開盤模式、長首棒開關及各比較 evidence，並明示可選限制與本功能 OLS 趨勢不代表重製台股原研究交易策略。

#### Scenario: 首根收盤開盤相等與中點嚴格邊界

- **WHEN** A open=100、close=90、low=88；B open=90、close=96，其他必要條件成立且採預設模式
- **THEN** 刺透 MUST pass；openB 等於 closeA 合法，不強制低於 lowA；B close=95 MUST fail

#### Scenario: 超過首根開盤不是刺透

- **WHEN** 其餘條件成立但 B close 等於或高於 A open
- **THEN** 刺透 MUST fail，不能取消上界、沿用刺透統計或自動新增看多吞噬命中

#### Scenario: 嚴格跳空要求及長首棒暖機

- **WHEN** openB = lowA 或介於 lowA 與 closeA，使用者選嚴格跳空模式
- **THEN** 該模式 MUST fail；回到 research-close 才依基本公式重算，額外長首棒未啟用時不足中位數窗 MUST 不使刺透 unknown

#### Scenario: 只有最高價超過中點

- **WHEN** highB 超過首棒實體中點，但 closeB 未嚴格超過
- **THEN** 刺透 MUST fail，不能以影線、紅色圖示或顯示值替代收盤比較

### Requirement: 型態成立與次日突破確認必須使用不同固定日期

`pattern-complete` MUST 為預設，型態末棒固定於 D。`next-session-breakout` MUST 將型態末棒固定於 D 前一個官方交易日、D 為確認日；多頭須 closeD 嚴格大於型態最高 high，空頭須 closeD 嚴格小於型態最低 low。系統 MUST 保存 formationEndDate、confirmationDate、mode；不得搜尋任意較早型態、讀未來棒、混用當日未完成 K 或把成立標成已突破。

#### Scenario: 次日只碰到型態高點

- **WHEN** 已完成紅三兵且下一完整交易日收盤等於型態最高 high
- **THEN** 次日突破確認 MUST fail；最高價超過但收盤未超過亦 fail

#### Scenario: 跨週末確認

- **WHEN** 型態結束於週五，官方下一交易日為週一且週一完整收盤越界
- **THEN** MUST 以週一為確認日，不要求週六／週日假棒

### Requirement: 量能與位置過濾必須內含於形態且不得前視

量能與位置過濾 MUST 預設停用，啟用後固定 AND 於選中形態。量能 MUST 比較 D 的 canonical 股數與截至 D 前一日的 N 日平均，預設 N=20、當日量大於等於 1.2 倍，可另啟用平均量至少 1,000 張；合法 N=5–60、倍數 1.0–10.0，張數按 1,000 股換算，平均量分母為零或缺必要資料 MUST unknown。

位置 MUST 用型態首棒之前 N 日的最低 low／最高 high 分別作多頭支撐／空頭壓力，預設 N=20、距離上限 2%，合法 N=5–60、距離 0.1–10%；型態最低 low／最高 high 與參考價絕對距離占參考價 MUST 小於等於設定門檻。不包含型態或未來資料，停用的過濾 MUST 不要求其資料。

#### Scenario: 外層 any 不能跳過量能

- **WHEN** 只有反轉形態分支啟用、形態成立但其已啟用量能不符，外層選 any
- **THEN** 分支 MUST fail，不能以量能或形態任一成立替代內部 AND

#### Scenario: 停用量能與位置

- **WHEN** 形態價格必要資料完整，但額外量能／位置窗不足且兩項過濾停用
- **THEN** 這些不足 MUST 不影響形態 verdict，不加入 active readiness 或 fingerprint

### Requirement: 子型態與既有條件必須遵守三態守恆

選中形態 MUST 以三態 OR：有 pass 即 pass；全 fail 才 fail；沒有 pass 且有 unknown 即 unknown。外層 MUST 沿用既有 all／any 真值表；未啟用分支不參與，未知原因不得靜默改為 fail。符合、不符合、無法判定的商品數 MUST 等於同一 universe；單檔有多種符合型態 MUST 只列一筆並保留全部命中標籤，不得重複計數。

#### Scenario: 一種成立但另一種 unknown

- **WHEN** 選中晨星 pass、紅三兵 unknown
- **THEN** 分支 MUST pass，仍保存紅三兵 unknown evidence

#### Scenario: 沒有成立但有缺資料

- **WHEN** 所有選中型態沒有 pass 且至少一個 unknown
- **THEN** 分支 MUST unknown，守恆計數與缺資料原因不得遺失

### Requirement: 新能力必須版本化凍結且查詢不得抓取來源

系統 MUST 新增 v9 criteria／preference 與 `candlestick-reversal-v1`／`candlestick-ohlcv-history-v1` 能力，引用已驗證來源建置最新最多 64 個 session 的 immutable 完整 OHLCV／必要特徵，保存來源／mapping／calendar／formula hash。publisher MUST 對相同 D、universe 與來源／公式輸入 no-op，不覆寫舊成功或失敗 evidence。

query、status、排序、翻頁、展開說明 MUST 唯讀；MUST NOT 下載 provider、新增 broker login／subscription、修改流量限制或重啟 runtime。v8 close-only 特徵 MUST 不可充當完整 OHLC；新能力不足 MUST 顯示 pending／unknown，不能縮窗冒充 ready、阻斷獨立 v8 布林發布或污染其每日 profile。跨日期／universe／price basis 的 legacy join MUST 拒絕。

#### Scenario: 只有 v8 布林 head

- **WHEN** 舊布林資料完整但缺新能力的 open／high／low
- **THEN** 新形態 MUST preparation pending，既有布林仍可照原版本使用

#### Scenario: 重複相同查詢

- **WHEN** 使用者反覆調整形態參數、查詢或展開 evidence
- **THEN** MUST 只讀同一凍結底稿，不產生行情下載、訂閱或發布副作用

### Requirement: API 必須提供可重算證據與固定分頁

API MUST 回傳 snapshot、criteria／formula／mapping／catalog version、through、完整命中型態／子型、形成與確認日期、必要 OHLC、精確比較、前期窗、實體中位數、可選量能／位置窗、verdict／reason 及 evidence hash。cursor、排序與 cache MUST 綁定同一 snapshot／active criteria fingerprint，並以商品代碼穩定解決同值排序；舊 cursor 不得交給新版本重解釋。

#### Scenario: 稽核晨星符合列

- **WHEN** 使用者或驗收者檢查晨星結果
- **THEN** MUST 可用 A／B／C 的原值重算中點、回補、跳空與長短實體，並核對來源日期及 evidence hash

#### Scenario: 全市場獨立重算

- **WHEN** 正式本機 snapshot 完成且準備宣告驗收成功
- **THEN** MUST 逐股獨立重算並比對 API 全分頁 pass／fail／unknown、命中標籤與守恆計數，不能只以 fixture 或單一例子代替
