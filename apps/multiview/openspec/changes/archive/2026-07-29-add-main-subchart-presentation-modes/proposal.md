## Why

目前頂端的「籌碼副圖」控制只能在「單一副圖／多層副圖」之間切換，名稱也無法涵蓋技術副圖；使用者若只想比較主 K 線，必須逐一取消副圖內容，且不可清楚地回到原本選擇。應將它提升為完整的「主副圖」呈現模式，提供只顯示主圖的明確入口，並把首次預設改為較精簡的單一副圖。

## What Changes

- 將頂端控制標籤由「籌碼副圖」改為「主副圖」，下拉選項依序提供「主圖」、「單一副圖」、「多層副圖」。
- 新增「主圖」模式：每個 panel 只顯示主 K 線，副圖槽位完全收合並將空間讓回主圖，不清除技術指標、籌碼選取、series 或群組排序偏好。
- 「主圖」模式必須停止不可見技術副圖與籌碼 pane 的 resize、crosshair、輪詢、回補與資料 request lifecycle；切回單一或多層副圖時依保存狀態恢復。
- 將沒有保存模式偏好的首次預設由多層副圖改為單一副圖；既有 A／B 保存值分別遷移為單一／多層副圖，不覆寫使用者已明確保存的偏好。
- 主圖與單一副圖適用所有市場；多層副圖仍只適用符合條件的全台股頁籤或台股單一商品頁。受限市場不得停用整個下拉選單，只停用多層副圖選項。
- 更新模式狀態、版面、資產 cache-buster、契約測試與正式站 browser-visible 驗收矩陣。

## Capabilities

### New Capabilities

- `chart-presentation-modes`：定義「主圖／單一副圖／多層副圖」三種全域呈現模式、首次預設、偏好遷移、版面收合與不可見副圖 lifecycle。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`：將既有 A／B 控制納入三模式，保留籌碼選取與排序相容性，並把市場限制改為只限制多層副圖選項。
- `codex-sites-rewrite`：正式站驗收需涵蓋三模式、全市場主圖模式、台股多層資格及資產版本更新。

## Impact

- 前端：`public/static/index.html`、`public/static/app.js`、`public/static/chip-panes.js`、`public/static/styles.css`、`public/static/chart-interactions.js`。
- 偏好：既有 `compactSubchartMode` A／B 值需安全遷移；不新增伺服器端個人資料或 D1 schema。
- 測試：`tests/rendered-html.test.mjs`、`tests/subchart-interaction.test.mjs` 與相關 panel lifecycle／匯出契約。
- 部署：更新前端資產 cache-buster，並以已登入 Codex Sites 正式站驗證 1／2／3／4／6／8 圖及單一商品頁。
