## Context

目前 panel template 將技術副圖與籌碼副圖拆成兩個工具列入口、兩個獨立畫面區塊。技術副圖固定占用 `indicator-wrap`，籌碼 pane manager 則把作用中的 pane 掛載到其下方的 `chip-pane-region`。因此方式 A 雖限制為一個籌碼 pane，畫面仍同時保留技術副圖並增加一列籌碼圖，與「單一副圖」語意不符。

這次只調整前端控制入口、呈現槽位與裝置端偏好；籌碼 API、D1 schema、上游 adapter、Sites secret 與資料正規化格式不變。

## Goals / Non-Goals

**Goals:**

- 每個 panel 的工具列只保留一個「副圖」入口，選單內清楚分組技術指標與籌碼資料。
- 方式 A 只有一個實際副圖槽位；技術副圖與單一籌碼 pane 互相替換，主圖下方不再產生額外列。
- 方式 B 維持技術副圖加多層籌碼 pane，並保留既有複選、排序、捲動及 request 共用行為。
- 分別保存方式 A 的作用種類／籌碼項目、方式 B 的技術指標與籌碼組合，切換圖數或模式不互相覆寫。
- 維持主圖、技術副圖與作用中籌碼 pane 的時間範圍、十字線、resize 與 lifecycle 同步。

**Non-Goals:**

- 不新增籌碼資料種類或修改 FinMind、TWSE、TPEx、TDCC 資料來源。
- 不變更主圖指標、K 線資料或後端 API contract。
- 不在本次加入八大行庫買賣超。

## Decisions

### 1. 合併為單一「副圖」選單

保留既有 `.sub-indicator-menu` 作為唯一 toolbar entry，在同一個 options 容器加入「技術指標」與「籌碼資料」兩個具可及名稱的群組。既有 `.sub-indicator` 與 `.chip-indicator` input class 保留，降低事件綁定與測試 contract 的改動範圍；獨立 `.chip-indicator-menu` 從 template 移除。

這個做法比新增二級彈出選單更適合目前緊湊 panel，鍵盤焦點仍沿用原生 `details`、`summary`、`label` 與 checkbox。

### 2. 方式 A 使用真正的共用副圖槽位

在主圖下方建立 `.subchart-slot`，內含既有技術 `indicator-wrap` 與籌碼 `chip-pane-region`。方式 A 以 `modeASlotKind = technical | chip` 決定同一時間只顯示其中一個：

- 操作任一技術指標選項時，作用種類切為 `technical`，保留既有技術指標複選組合並顯示同一張技術副圖。
- 操作任一籌碼選項時，作用種類切為 `chip`，沿用方式 A 單選語意，只掛載該籌碼 pane；技術副圖停止顯示但不清除勾選組合。
- 切換種類只重排／重建副圖槽位內容，不重建主 K 線或重新請求 candles。

既有偏好尚無 `modeASlotKind` 時採 `chip` 作為相容預設，讓原本方式 A 已選取的籌碼項目仍可見；使用者操作技術指標後即保存為 `technical`。

### 3. 方式 B 維持技術副圖加多層籌碼 stack

方式 B 的 `.subchart-slot` 同時顯示技術 `indicator-wrap` 與籌碼 stack。技術指標仍可多選並疊在既有技術 chart；籌碼項目仍依 registry 固定順序建立獨立 pane。超出可用高度時只在副圖槽位內捲動，不壓縮主圖。

### 4. 由 chip pane manager 保存 A 的作用種類

延伸既有以 `tabId + canonical symbol` 為鍵的 selection payload，新增 `modeASlotKind`，但保留原有 `modeAActivePaneId` 與 `modeBSelectedPaneIds`。manager 提供切換到技術槽位的方法，並透過 presentation callback 回報目前模式與槽位種類，讓 `app.js` 只負責套用 DOM class 與技術 chart 的顯示／resize。

當方式 A 為 `technical` 時，manager 的 desired pane 清單為空，因此不掛載籌碼 chart、不發出籌碼資料 request；切回 `chip` 時才恢復最後作用籌碼項目。方式 B 不使用 `modeASlotKind` 決定顯示，避免覆寫 A 偏好。

### 5. 同步與 lifecycle 只作用於實際可見 chart

主圖的 visible range、crosshair 與 resize 廣播仍送往所有作用中 controller；方式 A 被替換掉的 chart 必須退出作用清單或略過同步。切換 symbol、interval、panel 數量或銷毀 panel 時，既有 generation／abort 隔離規則維持不變，且不允許已隱藏籌碼 pane 的舊 response 回填。

## Risks / Trade-offs

- [方式 A 從籌碼切回技術時，技術 checkbox 是複選而非嚴格單選] → 方式 A 的「單一」定義為單一副圖槽位；技術 series 沿用既有同圖疊加行為，避免破壞 KD／ATR 等既有偏好。
- [舊版沒有保存作用種類] → migration 預設顯示既有 A 籌碼項目，並保留 B 組合；首次技術操作後寫入新欄位。
- [方式 B 多層內容可能使 panel 過高] → 把捲動限制在 `.subchart-slot`，主圖保持最低高度；A 不顯示 stack 捲動。
- [隱藏後 Lightweight Charts 尺寸可能為零] → 重新顯示技術或籌碼 chart 時明確觸發 resize，並在 browser QA 驗證 A/B、focus 與多圖切換。

## Migration Plan

1. 前端以相容讀取方式接受沒有 `modeASlotKind` 的 v1 payload，不清空既有選擇。
2. 發布新版靜態資產；不需 D1 migration 或 secret 變更。
3. 本機驗證後發布 Sites，使用已登入 session 驗證單一入口、A 替換、B 多層及 4／6／8 圖固定 A。
4. 若需回滾，只需回退前端資產；既有 payload 的新增欄位會被舊版忽略。

## Open Questions

無。
