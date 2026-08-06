## Context

`QuoteBoard` 目前以單一 flex 容器承載商品資訊與行情摘要，摘要則用 `repeat(4, auto)` 依序放入獨立的 label/value spans。這使三組資料形成六個文字列，並以 `overflow: hidden` 隱藏無法容納的內容。`QuoteBoard` 對 high、low、bid、ask 等欄位直接指定 up/down 樣式；`KbarReadoutField` 只有格式化後文字，無法區分價位與成交量，也沒有可靠參考價契約。

現有 `ContractInfo.reference` 是非指數商品的參考價，指數即時資料另有 `index.reference`。這些資料可作為目前交易日／交易時段的權威基準，但 `Candle` 歷史資料只有 OHLCV，沒有逐日官方參考價。系統也允許 K 線圖縮至工作區 24 欄中的 6 欄，並提供多種字體倍率，因此無法在所有寬度同時保證固定三列與完整顯示。

## Goals / Non-Goals

**Goals:**

- 在寬度足夠時把非指數行情摘要壓縮為 4 欄 × 3 列，讓出更多 K 線圖高度。
- 以容器寬度而非整個 viewport 決定商品資訊區與行情摘要的排列。
- 在窄圖、大字體、獨立視窗及多圖配置中保留所有資訊，不以裁切或省略號隱藏數字。
- 以同一個純函式判斷價位相對參考價的 up/down/flat 狀態，套用到行情摘要、K 棒回報與最新價軸標籤。
- 對缺少可靠歷史參考價的 candle 採中性色降級，不用今天參考價錯判歷史資料。

**Non-Goals:**

- 不改變 K 棒本體依 open/close 決定漲跌色的規則。
- 不改變成交量柱、技術指標線、買賣操作、損益或市場家數統計的既有語意色彩。
- 不新增歷史官方參考價 API，不把前一根 candle close 冒充除權息後的官方參考價。
- 不改變 Shioaji 登入、行情訂閱、simulation/production 模式或交易權限。
- 不調整 OHLCV 聚合、forming candle、跨日分隔線或 indicator instance 的既有行為。

## Decisions

### 1. 使用共用 `priceDirection` 純函式

新增前端共用工具，把有限且有效的 `value` 與 `reference` 映射為 `up`、`down` 或 `flat`。`value > reference` 為 `up`、`value < reference` 為 `down`；相等、缺值、非有限數字或無效參考價一律為 `flat`。元件只把此語意狀態轉為 theme 的 `up/down/flat` 樣式。

這比各元件自行比較可避免 high 永遠紅、low 永遠綠或 bid/ask 依買賣側著色的錯誤。使用 theme token 也能在預設台股慣例呈現紅漲綠跌，並保留使用者主動選擇國際配色時的既有設定。

### 2. 以資料語意決定是否判色

行情摘要會用結構化 metric 定義每個欄位的 label、value 與 `kind`。只有 `kind: price` 呼叫 `priceDirection`；reference 欄位固定為 flat，volume/count/time 維持中性色，指數上漲／下跌家數則保留 category 語意色。

`KbarReadoutField` 增加可辨識的 field key 與原始數值，畫面只對 open/high/low/close/latest 等 price fields 套用方向，volume 與 time 不套用。這比解析已格式化字串可靠，也不改變目前格式化與 accessible label 契約。

### 3. 只對可證明屬於目前交易日的 K 棒使用目前參考價

目前資料模型沒有歷史逐日 reference。STK、IND、WRT 的 selected candle 只有在其台灣日期等於台灣今日日期時，才可使用目前權威 reference；其他日期保持 flat。FUT、OPT 因夜盤跨日與交易日歸屬資訊不足，本 change 僅在所選 candle 是最新 forming candle 且 reference 有效時判色，其餘保持 flat。

