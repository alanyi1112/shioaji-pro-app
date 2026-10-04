## Context

目前選股面板使用基本條件、技術型態、籌碼／價量三群組與單一展開的 accordion。既有 v7 技術訊號及 v8 布林壓縮策略有獨立版本、immutable snapshot、三態組合、草稿／每日 profile 隔離與清單／圖表選擇政策。

v8 `BollingerFrozenFeatures.points` 只保存 close、volume、turnover 與 BOLL，沒有完整 open／high／low，不能用它推測新形態。現存 canonical OHLCV、官方交易日與來源選擇 evidence 可供背景建置引用；新功能不能由 UI 臨時下載或從圖表顏色辨識。

來源為使用者指定影片、其引用的 Bulkowski 公開資料與 Lu／Shiu／Liu（2012）台股研究。已核對原四型態及刺透章節，並以研究原文核對刺透定義與獲利統計；無可取得的完整逐字稿，不宣稱逐句核實全片。統計與定義來源、差異及工程預設另見 `references.md`。保留原 change ID，實際範圍已擴充為五種。

## Goals / Non-Goals

**Goals:**

- 將五種反轉組合變成有明確日期、數值邊界、三態結果與證據的日 K 篩選。
- 必須檢查型態形成前的趨勢，並嚴格落實晨星第三根收盤超過第一根實體中點。
- 提供五個精簡選擇按鈕、參數與統計說明收合，以及台灣紅陽／綠陰呈現。
- 重用已驗證背景行情，安全遷移舊偏好，維持布林、其他技術條件、圖表與清單功能。

**Non-Goals:**

- 不新增三外升、黃昏星、看多吞噬或其他未指定型態，不改寫既有分型定義。
- 不做盤中未完成 K、週 K、回測獲利模型、交易建議、自動下單或停損委託。
- 不新增五型態每日策略 profile，不改現有每日布林參數、背景輪詢頻率、來源或流量政策。
- 不處理其他四個 active monitor changes，也不藉此取得重啟、login、subscription、archive、commit 或 push 的授權。

## Decisions

### 1. 同一條件中的五種型態採 OR，內部必要條件採 AND

新增 `candlestickReversal` top-level 分支，`patterns` 固定排序為 `three-white-soldiers`、`bearish-engulfing`、`morning-star`、`three-black-crows`、`piercing`。分支預設關閉、五種子型態初始全選；啟用後至少保留一種。五種子判定使用既有三態 OR，再與其他已啟用條件依外層 all／any 合併。

每個形態的趨勢、形狀、選用的位置／量能與突破確認固定 AND。不能讓量能獨自通過，也不能要求五種型態同時成立。未啟用的選項不加入 active fingerprint 或 readiness。

替代方案是新增五個 top-level 大型設定面板；不採用，避免再次拉長 UI 及破壞既有單一展開契約。

### 2. 完整官方交易日、精確價格與可調工程門檻

令最新完整 snapshot 日為 D；型態依時間排序為 A、B、C，兩棒型態只有 A、B。資料按逐市場官方 session grid 排列，休市不建立假棒、商品缺日不壓縮。所有價格比較使用既有 canonical price units 與整數／有理數交叉乘，不以顯示小數或浮點 epsilon 判定。

每棒定義 `body=abs(close-open)`、`range=high-low`、`bodyLow=min(open,close)`、`bodyHigh=max(open,close)`。close > open 為陽、close < open 為陰；相等不算陽或陰。合法但 range=0 的棒不符合必要形狀，不做除零；非法 OHLC、重複或不足必要日期則為 unknown。

以下為本功能可重現的**工程預設**，不是聲稱影片或研究採用同一數值：

