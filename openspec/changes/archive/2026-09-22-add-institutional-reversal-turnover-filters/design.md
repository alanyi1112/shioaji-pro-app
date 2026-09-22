## Context

收盤後選股目前以 v5 immutable snapshot 提供基本面、技術型態與籌碼條件。官方法人報表 adapter 已能解析 TWSE 外資欄位，但選股專用 `screener_chip_daily` 只保存投信；TPEx 歷史報表 parser 更直接把外資欄位設為 `null`。現有 D1 同時具有至少 130 個完整官方 OHLCV 交易日、已發行普通股數與至少 21 個交易日的法人 receipts，足以計算本次策略，但必須先以新 mapping 重新驗證並保存全市場外資欄位。

投信每日買賣超屬於流量，既有正式規格禁止把它累積成投信實際持股。故本設計把原提案中的「投信持股比例」替換成可由同日投信淨買超與成交量直接驗證的「投信成交參與率」，並額外用今日買超相對於前期累計賣超的「回補強度」描述反轉力道。

## Goals / Non-Goals

**Goals:**

- 在既有「籌碼／價量」分類提供外資與投信兩個可獨立啟用、可調參數且可解釋的連賣轉買複合條件。
- 以官方交易日序列明確切開今日與過去基準，所有必要輸入缺漏時 fail closed。
- 讓選股 canonical row、immutable snapshot、API evidence、偏好遷移與 UI 一起升級，並維持舊 v5 snapshot 可回復。
- 以 additive D1 migration 與重新驗證的官方報表補齊全市場外資資料，不借用局部圖表 cache。
- 保留每個子條件的原始日期、原始整數、單位、分母、公式版本及 verdict，支援代表性重算。

**Non-Goals:**

- 不提供或推算投信實際持股股數／比例，也不以「核心持股」、「初次認養」等存量名稱描述流量資料。
- 不建立盤中條件；本次只使用通過收盤後 publication gate 的 `effectiveSessionDate`。
- 不調整官方交易日、OHLCV、股本與既有投信累計買超占股本公式。
- 不觸發 Shioaji 訂閱、交易、自選清單寫入、行情服務啟停或 production 下單。
- 不用本次有限樣本宣稱投資績效或最佳化門檻。

## Decisions

### 1. 兩項策略是單一複合條件，內部固定 AND

新增 `foreignReversal` 與 `trustReversal` 兩個 criteria。每個 criteria 內的連續賣超、今日轉買、週轉率、相對週轉率、MA、相對成交量及流動性均須同時成立；投信條件另須通過回補強度與成交參與率。複合條件完成後才交給既有全域 `mode` 與其他條件做 AND／OR 組合。

替代方案是拆成十多個原子條件，但會讓使用者容易漏選策略必要分支，也會再次拉長條件面板，因此不採用。

### 2. 時間窗以 immutable snapshot 的官方 session index 定義

令 `D0 = effectiveSessionDate`：

- 前期連續賣超使用 `D-1 ... D-N`，預設 `N=3`，每一日 signed net shares 都必須嚴格 `< 0`。
- 今日法人轉買只使用 `D0`，門檻以 UI 張數乘以 1,000 後與 canonical shares 嚴格比較 `>`。
- 週轉率與成交量平均使用 `D-1 ... D-M`，預設 `M=5`，不得包含 `D0`。
- `SMA(P)` 採標準定義，使用 `D-(P-1) ... D0`，預設 `P=5`。
- 流動性平均使用 `D-1 ... D-L`，預設 `L=20`，平均成交股數須 `>= 最低張數 × 1,000`。

所有日期必須來自 snapshot 綁定的官方交易日序列；缺日、跳日、上市前、停牌或來源缺欄均保存明確 `unknown` reason，不壓縮序列。

### 3. 週轉率使用同一 snapshot 的已發行普通股數

`turnover(D) = volumeShares(D) / issuedCommonShares × 100`。今日週轉率必須嚴格大於可調最低值，並嚴格大於過去 M 日週轉率算術平均乘以可調倍數。分母須為 snapshot 綁定且不晚於 `D0` 生效的正整數；無效時為 `unknown`。

雖然固定分母下「週轉率大於平均兩倍」已蘊含「成交量大於平均」，API evidence 仍分開計算並回傳兩個子 verdict，因為這是使用者策略的顯式條件，也可避免未來股本分母版本變動時語意消失。

### 4. 投信持股條件改為回補強度與成交參與率

投信額外公式為：

- `recoveryPct = D0投信淨買超 / abs(sum(D-1 ... D-N 投信淨賣超)) × 100`，預設須 `>= 50%`。
- `participationPct = D0投信淨買超 / D0成交股數 × 100`，預設須嚴格 `> 1%` 且 `< 15%`。

