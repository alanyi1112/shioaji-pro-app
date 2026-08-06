## Context

多層副圖目前以 `.chip-pane-header` 的 flex wrap 與 `.chip-pane` 的 auto row 呈現完整 inline readout。`renderInlineReadout()` 在每次共用 crosshair frame 以 `replaceChildren()` 置換日期及 segments；完整資料、部分資料、TDCC 非發布日與最近一筆參考的 segment 數量及文字寬度不同，因此瀏覽器會重新計算換行列數，連帶改變 pane 與 panel 高度。後續 pane 的螢幕 Y 座標會累積偏移，四圖相同 pane 的橫向邊界也可能失去對齊。

現行 `taiwan-stock-chip-subcharts` 主規格將這種逐次自然增高列為必要行為，本 change 必須先修改 contract，再調整 `chip-panes.js`、`styles.css` 與 `app.js` 的版面協調。資料 API、D1、series 數值與 crosshair 日期解析均不在此次問題範圍。

## Goals / Non-Goals

**Goals:**

- 讓完整資料、部分資料、無資料、首筆比較與 TDCC 最近一筆等 readout 狀態在共用游標移動期間共用穩定幾何高度。
- 保留所有日期、欄位、方向、狀態、色票及原順序，並允許依 panel 寬度安全換行。
- 將高度量測與協調移出 pointer/crosshair 熱路徑，只在資料或 layout-affecting 狀態改變時執行。
- 在副圖配置相容的同列多圖 panel 間，同步相同 pane identity 的保留高度，避免橫向邊界因商品數字長度不同而錯位。
- 維持 chart 區至少 64 CSS px、document 單一垂直捲動、共用十字線 X 軸誤差不超過 1 CSS px，以及既有 lazy mount／cleanup contract。

**Non-Goals:**

- 不縮短、隱藏或省略既有 readout 欄位。
- 不改成浮動 tooltip、橫向捲動或獨立 pane 捲動。
- 不修改行情或籌碼資料來源、API payload、D1 schema、cache、stream 或 backfill。
- 不開放 6／8 圖多層副圖，也不改變方式 A 的單一副圖政策。
- 不強制對齊 pane 選取、順序或前置 pane identity 不相容的 panel。

## Decisions

### 1. 以 layout signature 管理穩定高度週期

每個 pane controller 維護一個 layout signature，至少包含 presentation mode、pane 可用寬度、字型／zoom 後的 computed style、目前 series 選取、資料狀態族群及 holder 級距。signature 未改變時，共用游標只能更新 readout DOM 的文字、class 與 CSS variable，不得重新量測或改寫保留高度。

signature 只在 payload、圖數／panel 寬度、responsive breakpoint、series、holder 級距、pane 顯示組合或字型尺寸改變時失效。失效後使用單一排程 frame 重算，避免同一次 reconcile 反覆觸發 layout。

相較於硬編碼各 pane 的 pixel 高度，layout signature 能涵蓋 1／2／3／4 圖、不同 viewport、瀏覽器縮放與使用者 series 設定；相較於每次 pointer move 量測，則可避免 forced layout 與視覺跳動。

### 2. 以有界的最大 readout envelope 取得保留高度

controller 先從目前 payload 建立 readout envelope，而不是逐日期建立大量量測 DOM。對固定順序的每個 segment，掃描目前載入資料取得格式化後的最大文字寬度候選，組成一份保守的完整資料 readout；另納入部分資料、`無資料`、`當日無資料`、`最近一筆`、`首筆／無前期比較` 等結構不同候選。

所有候選使用一個套用實際 pane 寬度與 computed style 的隱藏 measurer 量測，只保留最大 block size。保留高度必須是該 layout signature 下的上界，而不是只採目前最新值高度；因此從最新完整值移到舊日缺值，或從缺值移回完整值，都不會觸發幾何變動。

readout region 使用明確的 reserved block size／CSS variable。外層 header 仍可包含標題、狀態與 holder 級距控制；這些非 crosshair 元素只有在自身 layout-affecting 狀態改變時才參與重新計算。量測器不得常駐可及性樹、不得建立水平捲動，也不得被完整 panel PNG 匯出。

