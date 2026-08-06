## Context

目前產品已支援 1／2／3／4／6／8 圖與副圖方式 A／B，但 4 圖仍被強制為方式 A；4 圖既有版面則是 2×2。多圖面板的雙擊目前以 `focusedPanelIndex` 在原分頁切換成聚焦單圖，這會中斷原本多圖工作區。方式 B 的籌碼排序已改為三個資料群組整組排序，但只能從很小的把手起拖，且拖曳期間沒有 document 邊緣自動捲動，因此只能可靠地放到 viewport 內可見的群組位置。

這次變更同時調整三個彼此相依的前端互動：讓 4 圖可使用自然增高的多層副圖、把雙擊結果改為新分頁單圖，以及讓資料群組能跨越 viewport 完成排序。它不改變 Worker API、D1 schema、籌碼資料來源或群組內 canonical child order。

## Goals / Non-Goals

**Goals：**

- 讓 4 圖可切換「單一副圖」與「多層副圖」；桌面寬度下的多層副圖固定為一列四個等寬 panel，所有 panel 依內容自然增高並共用 document 垂直捲動。
- 保留 4 圖方式 A 的既有 2×2 固定視窗版面；6／8 圖仍固定方式 A。
- 使用者雙擊多圖中的商品 panel 時，在新分頁開啟同一商品、週期與頁籤的 1 圖畫面，原分頁的多圖狀態完全保留。
- 擴大籌碼資料群組的拖曳起點，並在拖曳接近 viewport 上下邊緣時自動捲動 document，使不可見的群組目標也能到達。
- 排序成功後只提交一次群組順序、一次必要 layout refresh，且不重新請求 pane 資料。

**Non-Goals：**

- 不提供單一籌碼 pane 的自由排序；群組內仍使用固定 canonical child order。
- 不改為單擊開啟新分頁，避免和圖表十字線、平移、縮放及其他控制操作衝突。
- 不讓 6／8 圖使用方式 B，也不重做 4 圖方式 A 的 2×2 版面。
- 不新增後端 API、D1 migration、行情或籌碼資料回補流程。
- 不在本次變更重新設計手機版；既有 breakpoint 以下維持單欄與 document 捲動。

## Decisions

### 1. 以 effective mode 決定 4 圖版面

副圖模式政策改為 1／2／3／4 圖可使用 A 或 B，只有 6／8 圖強制 A。4 圖方式 A 繼續套用既有 `grid-4` 2×2；4 圖方式 B 則加入專屬 layout class，在桌面寬度使用 `repeat(4, minmax(0, 1fr))`、單列及自然 row height。既有方式 B 的 page-scroll class 繼續負責移除固定 viewport 高度，讓 `html/body` 成為唯一垂直捲動容器。

不直接把所有 `grid-4` 改為四欄，因為那會破壞使用者仍需要的方式 A 2×2 版面。窄於既定多圖可讀性 breakpoint 時，4 圖方式 B 和 3 圖相同改為單欄。

### 2. 單圖新分頁使用 page-scoped URL state

雙擊 panel 時建立同源 URL，至少帶入 `view=single`、canonical `symbol`、允許的 `interval` 與穩定 `tab` 識別，再以 `window.open(url, "_blank", "noopener")` 開啟。新分頁初始化時先驗證 query：商品必須能對應目前商品目錄／頁籤，週期必須在 allowlist，頁籤不存在時使用安全 fallback。有效時只在該頁面的 runtime state 將圖表數量設為 1，不能把 `chartCount=1` 寫入共用 `localStorage`。

新分頁仍沿用該商品既有的副圖偏好與籌碼選擇，因為偏好鍵仍以 `tabId + canonical symbol` 保存。原分頁不修改圖數、捲動位置、頁碼、商品順序、圖表範圍或副圖狀態。

選擇 page-scoped query 而不是複製完整應用 state，是為了讓 URL 可重載、可測試，並避免兩個分頁互相覆寫圖數。URL 只表達「這個頁面以單圖開啟」與目標商品上下文；不承諾成為完整工作區分享格式。

### 3. 移除同分頁聚焦狀態

既有 `focusedPanelIndex`、聚焦 class、Escape 退出聚焦及其模式強制分支會被移除，雙擊只負責開新分頁。原本以「1 圖或聚焦」判斷的單圖限定能力，改為依實際有效圖數 1（包含 `view=single` 頁面）判斷。