UI、API、排序與 evidence 一律使用「回補強度」及「成交參與率」名稱。既有「N 日投信累計買超占已發行普通股數」保留為獨立條件，不重複包入本複合條件。有限本機資料只用於確認預設門檻不會機械性清空結果，不作績效宣稱。

### 5. 外資 canonical mapping 升版且不覆寫既有 provenance

新增 `foreign_buy_shares`、`foreign_sell_shares`、`foreign_net_shares` 與新 mapping 驗證欄位。TWSE 必須驗證一般外資與外資自營商各自 `buy - sell = net` 後再合計；TPEx 必須依已核對的歷史表群組位置取得「外資及陸資合計」買進、賣出及淨額，並驗證相等式。來源若缺欄或表頭漂移，該 market／date receipt 不得通過。

既有 receipt 的 payload hash 只能證明 v1 payload，不能證明新外資 mapping。migration 以新增 verification table／欄位保存 `receiptId + mappingVersion + payloadHash`；歷史日期必須重新取得來源並確認 report date、schema 與 hash。相同 payload 可連結既有 receipt，但不得直接把舊 normalization version 改寫成已驗證。

### 6. criteria、snapshot 與 API 升至 v6

新增 `CriteriaV6`、v5→v6 migration、v6 preference 與精確 fingerprint；v6 snapshot 以同一日期的已發布 v5 snapshot 為基礎，再嵌入法人反轉所需的相鄰 daily flow、OHLCV、issued shares 及逐公式 evidence。publisher 只有在兩市場所需外資／投信 mapping、v5 base、OHLCV 與股本全部對齊時才原子發布 v6。

UI 在 v6 已發布後使用 v6；v6 pending 或 rollback 時仍可保留 v5 畫面與最後合法 v5 snapshot，不得把 staging v6 當成 current。GET／排序／翻頁仍只讀 immutable snapshot，不得現場抓來源或重算全市場。

### 7. UI 延續精簡 accordion

兩項條件放在「籌碼／價量」，預設未啟用且收合。摘要列顯示法人、賣超日數、今日買超門檻與關鍵倍數；展開後以緊湊 grid 顯示可調參數。投信卡另外顯示回補強度與成交參與率，並以短說明明示「成交參與率不是持股比例」。既有「全部取消」必須涵蓋新條件。

## Risks / Trade-offs

- [外資 mapping 升版需要重抓歷史報表] → 以有界、可續跑、逐市場逐日期 targets 執行，保留 checkpoint、cooldown、Retry-After、來源日期與缺漏，不用舊 hash 假裝完成。
- [新複合條件欄位多，可能增加 UI 高度] → 沿用分類與單一 active condition accordion，摘要收合、編輯 grid 緊湊排列，不新增長篇常駐說明。
- [條件非常嚴格，部分日期結果可能為零] → 顯示 matched／fail／unknown 與逐子條件證據；不為了產生結果自動放寬使用者門檻。
- [投信成交參與率可能被誤認為持股] → 型別、API key、UI label、spec 與測試固定使用 `participationPct`／「成交參與率」，禁止 `ownership` 命名。
- [v6 發布被其他 v5 籌碼 gate 延遲] → 以 v5 published snapshot 為一致性基礎，寧可保留舊 v5 也不發布跨日期資料；health 明示 v6 pending 原因。
- [舊偏好 exact-key 驗證不接受新欄位] → 新增 v6 preference schema 與 deterministic v5→v6 migration，舊欄位保持原值，新條件預設關閉。

## Migration Plan

1. 先完成 v6 純函式、criteria validation／fingerprint、公式與 fixtures 測試，不接 live publication。
2. 套用 additive D1 migration，新增外資欄位與 mapping verification evidence；以 staging DB 驗證 schema、integrity 及既有個人資料 hash。
3. 啟用 v2 institutional normalizer，依目前 v6 必要歷史窗重新抓取 TWSE／TPEx 官方報表並可續跑回填；v1 rows 與 v5 publication head 保持不變。
4. 建立 staging v6 snapshot，核對全市場 target、processed、missing、unknown、日期、hash 與代表性公式重算後才原子發布。
5. 啟用 v6 route、gateway、偏好遷移與 UI；保留 v5 read path，完成瀏覽器及無副作用驗收。
6. 若 migration、backfill、coverage 或 UI 驗收失敗，停止 v6 publication 並讓 UI 回到最後合法 v5；不刪除或改寫 v5 snapshot、個人清單與行情狀態。

## Open Questions

無。投信實際持股來源明確不在本次範圍；若未來取得具授權、日期與全市場 coverage 的正式來源，必須另立 change。