| 參數 | 預設 | 允許範圍／語意 |
|---|---:|---|
| 形成前趨勢窗 | 5 日 | 3–60 個官方交易日，不含型態棒；OLS 斜率與首尾收盤變動需同方向 |
| 最低趨勢變動幅度 | 0% | 0–20%，變動絕對值必須嚴格大於門檻；0 不代表可接受橫盤 |
| 長實體占振幅 | 60% | 50–90%，body / range 大於等於門檻 |
| 實體長度參考窗 | 20 日 | 5–60 日，結束於型態首棒之前 |
| 長實體相對倍數 | 1.0 | 0.5–3.0 倍，body 大於等於前期 body 中位數乘此倍數；中位數為 0 時 unknown |
| 小實體占振幅 | 30% | 0–40%，body / range 小於等於門檻，必須低於長實體門檻 |
| 收盤離高／低點距離 | 20% | 0–30% 的當棒振幅；紅三兵檢查高點，烏鴉檢查低點 |
| 晨星回補比例 | 50% | 50–100%，第三根 close 必須嚴格超過設定位置；不可設定低於 50% |
| 十字晨星子型 | 包含 | 以第二根 open = close 精確辨識，標示子型與獨立 76% 參考 |
| 晨星跳空模式 | 嚴格實體跳空 | 可改為不強制跳空，但必須標示為變體，不宣稱同一研究反轉率已驗證該變體 |
| 刺透回補比例 | 50% | 50–99.99%，最多兩位小數；第二根 close 必須嚴格超過設定位置且仍低於首根 open |
| 刺透開盤模式 | 不高於前收 | `research-close`：openB <= closeA；`below-prior-low`：額外要求 openB < lowA，明示嚴格跳空變體 |
| 刺透首棒長實體 | 不要求 | `piercingRequireLongFirstBody=false`；啟用才套用共用長實體門檻及中位數窗，明示額外過濾 |

長實體門檻適用紅三兵全部三根、烏鴉全部三根與晨星第一／第三根；吞噬以嚴格實體包覆為必要條件，不另要求 body 中位數暖機。刺透只有啟用首棒長實體才需要該暖機窗；研究開收公式未另量化長實體。各型態只要求自己實際會用到的資料，不能因未選模式缺資料而阻擋全部查詢。

### 3. 五型態的必要公式

- **紅三兵**：形成前下跌；A、B、C 均為長陽線；`closeA < closeB < closeC`；B、C 的 open 嚴格在前一棒 bodyLow／bodyHigh 之間；三棒 `(high-close)/range <= nearExtremeMaxPct`。
- **看跌吞噬**：形成前上漲；A 陽、B 陰；`openB > closeA` 且 `closeB < openA`。吞噬實體而非完整 high／low，等號不算嚴格吞噬；提供 body 倍數 evidence 但不偷偷增加預設倍數門檻。
- **晨星**：形成前下跌；A 長陰、B 小實體（含精確十字子型）、C 長陽；`closeC > closeA + recoveryPct * (openA-closeA)`。預設 50% 等價 `2*closeC > openA+closeA`，不能使用 `highC`、第三根實體長度或顯示值代替。嚴格跳空需 `bodyHighB < bodyLowA` 及 `bodyLowC > bodyHighB`；不強制跳空模式只取消這兩條，不能取消其餘必要條件。
- **三隻烏鴉**：形成前上漲；A、B、C 均為長陰；`closeA > closeB > closeC`，並逐根出現較低 low；三棒 `(close-low)/range <= nearExtremeMaxPct`；B、C open 嚴格在前一棒實體內。影片的「每根」開盤描述另外以 `firstCrowOpenWithinPriorBody=true` 預設檢查 A 與 A 前一根實體；可關閉此額外限制，UI 明示原研究公開識別表只明列第 2、3 根開盤要求。
- **刺透（Piercing）**：形成前下跌；A 陰、B 陽；`openB <= closeA`、`closeB < openA` 且 `closeB > closeA + piercingRecoveryPct*(openA-closeA)`。50% 預設以 `2*closeB > openA+closeA` 精確比較；第二根只由 high 越過中點、close 恰等中點、close 大於等於首根 open 均 fail。close 達首根 open 的看多吞噬不納入本次刺透；其他已選型態仍各自獨立判定，不能將刺透 fail 重新標成其他型態 pass。嚴格跳空模式額外要求 `openB < lowA`；選用首棒長實體、量能、位置及次日突破均只增加 AND 過濾，不移除必要開收關係。

