## Context

目前主交易畫面的 Traditional Pivot 已具有版本化公式、1D-authoritative product projection、分鐘圖唯讀鏡像、標籤避碰與 autoscale，但仍以 `traditional-pivot` primitive instance 存在於通用指標 picker。三關價與 CDP 尚無純函式、狀態或 renderer；現有 Pivot reference day 又只有「後面出現下一個交易日才算 completed」的判定，盤後當日最後一根日 K 仍會被視為 provisional。

本 change 必須建立在 `align-chart-tools-and-add-multiview-minute-klines` 已歸檔並同步正式 spec 的狀態上。工作區可能同時存在多個 K 線 panel、快速切換商品及時框，所有投影必須沿用既有 Shioaji simulation 資料，不新增外部行情依賴，也不能攔截交易模式的圖表點擊。

## Goals / Non-Goals

**Goals:**

- 以工具列「壓撐」入口統一管理 PivotPoint、三關價與 CDP，並移除通用指標 picker 的重複 Pivot 入口。
- 讓三套公式使用相同、可測試且版本化的 reference OHLC，並由 1D 唯一管理自動／固定歷史 reference。
- 在台股盤中使用上一個完整交易日，收盤且資料有效後使用最後一根日 K；無法確認完整時保持 fail closed。
- 讓 1m、5m、15m、60m 與 1D 顯示同商品同一組 reference，並支援個別開關與最多十五條線的全域標籤避碰。
- 非破壞遷移既有 Traditional Pivot instance，保留啟用狀態且不產生重複線。

**Non-Goals:**

- 不改 MultiView 的 panel-local Pivot UI、週／月 K 或分鐘 K 資料管線。
- 不支援 FUT／OPT、夜盤或不同交易 session 的收盤規則。
- 不保存跨 reload 的歷史固定 reference，也不新增帳戶、下單或 production 權限。
- 不把壓撐價位自動轉成委託價格、警示或交易建議。

## Decisions

### 1. 建立共用 level-set contract，不複製三個 renderer

新增版本化的 `SupportResistanceProjection`，共同包含 product identity、reference OHLC／日期／完成狀態、formula id、formula version，以及排序後的 `{ id, label, price, role }` levels。PivotPoint、三關價與 CDP 各自只負責純計算，renderer、readout、清除與 autoscale 只接受 level-set collection。

這比為三個公式各建立 primitive 更適合，因為標籤避碰必須跨公式統一計算；若各自渲染，價格相近時仍會互相遮蔽。所有計算先保留公式精度，再沿用商品價格 formatter 顯示，不強制捨入為可委託 tick。

### 2. 固定三套公式與版本

- PivotPoint 沿用 `traditional-pivot-tw-v1`：`P=(H+L+C)/3`、`R1=2P-L`、`S1=2P-H`、`R2=P+(H-L)`、`S2=P-(H-L)`、`R3=R1+(H-L)`、`S3=S1-(H-L)`。
- 三關價使用 `three-level-price-tw-v1`：`UP=H+(H-L)×0.382`、`MID=(H+L)/2`、`DOWN=L-(H-L)×0.382`。
- CDP 使用 `cdp-wilder-tw-v1`：`CDP=(2C+H+L)/4`、`PT=H-L`、`AH=CDP+PT`、`NH=2CDP-L`、`NL=2CDP-H`、`AL=CDP-PT`。

每個純函式拒絕非有限值、`H<L` 或 `C` 不在 `[L,H]` 的 OHLC，並以固定 fixture 驗證順序與精度。替代方案是直接沿用第三方 runtime 程式，但會引入不可控版本與授權邊界，因此不採用。

### 3. 啟用狀態沿用 canonical indicator store，reference 改為 formula-independent product state

「壓撐」checkbox 仍透過版本化 canonical indicator store 保存，使同 origin panel／視窗沿用既有同步、寫入失敗與 migration 行為。reference state 的 key 改為 `security type + exchange + canonical code`，不含 timeframe、formula id 或 instance id；enabled formulas 只讀同一份 reference。

固定歷史 reference 只存在目前 document memory。最後一個 formula 被取消時，刪除該商品的 pinned state；reload 後 checkbox 可恢復，但 reference 重新依自動規則選擇。這延續現有 Pivot session lifecycle，避免把 provisional 或過期日期長期保存。

### 4. 以可注入時間的純 resolver 判定自動 reference

resolver 輸入 `Asia/Taipei` 現在時間、依交易日聚合的 raw 1m Kbars、資料載入狀態及 security type。STK／IND／WRT 採以下順序：

