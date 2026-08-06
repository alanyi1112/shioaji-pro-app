## 1. 建立可回歸的互動契約

- [x] 1.1 在 `tests/rendered-html.test.mjs` 與 `tests/subchart-interaction.test.mjs` 先加入失敗測試，鎖定 4 圖方式 A 2×2、4 圖方式 B 一列四欄、6／8 圖強制 A，以及多層模式 document 捲動 class 的 effective mode 規則。
- [x] 1.2 加入 page-scoped 單圖 URL 的建立／解析測試，涵蓋 canonical symbol、interval allowlist、tab fallback、重載、`noopener` 與不得把 1 圖寫入共用圖數偏好。
- [x] 1.3 加入群組排序互動測試，涵蓋擴大後的 header 啟動區、互動控制項與 chart 區排除、上下 edge zone、捲動後重新量測、合法 drop 單次提交及所有取消路徑清除 animation frame。

## 2. 雙擊在新分頁開啟單圖

- [x] 2.1 在 `public/static/app.js` 實作同源單圖 URL 建立與初始化解析，將有效 `view=single`、`symbol`、`interval`、`tab` 套用為該頁 runtime 的 1 圖狀態，並讓無效 query 安全 fallback。
- [x] 2.2 把 panel `dblclick` handler 改為在使用者手勢內以 `window.open(..., "_blank", "noopener")` 開啟目標單圖，排除表單、按鈕、連結、選單及拖曳中的事件，且不改變原分頁狀態。
- [x] 2.3 移除 `focusedPanelIndex`、同分頁聚焦／Escape 復原流程與相關 class／metadata，並把 Fixed Range Volume Profile 等單圖限定判斷改為依實際有效圖數 1 運作。
- [x] 2.4 驗證新分頁沿用目標商品的 `tabId + canonical symbol` 副圖偏好與籌碼選擇，但不覆寫其他分頁的圖表數量、頁碼、商品順序或 visible range。

## 3. 支援 4 圖多層副圖版面

- [x] 3.1 調整 `public/static/app.js` 的 effective mode 與模式控制：1／2／3／4 圖可切換 A／B，只有 6／8 圖強制 A，並保留使用者既有 `compactSubchartMode` 偏好。
- [x] 3.2 在 `public/static/styles.css` 與 layout class 更新中保留 4 圖方式 A 的 2×2，新增 4 圖方式 B 桌面一列四個等寬 panel、自然高度與單一 document 垂直捲動。
- [x] 3.3 套用四欄所需的緊湊 toolbar、header、readout 與價格軸規則，確保必要控制項可操作、文字可安全換行，且頁面不產生水平捲軸。
- [x] 3.4 在既定可讀性 breakpoint 以下讓 4 圖方式 B 改為單欄，並驗證切換 A／B、4→6／8→4 及 resize 後能正確清理／恢復 layout 與 pane lifecycle。

## 4. 修正群組拖曳與跨 viewport 排序

- [x] 4.1 在 `public/static/chip-panes.js` 與 `public/static/styles.css` 將群組專用把手及同一 header 的非互動標題／空白區設為可拖曳啟動區，保留清楚的 cursor、focus、選取外框、ghost 與 placeholder，且不讓單一 pane 或 chart canvas 變成排序單位。
- [x] 4.2 實作單一 `requestAnimationFrame` 拖曳 loop：依 pointer 與 viewport 上下 edge zone 的距離計算有上限的 `window.scrollBy` 速度，離開 edge、抵達 document 邊界或結束拖曳時立即停止。
- [x] 4.3 在 document 自動捲動後重新量測 group wrapper rect 與 drop threshold；拖曳中只更新 ghost／placeholder，合法 drop 才一次重排 DOM、同步 plot order、保存 `modeBGroupOrder` 並執行一次 layout refresh。
- [x] 4.4 將 Escape、`pointercancel`、buttons 歸零、blur、visibility change、resize、商品切換與模式切換整合到共同 cleanup，確認會取消 pending frame、保留原順序且不寫偏好、不 resize Canvas、不重新載入資料。
- [x] 4.5 保留群組內 canonical child order，以及右鍵／`ContextMenu` 鍵／`Shift+F10` 的上移與下移替代操作，並驗證每個 `tabId + canonical symbol` 的群組順序可獨立保存與重載。

## 5. 整體驗證與正式站驗收

- [x] 5.1 執行 `npm test`、`npm run lint`、`openspec validate --all --strict` 與 `git diff --check`，修正所有回歸且不得放寬既有測試門檻。
- [x] 5.2 在本機瀏覽器驗證桌面 3 圖 B、4 圖 A 2×2、4 圖 B 一列四欄、6／8 圖 A 與窄螢幕單欄；確認副圖完整可讀、只由 document 垂直捲動、沒有水平捲軸或 console error。
- [x] 5.3 在本機瀏覽器驗證多圖 panel 雙擊只開一個新分頁，新頁為正確商品／週期／頁籤的 1 圖，重載後仍正確，原頁狀態不變且新頁沒有 `window.opener`。
- [x] 5.4 在長頁面的頂部、中段與底部分別驗證群組向上及向下跨 viewport 拖曳、取消、右鍵／鍵盤替代操作與重載持久化；確認拖曳期間沒有額外 candles／籌碼請求或 Canvas 重建。
- [x] 5.5 完成 commit／push 與 Codex Sites 部署後，以已登入正式站重做 4 圖 A／B、新分頁單圖及群組拖曳 smoke，並保存可見 UI、live JS／API、deployment 與正式版本證據。

## 6. 多層副圖首次預設全選籌碼項目

- [x] 6.1 在 `tests/rendered-html.test.mjs` 加入失敗測試，鎖定未保存偏好時完整十項預設，以及既有部分選取／空選取不得被覆寫。
- [x] 6.2 在 `public/static/chip-panes.js` 將方式 B 預設改為全部十個 registry panes，並更新偏好版本；方式 A 預設維持單一三大法人合計。
- [x] 6.3 執行相關測試、完整 `npm test`、`npm run lint`、`openspec validate --all --strict` 與 `git diff --check`。
- [x] 6.4 在本機瀏覽器以無該商品籌碼偏好的狀態驗證多層副圖十項皆勾選，且既有偏好仍可保留。
