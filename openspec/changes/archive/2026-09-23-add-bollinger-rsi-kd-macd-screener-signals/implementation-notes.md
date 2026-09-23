# 實作盤點紀錄

## 2026-09-22 v7 前置稽核

- v6 criteria／preference 位於 `src/lib/stock-screener-v6.ts`，API parser 位於 `src/lib/stock-screener-api.ts`，D1 publisher／repository／route 各自以 v6 檔案隔離；v7 採新增檔案與 `schema_version=7`，不修改 v1–v6 row 語意。
- D1 `screener_snapshots` 與 `screener_snapshot_rows` 已可依 `schema_version` 保存 immutable snapshot，因此 v7 不需要新增資料表；gateway 目前只允許固定 `status`／`results` GET 路徑，v7 只擴充合法 query allowlist。
- canonical 公式沿用 `src/lib/indicators.ts` 與 reference tests：BOLL(20,2)、Wilder RSI5／10、KD(9,3,3，K／D 由 50 初始化)、MACD(12,26,9)；OHLCV 使用 `official-daily-ohlcv-v2`、成交量內部單位為股。
- 本機 D1 的 `screener-ohlcv-v4-progress` 為 2026-09-22、130 sessions、260/260 targets、remaining/failed 均為 0；最新 v4/v6 snapshot 母體皆為 1,976 檔。
- 130-session canonical source catalog：TWSE 1,084 檔（完整 130 日 1,002 檔）、TPEx 893 檔（完整 130 日 669 檔）；本次 v7 base universe 實際納入 TPEx 892 檔。publisher 會逐檔核對官方交易日 suffix，不以「資料列數達暖機門檻」代替 session continuity，也不縮短公式或補造資料。

## 2026-09-22 實作後全市場結果

- 已原子發布 snapshot `5381c763-d05b-4c09-aefb-f72a0751ff34`，有效交易日為 2026-09-22，公式版本 `after-market-v7-boll-rsi-kd-macd-1`，來源 mapping `official-daily-ohlcv-v2`。
- TWSE target／covered 為 1,084／1,084，indicator ready 1,017，暖機不足 2，交易日不連續 65；TPEx target／covered 為 892／892，indicator ready 679，暖機不足 3，交易日不連續 210。
- `covered` 代表 publisher 已對母體內每檔商品完成處理；暖機不足與交易日不連續保留為逐商品 unknown，不會縮小母體，也不會誤判為整批 publication gate 失敗。
- 17 種模式皆完成全母體守恆與代表商品驗證；量能代表樣本以 2026-08-25 至 2026-09-21 的 20 個交易日為 baseline，明確排除 D=2026-09-22。
- 模擬 D1 batch failure 會刪除 staging 且保留既有 head；落後 checkpoint 會回傳 preparation pending；合法逐商品缺 session 會發布 continuity unknown。