1. 最新資料日期早於台北今日日期時，該最新交易日視為已完成；可涵蓋開盤前、週末及休市日。
2. 最新資料日期等於今日且時間早於 13:35，今日視為 forming，使用前一個完整交易日。
3. 最新資料日期等於今日且時間到達 13:35 後，只有在本次 current-day Kbars 載入成功、OHLC 合法且資料來源未標示 unavailable 時，才採用今日最後一根日 K。
4. 任何日期倒序、資料錯誤、來源不可用或完整性無法證明時，退回前一個可證明完整的交易日；不得只靠 quote 價格補造日 K。

13:35 是涵蓋上市／上櫃個股可能延後至 13:33 收盤的保守邊界。resolver 不維護自行猜測的休市日曆，而以實際 Kbar 日期處理週末、休市與補行交易日。所有測試注入固定時間，不能依 CI 主機時鐘漂移。

### 5. 1D 唯一管理 reference 與 lifecycle

勾選第一個 formula 時立即建立自動 reference。只有在 1D 且為游標觀察模式時，使用者可啟動「固定歷史」並點選合法、已完成的日 K；三套 formula 同步改用該 OHLC。今天尚未完成的日 K 不可固定。`回到最新` 重新執行自動 resolver。

1m、5m、15m、60m 只訂閱同商品 state，不顯示會改變 reference 的控制；reference candle 不在分鐘資料窗時，線段起點夾到 plot 左側安全邊界。交易、停損、停利與警示模式保持優先，不能被壓撐選棒攔截。

### 6. 以單一 primitive 做跨公式標籤配置與清理

renderer 將所有已啟用 level sets 合併後，依 formula／role 固定排序並做一次 Y 軸標籤避碰。每個標籤包含公式縮寫、level 名稱與格式化價格，例如 `PP R1 2,481.67`、`三關 上 2,560.00`、`CDP AH 2,575.00`；位移後以短 connector 指回真實價格。色彩、線型與文字前綴共同辨識，不只依賴顏色。

autoscale 只納入目前 enabled 且有限的 levels。取消單一 formula 必須原子移除其線、標籤、readout 與 autoscale；切換商品／時框、較新 generation、unmount 或三項全關時必須清空舊 primitive data。

### 7. 以可重入 migration 移除重複 Pivot 入口

migration 將合法舊 `traditional-pivot` instance 映射為 `PivotPoint` checkbox：可見 instance 轉為勾選，hidden instance 轉為未勾選；完成新版 state 寫入前保留舊資料。若新版 state 已存在，以新版為準並移除 legacy duplicate。通用 indicator picker 不再列出 Traditional Pivot，但公式、fixture 與舊 id parser 可保留作 migration 使用。

若 localStorage 寫入失敗，沿用 canonical store 的 in-memory snapshot 與「設定尚未保存」提示，不刪除舊 key。回滾時可恢復 picker entry 並由保留的 legacy migration source 重建 Pivot instance。

## Risks / Trade-offs

- [三套公式同時啟用時最多十五條線造成畫面擁擠] → 共用標籤避碰、formula prefix、connector 與固定排序；不得隱藏或合併不同價格。
- [只以時間判定收盤可能遇到延後收盤或資料中斷] → 使用 13:35 保守邊界並同時要求 current-day Kbars 成功與合法；否則退回上一完整交易日。
- [active changes 同時修改 Pivot spec 造成 archive 衝突] → 實作前先 archive／sync `align-chart-tools-and-add-multiview-minute-klines`，再 rebase 本 change 的 delta 並 strict validate。
- [舊 Pivot 與新 PivotPoint 同時渲染] → migration idempotency、singleton normalization 與 renderer-level formula 去重測試。
- [多 panel 快速切換收到舊商品 projection] → product key、generation token、latest-wins refresh 與 unmount cleanup。
- [enabled checkbox 跨 reload，但固定日期不保存，可能讓使用者誤解] → UI readout 明示「自動」或「固定歷史」，reload 後固定狀態必須消失並重新標示自動 reference。

## Migration Plan

1. 歸檔並同步 `align-chart-tools-and-add-multiview-minute-klines`，重新檢查本 change 的 modified requirement 基準。
2. 先加入公式、reference resolver、projection contract 與 fixture tests，再抽象化既有 Pivot primitive。
3. 加入 formula-independent product state、canonical store schema 與可重入 Traditional Pivot migration。
4. 建立「壓撐」popover、1D 選棒／回到最新及分鐘圖唯讀 readout，移除 picker 的重複入口。
5. 執行 unit、component、browser、build、OpenSpec strict 與 `git diff --check`，再以 `127.0.0.1:5173` simulation 做盤中／盤後固定時鐘可見驗收。
6. 回滾時停用新版入口與 renderer、恢復 legacy picker mapping；不得停止既有 simulation API、watchdog、5173／5174 或行情連線。

## Open Questions

無。固定歷史 reference 採 document-session scope；MultiView、FUT／OPT、跨 reload pin 與自動交易動作均明確不在本 change。
