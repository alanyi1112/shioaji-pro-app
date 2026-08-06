## Context

目前籌碼副圖由 `public/static/chip-panes.js` 的 flat registry 建立，每個 pane 擁有自己的 Lightweight Charts Canvas、讀值、右鍵功能表與 lifecycle。方式 B 以 `modeBSelectedPaneIds` 與 `modeBPaneOrder` 保存單一 pane 的勾選與順序；拖曳每跨過一個 pane 中線就呼叫 `appendChild()` 重排實際 Canvas DOM，並透過 `onLayoutChange` 啟動 panel resize／axis 對齊工作，這是操作頓挫的主要來源。

目前只有 holder pane 建立詳細資料 DOM，且右鍵後以最新資料而非滑鼠指向日期產生內容。主圖與技術副圖沒有 panel 級右鍵功能表，也沒有完整 panel 的本機圖片匯出能力。這次變更只調整前端呈現、選擇偏好與本機匯出；台股籌碼 API、D1 schema、上游資料與 Sites runtime secret 均不變。

## Goals / Non-Goals

**Goals:**

- 將十個籌碼 panes 映射為三個固定資料群組，提供可存取的三態大項目與獨立子項目。
- 讓同群組的可見 panes 永遠相鄰、整組排序，並避免拖曳期間搬動實際 Canvas DOM 或反覆重算版面。
- 讓全部籌碼副圖能從指向日期開啟一致的前期比較詳細資料，沿用圖上色票與台股漲跌色。
- 讓任一商品 panel 可在瀏覽器內輸出包含完整可見主副圖的 PNG，且不將資料交給伺服器或第三方服務。
- 保留既有選取、A／B 模式、4／6／8 圖與聚焦模式政策、request cache、共用時間軸及 panel lifecycle。

**Non-Goals:**

- 不替 RSI、KD、MACD、ATR 技術副圖新增詳細資料表。
- 不允許在資料群組內自訂子項目順序，也不把同群組 panes 拆散排序。
- 不改變籌碼 API、D1 schema、官方資料來源、回補排程或資料頻率。
- 不把截圖上傳至 Sites、R2、外部圖片服務或 AI Agent，也不提供伺服器端截圖。
- 不截取整個網站、多個商品 panel、瀏覽器 chrome 或未顯示的副圖。

## Decisions

### 1. 使用明確群組 registry，不從 dataset 自動推論

新增穩定的群組定義，群組順序與內部 pane 順序如下：

1. `institutional`／「法人」：`foreign-flow-holding`、`investment-trust-flow`、`dealer-flow`、`institutional-total-flow`。
2. `margin-financing`／「融資券」：`margin`、`short`、`securities-lending`、`short-margin-ratio`。
3. `holder`／「大戶持股」：`big-holder`、`retail-holder`。

不依 dataset 分組，因為外資 pane 橫跨兩個 datasets，而借券與融資券屬於產品語意上的同群組但使用不同 dataset。群組 registry 與 pane registry 分離，pane registry 繼續作為資料、series 與 chart controller 的基礎。

### 2. 子項目仍是真實選取狀態，大項目由子項目推導

保留 `modeBSelectedPaneIds`，避免破壞既有偏好與 pane lifecycle。大項目 checked／indeterminate／unchecked 由群組內已選 pane 數量推導：全部為 checked、部分為 indeterminate、零個為 unchecked。點選 checked 大項目取消全部；點選 unchecked 或 indeterminate 大項目全選。

只有方式 B 的大項目可執行整組勾選。方式 A、4／6／8 圖與聚焦模式維持一次只顯示一個籌碼 pane；選單仍可按群組呈現子項目，但大項目不可觸發多 pane，並以 disabled 狀態與可存取說明提示「多層副圖可整組選取」。

不把全部十個 panes 設為新預設。沒有偏好的使用者仍採既有五個預設 panes；已有偏好者完整保留已選 pane IDs，再由新 registry 推導群組狀態。

### 3. 順序持久化提升為 group order，內部順序固定

偏好新增版本與 `modeBGroupOrder`。畫面順序由 `modeBGroupOrder` 展開各群組目前已選 pane IDs，再依群組 registry 的 canonical child order 排列。部分選取的群組只展開可見子項目，但仍視為一個可拖曳單位。

舊 `modeBPaneOrder` 遷移時，以每個群組第一個出現的已選 pane 位置決定群組相對順序，群組內改用 canonical order；無法辨識或尚未出現的群組依 registry 順序補在後方。保留舊欄位供降版回退讀取，但新版只以 group order 決定方式 B 排列。

