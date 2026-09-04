## Context

MultiView 的籌碼副圖由 `apps/multiview/public/static/chip-panes.js` 建立 Lightweight Charts。為避免多商品、多層副圖同時保留數百個 Canvas 而讓技術副圖無法繪製，pane controller 目前使用 `IntersectionObserver`，只掛載距 viewport 垂直 240px 內的圖表；離屏時會執行 `chart.remove()` 並清空 chart surface，但保留 pane 標題、讀值、選取及最後 payload。

完整商品 panel PNG 由 `panel-image-export.js` 量測整個長 panel，等待兩個 animation frames 後交給 `html2canvas`。這個流程沒有通知籌碼 manager 準備離屏副圖，因此 clone 只能取得匯出瞬間仍存在的 Canvas。畫面中曾看過的融資券或持股線圖若已因捲動離開 viewport 而卸載，輸出就只剩一般 DOM 標題與讀值。現有測試分別確認虛擬化及匯出器程式碼存在，沒有執行兩者整合後的實際 Canvas 擷取。

本變更是純前端生命週期修正。既有完整 panel 尺寸、viewport-safe clone、本機 PNG、安全像素上限、右鍵入口、行情與籌碼資料契約都必須維持。

## Goals / Non-Goals

**Goals:**

- 從 panel 任一合法位置匯出時，完整 PNG 都包含該 panel 所有已選取且應顯示的籌碼副圖。
- 匯出期間只暫時增加目標 panel 的圖表資源，並在所有終止路徑精確還原。
- 匯出用副圖與主圖使用相同 viewport、共用游標日期、讀值及右側價格軸配置。
- 在 Canvas 尚未準備完成時有界等待；無法完成時禁止下載缺圖 PNG。
- 以可執行生命週期測試及瀏覽器 PNG 驗收取代只比對原始碼字串的假陽性證據。

**Non-Goals:**

- 不永久關閉 `IntersectionObserver`、不把所有商品的離屏副圖常駐掛載，也不單純放大 `rootMargin`。
- 不重新抓取行情或籌碼資料，不改變選取、群組順序、資料來源、D1 schema 或背景回補流程。
- 不改用伺服器端或第三方截圖服務，不上傳圖片、行情、cookie、token 或其他使用者資料。
- 不把未選取、隱藏或不適用的副圖加入 PNG，也不把明確「無資料」狀態偽造成有線圖。

## Decisions

### 1. 由籌碼 manager 提供 target-panel export lease

`createChipPaneManager()` 新增非公開全域、只屬於該 panel instance 的匯出準備介面。開始匯出時建立 generation-bound lease，記錄：

- 匯出前已掛載的 controller IDs。
- 當下應顯示的 ordered pane IDs。
- panel generation、symbol、interval 與目前 context identity。
- 目前主圖 accepted viewport 與共用游標時間。

lease 啟用期間，該 manager 的 `IntersectionObserver` callback 不得卸載 lease 所需 controller。manager 只掛載目標 panel 當下已選取且適用的 panes，不處理其他 panel。匯出結束後，lease 的 idempotent `release()` 只卸載原本未掛載的 controllers，保留原先掛載者，並恢復一般 observer 行為。

選擇 lease 而不是全域停用虛擬化，是為了讓資源增幅限制在單一匯出 panel，並讓成功、失敗、取消、切換商品與銷毀 panel 共用同一個 `finally` 清理契約。單純等待更多 animation frames 無法讓已被 `surface.replaceChildren()` 清除的 Canvas 回來，因此不採用。

### 2. controller 明確回報 export readiness，不以固定延遲或固定 Canvas 數猜測

每個匯出所需 controller 以最後已保留 payload 掛載並 render，接著套用 manager 傳入的 viewport、axis safe width 與共用游標／讀值。controller 應回報至少以下狀態：

- chart 已掛載且 context identity 仍與 lease 一致。
- chart surface 已完成非零 CSS 尺寸與 backing-store 尺寸的 Canvas 建立。
- 對具有合法 material data 且選取至少一個 series 的 pane，實際 series 已完成建立。
- 對明確不適用或資料 unavailable 的 pane，保留目前可見空狀態，不把它誤判成 Canvas 遺失。

manager 以 layout frame、paint frame 與有界 readiness 檢查等待繪製完成，不硬編 Lightweight Charts 目前每張 chart 產生的 Canvas 數量。若 signal abort、panel generation 改變、identity 改變或期限內仍未 ready，準備流程必須失敗。

