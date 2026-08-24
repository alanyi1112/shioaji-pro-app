## 2026-08-24：MultiView 單圖日 K 指定日期 1 分 K current evidence

### completion contract 與 production 接線

- 僅在 MultiView `chartCount=1`、台股 `1d`、滑鼠左鍵雙擊主圖有效且已完成的日 K 棒時取得 drill-down ownership；控制項、背景、非日 K、未完成日 K、註記／價格範圍／固定範圍 VP 繪製或拖曳期間一律不切換。
- `chartCount=2／3／4／6／8` 保留既有 `window.open(..., "_blank", "noopener")` 單圖導覽，不在原 panel 啟動 exact-date load；MultiView 單擊維持立即處理，未重新引入 260ms arbiter。
- production `realtime-coordinator.js` 先以 fresh `/api/v1/info` 重驗 `simulation=true`，再以 canonical contract 只讀 `start=end=targetDate` 的 1 分 Kbars；整個 info／contract／Kbars operation 以 `source + symbol + date + 1m` 做 page-scoped single-flight，600 根上限與 exact-date cache filter fail closed。
- request／response 固定 current schema、canonical symbol、source identity、simulation mode、`Asia/Taipei`、exact date、generation 與 identity；空資料、混日、亂序、非法 OHLCV、舊 schema、偽造 key／identity、非 simulation 與晚到 generation 均保留原日 K。
- loader 先完成 response validation 與完整 payload projection，確認 panel、symbol、interval、load token、generation仍相同且 panel active 後，才停止舊 stream並在同 panel原子套用 `1m`；成功的歷史 target 不誤接 current-day realtime stream。一般 interval selector 可回到正常日 K loader。
- fault rollback 會恢復原 interval、payload、viewport、annotation、固定範圍 VP、壓撐、PE context、籌碼／指標 eligibility 與原 stream；production assets 已升版為 `20260824-single-chart-v1`，共用 contract先於 coordinator 與 app載入。

### focused、integration、browser 與 build

- focused MultiView：`realtime-coordinator.test.mjs` 與 `rendered-html.test.mjs` 共 84／84 通過；涵蓋 simulation recheck、exact date、cross-generation single-flight、covering cache、非 simulation、舊 schema、非法日期、非同日範圍、偽造／重放 identity、routing、active generation guard 與完整 rollback。
- focused 共用 domain：`daily-minute-drilldown-contract.test.ts` 與 `main-chart-daily-drilldown.test.ts` 共 57／57 通過。
- MultiView integration：`pnpm test:multiview` 完成 vinext production build，516／516 tests 通過；`pnpm lint:multiview` 0 warning、`pnpm typecheck:multiview` 通過。
- 主程式 TypeScript／production build：`pnpm build` 通過；JavaScript syntax 已對 `app.js`、`realtime-coordinator.js`、`daily-minute-drilldown-contract.js` 執行 `node --check` 並通過。
- browser-visible 實頁：既有 `127.0.0.1:5174` 回傳 `runtime=local-worker`，`127.0.0.1:8080/api/v1/info` 實測 `simulation=true`；未啟停或重啟服務。單圖 `00919.TW` 日 K 雙擊後，同 panel 顯示 `2026-03-11 1 分 K 已載入`，主圖與副圖五個游標位置皆為 `2026-03-11`，無 current-day 混入；切回 `1d` 後正常重載。單圖既有 `1m` 雙擊不切換；2／4／8 panel 的原 panel 均維持 `1d` 且未出現 exact-date status。in-app Browser 未觀察到 popup，但 production `window.open` routing 由 source／integration contract覆蓋；console 為 0 error／0 warning。
- OpenSpec：本 change strict 與 `--all --strict` 21／21 通過；`git diff --check` 通過。

### 獨立 P0/P1 closure