### 4. 拖曳採 snapshot、ghost 與 placeholder，drop 前不搬 Canvas

每個有至少一個可見 pane 的群組建立 group wrapper 與單一群組拖曳把手。`pointerdown` 時一次量測所有可見 group rect，保存原始順序並建立：

- 涵蓋完整群組高度的選取外框。
- 跟隨 pointer 的輕量 ghost，只顯示群組名稱與可見 pane 數量。
- 與群組等高、具有清楚邊框與文字的 placeholder。

`pointermove` 只透過單一 `requestAnimationFrame` 更新 ghost transform 與 placeholder 目標，不呼叫 `appendChild()`、chart resize、axis measurement、資料 reload 或偏好寫入。`pointerup` 才一次提交 group order、重排 group wrappers、保存偏好並執行一次 layout refresh。Escape、`pointercancel`、blur、visibility change 或按鍵已釋放會移除預覽並保留原順序。

替代方案是繼續即時搬動 panes 並只增加節流，但 group 中可能含四個 Canvas，仍會造成 layout thrash，因此不採用。

### 5. 右鍵上移／下移與拖曳共用 group reorder primitive

方式 B 的任一籌碼 pane 右鍵「上移／下移」作用於所在資料群組，文字與 aria-label 明確標示整組移動。最前／最後群組的對應動作 disabled。移除副圖仍只移除該 pane；群組最後一個 pane 被移除後 group wrapper 才銷毀。

### 6. 建立所有籌碼 panes 共用的 detail model

將 pane series 名稱、色票、取值、formatter 與比較規則集中成 canonical metadata，圖形、header readout、右鍵 series 選單與詳細資料表共用，避免同一項目維護多份色票。詳細資料模型輸出：項目名稱、series 色、前一筆值、指向值、變化值、方向、兩筆實際日期及必要的來源／頻率註記。

滑鼠右鍵以 pane chart 的 `coordinateToTime(clientX - rect.left)` 取得指向 candle 日期並 pin 住；鍵盤 `ContextMenu`／`Shift+F10` 優先使用目前共用游標日期，沒有游標才使用最新合法日期。詳細資料開啟後不因 pointer leave 改回最新資料。

daily pane 以小於指向日期的最近一筆有效 row 作為前一交易日／前一筆有效資料。變化固定為 `指向值 - 前一筆值`。holder pane 不 forward-fill：以小於或等於指向日期的最近一筆 TDCC snapshot 作為當期，再取其前一筆實際發布 snapshot；表格明列指向日期、當期與前一期 `dataDate`。若指向日以前沒有當期或前一期，對應欄位顯示「無資料」或「首筆／無前期比較」。

詳細資料表固定欄序為「項目｜前一交易日／前一筆有效資料｜指向交易日｜變化」。增加為紅、減少為綠、零為中性色；項目標題使用 canonical series color。非數值的來源、頻率、官方級距與提醒使用中性色，不製造數值變化。

### 7. panel context menu 統一截圖入口，技術副圖可整列移除

`public/static/app.js` 為每個 `.chart-panel` 建立單一 panel context menu。主圖、toolbar、技術副圖、panel 空白與非籌碼區右鍵時顯示截圖操作；籌碼 pane 既有 context menu 直接加入同一個 callback，並繼續阻止事件冒泡，避免同時出現兩個選單。技術副圖只顯示 panel 截圖操作，不建立技術詳細資料。

panel context menu 會記錄開啟來源是否位於 `.indicator-wrap`。只有從可見技術副圖開啟時才顯示「移除副圖」；執行後一次取消該 panel 目前勾選的 RSI、KD、MACD、ATR，接著以既有 `applySubchartPresentation()` 與 `applyPayload()` 更新版面與 series。這個動作不變更籌碼副圖選取、資料群組順序或其他商品 panel。

### 8. 截圖使用本機 DOM／Canvas 序列化 adapter，不依賴遠端服務

新增獨立 client-side exporter。匯出時先保存指向日期與 readout、關閉右鍵選單並等待兩個 animation frames，接著以 `.chart-panel` 的實際寬度與完整 `scrollHeight` 建立離屏輸出：複製 panel DOM、把每個 Lightweight Charts Canvas 與 overlay Canvas 置換為同尺寸 data URL image、同步表單目前值與必要 computed styles，再以 SVG `foreignObject`／Canvas 轉成 PNG Blob。

