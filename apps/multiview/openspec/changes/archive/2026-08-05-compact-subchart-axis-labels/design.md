## Context

籌碼副圖與技術副圖分別在 `chip-panes.js` 與 `app.js` 建立 Lightweight Charts series，現有 price formatter 各自強制千分位完整張數或固定小數位。這些 formatter 同時可能被 readout 使用，因此本次需要明確區分「數值軸」與「圖例／游標讀值」的顯示責任。

## Goals / Non-Goals

**Goals:**

- 提供可由籌碼與技術副圖共用、可單元測試的數值軸格式函式。
- 張數千位縮寫為 `K張`，百分比與技術值移除尾端無意義的零。
- 保留非零小數、負號、既有單位及原始數值精度。
- 以實際瀏覽器圖表確認右側刻度顯示變短。

**Non-Goals:**

- 不改動 API payload、資料計算、資料來源或時間對齊。
- 不改動 header、游標 readout、詳細資料表及主圖價格軸格式。
- 不新增其他大數單位或改變圖表尺度。

## Decisions

1. 新增瀏覽器端共用 formatter 模組，並在 `app.js` 與 `chip-panes.js` 載入前引入。相較在兩個大檔案各寫一份規則，共用模組可避免 `K` 門檻及小數策略漂移，也能直接以 Node VM 測試。
2. 張數以圖表 series 已使用的「張」為輸入單位：絕對值達 `1,000` 時除以 `1,000` 並加上 `K張`；未達門檻仍顯示完整必要數字與 `張`。縮寫最多保留一位必要小數，例如 `1,500` 顯示為 `1.5K張`。
3. 百分比軸最多保留兩位小數但不設定最少位數，因此 `2.00`、`2.50` 分別顯示為 `2%`、`2.5%`。
4. 技術指標軸延續現有精度上限：震盪指標最多兩位小數；自適應指標依量級最多兩位小數；兩者都不再強制補零。readout 繼續使用既有 formatter，避免本次軸寬需求改變資訊列格式。

## Risks / Trade-offs

- [風險] `K` 縮寫會降低大張數刻度的精細度 → 最多保留一位小數，且只套用於軸刻度，不影響 readout 與詳細資料。
- [風險] 共用 script 載入順序錯誤會讓 formatter 不存在 → 在 HTML 中固定置於 `app.js` 與 `chip-panes.js` 前，並以 source contract 與瀏覽器驗收檢查。
- [風險] Lightweight Charts 可能用同一 formatter 顯示 series 最後值 → 現有相關 series 已設定 `lastValueVisible: false`，因此影響限於數值軸。

## Migration Plan

1. 新增共用 formatter 與單元測試。
2. 將籌碼副圖及技術副圖的 `priceFormat.formatter` 改接共用函式。
3. 更新靜態資源版本、執行完整建置與測試，再以本機實際圖表驗收。
4. 若需回復，還原 script 引用與 formatter 接線即可；無資料遷移。

## Open Questions

無。
