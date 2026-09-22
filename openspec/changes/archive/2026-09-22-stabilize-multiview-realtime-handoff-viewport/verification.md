## 驗證摘要

### 原始問題證據

- 使用者提供的 `/Users/alanyi/Desktop/螢幕錄影 2026-09-21 10.16.05.mov` 為 00929.TW、日線、自動來源；約 4.75 秒收到盤中新價位時，既有完整圖形突然縮到左側並留下大面積右側空白。
- 2026-09-21 實際來源核對：canonical API 有 524 根日 K；本機 Shioaji 365 日 Kbars 聚合為 242 個交易日。舊流程把 524 根資料的 logical range 套到 242 根資料，會留下約 54% 不存在的索引空間。
- 第一次修正後的 browser trace 又抓到第二層競態：自動模式在完整 242 根 Kbars 到齊前，曾短暫畫出 160 根 canonical／provisional payload。此證據未被當成通過，已再加入 bootstrap gate 與 bounded fallback grace。

### 程式與回歸驗證

- `node --test tests/realtime-charts.test.mjs tests/realtime-coordinator.test.mjs tests/chart-viewport-coordinator.test.mjs tests/subchart-interaction.test.mjs tests/taiwan-stock-volume.test.mjs tests/rendered-html.test.mjs`：173/173 通過。
- `pnpm exec tsc --noEmit`：通過。
- `pnpm exec eslint public/static/app.js public/static/chart-interactions.js tests/chart-viewport-coordinator.test.mjs tests/subchart-interaction.test.mjs tests/taiwan-stock-volume.test.mjs --max-warnings=0`：通過。
- `pnpm build`：通過；僅有既存 Vite native config 相容性 warning。
- `pnpm run realtime:ui-preview-verify`：1/2/3/4/6/8 圖、重複商品、1m 與單圖 browser 驗收通過。驗收腳本原先仍選取已移除的 `intraday`／「分時」選項，已同步為目前正式的 `1m`、`5m`、`15m`、`60m` 契約。
- `openspec validate stabilize-multiview-realtime-handoff-viewport --strict`：通過。
- scoped `git diff --check`：通過。

### 5174 真實 simulation runtime

證據：`evidence/00929-source-modes-after-hours.json`、`evidence/00929-auto-after-hours.png`。

- 自動：只出現一次完整 242 根 Shioaji 日 K，viewport `{from: 0, to: 243}`，invariant 通過；沒有 160→242 中間畫面。
- Shioaji 即時：只出現一次完整 242 根，viewport `{from: 0, to: 243}`，invariant 通過。
- Yahoo 延遲：160 根 canonical 顯示，viewport `{from: 0, to: 161}`（浮點誤差範圍內），invariant 通過。
- 三種模式的 `/api/candles`、Shioaji info、SSE、contract、subscribe、snapshot、Kbars 請求均無 HTTP 失敗，console／page error 為 0。
- 將瀏覽器網路層的 Kbars 回應延遲至 2.2 秒時，1.5 秒先原子顯示 160 根 Yahoo fallback；Kbars 恢復後一次交接為 242 根，兩個階段 viewport invariant 都通過，沒有不存在的 logical slots。
- 5174 `/api/health` 維持 `ok=true`、`runtime=local-worker`、D1 persistence 正常；驗收未重啟 5173、5174、Shioaji API 或 watchdog。

### 尚待實際盤中時點

- 2026-09-22 09:44–09:48（Asia/Taipei）已於實際開盤時段完成。獨立一圖驗收頁使用 00929.TW、日線、自動來源；初始畫面先顯示「等待 Shioaji Kbars」，隨後一次顯示完整 Shioaji 日線，沒有先畫 canonical 中間 payload。
- 連續盤中樣本為 29.31／12,451 張、29.31／12,456 張、29.30／12,459 張、29.30／12,481 張、29.30／12,811 張、29.30／12,820 張。價格、成交量與最新指標持續變動，`panelRenderGeneration=1`、`dataRequestCount=1`、`realtimeConnectionCount=1`；沒有重新載入資料集合或建立第二條即時連線。
- 三次可見畫面取樣的主圖 plot 均為 1420×396 CSS px，技術副圖均為 1420×78 CSS px；日期軸、歷史 K 棒、最新價右側空間與主副圖 X 軸維持原位置，沒有縮到左側、位移或產生大面積空白。browser console error／warning 均為 0。
- simulation API、business session、watchdog、5173、5174 維持運作，production 與 write master 維持停用；驗收未重啟共用服務。結構化證據為 `evidence/00929-live-acceptance-2026-09-22.json`，task 3.4 通過。
