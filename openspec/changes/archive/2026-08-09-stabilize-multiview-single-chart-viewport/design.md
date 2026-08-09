## Context

MultiView 的每個 panel 由 Lightweight Charts 主圖、技術副圖及零到多個籌碼副圖組成。這些 chart 目前都訂閱 `visibleLogicalRangeChange`，並透過 `setSynchronizedVisibleTimeRange` 互相同步；同步中的 callback 只以短暫的 `isSyncingTimeScale` 或兩個 animation frame 的 `rangeInputEnabled` 抑制。實際載入還會交錯發生 `autoSize`、`ResizeObserver`、`IntersectionObserver`、資料 `setData`、副圖 recovery 與非同步籌碼 render，因此程式性 callback 可能在抑制解除後才抵達，並被當成使用者 viewport 意圖。

本機以 `0050.TW` 日 K、1970×1280 viewport 重複開啟單一商品多層副圖時，8 次中有 3 次從正確的 `0–161` 漂成 `158–319`；最新 K 棒只落在約 16px，右側空白約 1866px。單一副圖固定尺寸連續 10 次正常，但載入期間由 640×520 放大到 1970×1280 時，6 次中有 5 次漂成約 `-383–161`，而既有 debug report 因只檢查右側留白仍回報通過。

## Goals / Non-Goals

**Goals:**

- 讓單一商品圖初次載入在單一副圖與多層副圖下都穩定顯示完整 canonical candles，並保留既定右側空間。
- 明確區分使用者 viewport 意圖與程式性 layout／data callback，避免任何 pane 以非使用者事件污染其他 pane。
- 所有 pane 在合法使用者平移或縮放後維持一致，且後續 resize、即時更新或副圖掛載不得重設使用者結果。
- 讓 debug report 與測試能辨識 K 棒貼左、貼右、過度縮小及首尾資料不可見，而不是只檢查右側 gap。

**Non-Goals:**

- 不改變 K 線資料數量、歷史補載、指標公式、籌碼資料來源或行情 API。
- 不改變多層副圖的一般 wheel 捲頁及 Alt／Option wheel 縮放契約。
- 不新增 viewport 的跨分頁或持久化保存。
- 不處理 RealTimeStock 5173 主交易圖表的 viewport；本 change 僅限 5174 MultiView。

## Decisions

### 1. 以 panel-local viewport coordinator 管理來源與最後接受範圍

每個 panel 建立一個小型 viewport coordinator，保存目前 generation、最後接受的 logical range、程式性同步深度及各 surface 的使用者互動狀態。所有主圖、技術副圖與籌碼副圖 range callback 都必須帶 source，交由 coordinator 判斷是否可發布；不再讓 callback 直接彼此呼叫。

選擇 panel-local 而非全頁 singleton，因為不同商品 panel 的 viewport 不應互相影響，且 panel destroy／rebuild 可直接讓舊 generation 失效。

### 2. 使用明確手勢授權，不以等待固定 frame 數推定使用者操作

主圖、技術副圖及籌碼副圖 surface 在 capture phase 追蹤 `pointerdown` 到 `pointerup`／`pointercancel` 的拖曳期間，以及可被圖表處理的 wheel 手勢。多層副圖未按 Alt／Option 的一般 wheel 只捲動頁面，不授權 viewport；被授權的 source 在有界手勢窗口內產生的 range 才能更新 coordinator。

替代方案是延長 `isSyncingTimeScale` 或 `rangeInputEnabled` 的 frame／timeout，但不同瀏覽器、資料速度和 pane 數量仍會改變 callback 順序，只會降低而無法消除競爭，因此不採用。

### 3. 程式性 mutation 一律包裝並回復最後接受範圍

資料套用、chart resize、副圖掛載、指標 recovery、歷史 prepend、即時更新及跨 pane 同步都經 coordinator 的 programmatic mutation API 執行。mutation 完成後以最後接受範圍同步所有目前已掛載 pane；晚到且沒有手勢授權的 callback 不發布，若它已改變 source chart，則在下一個 animation frame 有界回復最後接受範圍。

初次 payload 套用時，最後接受範圍設為 `0` 到 `candleCount - 1 + RIGHT_OFFSET_BARS`。歷史補載與即時新增 K 棒沿用既有時間錨點邏輯，並將計算後的合法保留範圍提交給 coordinator。

### 4. 初始 invariant 同時檢查資料覆蓋與視覺位置

在第一次使用者 viewport 手勢前，layout、資料或 pane 掛載 settle 後檢查：

- logical range 為有限值且與 `[0, candleCount - 1]` 有重疊；
- 第一根與最後一根 K 棒座標有限；
- canonical candles 在 plot 的可見寬度／邏輯跨度達到合理下限，不得只剩一、兩根貼邊；
- 最新 K 棒右側 gap 維持既定 2 根左右的容許區間。

若不符合，將 canonical 初始範圍重新套用全部 pane。使用者手勢一旦成立，初始化 self-heal 關閉；此後只回復 coordinator 已接受的使用者範圍，不回到全資料範圍。

### 5. 驗收採動態狀態機測試加本機瀏覽器重複測試

新增可執行的 coordinator 單元測試，模擬程式性 resize callback、延遲副圖 callback、合法 pointer／wheel 手勢及舊 generation。現有 source regex 可保留作 wiring 契約，但不得作為主要正確性證據。

本機 browser acceptance 使用 simulation／既有延遲行情，至少驗證 `0050.TW` 日 K：單一副圖固定與 resize、具有多個籌碼 pane 的多層副圖重複開啟、即時／批次更新後範圍不漂移，並以 debug report 核對首尾座標、可見佔比、右側 gap 及各 pane range。

## Risks / Trade-offs

- [手勢授權窗口太短，遺漏 Lightweight Charts 延遲 callback] → pointer drag 以完整 pointer lifecycle 授權，wheel 使用可重設的短 debounce，並以動態測試覆蓋 callback 延遲。
- [手勢授權窗口太長，誤收程式性 callback] → 授權綁定 source 與 generation；程式性 mutation 期間永遠優先抑制，不能只靠時間。
- [自我修復覆蓋使用者刻意縮放] → 初始 canonical self-heal 只在尚無使用者互動時啟用；互動後以最後接受的使用者 range 為回復目標。
- [未掛載籌碼 pane 之後出現時不同步] → mount／render 完成只能拉取 coordinator range，不得發布自己的初始 range。
- [既有測試只比對原始碼而產生假綠燈] → 新增執行狀態機與真實瀏覽器重複載入驗收，debug report 必須揭露 coverage invariant。

## Migration Plan

1. 先加入 coordinator 與單元測試，再逐步把主圖、技術副圖及籌碼副圖 callback 接入。
2. 保留既有 logical／time range 換算與歷史錨點功能，只替換 range 發布權限及程式性 mutation 邊界。
3. 以單一副圖、多層副圖與重複開啟 browser acceptance 驗證後，再執行 MultiView 全套測試與 OpenSpec strict validation。
4. 若回歸，可回退 coordinator wiring，原資料與使用者設定無需 migration；此 change 不修改持久化 schema。

## Open Questions

無。已用實際失敗範圍與單一／多層副圖時序確認實作邊界。
