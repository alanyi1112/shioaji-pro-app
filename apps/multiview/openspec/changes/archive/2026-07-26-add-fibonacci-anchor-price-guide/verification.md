# 驗證紀錄

## 本機互動驗收

- 費波那契回撤：待選 A 顯示 `3811.71`，待選 B 顯示 `4136.25`；點下 B 後完成註記的 0 與 1 水準仍分別顯示 `4136.25`、`3811.71`。
- 費波那契拓展：待選 A、B、C 依序顯示 `3324.91`、`3852.28`、`3608.88`；完成第三點後移除暫態導引並保留三個錨點。
- 待選價位實線與既有收盤價水平虛線可同時辨認；K 棒日期垂直線、技術副圖及籌碼 pane 的日期同步維持正常。
- 已驗證快速上下移動、圖頂與圖底夾限、900 × 700 responsive resize、四圖密集版面、滑鼠離開、Escape、完成、工具及週期切換，沒有殘留導引或阻擋圖表手勢。
- 完整 panel PNG 匯出已在單圖及四圖狀態實際觸發；本機自動化瀏覽器兩次都未在 90 秒內回報下載事件。Exporter contract 測試已確認 `data-export-exclude` 會移除暫態導引，並保留完成費波那契註記。

## 自動化驗證

- `npm test`：253/253 通過，包含 production build。
- `npm run lint`：通過，0 warnings。
- `openspec validate add-fibonacci-anchor-price-guide --strict`：通過。
- `openspec validate --all --strict`：26/26 通過。
- `git diff --check`：通過。

## 非本變更提示

- build 仍顯示既有的 Vinext 動態 API route classification 提示及 Node.js `module.register()` deprecation warning；兩者均未造成建置或測試失敗。

## Sites 正式站

- 已將 commit `fe73aa7b7a83336bd1f159425c532635f263e67c` 發布為 Sites version 137：<https://quote-chart-multiview.alanyi1112.chatgpt.site>。
- 在已登入正式站以 `2330.TW` 日線重驗回撤：待選 A、B 顯示 `1324.19`、`2098.08`；完成後 0 與 1 水準仍為 `2098.08`、`1324.19`，暫態導引數量歸零。
- 重驗拓展：待選 A、B、C 依序顯示 `1387.07`、`1962.65`、`1672.44`；完成後保留三個錨點並移除暫態導引。
- C 點驗收畫面同時顯示青色實線 `待選 C｜1672.44`、既有收盤價水平虛線 `2350` 與跨 pane 日期 `2026-07-14`；導引群組具有 `data-export-exclude` 且 `pointer-events: none`。
- 正式站驗收建立的註記已清除，最終畫面沒有暫態導引或測試錨點。

## 2026-07-26 選點標記與拓展尺度修正

### 本機互動驗收

- 以 `2454.TW` 日線啟動拓展後，待選 A 僅建立 1 個小型十字、0 個圓形錨點；主圖均線、布林線及其他價格折線在費波那契 pending 期間不再沿垂直十字線堆疊大型實心 marker。
- 固定 A 後待選 B 顯示 1 個半徑 `4` 的空心圓與 1 個 preview 十字；固定 B 後待選 C 顯示 2 個半徑 `4` 的空心圓與 1 個 preview 十字。
- 將待選 C 從 `4596.37` 快速移到 `-83.51` 時，已固定 A／B 的 SVG Y 座標皆維持 `[229.5, 142.5]`；可見 pending 水準數由 2 變為 7，但 K 線價格尺度沒有跟著壓縮或展開。
- 完成 C 後 preview 十字與待選價位導引均移除，保留 3 個半徑 `4` 的空心圓及全部 7 條正式拓展水準；原生價格折線 marker 恢復。Escape 取消與清除繪圖後均為 0 個暫態十字、價位導引及測試錨點。

### 自動化驗證

- 相關測試：34/34 通過。
- `npm test`：254/254 通過，包含 production build。
- `npm run lint`：通過，0 warnings。
- `openspec validate add-fibonacci-anchor-price-guide --strict`：通過。
- `openspec validate --all --strict`：26/26 通過。
- `git diff --check`：通過。

