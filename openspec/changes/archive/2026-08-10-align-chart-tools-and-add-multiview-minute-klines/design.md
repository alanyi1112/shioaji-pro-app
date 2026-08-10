## Context

RealTimeStock 主交易畫面的 Pivot 由 `CandleChart` 直接把目前時框載入的 raw 1 分 K 依交易日分組，`pivotPinnedDateRef` 與 `pivotReferenceRef` 又以 `indicator id + 商品 + timeframe` 為 key。結果是同一商品在 1D 與分鐘圖可能選到不同 reference，且任何時框都能移除全域 indicator。現有 `PivotPrimitive` 只從下一交易日第一根 K 開始畫近似實線文字，沒有 MultiView 已具備的 reference projection map、P／R／S 線型、價格軸安全邊界、標籤避碰與 connector。

主交易畫面及 MultiView 的 Fibonacci resolver 目前都把 `event.altKey` 解讀為自由價位。這次需求只改「回撤」的 A／B 方向，不改拓展 C、保存 identity、清除 scope、公式或畫面層級。

本機 MultiView 的 worker、UI、URL、localStorage、batch 與 stream 目前共同封鎖分 K。程式內雖有 `intraday` 分時走勢骨架，但它把 Tick 顯示為成交價／均價折線，分鐘資料只保留 close、average price 與 volume，不能支援 Candlestick、Pivot、Fibonacci 或 OHLC 指標。Local Shioaji coordinator 已能一次取得指定商品當日 Kbars 並共用一條 SSE；新設計必須在 simulation 安全邊界內擴充為真正的分鐘 K，而不是恢復舊分時模式或啟用遠端 realtime。

## Goals / Non-Goals

**Goals:**

- 讓主交易畫面與 MultiView 對同一 Pivot fixture 產生一致的 Traditional 七線、reference／applies-to／status 及視覺角色。
- 讓主交易畫面由 1D 唯一管理 Pivot lifecycle，分鐘圖只鏡像同商品的 canonical projection。
- 讓兩個畫面的 Fibonacci retracement 在 Option／Alt 下採 A high、B low，且 preview 與 click commit 完全一致。
- 讓本機 MultiView 在既有日、週、月 K 之上提供 1m、5m、15m、60m，並在 simulation 中以 canonical 1 分 Kbars 加 Tick 更新分鐘 K。
- 保留多 panel 去重、generation/latest-wins、viewport、指標、註記、來源標示、fallback 與本機安全限制。

**Non-Goals:**

- 不更改 Traditional Pivot 公式、FUT／OPT 支援範圍或新增其他 Pivot 類型。
- 不讓分鐘圖單獨建立、刪除或覆寫主交易畫面的 Pivot。
- 不更改 Fibonacci 拓展的 Option／Alt 自由價位、公式、水準、色票、保存或清除 scope。
- 不把舊 `intraday` 成交價／均價折線改名冒充 1m K，也不要求保留為可選時框。
- 不啟用 production、真實下單、Cloudflare realtime、Sites 多帳戶或正式站部署／帳務驗收。
- 不把分鐘 K 無限制保存到 D1，也不新增外部市場資料依賴。

## Decisions

### 1. 以版本化 projection contract 與共用 fixture 對齊 Pivot，不建立跨 app runtime 耦合

主交易畫面採用與 MultiView `selected-next-period-v1` 等價的資料模型：reference period、status、applies-to、applicable period、七個 levels 與 target mapping。兩邊必須讀取同一組 fixture 並以相同精度驗證結果；實作可各留在原 app build boundary，避免讓根 Vite 與 nested vinext/worker 互相引用 runtime 檔案。

替代方案是讓主畫面直接 import `apps/multiview/worker/pivot-points.ts`，但這會把 worker 的 provider/timezone 型別與 Sites build 邊界帶入交易畫面，因此不採用。

### 2. 主交易畫面使用 product-scoped、1D-authoritative Pivot state

