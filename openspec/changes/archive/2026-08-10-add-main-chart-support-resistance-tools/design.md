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
- 讓台股普通股票與 ETF 的報價及漲跌價差依正式升降單位顯示必要小數位，並讓主要報價面板共用相同 formatter。

**Non-Goals:**

- 不改 MultiView 既有週／月 K、分鐘 K 資料管線、圖表數量配置或 panel-local 狀態邊界；只擴充「主圖」壓撐公式與共用 renderer。
- 不支援 FUT／OPT、夜盤或不同交易 session 的收盤規則。
- 不保存跨 reload 的歷史固定 reference，也不新增帳戶、下單或 production 權限。
- 不把壓撐價位自動轉成委託價格、警示或交易建議。
- 不改百分比固定兩位、技術指標衍生值、FUT／OPT／WRT 或非台股商品既有格式。

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

勾選第一個 formula 時立即建立自動 reference。任一 formula 已啟用且目前為 1D 游標觀察模式時，使用者直接點選合法、已完成的日 K 即固定該根 reference，三套 formula 同步改用該 OHLC，不再維護額外的「固定歷史」armed state。今天尚未完成的日 K 不可固定。`回到最新` 重新執行自動 resolver。

1m、5m、15m、60m 只訂閱同商品 state，不顯示會改變 reference 的控制；renderer 以 reference 的 `firstTime` 定位所選 K 棒並由該處向右畫線，只有 reference candle 不在分鐘資料窗時才把線段起點夾到 plot 左側安全邊界。交易、停損、停利與警示模式保持優先，不能被壓撐選棒攔截。

### 6. 以單一 primitive 做跨公式標籤配置與清理

renderer 將所有已啟用 level sets 合併後，依 formula／role 固定排序並做一次 Y 軸標籤避碰。每個右側標籤包含公式縮寫、level 名稱與格式化價格，例如 `PP R1 2,481.67`、`三關 上 2,560.00`、`CDP AH 2,575.00`；位移後以短 connector 指回真實價格。色彩、線型與文字前綴共同辨識，不只依賴顏色。左上角 readout 只保留共用 reference 的自動／固定歷史、日期、完成／unavailable 狀態與固定歷史時的「回到最新」，不再重複列出 level 值。

autoscale 只納入目前 enabled 且有限的 levels。取消單一 formula 必須原子移除其線、標籤、readout 與 autoscale；切換商品／時框、較新 generation、unmount 或三項全關時必須清空舊 primitive data。

### 7. 以可重入 migration 移除重複 Pivot 入口

migration 將合法舊 `traditional-pivot` instance 映射為 `PivotPoint` checkbox：可見 instance 轉為勾選，hidden instance 轉為未勾選；完成新版 state 寫入前保留舊資料。若新版 state 已存在，以新版為準並移除 legacy duplicate。通用 indicator picker 不再列出 Traditional Pivot，但公式、fixture 與舊 id parser 可保留作 migration 使用。

若 localStorage 寫入失敗，沿用 canonical store 的 in-memory snapshot 與「設定尚未保存」提示，不刪除舊 key。回滾時可恢復 picker entry 並由保留的 legacy migration source 重建 Pivot instance。

### 8. 公式整組樣式沿用 canonical instance styles

「壓撐」按鈕沿用「指標」按鈕的正常與 active 色彩、背景語言，只保留自身不帶 `margin-left: auto` 的版面差異，並額外以 `borderBright`／active accent 框線維持清楚邊界。PivotPoint、三關價與 CDP 每列右側提供設定圖示，開啟獨立且可取消的草稿對話框；每個公式以 canonical indicator instance 的 `styles.line` 保存 `color`、`width` 與 `lineStyle`，不另建 localStorage key。

公式未啟用時仍可建立 hidden instance 保存樣式；此操作不得勾選 checkbox。renderer 先套用公式預設的 role 色彩／線型，再以存在的整組自訂樣式覆蓋線、標籤及 connector。1D 與分鐘時框訂閱同一 canonical snapshot，因此樣式變更不觸碰 reference state 即可同步更新。