| 風險 | 結果與證據 |
|---|---|
| 手勢誤取 ownership | 只接受單圖、左鍵、主圖 plot、日 K candle-center hit與已完成台股交易日；控制項、背景、工具 pending／drag與非日 K fail closed。 |
| 多圖 routing 回歸 | `count > 1` 在 target-date eligibility 前直接走既有單圖 navigation；原 panel 不建立 loader request。 |
| stale／跨 context commit | await 前後均核對 active panel、daily generation、load token、symbol、interval與 chart count；destroy／一般 load會使舊 consumer失效。 |
| partial projection／crash window | validation與 `preparePanelPayload` 全部在 stream mutation 前完成；只有 current identity可進 commit，apply fault會復原 baseline。 |
| rollback 工具漂移 | closure 發現並修補 1 個 P1：apply fault 後現在同步恢復固定範圍 VP、PE context與指標 availability，連同 annotation、壓撐、payload、viewport及 stream；focused contract已鎖定順序。 |
| cache／來源重放 | exact-date filter同時接受 numeric／ISO `sourceTime` 並重新計算台北 session date；schema、single-flight key、request identity及response identity不符即拒絕。 |
| 非 simulation／broker authority | fresh info不是 simulation時在 contract／Kbars前停止；本切片只有行情 read，未新增 order、account、CA、production或 broker write route。 |

- closure 未發現 P0；上述 1 個 P1 已修補並通過 focused與完整 integration，沒有尚未關閉的本切片 P0/P1。
- 本切片未執行 broker write、simulation委託、production、CA、真實下單、部署、commit、push或服務啟停。

## 2026-08-24：MultiView 游標熱路徑延遲 current evidence

### 根因與 production 接線

- 一般 `pointermove` 原本同時觸發 native `handleSurfacePointerMove` 與 Lightweight Charts `subscribeCrosshairMove`，兩條路徑都解析 candle 並排程 crosshair；同一事件還會呼叫 `scheduleOverlayRender()`，重建 FVG、Volume Profile、固定 VP、可見高低點、註記與壓撐 overlays。
- current `app.js` 只以 Lightweight Charts crosshair callback 作為游標時間來源；native pointer handler只在繪圖工具持有 ownership 時更新 preview。overlay rerender events 已移除 `pointermove`，保留 wheel、pointerup、pointerleave、dblclick、resize 與 scroll 等真正可能改變幾何的事件。
- per-panel crosshair 以 animation frame latest-wins 合併；`candle time + bounded payload revision` 已提交後，相同事件不再更新主圖／技術／籌碼 readout、呼叫所有 pane `setCrosshairPosition` 或量測 shared crosshair geometry。layout 或 payload 實際改變會 invalidate key。
- 籌碼 inline readout 加入內容 signature，相同日期與 segment 不再 `replaceChildren()`；實際內容改變、清除或 pinned detail 改變仍可更新。
- annotation preview 的 marker、autoscale 與 SVG render 改為單一 animation-frame gate，快速 pointer events 只提交最後 state；固定範圍 VP 仍沿用自己的 document pointer drag handler並直接 render，不依賴已移除的全域 pointermove overlay hook。
- `index.html` 已升版 `app.js` 與 `chip-panes.js` 為 `20260824-cursor-hotpath-v1`，避免瀏覽器沿用舊熱路徑。

### 驗證結果