不採用「所有歷史 K 棒都和今天 reference 比較」，因為結果明顯錯誤；也不採用「前一根 close」，因為除權息、商品換月與夜盤 session 可能使它不等於官方參考價。未來若 API 提供逐交易日 reference，可替換 resolver 而不用修改顯示元件。

### 4. 使用外層 query container 與內層排版容器

`QuoteBoard` 外層設為 `container-type: inline-size`，內層才是實際 flex/grid 版面，讓 `@container` 能依每張圖的實際寬度調整。寬版時商品 hero 與摘要左右排列；摘要使用 4 欄 × 3 列。中版時 hero 與摘要上下排列但摘要仍維持四欄；窄版改為兩欄並增加列數。

每個 metric 以 `inline-flex` 綁定 label/value、使用 `white-space: nowrap` 與 tabular numbers。容器不得使用會裁切數值的 `overflow: hidden`；在極窄空間增加高度是可接受的必要取捨。

相較 viewport media query，container query 能正確處理同一 viewport 內同時存在不同寬度的 1、2、4、8 張圖與 popout。

### 5. 最新價軸標籤只改 price line 顏色

主 candlestick series 依最新價與可靠 reference 更新 `priceLineColor`，使右側最新價標籤和行情摘要一致。K 棒 body、wick、border 與 volume series 顏色不變，避免把「相對昨收」和「單根 K 棒開收方向」混為一談。

### 6. 特大字級優先回收固定軌道與間距

標準看盤在約 1500 CSS px viewport 時，K 線面板實際約 926px 寬。1.3 特大字級會把 `rem` 最小軌道同步放大；若 hero 的商品代碼與漲跌欄仍保留固定 `rem` 下限，最新價雖然有足夠實際空間，grid 卻只分配到過窄軌道，並把摘要最右欄推出面板。

因此中寬版仍維持 hero 與四欄摘要同列，但 hero 內部改以內容寬度配置商品代碼、最新價與漲跌，並縮減可伸縮的空白與 grid gap；摘要欄允許使用剩餘空間，不再用會隨根字級膨脹的 28rem 下限。字級放大且面板再縮窄時，使用字級感知的 container breakpoint 提前切換為上下排列或兩欄摘要。價格與摘要文字本身不得縮小、折行或省略。

## Risks / Trade-offs

- [極窄圖表無法維持固定三列] → 以資訊完整為最高優先，在 container breakpoint 改為兩欄多列，並用瀏覽器驗收確認沒有裁切。
- [特大字級放大 `rem` 軌道造成假性空間不足] → 以內容寬度和較小可伸縮間距回收黃色閒置區，並在約 1499×821 viewport 的標準看盤配置做回歸驗收。
- [歷史 K 棒缺少官方 reference] → 僅在可證明可靠時判色，其餘 flat；不製造看似精確的錯誤顏色。
- [指數摘要欄位和一般商品不同] → 共用 metric 模型但保留指數的 category colors，不把家數與價格 reference 比較。
- [高頻即時行情造成不必要 render] → `priceDirection` 為常數時間純函式，僅在既有行情 render/update 路徑計算，不新增訂閱或排程。
- [既有未提交工作重疊] → 僅修改本 change 涉及的局部區塊，套用 patch 前後檢查 diff，不覆寫其他 change 的程式。

## Migration Plan

1. 先新增純函式與單元測試，再讓 QuoteBoard 與 CandleChart 採用。
2. 重構 QuoteBoard DOM/CSS，保留既有資料來源、欄位內容與無資料 placeholder。
3. 擴充 Kbar readout field metadata 與 reference resolver，維持既有格式與排列。
4. 執行既有測試、TypeScript 檢查與 production build。
5. 在本機 simulation 以多種圖表寬度、字體倍率、主視窗與 popout 進行可見驗收。
6. 若需回復，可個別撤回 QuoteBoard 結構、CandleChart 判色與共用 helper；沒有資料 migration 或後端相依。

## Open Questions

無。歷史官方 reference 未提供時採中性色，作為本 change 的確定安全降級規則。
