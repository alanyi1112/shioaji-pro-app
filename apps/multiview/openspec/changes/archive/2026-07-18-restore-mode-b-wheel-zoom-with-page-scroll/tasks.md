## 1. 固定互動契約與測試基線

- [x] 1.1 擴充前端結構／腳本測試，固定方式 A 現有的 mouse wheel 縮放、左鍵拖曳、pinch 與單一副圖版型行為
- [x] 1.2 新增方式 B 互動政策測試，確認 mouse wheel 縮放保持啟用、垂直 touch drag 交給頁面、水平 touch drag 與 pinch 仍操作圖表
- [x] 1.3 新增命中區域測試，區分 `.chart-surface`、`.indicator-chart`、`.chip-pane-chart` 與圖表外標題列、工具列、控制項及頁面空白

## 2. 拆分並共用圖表互動政策

- [x] 2.1 將 `public/static/app.js` 的 `chartInteractionOptions()` 從單一 `pageScrollEnabled` 布林值改為可分別表達 mouse wheel、mouse drag、touch drag 與 pinch 的互動政策
- [x] 2.2 讓主圖與技術副圖在方式 B 重新啟用 mouse wheel 時間縮放，同時保持觸控垂直滑動可捲動 document
- [x] 2.3 調整 `public/static/chip-panes.js`，讓所有動態籌碼 pane 使用相同互動政策，並移除或重新命名語意不完整的 `setPageScrollEnabled()` 介面
- [x] 2.4 若抽出共用靜態 helper，更新 `public/static/index.html` 的載入順序與 cache-busting 版本，確保 helper 先於 `chip-panes.js` 與 `app.js` 可用

## 3. 滾輪事件分流與生命週期

- [x] 3.1 在實際圖表操作區保留 Lightweight Charts 的普通 wheel 縮放，且不得讓同一手勢改變 `window.scrollY`
- [x] 3.2 確認圖表標題列、panel 工具列、select、button、頁面空白與瀏覽器原生捲軸不被圖表 wheel listener 攔截，可自然捲動 document
- [x] 3.3 實作方式 B 的 `Option/Alt + wheel` 強制捲頁備援，阻止圖表縮放但不攔截 `Ctrl/Cmd + wheel`
- [x] 3.4 正規化必要的 wheel `deltaMode` fallback，避免不同瀏覽器或滾輪裝置產生過大、過小或反向的頁面位移
- [x] 3.5 將 wheel routing listener 納入主圖、技術副圖、籌碼 pane controller 的 cleanup，確認 pane 移除、panel reset、圖數切換與 A／B 切換後沒有重複或殘留 listener

## 4. 時間範圍同步與版面穩定

- [x] 4.1 驗證從主圖、技術副圖或任一籌碼 pane wheel 縮放時，既有 visible logical range 同步鏈會更新同一 panel 的所有可見圖表
- [x] 4.2 驗證從任一可見圖表按住滑鼠左鍵拖曳時，同一 panel 同步平移且其他 panel 與 document 捲動位置不變
- [x] 4.3 強化 range re-entrancy guard，避免主圖、技術副圖與多個籌碼 pane 在 wheel／drag 後互相回授、抖動或重複觸發歷史補載
- [x] 4.4 保留方式 B 的 `html/body` 唯一垂直捲軸，確認 `.chart-panel`、`.subchart-slot`、`.chip-pane-region` 與 `.chip-pane-stack` 不產生內層捲動
- [x] 4.5 在圖表縮放、頁面捲動與 layout 穩定後重新量測共用垂直線，確認相同日期於主圖及所有可見副圖的絕對 X 座標差小於或等於 1 CSS px

## 5. 主圖與技術副圖逐日讀值

- [x] 5.1 在 K 線主圖浮動框第一項加入 `YYYY-MM-DD` 日資料日期，並以目前 crosshair candle time 更新
- [x] 5.2 將技術副圖 `.sub-readout` 從浮動 tooltip 改為單列緊湊 header，依序顯示日期及目前勾選的 RSI、KD-K、KD-D、MACD、ATR 數值
- [x] 5.3 實作技術副圖 latest／hover 狀態：載入與指標切換後顯示最新 candle，crosshair 作用時顯示該日，離開後恢復最新值
- [x] 5.4 調整方式 A／B 技術副圖 layout，讓 header 與 chart 共用既有槽位並維持方式 B 96–120 CSS px 總高
- [x] 5.5 更新結構與行為測試，確認完整日期、未勾選值隱藏、主圖浮動框保留、技術副圖沒有 `cursor-tooltip`／浮動定位

## 6. 驗證與部署

- [x] 6.1 執行 JavaScript syntax check、前端自動化測試、專案既有測試與 `openspec validate --all --strict`
- [x] 6.2 在本機瀏覽器以 1／2／3 圖及至少五個籌碼 pane 驗收圖表內 wheel 縮放、圖表外 wheel 捲頁、`Option/Alt + wheel`、左鍵拖曳、共用十字線與主圖／技術／籌碼逐日讀值
- [x] 6.3 驗收觸控／模擬觸控的垂直捲頁、水平平移與 pinch 縮放，並確認方式 A、4／6／8 圖及聚焦模式沒有回歸
- [x] 6.4 依 Sites 流程部署後，在已登入正式站驗證 1／2／3 圖的 mouse wheel、document scroll、日期讀值、panel 隔離、listener cleanup 與 1px 對齊，並保存可追溯的版本與驗收證據

## 7. 籌碼 pane 操作與文案精簡

- [x] 7.1 正常 available 狀態不顯示「可用」，並保留具有判斷價值的回補、歷史與錯誤狀態
- [x] 7.2 移除標題列常駐按鈕，加入圖表區右鍵／鍵盤功能表「移除副圖」及完整 listener cleanup
- [x] 7.3 將持股變化、週變化與座標刻度的「百分點」文案統一為 `%`，完成自動化、本機與正式站驗收