- JavaScript syntax：`node --check` 覆蓋 `app.js` 與 `chip-panes.js`，通過。
- focused：chart lifecycle、annotations、籌碼 readout、rendered HTML 與 subchart interaction 共 152／152 tests 通過；其中實際抽取 production `syncCrosshairForTime()`，證明連續 A／B／C 事件只排一個 frame 並提交 C，相同 committed key 不再排程。
- MultiView integration：production build 與 511／511 tests 通過；lint 0 warnings、`pnpm typecheck:multiview` 通過。
- 主程式 TypeScript／production build：`pnpm build` 通過。
- OpenSpec：本 change strict 與 `--all --strict` 21／21 通過；`git diff --check` 通過。
- browser-visible 實頁：在使用者明確授權下只啟動 `127.0.0.1:5174` MultiView；`/api/health` 實際回傳 `ok=true`、`runtime=local-worker`、D1 persistence 正常。瀏覽器確認載入 `app.js` 與 `chip-panes.js` 的 `20260824-cursor-hotpath-v1` production fingerprint。
- 1 panel：5 個跨期間游標位置的主圖、技術副圖與籌碼 readout 日期一致；另以 61 次連續移動驗證 latest-wins，CUA move 平均 9ms、p95 10ms、最大 17ms，最後可見日期一致。
- 2 panel：每 panel 31 次連續移動，平均 18–19ms、p95 30–34ms、最大 45ms；移入任一 panel 時僅該 panel 的主圖／技術副圖提交同一日期，離開的 panel 回復自己的最新值，未發生跨 panel 汙染。
- 4 panel：每 panel 21 次連續移動，p95 27–40ms；一次孤立最大值 166ms，其餘 panel 最大值 27–41ms。四個 panel 的 active 主圖／技術副圖日期均一致，未形成持續 backlog。
- 8 panel：每 panel 15 次連續移動，共 120 次；平均 13–18ms、p95 19–45ms、最大 45ms。八個 panel 的 active 主圖／技術副圖日期均一致，最後游標位置可見，browser console 為 0 error／0 warning。

### 獨立 P0/P1 closure

| 風險 | 結果 |
|---|---|
| 同一事件雙 source | native pointer path 不再同步 crosshair；main／technical／chip 只由 chart callback進入同一 frame gate。 |
| frame backlog／舊事件 | pending time 採 latest-wins；panel lifecycle generation、destroy cancel與 active guard 保留。 |
| 相同 candle 重工 | commit key 使用短 revision，不把大型 payload signature帶入熱路徑；相同 key 在排 frame 前及 commit 前都會拒絕。 |
| annotation preview 失效 | preview state 仍逐事件 latest 更新，但 marker、autoscale、SVG 只在下一 frame套用一次。 |
| 固定範圍 VP drag | drag 自有 `document.pointermove`、range update 與 render，不依賴一般 overlay pointer hook。 |
| layout／payload 改變後游標不刷新 | layout scheduling、chart reset及 material payload revision會 invalidate crosshair commit key。 |
| broker authority | 變更只觸及 MultiView pointer、readout、overlay 與文件；未新增 order、account、CA、production 或 broker write route。 |

- source／focused／integration closure 未發現未關閉的 scope P0/P1。
- browser-visible 壓力驗收已補齊，未發現新的 P0/P1；Task 7.3 completion contract 已全部滿足。
- 本輪只在使用者明確授權下啟動 MultiView 5174；未啟停或重啟其他行情服務，亦未執行 broker write、simulation 委託、production、CA、真實下單、部署、commit或push。

## 2026-08-24：MultiView 副圖單次載入與重繪 current evidence

### 根因與 production 接線

- 技術副圖原本在初次 `time range` 尚未建立時，延遲 120ms 執行 `indicatorChart.remove()`，清空全部 series 後遞迴呼叫 `renderIndicatorChart()`；即使資料只載入一次，畫面仍會完整建立與繪製第二次。current `app.js` 保留既有 chart 與 series，只執行有界 `resize`、主圖 viewport sync、分日線刷新及 alignment measurement。
- 籌碼副圖原本在日期範圍改變時先以舊 payload 對所有 controller render，再載入 response 後對所有 controller render；同一份 material response 的 `fetchedAt`、cache 狀態或 requested range metadata 改變也會清除並重建 series。current manager 已將 topology reconcile、neutral candle anchor 與 material render 分流：既有 controller 只更新 anchor，新 controller 才接收符合目前 request identity 的既有 payload。
- 每個籌碼 pane 現在以 canonical material signature 加上 pane／series／級距設定作為 render gate；`cache`、`fetchedAt`、`lastAttemptAt`、`lastSuccessAt`、`requestedStart`、`requestedEnd` 與 `updatedAt` 不構成可見資料變更。只有成功完成 render 才 commit signature，失敗可安全重試；IntersectionObserver unmount 會 reset gate，remount 可重建必要 Canvas。
- 相同 presentation mode、slot 與 pane IDs 不再重複通知 panel layout；相同 request identity 直接沿用 payload，明確 backfill／poll 才以 `force` 重新讀取。商品或週期改變仍遞增 generation、abort 舊 consumer、清除 payload identity，晚到 response 不得跨 context 套用。
- `index.html` 已升版 `chip-panes.js` 與 `app.js` production asset fingerprint，避免瀏覽器沿用具有重建路徑的舊靜態資產。

