## Context

圖表 panel 由 `public/static/app.js` 建立主圖、技術副圖與共用十字線，`public/static/chip-panes.js` 管理籌碼 pane 的選取、建立、排序及 `localStorage` 偏好，`public/static/styles.css` 控制單一／多層副圖的高度。現況以 `<details>` 建立主圖與副圖選單，只會在另一個同層選單展開時互斥收合；方式 B 永遠保留技術副圖列；籌碼 pane 每次依 `CHIP_PANE_REGISTRY` 固定順序重新附加 DOM；共用垂直線則沒有位於 K 線橫軸的日期標籤。

本變更只調整瀏覽器端互動與偏好格式，不改動 Workers API、資料庫 schema 或市場資料計算。既有已完成但尚未歸檔的籌碼標題換行及 TDCC 明細 change 可能修改同一主規格，實作前必須以當時已同步的主規格保留其完整行為。

## Goals / Non-Goals

**Goals:**

- 讓主圖／副圖選單符合一般 popover 的外部點擊收合行為，且不破壞 checkbox 多選。
- 讓共用垂直游標在主 K 線橫軸顯示唯一、正確且不溢出的日期標籤。
- 沒有任何技術指標時不建立可見空白列，重新選取後可安全恢復同步。
- 精簡法人 pane 標題及移除標題列來源文字，但保留資料 provenance 供 API、狀態判斷與詳細資料使用。
- 讓方式 B 的已選籌碼 pane 可拖曳排序、可用鍵盤替代操作，並依 `tabId + canonical symbol` 持久化。

**Non-Goals:**

- 不改變單一副圖／多層副圖可用圖數政策、指標公式、資料欄位或右側數值軸。
- 不允許任意調整主 K 線、技術副圖與籌碼區三者的區塊層級；排序只作用於方式 B 的籌碼 panes。
- 不把資料來源從 response、健康狀態、右鍵詳細資料或除錯資訊移除。

## Decisions

### 1. 使用 panel-scoped 選單控制器處理外部點擊

`wireIndicatorMenus` 將回傳 cleanup，並以 capture phase 的 `document.pointerdown` 判斷左鍵事件是否落在目前開啟的 `<details>` 外。命中選單內部時保留開啟狀態，命中其他位置時收合該 panel 的主圖與副圖選單；`Escape` 與展開另一個選單仍沿用既有語意。panel 銷毀時移除 listener，避免重建後累積處理器。

不採用每個 checkbox 變更後強制關閉，因為副圖選單需要連續複選；也不採用只監聽 `click`，以免在 focus／pointer 時序完成後才收合而產生閃動。

### 2. 日期標籤沿用共用十字線狀態，以自訂 overlay 呈現

在 panel 增加單一 `.panel-crosshair-date`，由 `positionSharedCrosshair(time)` 使用 candle 的 `sessionDate`／chart time 產生 `YYYY-MM-DD`。標籤水平中心對齊共用垂直線，並限制在主圖 plot 的左右邊界與價格軸安全寬度內；垂直位置固定在 K 線主圖時間軸。`hideSharedCrosshair()`、無合法 candle、切換商品或銷毀 panel 時一併隱藏並清除文字。

不重新啟用各 Lightweight Charts instance 的原生垂直 crosshair label，因為多圖同步時會重新產生多條原生垂直線與多個日期標籤，破壞目前單一共用垂直線契約。

### 3. 技術副圖可見性由實際選取指標決定

以 `selectedSub.size > 0` 作為技術副圖是否存在的唯一條件。方式 B 沒有技術指標時，`.indicator-wrap` 隱藏且 grid 不保留 technical row；方式 A 作用種類為 technical 但沒有選取指標時，整個副圖槽位收合。重新勾選任一指標後才建立或恢復 indicator chart、resize、同步 visible range／crosshair 並恢復緊湊高度。隱藏狀態不得接收 resize、wheel routing 或 crosshair 更新。

取消最後一個指標時沿用現有 `renderIndicatorChart` lifecycle 移除 indicator chart instance；重新勾選後以已載入的 `lastPayload` 重建，不重新請求 candles。實際可見性與同步仍由 lifecycle gate 控制，panel 銷毀時沿用既有完整清理。

### 4. 選單名稱與 pane 顯示名稱分離

`CHIP_PANE_REGISTRY` 為四個法人項目保留描述完整的選單 label，但新增或沿用短 `title` 欄位，pane header 分別顯示「外資」、「投信」、「自營商」及「三大法人」。inline readout 不再建立來源 segment；來源仍保留在 payload、availability、診斷與允許顯示來源的右鍵詳細資料。

分離名稱可避免縮短選單後降低功能辨識度，也避免以 CSS 隱藏文字造成螢幕閱讀器仍讀出不一致內容。

### 5. 以穩定 pane ID 儲存自訂順序

selection schema 增加版本化的 `modeBPaneOrder`，內容為已知 pane ID 的完整排列。讀取舊偏好時，以既有已選 ID 順序起始，再補上 registry 尚未出現的 ID；未知或重複 ID 會被移除。`desiredPaneIds()` 與 `reconcile()` 改依保存順序建立／重新附加 pane。

每個方式 B pane header 提供專用拖曳把手，避免整個圖表拖曳與時間軸平移互相衝突。拖曳期間顯示來源與插入位置，成功放開只寫入一次偏好；`Escape`、`pointercancel`、視窗失焦或滑鼠按鍵已釋放時安全結束。右鍵功能表另提供「上移」與「下移」作為鍵盤及非拖曳替代操作，不增加常駐按鈕。方式 A 不顯示也不接受排序操作。

## Risks / Trade-offs

- [外部點擊 listener 在 panel 重建後重複註冊] → 控制器回傳 cleanup 並納入 panel `destroy()` 測試。
- [日期標籤在最左或最右 K 棒溢出 plot] → 使用 axis-safe plot bounds clamp，並在 resize／focus 後重新定位。
- [技術副圖收合造成 grid 高度與共用線量測競態] → class 切換後使用既有雙 `requestAnimationFrame` layout／alignment 排程重新量測。
- [拖曳與圖表平移、頁面捲動衝突] → 只有專用把手能啟動排序，拖曳期間才阻止必要的 pointer default。
- [舊偏好或新增 pane 造成排序遺失] → 以穩定 ID 正規化並把 registry 新項目補到末端，無法解析時回到 registry 順序。
- [其他尚未歸檔 change 修改相同 requirement] → 實作與歸檔前重新同步主規格，保留標題換行、顏色、TDCC 詳細資料與回補行為後再套用本 change。

## Migration Plan

1. 先同步並歸檔已完成且會修改相同籌碼副圖規格的 changes，重新核對本 delta spec 未覆蓋其行為。
2. 加入向後相容的 selection schema migration；首次讀取舊資料時只在下次選取或排序後寫入新欄位。
3. 部署前完成 Node、lint、build、OpenSpec strict validation 與實際瀏覽器互動驗收。
4. 若排序或版面發生回歸，可回退前端資產版本；舊 `modeBSelectedPaneIds` 仍可讀取，新增排序欄位不影響舊版。

## Open Questions

無。拖曳範圍限定於同一 panel 的方式 B 籌碼 panes，選單保留完整名稱、pane header 使用短名稱。