Pivot canonical key 使用 `indicator id + security type + exchange + canonical code`，不含 timeframe。canonical state 保存目前 reference key、reference candle time、status、applies-to 與 levels；1D 的建立、固定歷史、回到最新、隱藏及移除會更新這份 state。1m／5m／15m／60m 只能訂閱並渲染，不顯示會改變 canonical state 的控制。

Pivot instance 不再接受 `visibleTf` 排除任一支援時框。舊 instance 若保存 `visibleTf`，讀取時只針對 Pivot 正規化為所有支援時框；其他指標維持原規則。切換商品時按 product key 隔離，FUT／OPT 仍顯示不支援。

canonical selection 為目前 document state，不新增跨 reload 的歷史 pin schema；reload 後 indicator 啟用狀態仍由既有 indicator store 還原，projection 回到最後 completed reference。這與 MultiView 現有 selection lifecycle 一致，也避免把 provisional reference 保存成 completed。

### 3. 主交易畫面移植 MultiView 的 Pivot 呈現契約

七線從所選 reference candle 的 X 座標向右延伸到價格軸安全邊界。P、R1／S1、R2／S2、R3／S3 分別使用固定色彩與實線／強調／虛線／點線角色；標籤依固定排序避碰，若離開真實價格 Y 座標則加短 connector。autoscale helper 只納入所選七個有限價格，cleanup、切換與較新 generation 必須清空舊資料。

readout 顯示 reference、下一交易日、已完成／暫估與格式化七值，不再顯示英文 `completed`。如果分鐘圖載入範圍沒有 reference candle，投影值仍保留，起點夾到目前 plot 左側安全邊界並明確維持相同 reference，不得偷偷改用分鐘圖自己的最後完成日。

### 4. Fibonacci resolver 改為 kind-aware modifier policy

resolver 不再只接收 `freePrice: boolean`，而是接收可測試的 modifier policy。Retracement：一般 A=low、B=high；Option／Alt A=high、B=low，兩點都必須位於合法 K 棒，不能以 modifier 點未來空白區。Extension：維持一般 A=low、B=high、C=low／未來自由價位，Option／Alt 仍可使用 tick-size 正規化自由價位。

DOM 的 macOS Option 與 Windows Alt 都透過 `event.altKey` 判斷。pointer preview、price guide 與 click commit 必須呼叫同一 resolver；tooltip、pending notice、測試及兩份 OpenSpec 同步更新。

### 5. 本機 MultiView 採環境感知 interval allowlist

本機 `127.0.0.1:5174` 的 canonical API 值為 `1m`、`5m`、`15m`、`1h`、`1d`、`1wk`、`1mo`，UI 將 `1h` 顯示為 `60m`，並維持 `1wk`／`1mo` 顯示為週／月。本機舊 URL／localStorage 的合法週、月設定 MUST 原樣保留；只有 `intraday` 或其他非法 interval 正規化為 `1d`，且只覆寫 interval，不破壞商品、panel 順序或其他偏好。

Cloudflare／Sites 不套用這次本機 allowlist，也不要求重新部署或驗收；其既有 feature-off 行為維持。替代方案是同時開放 hosted Yahoo 分 K，但那會重新引入來源授權、保存、Free-tier 與正式站驗收，不符合本次範圍。

### 6. 1 分 Kbars 是 canonical 歷史，其他分鐘時框只做 session-aware 聚合

本機 page-scoped coordinator 依 `canonical symbol + start + end` 對 `/local-shioaji/api/v1/data/kbars` 做 single-flight 與有界記憶體 cache。預設歷史深度與主交易畫面一致：1m 3 日、5m 7 日、15m 30 日、60m 60 日；同商品多 panel 或切換時框重用已涵蓋的 1 分資料，不輪詢 Kbars。