### focused、integration 與 build 結果

- JavaScript syntax：`node --check` 覆蓋 `app.js` 與 `chip-panes.js`，全部通過。
- focused：chart lifecycle、籌碼 status／render gate、rendered HTML 與副圖 interaction 共 132／132 tests 通過。
- MultiView integration：`pnpm --prefix apps/multiview test` 完成 production build，508／508 tests 通過；`pnpm --prefix apps/multiview run lint` 以 0 warnings 通過；`pnpm typecheck:multiview` 通過。
- 主程式 TypeScript／production build：`pnpm build` 通過；既有 large chunk 與 Vite dynamic-import 訊息為 warning，沒有 build failure。
- OpenSpec：本 change strict 與 `--all --strict` 全部通過；`git diff --check` 通過。

### 獨立 P0/P1 closure

| 風險 | 結果與證據 |
|---|---|
| 技術副圖第二次重建 | recovery block 已無 `remove()`、series reset 或遞迴 `renderIndicatorChart()`；render token、panel lifecycle 與可見性 guard 保留。 |
| 相同 payload 重畫 | material signature 忽略不可見 refresh metadata；per-pane gate 只在 material／series／級距改變時重畫，且只在成功後 commit。 |
| 日期範圍與 neutral anchor 漂移 | range-only context 不再進 topology reconcile；既有 pane 以完整 candles `setData` 更新 anchor，再以 request identity 判定是否讀取新資料。 |
| 新增／移除／重排 pane | reconcile 只 render 本輪新建 controller；已存在 controller 不因 DOM 排序重畫。新 controller 只有在 payload request key 與目前 datasets／日期範圍完全一致時才可沿用。 |
| unmount／remount 空白 | 離開 viewport 仍可釋放 Canvas；remount reset render gate 並以最後 material signature 重建必要 series，不會被錯誤視為已 render。 |
| 晚到 response／跨商品污染 | symbol／interval change 先 invalidate generation、abort 舊 request並清除 payload key；response 必須符合目前 generation。 |
| refresh fault | 相同 context refresh 期間保留最後已驗證 payload；AbortError、舊 generation 或暫時 error 不以空集合覆寫既有 pane，尚無 payload 時才顯示 unavailable。 |
| broker authority | production 變更只觸及 MultiView 圖表與唯讀 `/api/taiwan-stock-chip`；未新增 order、account、CA、production 或 broker write route。 |

- closure 未發現新的 P0/P1；沒有尚未關閉的本切片 P0/P1。
- 本切片未執行 broker write、simulation 委託、production、CA、真實下單、部署、commit、push或服務啟停。

## 2026-08-24：MultiView 互動與大戶持股穩定性 current evidence

本節取代下方歷史 closure 中所有「MultiView 日 K 雙擊在 panel 內進入指定日期 1 分 K」及 `target-date-v2` production wiring 敘述。RealTimeStock 主交易畫面的指定日期 drill-down 保留；MultiView 的 current product contract 是立即單擊與雙擊開單圖。

### 根因與 production 接線