保留舊聚焦狀態會產生兩套互相競爭的單圖路徑，也可能再次使 4 圖被誤判為方式 A，因此採明確移除，而不是只改事件 handler。

### 4. 群組 header 作為較大的拖曳啟動區

方式 B 的群組 wrapper 仍是唯一可排序單位。專用把手與同一群組 header 的非互動空白／標題區可啟動拖曳；checkbox、按鈕、連結、選單及 pane chart canvas 不得啟動排序。游標、可及名稱與 focus 樣式需讓滑鼠及鍵盤使用者辨識可排序範圍，右鍵及鍵盤的上移／下移替代操作維持不變。

這個範圍比只放大 22px 把手容易命中，但不會把整個 pane 或圖表區變成拖曳區，因此不會攔截圖表平移、十字線或觸控手勢。

### 5. 拖曳邊緣自動捲動使用單一 animation frame loop

pointer 位於 viewport 上方或下方 edge zone 時，拖曳控制器依接近邊緣的距離計算有上限的捲動速度，透過同一個 `requestAnimationFrame` loop 呼叫 `window.scrollBy`。離開 edge zone、到達 document 邊界、取消或 drop 時立即停止。每次 document 捲動後重新量測群組 rect／drop threshold，避免使用拖曳開始時的過期座標。

拖曳移動期間只更新 ghost、placeholder 與候選位置，不搬動實際 Canvas DOM、不 resize、不 load、不持久化。合法 drop 才一次重排 group wrappers、同步共用十字線 plot order、保存 `tabId + canonical symbol` 群組順序並做一次 layout refresh。Escape、`pointercancel`、buttons 歸零、blur、visibility change、resize、商品切換或模式切換都共用同一個 cleanup 路徑，並取消 pending animation frame。

### 6. 驗證以可見行為與資料流為準

單元／contract tests 覆蓋 URL 建立與解析、4 圖 effective mode、群組 drop 計算及 edge auto-scroll cleanup。瀏覽器驗收至少包含：4 圖 A 仍為 2×2、4 圖 B 為一列四欄且頁面垂直捲動、窄螢幕單欄、雙擊只開一個新分頁且原頁不變、新頁為正確 1 圖、群組由上往下及由下往上跨 viewport 排序、重載後順序保留，以及拖曳過程沒有額外籌碼請求或 console error。

### 7. 全選只作為未保存偏好的多層副圖預設

`DEFAULT_MODE_B_PANES` 使用完整 `CHIP_PANE_REGISTRY` 順序，讓適用台股商品首次進入方式 B 時，法人、融資券與大戶持股三群組的十個籌碼副圖全部勾選。若 `modeBSelectedPaneIds` 已存在，即使內容為部分選取或空陣列，也視為使用者明確偏好並原樣保留；切換方式 A、6／8 圖或升級版本不得重新全選。方式 A 的單一作用 pane 預設維持三大法人合計。

## Risks / Trade-offs

- **四欄下 panel 很窄：** 使用既有緊湊 toolbar／readout 規則並允許 header 自然換行；以實際 4 圖方式 B 截圖驗收，避免水平捲軸與控制項裁切。
- **雙擊可能同時觸發圖表互動：** 僅在 panel 非互動控制區的既有雙擊路徑處理，並明確排除 `select`、`button`、`input`、連結、menu 與拖曳中的事件；不新增單擊行為。
- **瀏覽器可能阻擋新分頁：** `window.open` 直接在使用者的 `dblclick` gesture 內同步呼叫；開啟失敗時不破壞原分頁狀態。
- **自動捲動造成 drop 位置跳動：** 每一 frame 重新量測可見 wrappers，速度設上限並在 document 邊界停止；drop 前以最後量測結果決定位置。
- **多分頁共享偏好：** 新頁只覆寫 page-scoped 圖數，不保存圖數；其他既有可共享偏好仍按現行規則運作。

## Migration Plan

本次沒有資料庫 migration。既有 `compactSubchartMode` 與群組順序偏好沿用；升級後 4 圖會依使用者已保存的 A／B 偏好決定 effective mode，6／8 圖仍覆寫為 A。舊版沒有 URL state 的書籤照常開啟一般工作區。若需 rollback，可恢復 4 圖強制 A、舊雙擊聚焦 handler 與無 auto-scroll 的排序控制器，不需轉換任何持久資料。

## Open Questions

無；4 圖排列、雙擊手勢、新分頁行為及群組層級排序範圍皆已確認。