1m 保留來源 OHLCV；5／15／60 分以 `Asia/Taipei` 交易日內 bucket 聚合，open 取第一筆、high／low 取極值、close 取最後一筆、volume 加總。bucket 不得跨交易日、午間或資料缺口製造假成交；輸出時間使用 bucket 第一個實際 minute。重送以 source time／sequence 去重，跨日先完成或清除前一 provisional bucket。

### 7. Tick 只更新目前未完成分鐘 bucket，且不得混接來源

Kbars bootstrap 後，接受的 Tick close 依來源時間更新目前 1m bucket：第一筆建立 open，high／low 取接受 Tick close 極值，close 取最新，volume 使用 total-volume delta 並避免與 bootstrap 重複。再由 canonical 1m 尾端重聚合目前 5／15／60 bucket。倒序、重送、舊 session、非法價格或負量一律拒絕。

Shioaji unavailable/stale 時，panel 原子切換到既有 Yahoo delayed payload並清楚標示來源；不得保留 Shioaji high／low 又混入 Yahoo close／volume。強制 Shioaji 模式則保留最後接受資料並顯示 unavailable，不靜默改稱即時。

### 8. 分鐘 K 沿用一般 Candlestick pipeline

新分鐘時框走既有 Candlestick、volume、indicator recompute、Pivot request、Fibonacci identity、history prepend、viewport coordinator、crosshair readout、跨日分隔與 panel export，不走 `is-intraday` 折線分支。Pivot 在 MultiView 仍維持 panel-local checkbox/reference selection，但 minute interval 的 reference rows 必須使用 daily-based OHLC，不能用單根分鐘 K。

## Risks / Trade-offs

- [多 panel 同時要求 60 日 1 分 K 可能增加本機 API 負載] → 使用 page-scoped range-covering single-flight/cache、八商品上限、response size guard 與無輪詢契約；先載入目前 panel，鄰近預取須受控。
- [Tick 首次落在尚未 bootstrap 的分鐘可能無法還原該分鐘完整 OHLC] → bootstrap 完成前保留 pending Tick，依 source time 合併後才發布；bootstrap 失敗則明確標示 partial，不宣稱完整。
- [分鐘圖範圍看不到 1D reference candle] → 保留 canonical levels 與 reference readout，將線段起點夾到左側 plot 邊界，不另選 reference。
- [多圖緊湊工具列可能壓縮時間週期文字] → 1／2／3／4／6／8 圖都保留足以顯示 1m／5m／15m／60m／日／週／月的固定 interval 欄寬，較長商品名稱才使用省略號。
- [兩份 Pivot／Fibonacci 實作再次漂移] → 固定版本字串、共用 fixture、跨實作 parity test，並同步 root 與 nested OpenSpec。
- [遠端部署誤開分鐘 K 或 realtime] → config 與 API 以 deployment target fail closed；驗收確認 production build 不新增 capability，不執行部署。

## Migration Plan

1. 先更新純函式、fixture 與 OpenSpec，建立 Pivot projection parity、Fibonacci modifier及分鐘聚合測試。
2. 改主交易畫面 Pivot canonical state／renderer，再以 simulation 驗證 1D 建立、四個分鐘時框鏡像及 1D 刪除。
3. 改兩邊 Fibonacci resolver 與可見文字，驗證 preview／commit 及 extension regression。
4. 加入本機 interval migration、1 分 history coordinator、分鐘聚合與 Tick 尾端更新，再接入一般 Candlestick pipeline。
5. 依序執行 root unit、browser、MultiView test/build/lint、root／nested OpenSpec strict、`git diff --check` 與本機 5173／5174 可見驗收。
6. 回滾時先停用新的本機 minute capability 並把本機 interval 正規化回 `1d`；保留既有日 K、indicator、Fibonacci storage 與 runtime，不停止 simulation API 或行情連線。

## Open Questions

無。依修正後決策，本機選單保留日／週／月並新增四個分鐘週期；Fibonacci 只修改 retracement modifier，Pivot 只由主交易畫面 1D 管理，遠端部署不納入本 change。