### 3. crosshair 更新採內容-only 路徑

`showReadout(time)`、`restoreLatestReadout()` 與 `positionSharedCrosshair()` 保留既有資料解析及 requestAnimationFrame 節流，但 readout 更新不得呼叫 `getBoundingClientRect()`、`scrollHeight`、`offsetHeight`、chart resize 或 reservation coordinator。更新後的實際 header、pane、後續 pane top 與 panel document height，在同一 layout signature 內必須維持不變。

若開發期偵測到內容超出已計算 envelope，視為 reservation 演算法錯誤並由測試攔截，不以 pointer path 即時擴高作為正常 fallback，避免把跳動問題藏到少見資料。

### 4. 相容多圖 panel 使用兩階段高度協調

每個 panel 先回報本地 pane reservation；panel coordinator 再針對同一 CSS grid row、相同 pane identity、相同 pane 順序前綴與相容控制配置的 panel，套用該 cohort 的最大值。如此可讓四圖預設相同副圖配置保持橫向邊界對齊，又不會因某個 panel 少選 pane、改過群組順序或改變 holder 控制而錯誤拉齊。

協調採「先移除舊 override 並量本地值，再一次套用 cohort 最大值」的兩階段流程，避免 ResizeObserver 回授循環。panel 被移除、切換頁面／商品、變更圖數或離開多層副圖時，必須清除 cohort registration 與 CSS override。

### 5. 幾何測試以實際 DOM 數值為準

source contract 測試只驗證 reservation API、CSS 結構與 pointer 熱路徑禁用量測；瀏覽器驗收必須逐一記錄 header height、pane height、下一個 pane top、panel height 及 crosshair X 座標。完整／部分／缺值／TDCC 非發布日往返時，前述 Y 向幾何差異均不得超過 1 CSS px。

1／2／3／4 圖需分別驗證；6／8 圖則驗證仍固定為單一副圖且未誤啟用本協調器。series、holder 級距與 viewport resize 可合法觸發一次 reservation 重算，但重算完成後的 pointer movement 必須再次保持穩定。

## Risks / Trade-offs

- [保守 envelope 造成少量空白] → 只保留目前 layout signature 所需最大值，並在真正 layout 變更時重算，不使用全站單一最大高度。
- [最大字串組合仍低估特殊換行] → 將所有結構不同狀態納入候選，對每個 segment 使用 payload 中格式化後的最大寬度，並以瀏覽器極端長數字 fixture 驗證上界。
- [量測造成載入期 layout 成本] → 每個 pane／signature 只用共用隱藏 measurer 做有界候選量測，集中於單一 frame，禁止在 crosshair frame 執行。
- [跨 panel 同步形成 ResizeObserver 迴圈] → 分離 local measurement 與 cohort override，對相同值不重寫，並在 coordinator frame 內批次套用。
- [不同 pane 配置被錯誤拉齊] → cohort key 納入 grid row、pane identity、順序前綴與控制配置；不相容時各 panel 獨立穩定。
- [固定 reservation 影響方式 A] → 方式 A 僅套用單一槽位內的本地 reservation，不加入多 panel cohort，也不改變固定副圖槽位高度政策。

## Migration Plan

1. 先加入 readout envelope／layout signature 的純函式與單元測試，不改現有顯示。
2. 導入單 pane reservation 與 CSS block-size，驗證完整、缺值與 TDCC 狀態不再改變幾何。
3. 將 reservation invalidation 接到 payload、series、級距與 responsive layout 事件，確認 pointer path 不包含量測或 resize。
4. 加入相容 panel cohort 協調與 cleanup，完成 1／2／3／4 圖瀏覽器驗收。
5. 先發布 Sites 保留站驗收，再以同一 exact commit 發布 Cloudflare 正式站；若出現裁切或 layout loop，回滾該版本即可，資料與 D1 無 migration。

## Open Questions

- 無。若實作量測顯示跨 panel cohort 帶來不可接受的複雜度，仍不得降低單 pane 游標幾何穩定門檻；應保留單 pane reservation，並把跨 panel 對齊拆成後續 change，而不是回退成 pointer-time 自然增高。