- 點擊卡頓：MultiView 原本對每次合法日 K 單擊啟動 260ms `dailyGestureArbiter`，使壓撐與其他主圖工具必須等待雙擊視窗。current `app.js` 已移除該 timer、pending click 與 target-date ownership；合法單擊直接進入既有 surface tool handler。
- 雙擊未開單圖：舊 `handlePanelDoubleClick` 會讓有效日 K 取得 panel 內 drill-down ownership並阻止 `window.open`。current handler 在既有控制項 ignore list 與拖曳抑制邊界下，直接以目前 canonical 商品、interval 與 tab route 呼叫既有單圖導覽。
- 大戶持股偶發消失：舊籌碼 manager 在 refresh 前先清除 payload，暫時空 K 棒、取消或 API 失敗又會 render 空集合。current manager 以 `canonical symbol + interval + candle date range + sorted datasets` 建立 request identity，採同 context stale-while-refresh；相同 identity 不重抓，短暫空 K 棒不覆寫既有 context，背景失敗也保留最後已驗證 payload。
- 商品或週期改變時仍會遞增 generation、abort 舊 consumer 並清除 payload identity；晚到 response 必須通過 generation guard。backfill／輪詢可明確 `force` 刷新，但 pane 重排會在 generation 變動前命中既有 identity，因此不會中斷正在進行的強制刷新。
- `index.html`、`app.js` 與 `realtime-coordinator.js` 已解除 MultiView target-date loader 接線；`daily-minute-drilldown-contract.js` 只保留為主交易畫面 TypeScript／browser parity fixture，MultiView production HTML 不載入它。

### focused、integration 與 build 結果

- JavaScript syntax：`node --check` 覆蓋 `app.js`、`chip-panes.js`、`realtime-coordinator.js`，全部通過。
- focused：籌碼 lifecycle 與 rendered HTML 77／77 tests 通過；主交易畫面 retained drill-down contract 57／57 tests 通過。
- MultiView integration：`pnpm --prefix apps/multiview test` 完成 production build，506／506 tests 通過；`pnpm --prefix apps/multiview run lint` 以 0 warnings 通過；`pnpm typecheck:multiview` 通過。
- 根目錄 source：`pnpm exec vitest run src --exclude '**/*.browser.test.ts'`，60 files／674 tests 通過；`pnpm build` 的 TypeScript 與 Vite production build 通過。
- OpenSpec：本 change strict 與 `--all --strict` 21／21 全部通過；`git diff --check` 通過。
- 根目錄未把 `pnpm test` 當成本切片 gate：該命令在 sandbox 因 unrelated 智慧下單 tests 建立 Unix／TCP listener 遭 `EPERM`，另有既存智慧下單 trust manifest source hash drift；本切片未修改該 change，且所有 current scope suites 已通過。

### 獨立 P0/P1 closure

| 風險 | 結果與證據 |
|---|---|
| click delay／重複提交 | MultiView runtime 已無 arbiter、timer、pending single-click 或 target-date click handler；surface click 立即且只由既有工具處理。 |
| 雙擊失效／雙開頁 | panel 只有一個可清理的 `dblclick` handler，直接走既有 `openPanelInNewTab`；控制項、拖曳與單圖 layout 的既有 ignore 邊界維持不變。 |
| target-date 殘留 | production HTML 不載入 contract，app 與 coordinator 沒有 loader、observation 或 single-flight route；MultiView 雙擊不發 target-date request。 |
| 大戶資料 refresh window | refresh 前不清 payload；取消、短暫 error 與同 source 空 K 棒保留最後已驗證 payload及其非空 candle context。 |
| 跨商品污染／晚到 response | symbol／interval change 清除 identity並 abort；每次 response 以 generation guard 拒絕晚到 consumer。 |
| pane 重排／forced refresh race | 相同 request identity 在 generation increment 與 abort 之前直接 reuse；明確 forced backfill 仍可完成，不因重排被取消。 |
| broker authority | 變更只有 MultiView UI、唯讀籌碼 API 與文件；未新增 order、account、CA、production 或 broker write route。 |

- closure 期間未發現 P0。
- closure 發現並修補 1 個 P1：同 source 暫時空 K 棒原本仍先覆寫 manager context，重排時可能以空時間軸重繪；現在 preservation guard 在 context assignment 前返回，focused 與完整 integration tests 均通過。
- 本切片沒有尚未關閉的 scope P0/P1；未執行 broker write、production、CA、真實下單、部署、commit、push或服務啟停。

