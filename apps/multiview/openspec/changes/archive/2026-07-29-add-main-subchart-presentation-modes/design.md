## Context

目前頂端 `#compact-subchart-mode` 直接保存 `compactSubchartMode=A|B`，並同時負責市場資格、頁面捲動與每個 panel 的籌碼 pane 模式。任何非 B 值都會被 `effectiveCompactSubchartMode()`、`chart-interactions.js` 與 `chip-panes.js` 正規化為 A，因此若只在下拉選單新增第三個值，畫面可能隱藏副圖但背景仍建立 controller、取得籌碼資料並更新不可見圖表。

現有 `.chart-panel.has-no-subchart` 已能把副圖 grid row 收合為 0 並讓主圖使用剩餘高度，可沿用為「主圖」模式的版面基礎。方式 A／B 另有已保存的技術指標、單一籌碼 pane、方式 B 複選與群組順序，新增模式不得破壞這些狀態。

## Goals / Non-Goals

**Goals:**

- 建立語意清楚的 `main`／`single`／`multi` 呈現狀態，UI 顯示「主圖／單一副圖／多層副圖」。
- 首次預設 `single`，同時安全遷移既有 A／B 偏好。
- `main` 完全收合副圖並停止不可見副圖 lifecycle，不重新載入主圖 candles。
- 主圖與單一副圖適用所有市場；只有 multi 受台股資格限制。
- 三模式切換保留技術指標、籌碼 pane、series 與群組順序。

**Non-Goals:**

- 不變更 K 線、技術指標或籌碼資料的計算與 API contract。
- 不新增 D1 schema、帳號偏好同步或每個 panel 各自獨立的呈現模式。
- 不把規格與介面中真正指涉台股資料的「籌碼副圖」一律改名；只把頂端全域控制改為「主副圖」。
- 不清除既有 A／B 選取或把進入主圖模式視為取消勾選副圖。

## Decisions

### 1. 呈現模式使用語意值，A／B 只留在相容邊界

前端全域狀態改用 `main`、`single`、`multi`。`single` 在既有籌碼 manager 邊界映射為 A，`multi` 映射為 B；`main` 必須是獨立的無副圖狀態，不得被泛化成 A。相較新增 C 或讓所有非 B 值繼續落入 A，語意值可避免資格、CSS 與 lifecycle 判斷混淆。

### 2. 使用新偏好鍵並相容讀取舊 A／B

新增語意化、具版本界線的呈現模式偏好。讀取順序為：合法新值 → 舊 `compactSubchartMode` 的 A／B 映射 → `single`。使用者變更後寫入新值；舊 A／B 值可保留為 rollback 相容資訊，但不得優先於新值。既有已保存 B 的使用者仍進入 multi，只有從未保存偏好的裝置改為 single。

### 3. effective mode 與保存 preference 分離

`main` 與 `single` 對所有市場皆有效。保存 preference 為 `multi` 但目前是非台股或混合頁籤時，effective mode 暫時為 `single`，多層選項 disabled，但不得覆寫保存 preference；回到 eligible 台股後恢復 multi。受限頁籤的整個 select 保持可操作，讓使用者仍可主動選擇 main 或 single。

### 4. `main` 必須驅動真正的 none lifecycle

`chip-panes.js` 增加明確 none／suspended 模式：`desiredPaneIds()` 回傳空陣列、取消進行中 request／輪詢／拖曳、銷毀現有 controllers 與 group wrappers、清除提示，但保留 selection。`applySubchartPresentation()` 在 main 時強制 `has-no-subchart`、不 resize 或同步 indicator／chip charts，並停用 panel 的「副圖」設定入口。切回 single／multi 時重新依保存 selection 建立必要 controller，主 K 線與 candles lifecycle 不重建。

### 5. 沿用 `has-no-subchart`，不建立另一套主圖版型

主圖模式套用既有副圖列歸零規則，移除 B 的 document-scroll class，所有 1／2／3／4／6／8 圖維持原 grid。相較建立新的 panel template，沿用既有 grid row 可減少匯出、resize 與 breakpoint 分支。

### 6. 主圖模式停用 panel 內副圖選單

主圖模式下，panel 的「副圖」選單保持可見但不可展開，提供可存取的 disabled 狀態與「請先切換至單一副圖或多層副圖」提示。這比允許使用者變更不可見內容、或暗中自動切換全域模式更可預期；切回其他模式後恢復原有操作。

### 7. 驗收以狀態、請求與正式可見結果三層確認

契約測試確認選項、預設、migration 與 eligibility；互動測試確認 none lifecycle 不發出籌碼 request、切回後恢復；正式站確認各圖數主圖擴展、非台股仍可切 main／single、多層選項正確停用、cache-buster 已更新且 console 無錯誤。

## Risks / Trade-offs

- [舊 B 使用者不會看到新的 single 首次預設] → 預設只適用無偏好裝置，尊重既有明確偏好；測試同時涵蓋無值、A、B 與損毀值。
- [只用 CSS 隱藏造成背景請求] → manager 必須支援 none lifecycle，測試 controller count、AbortSignal、輪詢與 request 計數。
- [從 multi 切到受限市場時 select 值與保存值不同] → UI 顯示 effective single、保留 preference multi，返回 eligible 台股時恢復並以測試鎖定。
- [切回模式時大量 pane 同時重建] → 沿用既有 D1 cache、single-flight 與 selection registry，不重新請求主 candles。
- [主圖模式的 panel 副圖選單看似仍存在] → 套用明確 disabled 樣式、`aria-disabled` 與 tooltip，不隱藏控制造成工具列位移。

## Migration Plan

1. 新增三模式常數、偏好解析與舊 A／B migration 測試。
2. 更新頂端標籤、選項、資格控制與 cache-buster。
3. 擴充 panel presentation 與 chip pane manager 的 none lifecycle。
4. 更新 CSS、無障礙狀態、匯出及互動契約。
5. 執行完整測試、OpenSpec strict validation 與本機 browser-visible 驗收。
6. 發布 owner-only Sites 版本，以已登入正式站驗收三模式與 network／console。

回滾時可回復前端與資產版本；舊 `compactSubchartMode` 仍保留最後相容 A／B，因此回滾版本不會讀取未知的 main 值。

## Open Questions

無。
