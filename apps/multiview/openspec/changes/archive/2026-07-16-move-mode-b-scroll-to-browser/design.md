## Context

目前桌面版 `body` 使用 `overflow: hidden`，`#chart-grid` 高度固定為扣除 topbar 的 `100vh`，每個 `.chart-panel` 再以 grid fraction 分配主圖與副圖高度。方式 B 雖會把技術副圖和所有已選籌碼 pane 掛載在同一 `.subchart-slot`，但 `.chip-pane-region` 使用 `overflow-y: auto`，因此內容超過固定 panel 時會在個別 panel 內產生垂直捲軸。

這個行為原本是為了讓多圖維持單一視窗，但使用者希望方式 B 仿照參考畫面，把所有副圖依序展開並由瀏覽器整頁捲動。現有模式政策仍限定 1／2／3 圖可用 B，4／6／8 圖與聚焦模式固定 A，因此可將長頁面版型嚴格限制在 effective mode B，不必改變大量多圖與聚焦行為。

## Goals / Non-Goals

**Goals:**

- 方式 B 的主圖、技術副圖與所有已選籌碼 pane 同時存在並自然向下排列。
- 桌面與窄螢幕只使用 `html/body` 的垂直頁面捲動，不在 panel 或籌碼區建立巢狀垂直捲動。
- 每個圖表維持可讀最低高度，新增或移除 pane 時讓 panel 與 document 高度自然增減。
- 方式 A、4／6／8 圖與聚焦模式維持固定視窗與單一共用副圖槽位。
- 版面高度改變後仍維持主圖、技術副圖與籌碼 pane 的 resize、visible range、crosshair 與 lifecycle 同步。

**Non-Goals:**

- 不開放 4／6／8 圖使用方式 B。
- 不改變 A／B 的保存偏好、籌碼選項固定順序或每個 pane 的資料與尺度語意。
- 不新增 pane 拖曳排序、折疊、虛擬化、sticky panel toolbar 或獨立高度調整控制。
- 不變更籌碼 API、D1 schema、資料來源、資料快取或秘密值管理。

## Decisions

### 1. 以明確版面狀態切換固定視窗與長頁面

由全域 effective mode 決定 `body`／`#chart-grid` 的版面狀態，方式 B 加上可測試的 page-scroll class；切到 A、4／6／8 圖或聚焦模式時移除。採明確 class 而非只依 `:has()` 推導，讓狀態切換、contract 測試與舊瀏覽器行為更可預測。

方式 A 繼續使用現有 `100vh` grid。方式 B 將 grid 與 panel 改為自然高度、auto row，並以 CSS variables／responsive `clamp()` 為主圖與技術副圖提供穩定的可讀基準高度；籌碼 pane 沿用既有最低高度。這能讓 page height 由真實 pane 數量決定，不必在 JavaScript 計算總高度。

替代方案是讓所有模式一律使用 document scroll，但會改變 4／6／8 圖與聚焦模式的一頁多圖體驗，因此不採用。

### 2. 方式 B 取消 panel 內垂直 overflow

在 page-scroll class 下，`.subchart-slot`、`.chip-pane-region` 與 `.chip-pane-stack` 都使用自然高度及可見 overflow；`body`／document 成為唯一垂直捲動容器。panel 仍可保留邊框圓角所需的裁切，但不得形成可捲動的內容區。頁面必須限制非預期的水平 overflow，避免窄 panel、價格軸或選單撐出瀏覽器水平捲軸。

1 圖會形成與參考畫面相同的單欄長圖；2／3 圖在寬螢幕維持並排，各 panel 依自己的已選 pane 自然增高，document 高度由同列最高 panel 決定。既有 breakpoint 下仍改為單欄，所有 panel 依序使用同一個瀏覽器捲軸。

替代方案是保留 panel 內捲動但把 scrollbar 樣式放到外側，仍會造成 wheel、touch 與閱讀位置被分割，不符合需求，因此不採用。

### 3. 垂直 wheel／touch 不得被副圖容器困住

移除 `overscroll-behavior: contain` 與 B 模式的內層 `overflow-y: auto`。本機瀏覽器驗收必須確認游標位於主圖、技術副圖或籌碼 canvas 上時，垂直 wheel／touch 仍能推進 document scroll。若 Lightweight Charts 預設手勢會攔截垂直頁面捲動，僅在方式 B 調整 `handleScroll`／touch 選項，保留水平拖曳、時間軸縮放與 crosshair；方式 A 不變。

### 4. 高度切換只 resize，不重建圖表與資料 request

既有主圖與籌碼 pane 已透過 `ResizeObserver` 監看 surface。切換 page-scroll class、增減 pane 或跨 breakpoint 時，沿用既有雙 `requestAnimationFrame`／延遲 refresh 策略觸發 `chart.resize()`、pane manager resize、價格軸寬度與 alignment 量測；不得為了高度變化重建 chart、重抓資料或重設 visible logical range。

切換 B → A 時先切換 class 與副圖 presentation，再 refresh 可見 chart；超出新 document 範圍的 scroll position 交由瀏覽器自然 clamp，不主動把使用者捲回頁首。返回 B 後仍恢復原本技術指標與完整籌碼勾選組合。

### 5. 以可觀察的捲動契約驗收

contract 與瀏覽器測試需同時驗證：方式 B 的 `document.scrollingElement.scrollHeight` 可隨 pane 增加而超過 viewport、`.chip-pane-region` 不具獨立垂直捲動、頁面沒有水平 overflow；方式 A 與 4／6／8 圖仍維持固定 grid。測試另需覆蓋 1／2／3 圖、窄螢幕、pane 增減、A／B 與聚焦切換、resize、wheel／touch、crosshair 及時間軸同步。

## Risks / Trade-offs

- [方式 B 勾選全部 pane 時頁面非常長] → 這是連續閱讀所有副圖的預期結果；保留固定順序與移除控制，不以內層捲動或壓縮掩蓋內容。
- [2／3 圖的 panel 選項不同會造成欄位高度不一致] → 各 panel 使用自然高度，document 以最高欄決定可捲範圍；不強制製造空白 pane 或跨 panel 對齊不同資料項目。
- [Lightweight Charts wheel 或 touch 攔截頁面捲動] → 加入真實瀏覽器手勢驗收，必要時只在 B 模式關閉垂直攔截並保留水平圖表操作。
- [切換 B／A 後 canvas 尺寸或價格軸不同步] → 依序切 class、套 presentation、執行既有多階段 refresh，並以 debug alignment report 與 screenshot 驗證。
- [長頁面同時掛載多個 canvas 增加記憶體與重繪成本] → B 仍只限 1／2／3 圖，沿用只建立已勾選 pane、dataset request 共用及取消 pane 即 destroy 的策略。
- [topbar 捲出畫面後切換模式較不方便] → 本次依參考畫面採自然頁面捲動；sticky topbar 屬獨立 UX 變更，不在本次範圍。

## Migration Plan

1. 先以 contract 測試固定 B 模式 page-scroll class、禁止內層 overflow 與 A 模式不變的要求。
2. 實作 CSS 長頁面版型及全域狀態 class，接續調整 resize／gesture 行為。
3. 依序驗收 1／2／3 圖 B、A、4／6／8 圖、聚焦與窄螢幕，再部署 Codex Sites。
4. 正式站確認瀏覽器捲軸、pane 順序、資料讀值與互動後完成變更。

若正式站出現阻斷問題，可回滾至前一個 Sites version；此變更沒有資料 migration 或不可逆狀態。

## Open Questions

無。sticky topbar、pane 折疊與自訂高度若日後需要，另立 change 評估。
