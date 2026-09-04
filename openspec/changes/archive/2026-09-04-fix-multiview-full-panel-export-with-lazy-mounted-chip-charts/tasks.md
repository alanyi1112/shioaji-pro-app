## 1. 建立可執行的回歸測試基線

- [x] 1.1 擴充籌碼副圖測試 harness，以可控制的 `IntersectionObserver` 實際建立 controller、讓已選 pane 卸載，並記錄匯出前 mounted controller／Canvas 集合。
- [x] 1.2 新增目前必定失敗的整合案例，證明從 panel 頂端擷取時離屏融資券與持股 pane 只有 DOM、缺少有效 Canvas，且既有原始碼 regex 測試不足以攔截問題。
- [x] 1.3 建立 exporter spy／fake renderer，能驗證擷取是否只在全部 expected panes ready 後開始，以及失敗時未呼叫下載。

## 2. 實作 target-panel export lease

- [x] 2.1 在單一 pane controller 增加 export readiness report，回報 context identity、mounted、有效 Canvas 尺寸、material availability、selected series 與實際 series 狀態。
- [x] 2.2 在 `createChipPaneManager()` 實作 generation-bound export lease，保存匯出前 mounted IDs，並只掛載目標 panel 當下已選取且適用的 controllers。
- [x] 2.3 讓 lease 期間的 `IntersectionObserver` 不卸載 expected controllers，且不永久停用一般 viewport-near 掛載／離屏卸載政策。
- [x] 2.4 讓 export-time mount 使用最後保留 payload，套用主圖 accepted viewport、axis safe width、共用游標日期與 readout，並將其 range callback 保持為程式性事件。
- [x] 2.5 實作有界 layout／paint readiness 等待，處理 `AbortSignal`、context identity 或 panel generation 改變，且不硬編固定 Canvas 數量。
- [x] 2.6 實作可重入 `release()`，只卸載匯出前未掛載的 controllers，保留原本掛載者及最後 payload、選取與群組順序。

## 3. 串接完整 panel PNG 匯出流程

- [x] 3.1 調整 `app.js` 的 `exportPanelPng()`，依序執行 lease prepare、ready gate、既有 `exportPanelImage()` 與 `finally` release，並沿用目前 pointed date 與取消控制器。
- [x] 3.2 在正式擷取前加入 expected-versus-ready 完整性閘門；具有合法資料的 pane 缺 chart、series 或有效 Canvas 時顯示明確錯誤並禁止下載。
- [x] 3.3 保留明確不適用／unavailable pane 的合法空狀態，確認閘門不以整張圖片像素非空白或固定 Canvas 數量誤判。
- [x] 3.4 保留 `panel-image-export.js` 既有完整高度、viewport-safe clone、像素上限、本機 PNG、外框與 object URL 清理行為。
- [x] 3.5 移除或重新界定未進入正式 render path 的 `serializePanel()`／Canvas-to-image 死碼與對應字串斷言，避免再把未執行程式碼視為匯出成功證據。
- [x] 3.6 更新 MultiView 靜態資產版本指紋，確保本機與後續獲授權的發布環境不會沿用舊匯出或籌碼副圖程式。

## 4. 自動化驗證生命週期與資源隔離

- [x] 4.1 驗證從 panel 頂端與底部觸發時，擷取前所有 expected panes 均 ready，且 PNG 範圍不包含未選取 pane 或其他商品 panel。
- [x] 4.2 驗證成功後 mounted controller 集合及 Canvas 數量精確回復匯出前狀態，其他商品 panel 從頭到尾不變。
- [x] 4.3 驗證 readiness timeout、renderer 例外、再次匯出、abort、商品／週期／版型切換與 panel destroy 都會禁止不完整下載並完成相同清理。
- [x] 4.4 驗證 export-time mount 不改寫主圖 accepted viewport、共用游標日期、使用者手勢狀態或已掛載副圖的時間範圍。
- [x] 4.5 執行受影響的 MultiView tests、完整 `npm test`、`npm run lint`、`openspec validate --all --strict` 與 `git diff --check`，並記錄結果。

## 5. 實際瀏覽器與 PNG 驗收

- [x] 5.1 使用既有本機 MultiView 5174（若未運作則先取得使用者啟動授權）開啟單一商品多層副圖，以具有合法籌碼資料的 `2449.TW`、`2454.TW` 或等價代表商品，分別從 panel 頂端與底部匯出。
- [x] 5.2 解碼實際 PNG 並逐 pane 比對 live plot，確認法人、融資券、持股群組的所有已選 series／柱狀圖、右側軸、共用日期與 readout 均存在，且沒有只剩標題的空白 plot。
- [x] 5.3 在多商品版型匯出單一目標 panel，確認其他 panel 不進入 export lease、輸出不包含其他商品，匯出後 Canvas 數量回復且互動正常。
- [x] 5.4 檢查瀏覽器 console 沒有 application error，保存不含秘密或個人資料的 mounted／ready／Canvas 計數與輸出尺寸證據。
- [x] 5.5 將根因、修正方式、自動測試、瀏覽器 PNG 與資源還原結果寫入本 change 的 `verification.md`；部署、commit、push 與收工同步仍等待各自明確授權。
