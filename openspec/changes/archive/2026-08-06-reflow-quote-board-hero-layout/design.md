## Context

`QuoteBoard` 目前把商品代碼與名稱包在 `symbolBlock`、最新價與漲跌停 badge 包在 `priceBlock`，再以獨立的 `changeBlock` 顯示漲跌與漲跌幅。`hero` 使用三個 `max-content` 欄位，當 `IX0001` 等指數的最新價較長時，三個欄位會在有限的 hero 軌道中競爭寬度，並侵入右側 `statGrid`。

自選清單的 row 已採用兩欄兩列 grid：左欄是商品代碼／名稱，右欄是最新價／漲跌資訊。這個模式能把長價格與漲跌資訊分到不同列，同時保留左右對齊。此 change 只處理 `QuoteBoard` 的展示層，不改變行情資料來源、格式化函式、判色語意或交易能力。

## Goals / Non-Goals

**Goals:**

- 讓商品資訊區採用「第一列代碼＋最新價、第二列名稱＋漲跌／漲跌幅」的兩欄兩列排列。
- 讓漲跌與漲跌幅在同一水平列右對齊，降低長數字造成的橫向競爭。
- 依個別 K 線圖容器寬度配置 hero 與摘要的空間，避免 hero 覆蓋 `statGrid`。
- 保留最新價、漲跌、漲跌幅、商品名稱、漲跌停 badge、既有字體倍率與顏色語意。
- 在指數、一般商品、特大字級、窄圖表及多圖不同寬度情境維持數字完整可讀。

**Non-Goals:**

- 不修改行情 API、Snapshot／Tick／Index 資料模型或數值格式化規則。
- 不修改右側四欄三列行情摘要的欄位順序、資料內容或判色規則。
- 不修改 K 棒、技術指標、成交量、watchlist、交易下單或 production／simulation 行為。
- 不以縮小到不可讀的字體、裁切、ellipsis 或假資料處理長數字。

## Decisions

### 1. 將 hero 改為扁平的四個 layout cells

`QuoteBoard` 的 hero 將直接放置商品代碼、最新價區塊、商品名稱與漲跌區塊四個子項，使用 CSS grid 自動形成兩列。這與 watchlist 的 DOM／CSS 語意一致，也讓左上與右上、左下與右下的對應關係清楚。

保留 `priceBlock` 以承載最新價與漲跌停 badge，但不再讓 `symbolBlock` 內含兩個 grid row；商品名稱改為 hero 的獨立 cell。替代方案是保留現有巢狀 wrapper 並用 `display: contents` 或複雜的 `grid-area`，但容易讓不同 breakpoint 下的 intrinsic sizing 失去可預期性，因此不採用。

### 2. 使用 `minmax(0, 1fr) auto` 的兩欄排列

hero 的左欄承擔代碼／名稱，允許在需要時回收閒置空間；右欄承擔最新價／漲跌，依內容提供足夠寬度。右側 cells 使用 `text-align: right`，漲跌區塊改為水平 flex，讓 `-214.90 -0.48%` 保持同一列。

所有 hero grid item 與文字區塊都設定 `min-width: 0` 或明確的 `white-space` 語意。數字使用既有 tabular numbers；商品名稱可在極窄空間以 ellipsis 保留版面，但價格、漲跌與漲跌幅不得裁切或省略。

### 3. 以 container query 控制降級

延續 `QuoteBoard` 外層的 `container-type: inline-size`。寬度足夠時，hero 與 `statGrid` 左右排列；中等寬度時上下排列；若 hero 本身無法安全維持兩欄，改為單欄堆疊並保持所有數字完整。這些 breakpoint 以 K 線圖容器為準，不使用整個 viewport 的 media query。

### 4. 以可見驗收確認實際尺寸

除了 TypeScript／unit tests，使用本機 simulation 以 `2330` 與 `IX0001` 驗證一般商品與長指數價格，並在約 `1499×821`、字體倍率 `1.3`、窄圖表、多圖不同寬度及 popout 情境檢查 hero 與摘要沒有重疊、水平溢位或數字遺失。

### 5. 寬版摘要回收欄內空白並保留呼吸間距

寬版 `boardLayout` 將 hero 與摘要調整為略偏向 hero 的比例，並以明確的 column gap 分隔兩區。`statGrid` 維持四欄語意，但 `statMetric` 在寬版改為以小 gap 緊接 label 與 value，不再用 `space-between` 把每個 metric 撐滿整欄；窄版恢復分散對齊，避免小容器的 label/value 擠在一起。這樣可回收摘要欄內的綠框空白，同時讓 hero 右緣與第一個摘要 metric 之間保留可辨識距離。

替代方案是把整個摘要 grid 靠右對齊並改為 `max-content` 欄位，但在不同數字長度與窄版 breakpoint 下容易產生過大的不均勻空白或溢位，因此只壓縮 metric 內部間距並調整兩大區域比例。

### 6. 摘要 metric 內部採標題左、數值右的兩欄 grid

每個 `statMetric` 使用 `max-content minmax(0, 1fr)` 兩欄 grid：標題欄依內容寬度固定在左側，數值欄填滿該 metric 的剩餘寬度並靠右對齊。這讓同一摘要欄跨三列的標題左界與數值右界形成穩定基準線，同時保留各 metric 之間已回收的緊湊間距。

替代方案是沿用 `flex-start` 或在窄版使用 `space-between`，但兩者會讓不同標題長度造成數值右界漂移，無法符合欄內上下列對齊的視覺需求，因此不採用。

## Risks / Trade-offs

- [兩欄 hero 在極窄容器仍可能沒有足夠空間] → 在 container breakpoint 降為單欄，並讓面板增加高度，優先保留數字完整性。
- [漲跌停 badge 增加最新價欄寬度] → badge 保持 compact、不可伸展，必要時隨 hero 一起進入窄版降級，不得把摘要推出面板。
- [商品名稱過長造成左欄擠壓] → 名稱允許 ellipsis；代碼與所有數字欄位不允許省略。
- [字體倍率放大造成 breakpoint 提早失效] → 使用 container query 與內容型欄位，並以 1.3 倍特大字級做實際驗收。

## Migration Plan

1. 先調整 `QuoteBoard` hero DOM，保留既有資料計算與 metrics mapping。
2. 更新 `quote-board.css.ts` 的 hero、symbol、price、change 尺寸與 container breakpoint。
3. 執行 `pnpm test`、`pnpm build`、OpenSpec strict validation 與 `git diff --check`。
4. 在本機 simulation 以一般商品／指數、標準／窄版、多圖與大字級完成可見驗收。
5. 若需回復，只需撤回 QuoteBoard hero markup 與局部樣式；沒有資料 migration 或 API 變更。

## Open Questions

無。漲停／跌停 badge 保留在最新價 cell，極窄容器以單欄 hero 作為安全降級。
