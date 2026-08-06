# 驗證紀錄

## 本機自動化

- 日期：2026-08-04（Asia/Taipei）
- `npm run lint`：通過，0 warnings。
- `npm test`：通過，399 tests、0 failed；包含 production build。
- `openspec validate --all --strict`：38 items passed、0 failed。
- `git diff --check`：通過。

## 本機已登入可見驗收

- 環境：`http://localhost:3000/`，台股頁籤、4 圖，桌面 viewport 1280 × 900；結束前已清除暫時 viewport override。
- 代表第一頁 canonical order：`2454.TW → 00919.TW → 00878.TW → 00929.TW`。
- 滑鼠左鍵按住商品報價區，將第一張移到第二張位置：DOM／controller order 原地變成 `00919.TW → 2454.TW → 00878.TW → 00929.TW`，顯示「商品順序已永久儲存」。
- 重載後仍保持新順序；再以鍵盤方向鍵移回，焦點跟隨至新的位置，最後已恢復原順序。
- 第二頁由 `00981A.TW → 00982A.TW → 009816.TW → 009819.TW` 重排為 `00982A.TW → 00981A.TW → 009816.TW → 009819.TW`；重載後第二頁保持新順序，第一頁完全不變，驗收後已恢復第二頁原順序。
- 第二頁 drop 前後：`dataRequestCount 27 → 27`、`streamSubscriptionCount 27 → 27`、`panelRenderGeneration 6 → 6`，證明純排序沒有重抓 candles、重建 stream 或重建 panel。
- 臨時把前兩張都顯示為 `2454.TW` 後拖曳：display symbols 可重複，但 canonical identities 仍為 4 個唯一值；排序後沒有新增、刪除或替換清單成員。驗收後顯示商品與清單順序均已恢復。
- 拖出 grid：順序不變、ghost／placeholder 清除並顯示取消訊息；未產生單圖分頁。
- 正常雙擊第一張商品報價區：開啟 `/?view=single&symbol=2454.TW&interval=1d&tab=system%3Ataiwan-stocks`；驗收分頁已關閉，多圖頁保持不變。
- 1 圖：0 個可見排序把手、`data-panel-reorder-enabled=false`。
- 6 圖：6 個可見排序把手，主副圖固定 `single`，`multi` disabled。
- 8 圖：8 個可見排序把手，主副圖固定 `single`，`main`／`multi` disabled。
- 乾淨新分頁載入 4 張圖皆完成，console errors：0。
- 高頻切換與重載期間，本機 Miniflare 曾在籌碼／商品目錄 D1 查詢輸出兩次暫態 internal error；排序 API 皆為 200，最後乾淨載入與瀏覽器 console 均正常。這不是本次排序路徑的失敗證據，但若後續本機驗收再出現，應另案追查 Miniflare D1 開發環境穩定性。

### 2026-08-05 補充驗收

- 實際重排第二頁時發現 panel 與 canonical order 已更新，但商品下拉選單仍維持舊選項順序；已補上既有 controller 的 option refresh，沒有重建 panel 或重新載入資料。
- 第二頁由 `00981A.TW → 00982A.TW → 009816.TW → 009819.TW` 重排為 `00982A.TW → 009816.TW → 00981A.TW → 009819.TW`；重載後 panel、第一個商品下拉選單與「我的清單」第二頁切片三者完全一致。
- 4 圖滑鼠 drop 前後 `dataRequestCount 8 → 8`、`streamSubscriptionCount 8 → 8`、`panelRenderGeneration 2 → 2`；臨時重複商品的 8 圖 drop 前後 `dataRequestCount 33 → 33`、`streamSubscriptionCount 33 → 33`、`panelRenderGeneration 8 → 8`。
- 1／2／3／4／6／8 圖分別確認排序入口數量為 0／2／3／4／6／8；6／8 圖的 `main` 與 `multi` 選項 disabled，實際模式固定為 `single`。
- 臨時重複商品排序後 8 個 canonical identities 仍全部唯一，取消／移出 grid 後無 ghost、placeholder 或 dragging class；console errors 仍為 0。
- 驗收結束前已將第一頁、第二頁及 8 圖代表頁的 canonical 順序恢復至驗收前基準，並重載確認。

## Sites 保留站

- 候選版本：Sites version 175，source commit `f74b0462e59427bd7f67be481f988b3ce9dd995b`；private deployment `appgdep_6a7279090f8481918f19df1f61ceac42` succeeded。
- 已載入 `panel-reordering.js?v=20260804-panel-reorder-v1` 與 `app.js?v=20260804-panel-reorder-v1`。
- 台股第二頁由 `00981A.TW → 00982A.TW → 009816.TW → 009819.TW` 重排為 `00982A.TW → 009816.TW → 00981A.TW → 009819.TW`；重載後 panel、商品下拉選單及「我的清單」一致，驗收後已恢復原順序。
- 2／3／4／6／8 圖逐一以 pointer 完成相鄰移動及還原；每次 drop 前後 `dataRequestCount`、`streamSubscriptionCount`、`panelRenderGeneration` 均不增加。1280px viewport 下 6 圖為三欄、8 圖為四欄 responsive grid。
- 6／8 圖均固定 `single`，`main`／`multi` disabled；臨時重複顯示 `^TWII` 時四個 canonical identities 仍唯一。
- 最終重載回到 4 圖、多層副圖、第一頁原順序；console errors：0。

## Cloudflare 正式站

- 候選 commit：`f74b0462e59427bd7f67be481f988b3ce9dd995b`；GitHub Actions run `30960948595` completed success。
- workflow 通過 lint、399 tests、38 項 strict validation、free-tier budget、D1 migration、anonymous Access boundary 與 protected health；protected health 確認 `deploymentTarget=cloudflare`、`persistence.d1=true`、commit SHA 相符。
- 已載入 `panel-reordering.js?v=20260804-panel-reorder-v1`、`app.js?v=20260804-panel-reorder-v1` 與同版 `styles.css`。
- 台股第二頁由 `00982A.TW → 009816.TW → 009819.TW → 3231.TW` 重排為 `009816.TW → 009819.TW → 00982A.TW → 3231.TW`；重載後 panel、商品下拉選單及「我的清單」一致，驗收後已恢復原順序。
- 2／3／4／6／8 圖逐一以 pointer 完成相鄰移動及還原；每次 drop 前後 `dataRequestCount`、`streamSubscriptionCount`、`panelRenderGeneration` 均不增加。1280px viewport 下 4 圖為兩欄、6 圖為三欄、8 圖為四欄 responsive grid。
- 6／8 圖均固定 `single`，`main`／`multi` disabled；臨時重複顯示 `00919.TW` 時四個 canonical identities 仍唯一，drop 前後 `dataRequestCount 32 → 32`、`streamSubscriptionCount 32 → 32`、`panelRenderGeneration 7 → 7`。
- 最終重載回到 4 圖、單一副圖、第一頁原順序；console errors：0。

## 歸檔判定

- tasks 6.1～6.4 全部完成；候選程式已在兩個獨立 D1 環境完成永久保存與回復驗收。
- 歸檔後將以最終 archive commit 再發布兩站，並以 Sites version provenance、Cloudflare protected health 及資源版本確認 exact commit；程式資產與上述完整互動候選版相同。