## 2026-08-24：產品範圍撤回

- 使用者明確要求撤銷主交易畫面與 MultiView 的分鐘 K「成交值（左軸）」相關變更。
- 原 Tasks 1–3 的 turnover contract、主畫面左軸與 MultiView 左軸 evidence 已被此產品決策取代，不再作為 current acceptance evidence，亦不得沿用來宣稱 production 支援。
- 已移除 turnover-only source、fixture、spec 與 tests，並從共用 Candle、Kbars aggregation、daily drill-down contract、local coordinator、realtime accumulator、Worker、gateway、payload、cache fingerprint、panel UI、readout、formatter、文件與驗收矩陣解除接線。
- 右側成交量 Histogram、`common_lot` 契約、分日線與 daily exact-date drill-down 保留。

## 保留的 daily drill-down production wiring

- 主交易畫面 `CandleChart` 仍以 bounded gesture arbiter 仲裁日 K 單擊／雙擊，透過既有 `/api/v1/info` 與 `/api/v1/data/kbars` simulation adapter 讀取 start／end 相同的 target date。
- response 必須通過 schema、source、symbol、target date、排序、OHLCV、600 根上限與 latest generation 驗證；所有 source、readout、volume、indicators、day-boundaries 與 viewport layer 完整後才 atomic commit。
- MultiView `daily-minute-drilldown-contract.js` 在 production script order 中先於 local realtime coordinator；page-scoped target-date single-flight 只共用唯讀 info／Kbars，panel commit 仍逐一驗證 generation 與 identity。
- MultiView 有效日 K 雙擊由目前 panel 接管；非日 K／背景維持開啟單圖，Yahoo／非 simulation／舊 generation／部分 response 均保留原日 K且不 fallback 開頁。
- 兩條 runtime 都不取得 broker authority、不送委託、不切 production、不啟用 CA，也不變更服務生命週期。

## 既有功能與使用者狀態保護

- 撤回未使用 `git checkout`、`git reset` 或整檔覆蓋共用 dirty files；智慧下單與其他使用者修改保持原狀。
- 右側成交量、價格 autoscale、指標、壓撐、費波那契、固定範圍 VP、panel layout、viewport、來源 fallback 與 live volume cursor 保留。
- daily drill-down 的 baseline／commit layers 不再包含 turnover，因此不存在缺少成交值 metadata 造成 target-date read 被錯誤拒絕的依賴。

## 驗證結果

本節只記錄撤回後重新執行的結果；舊 turnover 測試數與 browser 圖像不作 current evidence。

- focused：`pnpm exec vitest run src/lib/daily-minute-drilldown-contract.test.ts src/lib/main-chart-daily-drilldown.test.ts src/lib/chart-volume-contract.test.ts src/lib/chart-volume-parity.integration.test.ts src/lib/indicator-defs.test.ts`，5 files／75 tests 通過。
- 根目錄 source：`pnpm exec vitest run src --exclude '**/*.browser.test.ts'`，60 files／667 tests 通過。
- Chromium：`pnpm test:browser`，5 files／65 tests 通過；首次 sandbox listener `EPERM` 未執行任何 test，改在核准的本機 test boundary 重跑後通過。
- MultiView：`npm test`，production build 通過，507 tests 通過；`npm run lint` 以 0 warnings 通過。
- gateway：`npm run gateway:test`，80 tests 通過；首次 sandbox 無權使用既有 uv cache，改在核准的本機 test boundary 重跑後通過。
- 主程式 TypeScript／production build：`pnpm build` 通過。
- JavaScript syntax：`node --check` 已覆蓋 `app.js`、`realtime-coordinator.js`、`realtime-charts.js` 與 `daily-minute-drilldown-contract.js`，全部通過。
- OpenSpec：`pnpm exec openspec validate add-kbar-turnover-axis-and-daily-minute-drilldown --strict` 通過。
- diff：`git diff --check` 通過。

## Task 4.3：獨立 P0/P1 closure

### 審查發現與修補