### 9. 壓撐按鈕直接參與 toolbar flex layout

「壓撐」按鈕不放在額外的 layout wrapper 內，而與「指標」同為 toolbar 的直接 flex child，確保兩者套用同一套 flex cross-axis stretch、字級、行高、內距與 border-box 尺寸。popover 仍以 toolbar 為 absolute positioning containing block；outside click 改以按鈕及 popover 各自的 ref 判定，避免為了事件邊界重新加入會改變按鈕幾何的 wrapper。

### 10. 樣式控制值不得跨越 SyntheticEvent 生命週期

顏色 input 與粗細／線型 select 的 handler 必須先從 `event.currentTarget` 複製 primitive value，再把該 value 傳入 functional state updater；updater 不得閉包引用 SyntheticEvent。粗細及線型在寫入 draft 前再次以 allowlist 驗證，非法 DOM 值直接忽略。browser regression 必須以與主程式相同的 React `StrictMode` 渲染三個公式對話框，逐一操作全部控制及離開路徑，避免測試環境因少一次 updater 執行而漏掉真實崩潰。

### 11. 台股報價精度以商品 metadata 與價位級距決定

建立 contract-aware formatter，僅對 TSE／OTC 的 STK 套用台股升降單位：普通股票依 `<10: 0.01`、`10–<50: 0.05`、`50–<100: 0.1`、`100–<500: 0.5`、`500–<1000: 1`、`≥1000: 5`；ETF 依 `<50: 0.01`、`≥50: 0.05`。ETF 優先使用 Shioaji canonical `category === "00"`，只有 category 缺失時才使用涵蓋英文字尾的代號 fallback，避免把已知非 ETF 誤判。

成交／委買／委賣等絕對價位以該價位所在級距決定小數位；漲跌價差以昨收所在級距決定，確保跨級距時仍符合該商品當日顯示精度。百分比維持兩位。formatter 必須集中供自選、排行榜、主報價摘要、五檔、逐筆成交與 tray 使用；非台股、非 STK 或 metadata 不足時沿用既有安全格式，不改下單 tick validation。

### 12. MultiView 沿用既有 Pivot reference carrier 並擴充公式集合

MultiView 不另建第二套選棒狀態。worker 在既有 `selected-next-period-v1` Pivot projection 中，以同一根合法 H／L／C 一併產生 `three-level-price-tw-v1` 與 `cdp-wilder-tw-v1` levels；既有 Traditional Pivot 欄位及 contract version 保持相容。前端只要任一壓撐公式已勾選，就沿用既有 `pivot=traditional` 載入與 stream carrier，並依目前 panel 的三個 checkbox 決定實際繪製哪些 level sets。

每個 MultiView panel 的 Pivot Point、三關價、CDP 在同一來源週期共用一份 reference key、anchor time、直接點選與「回到最新」狀態，但 checkbox 維持目前 MultiView 的 panel-local DOM state，不讀寫主交易畫面的 canonical indicator store。1m、5m、15m、60m 直接使用各自來源週期 K 棒；日、週、月分別沿用下一交易日／週／月投影契約，週與月選項不得移除或降級。

renderer 將 enabled formulas 展平成單一標籤避碰集合，線由所選 K 棒 anchor 向右延伸，右側標籤以 `PP`、`三關`、`CDP` 前綴顯示 level 與格式化價位。左上角只顯示共用 reference／適用期／完成狀態與「回到最新」，不重複列出任何公式 level 值。取消單一公式只移除該公式；三項全關才清除 reference、overlay 及 autoscale。

### 13. MultiView 以來源週期保存壓撐投影並向下繼承