固定 `setTimeout` 只能降低發生率，無法證明所有 panes 已完成 render；硬編 Canvas 數量則會被 Lightweight Charts 版本或圖層調整破壞，因此皆不採用。

### 3. app 協調 prepare、capture 與 release，既有 exporter 保持本機 renderer 邊界

`app.js` 的 `exportPanelPng()` 先向同 panel 的 `chipPaneManager` 取得 lease，確認 ready 後才呼叫 `QuoteChartPanelImageExporter.exportPanelImage()`，最後在 `finally` release。這裡同時保存 pointed date 與 accepted viewport，避免 export-time mount callback 被誤認為使用者 viewport 意圖。

`panel-image-export.js` 繼續負責完整尺寸量測、`html2canvas`、PNG Blob、下載與 object URL 清理；它不直接知道籌碼資料模型。可加入 `assertCaptureReady` 或等價 callback 作為最後閘門，但不得自行抓資料或操控其他 panel。

現有未進入正式 render path 的 `serializePanel()`／Canvas-to-image helper 不得再作為測試成功證據。實作可移除死碼，或保留為清楚標示且有真正呼叫者的 adapter；無論選擇何者，主要驗收必須執行實際 prepare/capture 生命週期。

### 4. 完整性檢查以 controller 狀態為主，PNG 像素驗收為發布證據

下載前的 runtime gate 以 manager/controller 的 expected-versus-ready 報告判斷，不以整張 PNG「非空白」推論成功，因為明確 unavailable 或零值資料可能合法呈現空 plot。若具有合法資料的 expected pane 缺少 chart、series 或有效 Canvas，匯出直接失敗，不呼叫下載。

瀏覽器驗收則解碼實際輸出的 PNG，依 pane bounds 比較 live chart 與匯出 plot 的代表性 series 顏色／非背景繪圖內容，並核對 pane 標題、順序及右側軸。這能抓到「DOM 存在但 Canvas 圖層消失」的回歸，也不把整張主圖有內容誤當所有副圖都成功。

### 5. 所有終止路徑共用精確還原

匯出 controller 或 lease 綁定既有 `AbortSignal` 與 panel generation。下列任一情況都必須走相同清理：成功、renderer 例外、readiness timeout、使用者再次匯出導致舊工作取消、切換商品／週期、切換版型、panel destroy 或頁籤卸載。

`release()` 必須可重複呼叫而不重複移除 chart；不得清除最後 payload、讀值、選取或群組順序。還原後 manager report 的 mounted controller 集合及 Canvas 數量應與匯出前一致；其他 panel 的集合從頭到尾不得改變。

## Risks / Trade-offs

- [Risk] 匯出期間單一 panel 暫時掛載所有已選副圖，可能增加 GPU／記憶體壓力。→ Mitigation：只處理目標 panel、沿用 PNG 像素上限、禁止並行匯出同一 panel，並驗證峰值及清理後 Canvas 數量。
- [Risk] 新掛載 pane 的 ResizeObserver 或 range callback 可能改寫主圖 viewport。→ Mitigation：整段 prepare 視為 programmatic lifecycle，使用既有 viewport coordinator 的 accepted range，並禁止 callback 成為使用者意圖。
- [Risk] 匯出時資料或 panel identity 正在切換，可能混入新舊商品。→ Mitigation：lease 綁定 generation、symbol、interval 與 context identity；任一值改變立即 abort 並禁止下載。
- [Risk] 像素檢查把合法無資料 pane 判成失敗。→ Mitigation：runtime gate 使用 controller 的 material availability 與 expected series，而非單純計算非背景像素；像素比較只用於具有已確認資料的 browser fixtures／商品。
- [Risk] 清理時 observer 狀態與捲動位置已改變。→ Mitigation：先恢復匯出前集合，再依最新 observer entry 或重新觀察結果進行下一輪一般 reconciliation，不永久保存過期 viewport 判斷。

## Migration Plan

1. 加入 controller export readiness 與 manager lease，先以模擬 IntersectionObserver 的測試證明掛載、失敗及還原。
2. 在 `app.js` 串接 prepare/capture/release，保留既有 exporter 尺寸、安全與下載契約。
3. 補上實際 DOM／Canvas 整合測試及 PNG browser acceptance，確認離屏融資券與持股副圖完整。
4. 更新 MultiView 靜態資產版本指紋，先於本機 5174 驗證；後續若另有明確部署授權，再依既有發布流程部署。
5. 若發生回歸，可回退靜態前端資產；本變更沒有資料 migration、背景工作或不可逆狀態。

## Open Questions

- 無。採用單一目標 panel 的有界 export lease，並以 controller readiness 作下載閘門。
