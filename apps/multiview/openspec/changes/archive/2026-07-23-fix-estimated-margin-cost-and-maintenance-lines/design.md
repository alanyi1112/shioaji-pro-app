## Context

`estimated-margin-v1` 會先核對「本列前日餘額等於上一列今日餘額」及「本列流量可回推出本列今日餘額」。任何一項不合即把 `previousCost` 清為 `null`；後續即使本列流量已恢復可核對，也只會回傳 `cost_chain_interrupted`，除非融資餘額曾歸零。正式站 `3231.TW` 在 2026-02-11 今日餘額 60,690 張與 2026-02-23 前日餘額 60,627 張相差 63 張，因此成本線永久停在 2 月。

估算維持率的 calculator 已要求合法 `marginLoanRatio`，但 service 裝飾所有資料列時固定傳入 `null`。使用者提供的產品參考文件明定個股估算公式為 `當日收盤價 ÷（融資買進均價 × 60%）× 100%`；此處的 60% 是模型參數，不是要查詢逐商品實際融資成數。

## Goals / Non-Goals

**Goals:**

- mismatch 當日不造數，下一個可自洽交易日自動建立新估算區段。
- 讓 response 與 UI 能區分首次 `seeded`、歸零後重建及中斷後 `reseeded`。
- 依參考文件的固定 60% 模型計算個股估算融資維持率。
- 讓估算融資維持率副圖產生合法線圖，並清楚揭露 60% 是估算參數。
- 保持同一 `margin-short` response、D1 日資料及既有 pane lifecycle 相容。

**Non-Goals:**

- 不回推 mismatch 的未知餘額調整價格，也不把差異視為買進、賣出或現償。
- 不宣稱估算成本是投資人實際成交均價。
- 不宣稱估算維持率等同商品實際融資成數、個別券商、客戶整戶或追繳維持率。
- 不新增付費資料來源、credential 或 D1 migration。

## Decisions

### 1. mismatch 後保留單日 gap，再以新區段恢復

calculator 新增 `reseedPending` 狀態。跨列餘額或當日本身流量不平時，該列保持 `partial` 與 `estimatedCostPrice=null`，並清除舊成本。其後第一個同時滿足「前日餘額等於上一列今日餘額」及「當日流量可核對」的交易日，以當日收盤價 seed 全部當日餘額，回傳 `status=reseeded` 與 `reseeded=true`。

這會犧牲中斷前後成本的可比性，但不會為未知調整假造價格；使用者仍可從 gap 與 metadata 看出新區段。替代方案是以舊平均成本直接吸收不明差異，雖可畫出連續線，卻等同假設未知部位具有舊成本，因此不採用。

### 2. 公式版本升為 `estimated-margin-v2`

重新起算會改變 mismatch 後的輸出，cache 與 response 必須使用新公式版本，避免前端或 D1／edge cache 混用永久中斷的 v1 結果。新欄位採 additive nullable 相容，既有前端仍可讀取成本與維持率。

### 3. 維持率固定採 60% 個股估算模型

每個具有合法收盤價與估算融資成本的交易日，依 `收盤價 ÷（估算融資成本 × 0.6）× 100%` 計算。response 的 `marginLoanRatio` 保留 60%，但來源 MUST 標示為估算模型參數，不能宣稱是商品當日實際融資成數。缺少收盤價或估算成本時維持 `null`，不得 forward-fill 或內插。

這個決策直接遵循使用者提供的「大盤與個股融資維持率與買進均價計算說明」。替代方案是串接 TWSE／TPEx 逐商品調整成數，但那會改變參考指標定義，因此不納入本變更。

### 4. 前端沿用既有 pane，只補齊狀態語意

維持率 pane 已有折線、標題讀值、右鍵線圖項目與詳細資料，不新增 pane 或第二次融資請求。前端只需接受 `reseeded` 與來源文字，並繼續只繪製合法非空值；mismatch gap 與維持率缺值不得 forward-fill。

舊版已儲存的多層副圖偏好可能只列出融資券群組原本的 pane。將 `defaultsVersion` 升為 10；只有舊版本、非空選取且已選至少一個融資券 pane 時，才一次補入 `estimated-margin-maintenance`。寫入版本 10 後若使用者明確移除，後續讀取不得再加回。

由於正式站的 `app.js` 與 `chip-panes.js` 使用長期版本 query，這次 MUST 同步更新兩個 asset URL 的版本值，避免瀏覽器沿用仍會永久中斷成本鏈或不執行 pane 偏好遷移的舊程式。

## Risks / Trade-offs

- [重新 seed 會讓新區段失去中斷前完整成本歷史] → 明確標示 `reseeded`、gap、日期及公式版本。
- [固定 60% 不反映個別商品降成或券商實際授信條件] → 名稱保留「估算」，詳細資料明列 60% 模型參數與限制。
- [參考指標日後改版] → 來源名稱與公式版本公開，變更時必須另升版本並更新 fixtures。

## Migration Plan

1. 先加入 calculator fixtures 與 service integration tests。
2. 升級公式版本及 additive response metadata，不修改 D1 schema。
3. 本機驗證 `3231.TW` 在 2026-02-23 保留 gap、後續重新出現成本與維持率。
4. 建置並部署 owner-only Sites 候選版本，以正式 API 及已登入 UI 驗證主圖與副圖。
5. rollback 時回退 Worker／前端版本；既有 D1 raw margin rows 不需回滾。

## Open Questions

無。