匯出範圍排除 context menu、dialog、拖曳 ghost／placeholder 與標記為 `data-export-exclude` 的控制浮層。輸出解析度依 `devicePixelRatio` 提升但設定安全上限，避免十個 panes 造成超大 bitmap。以 object URL 觸發本機下載後立即 revoke；整個流程不得送出 fetch、Worker API 或第三方請求。若瀏覽器不支援或 Canvas 序列化失敗，保留頁面狀態並顯示可理解錯誤。

選擇自有 adapter 而非執行時 CDN，是為了避免第三方可用性與資料外流；若實作驗證證明既有瀏覽器無法可靠處理 `foreignObject`，可改用納入 lockfile 並由專案 build 封裝的 client-side library，但仍 MUST 維持零遠端上傳與相同 adapter contract。

實際的方式 B page-scroll 版面讓 `.chip-pane-region`、`.chip-pane-stack` 使用 `overflow: visible`，因此 `.chart-panel.scrollHeight` 可能只反映 grid 配置高度，而未包含溢出到 panel 邊界外的大戶／散戶持股比副圖。匯出尺寸 MUST 另外量測所有未排除且可見後代元素的 `getBoundingClientRect()`，取最右與最下繪製邊界和 panel 自身尺寸、`scrollWidth`／`scrollHeight` 的最大值。匯出 clone／renderer 再以這個完整尺寸展開 panel；若超過 Canvas 安全上限，優先等比例降低輸出倍率，無法產生至少 1 pixel 有效輸出時才明確失敗，絕不靜默裁切底部內容。

html2canvas 的 `windowHeight`／`windowWidth` MUST 保留擷取當下的瀏覽器 viewport，而不能改成完整輸出尺寸。主圖高度使用 `clamp(360px, 55vh, 620px)`；若 clone 的 viewport height 被改成長 panel 高度，主圖會在 clone 內膨脹並把後續籌碼 panes 推到既定 Canvas 底部之外，即使原始尺寸量測正確仍會裁切。Canvas 的 `height`／`width` 使用完整內容尺寸，CSS viewport 與 live 畫面保持一致，兩者必須分開處理。

## Risks / Trade-offs

- [Risk] 既有使用者曾把同群組 panes 交錯排序，群組化後無法完整保留單 pane 相對位置。→ Mitigation：以每組第一個可見 pane 的舊位置決定 group order，並在 migration 測試涵蓋交錯、缺值與重複 IDs。
- [Risk] group wrapper 或 placeholder 高度計算錯誤會造成跳動。→ Mitigation：拖曳開始時 snapshot 所有 rect，期間不接受選取或 layout mutation；resize、切換商品與模式時取消拖曳。
- [Risk] 完整多層 panel 的 PNG 可能超過瀏覽器 Canvas 尺寸或耗用大量記憶體。→ Mitigation：限制輸出倍率與最大像素、在匯出前估算尺寸，超限時使用可理解錯誤而非截斷內容。
- [Risk] SVG `foreignObject` 對 computed style、表單狀態或 Canvas 圖層支援不一致。→ Mitigation：以 adapter 隔離、明確置換 Canvas 與同步控制值，使用本機 Chrome／Safari 及正式站實際下載驗收；必要時換成本機 bundled library。
- [Risk] 右鍵點在週資料空白交易日可能被誤解為當日 TDCC 值。→ Mitigation：表格分開顯示指向日期、當期發布日與前一期發布日，不 forward-fill 至指向交易日。
- [Risk] 新增 group DOM 後共用十字線與右側數值軸可能失準。→ Mitigation：完成 drop 後只做一次既有 layout／alignment refresh，並延續小於等於 1 CSS px 的座標驗收。

## Migration Plan

1. 先加入純函式群組 registry、三態推導、group order normalization 與舊 pane order migration 測試。
2. 更新選單與偏好版本，但以相容讀取保留既有使用者選擇；確認方式 A 與強制單一模式不會整組開啟。
3. 以 group wrapper／ghost／placeholder 取代單 pane live DOM reorder，保留右鍵及取消 lifecycle。
4. 將 holder details 重構為共用 detail model，再逐一接上十個籌碼 panes 與指向日期。
5. 加入 panel context menu 與 image exporter，驗證完整長 panel、Canvas、表單值、指向 readout 與錯誤回復。
6. 完整測試後部署新的 owner-only Sites version；若發生回歸，可回滾至前一 Sites version。偏好保留舊 pane IDs，因此降版仍可讀取既有選取，僅忽略新 group order。

## Open Questions

- 無；技術副圖不提供詳細資料、詳細資料欄序、單一／多層模式邊界及既有偏好保留方式均已確認。