- 沒有發現 P0。
- 修補 P1「未完成日 K 資格缺口」：共用 TypeScript／browser contract 新增 `Asia/Taipei` 台股日盤 13:30 完成判定；主交易畫面與 MultiView 在 gesture 與 loader 兩層都重新檢查，forming 今日棒、未來日期、非法 wall-clock及主畫面未支援的 FUT／OPT 一律 `invalid_target` fail closed，不發出 Kbars read。
- 修補 P1「unmount 晚到結果」：主交易畫面卸載時遞增 target-date generation 並清除 staged observation；MultiView 既有 destroy／load generation invalidation 維持不變。
- 修補 P1「靜態資產舊快取」：MultiView contract 與 `app.js` query revision 升為 `target-date-v2`，避免舊 browser contract 錯誤沿用。
- 修補撤回殘留：移除主交易畫面與 MultiView 仍為 hidden 的 `leftPriceScale` 新增設定，恢復 change 前的價格軸設定；production residual scan 不再命中成交值 schema、series、fingerprint、Tick 欄位或左軸 UI。

### P0/P1 closure 矩陣

| 項目 | 結果與證據 |
|---|---|
| target-date race | request 重新正規化、single-flight settle cleanup、每 consumer generation validation、symbol／panel identity guard、快速切換與 destroy／unmount invalidation通過；舊 generation、forged request、混日與部分 response 均被拒絕。 |
| gesture 穿透 | bounded arbiter 的單擊逾時、同棒雙擊、不同棒、非法目標、交易 mode、annotation、價格範圍、固定 VP、drag ownership通過；forming 日 K 不取得 drill-down ownership。 |
| 雙開頁 | MultiView 只有已完成日 K 可取得 drill-down ownership並阻止 `window.open`；非日 K／背景維持原開頁，已取得 ownership 後載入失敗不 fallback 開頁。 |
| atomic commit／fault injection | schema、projection incomplete、projection throw、cancel、stale generation 與 identity drift 全部保留 immutable baseline；MultiView payload prepare 先於 commit，apply fault 會還原既有 payload並記錄安全階段。 |
| simulation-only／無 broker authority | 兩套 loader 都在 exact-day Kbars read 前重新讀取 info；非 simulation 在 Kbars 前停止。MultiView data adapter 只 allowlist info、contract、snapshots、Kbars與行情 subscription；order、account、CA、server及未知路由 403 且不轉送。gateway simulation adapter 只有 market-data capability。 |
| 成交值撤回 | 對兩套 production runtime 掃描 `Amount`、`total_amount`、turnover contract／series／fingerprint與左軸 UI 為 0 命中；OpenSpec 中只保留產品撤回的歷史與邊界說明。 |

### 最終驗證結果

- focused：`pnpm exec vitest run src/lib/daily-minute-drilldown-contract.test.ts src/lib/main-chart-daily-drilldown.test.ts src/lib/chart-volume-contract.test.ts src/lib/chart-volume-parity.integration.test.ts src/lib/indicator-defs.test.ts`，5 files／82 tests 通過。
- 根目錄 source：`pnpm exec vitest run src --exclude '**/*.browser.test.ts'`，60 files／674 tests 通過。
- Chromium：`pnpm test:browser`，5 files／65 tests 通過。
- MultiView：`npm test`，production build 通過，507 tests 通過；`npm run lint` 以 0 warnings 通過。
- gateway：`npm run gateway:test`，80 tests 通過；其中 simulation adapter market-data-only、無 CA 與 route deny tests 全部通過。
- 主程式 TypeScript／production build：`pnpm build` 通過。
- JavaScript syntax：`node --check` 已覆蓋 `app.js`、`realtime-coordinator.js` 與 `daily-minute-drilldown-contract.js`，全部通過。
- OpenSpec：`pnpm exec openspec validate add-kbar-turnover-axis-and-daily-minute-drilldown --strict` 通過。
- diff：`git diff --check` 通過。
- 本 closure 未執行 broker write、production、CA、真實下單、部署、commit、push或服務啟停。