### Sites 正式站互動驗收

- 最終程式 commit `3e36884b2ce05af8dfc6acb57c77f148d1e0d12f` 已發布為 Sites version 139：<https://quote-chart-multiview.alanyi1112.chatgpt.site>。version 138 首次驗收發現 `app.js` 與 `styles.css` 沿用舊 cache-buster，version 139 已更新兩者的資產版本並以強制重新整理確認載入新版。
- 以 `2301.TW` 日線啟動拓展後，待選 A 為 1 個小型十字、0 個固定圓圈，且主圖均線、布林線及其他價格折線不再沿垂直十字線堆疊大型實心 marker；導引顯示 `待選 A｜188.03`。
- 固定 A 後待選 B 為 1 個半徑 `4` 的空心圓與 1 個 preview 十字；固定 B 後待選 C 為 2 個半徑 `4` 的空心圓與 1 個 preview 十字，固定錨點半徑皆為 `4`。
- 將待選 C 從圖頂 `255.36` 移至圖底 `113.23` 時，A／B 的 SVG Y 座標皆維持 `[180, 99.99999999999994]`，確認 pending preview 不再驅動價格尺度。
- 完成 C 後保留 3 個半徑 `4` 的空心圓及 7 條正式拓展水準，preview 十字與待選價位導引均歸零，原生價格折線 marker 恢復；另以回撤模式確認 Escape 前十字／導引各 1 個，Escape 後十字、導引及固定圓圈皆為 0。
- 正式站驗收建立的拓展註記已執行「清除繪圖」，最後再完成 Escape 取消驗收；最終畫面沒有測試錨點、拓展水準或暫態價位導引。

## 2026-07-26 單圖首次載入與 1px 十字回歸修正

### 問題重現與根因驗證

- version 140 將 `/api/instruments` 與 `/api/config` 改成並行後，正式站四圖雙擊新分頁仍約需 23 秒才建立單圖 panel；Worker log 顯示 `/api/instruments` 在瀏覽器端延後約 22 秒才送出，而 Worker 實際處理約 195ms。
- 依請求未送達 Worker、原四圖頁同時維持多條 `EventSource` 的證據，判定為同源長連線占用瀏覽器可用連線。開啟單圖前短暫暫停原頁 panel 串流、3 秒後恢復，可讓新分頁必要請求立即送出。

### 本機與自動化驗證

- 本機 Chrome 四圖雙擊 `2454.TW` 日線，正確 `view=single` URL、1 個 panel 與 98 個 canvas 在 738ms 內建立。
- `npm test`：254/254 通過，包含 production build；`npm run lint`：通過，0 warnings。
- `openspec validate add-fibonacci-anchor-price-guide --strict`、`openspec validate --all --strict`（26/26）及 `git diff --check` 全數通過。

### Sites 正式站互動驗收

- commit `141070a7f283cf2b0221d7a1d1c84f08fd6c6f03` 已發布為 Sites version 141：<https://quote-chart-multiview.alanyi1112.chatgpt.site>。
- 已登入 Chrome 載入新版資產 `app.js?v=20260726-single-init-stream-capacity-v3`；四圖雙擊 `00919.TW` 日線後，正確單圖 URL、1 個 panel 與 91 個 canvas 在 815ms 內建立，沒有再出現約 23 秒的空白框架。
- 等待原頁 3 秒恢復後，原頁仍為 4 個 panel 與 378 個 canvas，沒有重建或遺失多圖可見狀態。
- 在單圖啟動費波那契回撤、固定 A 並移動待選 B，正式 DOM 同時顯示 1 個 preview 十字與 1 條價位導引；cross 與 halo 的 computed `stroke-width` 均為 `1px`，固定 A 為 1 個空心圓。
- 正式站驗收建立的費波那契註記已清除，最後確認 preview 十字、價位導引、固定圓圈及正式水準均為 0。