前期趨勢 OLS 只對型態首棒之前 N 個 close，以 x=0…N-1、整數價格計算斜率分子 `N*sum(x*y)-sum(x)*sum(y)` 的正負。上漲需斜率為正且末收盤相對首收盤漲幅嚴格超過門檻；下跌反向。橫盤、相等或方向矛盾為 fail，不以型態三棒本身證明前期趨勢。

刺透的預設開收關係採台股研究公式，但仍沿用本功能的前期 OLS 趨勢，不是重製原研究完整交易策略。原研究以 MA5 連續下降／上升識別趨勢，並用相反型態作變動持有期出場；本功能不實作其進出場與持有期。catalog 必須揭露這項差異，不能將研究報酬套用到本程式、額外長實體／量能過濾或改動參數後的結果。

替代方案是只檢查陽／陰排列或用漲跌昨收顏色；不採用，會錯把趨勢延續或跳空漲跌當成反轉組合。

### 4. 型態完成與突破確認的日期分離

`pattern-complete` 為預設，型態末棒結束於 D；這只表示必要形態成立，不宣稱後續方向已證實。`next-session-breakout` 將型態末棒固定於 D 前一個官方交易日，D 為唯一確認日：多頭 closeD 嚴格大於型態最高 high，空頭 closeD 嚴格小於型態最低 low。盤中尚未完成 D 不算；不往任意更早日期搜索直到找到 pass，也不讀 D 之後資料。

結果分開保存 formationEndDate、confirmationDate、mode。資料不足為 unknown，完整資料但沒有越界為 fail。兩模式不可混合為同一日訊號，更不能以突破確認機率代稱外部反轉率。

### 5. 量能與位置為可選的內部過濾

量能確認預設關閉，沿用技術條件既有 20 日、1.2 倍與可選平均量 1,000 張的控制；合法窗 5–60 日、倍數 1.0–10.0。判斷日固定為 D，平均窗結束於 D 前一交易日，不含 D；比較採股數與精確乘法，張數顯示換算 1 張=1,000 股。零平均量或缺必要量為 unknown，不生成無限倍數。停用時不要求量資料。

位置過濾預設關閉，工程預設 20 日、距離 2%，合法窗 5–60 日、容許 0.1–10%。參考窗結束於型態首棒之前：多頭使用前期最低 low 為支撐，空頭使用前期最高 high 為壓力；型態最低 low／最高 high 與參考價的絕對距離除以參考價需小於等於容許比例。資料與價格基準不足為 unknown，完整但離太遠為 fail。不能把自己形成的最低／最高點當成先前已知支撐壓力。

影片的趨勢／位置與風險使用說明保持參考文字；不將停損建議轉成交易草稿或下單功能，也不虛構影片指定 1.2 倍或 2%。

### 6. v9 擴充能力，不回寫 v8 布林底稿

計畫新增 CriteriaV9／PreferenceV9、`candlestick-reversal-v1` 公式及 `candlestick-ohlcv-history-v1` 能力。v8→v9 一次性遷移保留全部舊值，新增分支關閉；日常布林 profile revision 不變。啟用新分支時只能讀具有完整 OHLC 特徵的新 snapshot；舊結果仍照原版本展示，不以缺 open 的 close-only 點重新解釋。

背景 publisher 引用現有已驗證來源，為每檔保存至多最新 64 個 session 的 canonical OHLCV／必要特徵、逐市場 session grid、來源選擇與 hash。64 是最大 60 日前期窗 + 3 棒 + 1 確認日；不足時保留缺日與 unknown，不臨時縮窗或要求既有布林 160 日全窗口都 ready 才能使用短窗形態。來源 schema、來源日期、未還原 price basis 與已知價格不可比事件需要驗證；已知不可比事件跨必要窗口時 unknown，不以還原／未還原混用消除缺口。