每個 MultiView panel 以 `canonical symbol + source interval` 保存 document-session 內的 enabled formulas、reference projection、reference key、anchor 與 pinned 狀態；週期階層固定為 `月 > 週 > 日 > 60m > 15m > 5m > 1m`。來源投影只顯示在相同或更短週期，例如日線投影顯示於日、60m、15m、5m、1m，週線投影額外顯示於週，月線則顯示於全部週期。較短週期不得反向污染較長週期。

切換週期時，三個 checkbox 只還原目前來源週期自己的 enabled state，不代表目前畫面所有繼承線。取消、直接選棒及「回到最新」只更新目前來源週期；繼承自其他週期的投影必須回到該來源週期取消或重設。renderer 合併所有適用來源後一次處理線、標籤避碰與 autoscale，並在右側標籤加入來源週期，避免多組 `PP`、`三關`、`CDP` 無法辨識。

來源 K 棒在較短週期的 anchor 以該來源 K 棒涵蓋期間的第一根可見短週期 K 棒定位；若 reference 不在目前資料窗，才夾到 plot 左側安全邊界。狀態只保留於目前 panel document session，不寫入主交易畫面 canonical store，也不跨 panel；切換商品時以 canonical symbol 隔離，較晚返回的舊 generation 不得覆蓋目前商品或來源週期。

## Risks / Trade-offs

- [三套公式同時啟用時最多十五條線造成畫面擁擠] → 共用標籤避碰、formula prefix、connector 與固定排序；不得隱藏或合併不同價格。
- [只以時間判定收盤可能遇到延後收盤或資料中斷] → 使用 13:35 保守邊界並同時要求 current-day Kbars 成功與合法；否則退回上一完整交易日。
- [active changes 同時修改 Pivot spec 造成 archive 衝突] → 實作前先 archive／sync `align-chart-tools-and-add-multiview-minute-klines`，再 rebase 本 change 的 delta 並 strict validate。
- [舊 Pivot 與新 PivotPoint 同時渲染] → migration idempotency、singleton normalization 與 renderer-level formula 去重測試。
- [多 panel 快速切換收到舊商品 projection] → product key、generation token、latest-wins refresh 與 unmount cleanup。
- [enabled checkbox 跨 reload，但固定日期不保存，可能讓使用者誤解] → UI readout 明示「自動」或「固定歷史」，reload 後固定狀態必須消失並重新標示自動 reference。
- [單一自訂顏色降低 resistance／support 的預設角色辨識] → formula prefix、level label 與線型仍保留識別，設定對話框提供「恢復預設」並以公式整組套用語意明示影響範圍。
- [只看 `00` 代號前綴會漏掉或誤判 ETF] → canonical category 優先、代號只作 metadata 缺失 fallback，並用上市／上櫃及英文字尾 ETF fixture 驗證。
- [多個來源週期同時投影時標籤與控制語意混淆] → 右側標籤加入來源週期，checkbox／直接選棒／回到最新只管理目前來源週期，繼承線只能回來源週期取消。

## Migration Plan

1. 歸檔並同步 `align-chart-tools-and-add-multiview-minute-klines`，重新檢查本 change 的 modified requirement 基準。
2. 先加入公式、reference resolver、projection contract 與 fixture tests，再抽象化既有 Pivot primitive。
3. 加入 formula-independent product state、canonical store schema 與可重入 Traditional Pivot migration。
4. 建立「壓撐」popover、1D 選棒／回到最新及分鐘圖唯讀 readout，移除 picker 的重複入口。
5. 執行 unit、component、browser、build、OpenSpec strict 與 `git diff --check`，再以 `127.0.0.1:5173` simulation 做盤中／盤後固定時鐘可見驗收。
6. 回滾時停用新版入口與 renderer、恢復 legacy picker mapping；不得停止既有 simulation API、watchdog、5173／5174 或行情連線。

## Open Questions

無。固定歷史 reference 採 document-session scope；FUT／OPT、跨 reload pin 與自動交易動作均明確不在本 change。MultiView 僅擴充 panel-local 主圖壓撐公式，不與主交易畫面的 enabled state 或固定 reference 跨畫面同步。
