## Context

目前頁籤級資格以 `symbolsForActiveTab().every(isTaiwanStockSymbol)` 判斷；`isTaiwanStockSymbol` 僅接受 `.TW`／`.TWO`。Sites 保留站的「台股」頁籤將 `^TWII` 台灣加權指數排在第一支，因此全頁即使其餘商品都是台股 ETF 或個股，也會被當成跨市場混合頁籤。另一方面，panel 級 `effectiveChartPresentationMode(symbol)` 已能把不具籌碼資格的商品降級為單一副圖，可作為指數 panel 的安全防線。

## Goals / Non-Goals

**Goals:**

- 讓含台灣市場基準指數與 `.TW`／`.TWO` 商品的「台股」頁籤在 1／2／3／4 圖可選多層副圖。
- 讓基準指數 panel 保持單一技術副圖，不建立籌碼 pane 或相關資料生命週期。
- 保留 6／8 圖固定單一副圖，以及真正跨市場混合頁籤停用多層副圖的規則。
- 不覆寫使用者保存的主副圖模式、籌碼選取與排序。

**Non-Goals:**

- 不替 `^TWII` 增加法人、融資券或 TDCC 籌碼資料。
- 不擴大美股指數、期貨、匯率或任意 `^` 開頭商品的多層副圖資格。
- 不變更 Worker API、D1 schema 或圖表資料來源。

## Decisions

1. 新增明確的台股頁籤相容商品判斷，接受 `.TW`、`.TWO` 與 allowlist 內的台灣市場基準指數（本次為 `^TWII`）。不使用寬鬆的 `symbol.startsWith("^")`，避免美股指數被誤納。
2. 頁籤級資格使用相容商品判斷；panel 級仍使用嚴格的 `.TW`／`.TWO` 籌碼資格判斷。選擇多層副圖時，`^TWII` panel 會有效降級為單一副圖，其餘台股 panel 正常建立多層籌碼 pane。
3. `singleSubchartOnlyChartCount` 仍先於市場資格生效，確保 6／8 圖不因本次 allowlist 而重新開放主圖或多層副圖。
4. 回歸測試直接覆蓋 `^TWII + .TW + .TWO`、真正跨市場商品、單一商品頁及 6／8 圖，避免只以 source regex 取代行為驗證。

## Risks / Trade-offs

- [全域選單顯示多層副圖，但指數 panel 維持單一副圖] → 這是刻意的 panel 級安全降級；測試必須確認指數不建立籌碼 lifecycle，台股商品仍採多層模式。
- [未來新增其他台灣市場指數] → 以明確 allowlist 擴充，不用市場名稱或字首推測。
- [主規格既有圖數政策漂移] → 本次 delta 同步寫明 1／2／3／4 可切換、6／8 固定單一副圖，歸檔時消除矛盾。

## Migration Plan

1. 更新前端資格判斷與測試。
2. 通過完整測試、build、OpenSpec strict validation。
3. 發布 Sites 保留站後驗證台股 1／4 圖可選多層、`^TWII` panel 不建立籌碼 pane、6／8 圖仍固定單一副圖。
4. 若驗收失敗，回滾本次前端版本；不需要資料回復或 migration。

## Open Questions

無。