查詢純函式只對凍結特徵與合法 criteria 計算；來源抓取只沿用現有背景準備流程，不由 query、status、說明展開、排序、翻頁或圖表操作觸發。若既有資料無法滿足能力，必須先寫 pending 原因；任何新增下載／來源／額度／runtime 操作需另取得相應授權。

發布鍵綁定 D、universe revision、formula／mapping、source hashes；相同輸入 no-op，原始 snapshot 不覆寫。舊 v8 publisher 與本新能力獨立，不能讓本功能的 pending 阻斷每日布林。

### 7. UI 與 evidence

在技術型態中緊接「K 棒分型」放置新摘要。啟用後才展開五個可複選按鈕，以看多／看空文字協助理解；刺透屬看多。參數、統計與使用原則預設收合。展開不啟用，全部取消只關閉 top-level、保留模式與數值，不改已套用 query、每日 profile 或結果。

統計 catalog 保存版本、來源連結、metric 名稱、研究母體／期間／樣本數、反轉率、研究排名與口徑，不能與公式 hash 或本程式回測混在一起。刺透 64% 為 Bulkowski 反轉率；台股研究的報酬與獲利比例另列，不能共用同一 rate 欄位。結果卡顯示型態／子型／模式／日期；詳細 evidence 保存必要 OHLC、各棒 body／range、前期趨勢窗與斜率分子、回補與跳空比較、長短門檻、位置／量窗、各子條件 verdict／reason、source／formula hash。

陽線圖示與看多標記採台灣紅色，陰線與看空採綠色，文字及可存取名稱不依賴顏色；不引用國際主題色把陰陽倒置。既有圖表漲跌昨收顏色不得取代本功能 close-versus-open 定義。

## Risks / Trade-offs

- [影片、原研究公開定義與數值化公式不完全相同] → 明示來源定義、嚴格／變體、工程門檻與差異，研究數字不當本功能勝率。
- [嚴格跳空／開盤／長實體條件使結果稀少] → 零結果可接受；可見設定可調，不暗中放寬或補假陽／陰棒。
- [除權息或資料來源價格基準混用製造假形態] → 保存 price basis 與可得事件證據，已知不可比窗口 unknown；沒有事件證據時明列原始未還原價限制。
- [擴充 schema 使舊布林或其他條件失效] → additive 能力、舊路徑保持、版本化偏好、僅新分支啟用時檢查新 readiness，回歸 daily profile、legacy join 與 all／any。
- [紙上數字被理解為保證] → 分列外部反轉率與台股研究獲利數字、樣本及策略，明示不是本功能台股實測勝率。
- [大量窗口驗證造成讀取變慢] → 凍結小窗、單次嚴格校驗後只重用同一 immutable 物件，避免全市場重複 JOIN；DB／clone／hash 改變仍須驗證。

## Migration Plan

1. 先加入純函式與邊界 fixtures、metadata catalog；所有新條件維持停用。
2. additive schema／publisher 保存短窗完整 OHLC evidence，沿用正式背景輸入；不重置或覆寫原資料及失敗收據。
3. 加入唯讀 v9 query／status／分頁與安全 v8 preference migration，保留布林每日 profile。
4. 接上收合控制與結果證據，回歸既有圖表、清單及不產生交易副作用。
5. 真實本機 snapshot 逐股獨立重算、API 全分頁與 UI/network/console 證據成立後才宣稱功能完成；沒有符合實例也須核對正確零結果，不能製造成功案例。
6. 回退時停用／移除新入口，保留 v8 API、偏好原件與每日 profile；不刪 v9 原 evidence，也不把 v9 cursor 交給 v8 解釋。

## Open Questions

- 目前沒有阻擋規格建立的使用者選擇；上述數字為明確可調工程預設。
- 實作前需唯讀確認本機當期完整 OHLC 的來源能力及需要的 schema／路由接線，不能只因布林 head 發布成功便認定新能力 ready。
- 影片沒有完整逐字稿；刺透已核對章節畫面及引用研究原文，其餘未核實的台股報酬、期間或獲利數字不加入 catalog。後續若增加統計必須另核對原始研究口徑。
