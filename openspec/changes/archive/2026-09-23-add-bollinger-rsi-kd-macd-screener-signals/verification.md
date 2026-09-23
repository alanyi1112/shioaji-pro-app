# 驗證紀錄

## 驗收結論

`add-bollinger-rsi-kd-macd-screener-signals` 已完成實作與本機實際資料驗收。四個新條件預設關閉；啟用後只查詢 immutable v7 snapshot，不在 GET、UI 或圖表端臨時計算。資料不足時保留在完整母體並回報 unknown，不補造 K 線、不縮短公式。

## 實際 snapshot 與 coverage

- snapshot：`5381c763-d05b-4c09-aefb-f72a0751ff34`
- 有效交易日：2026-09-22
- 公式版本：`after-market-v7-boll-rsi-kd-macd-1`
- 來源 mapping：`official-daily-ohlcv-v2`
- 全母體：1,976 檔
- TWSE：target 1,084、covered 1,084、完整 130 日 1,002、indicator ready 1,017、暖機不足 2、交易日不連續 65。
- TPEx：target 892、covered 892、完整 130 日 669、indicator ready 679、暖機不足 3、交易日不連續 210。
- 每一模式均符合 `pass + fail + unknown = 1,976`。

## 逐模式實際結果

| 條件 | 模式 | pass | fail | unknown | 代表商品 |
| --- | --- | ---: | ---: | ---: | --- |
| BOLL | 上軌外 | 122 | 1,576 | 278 | 1315.TW |
| BOLL | 下軌外 | 20 | 1,678 | 278 | 1110.TW |
| BOLL | 中軌附近 | 365 | 1,333 | 278 | 1210.TW |
| RSI | 高檔死亡交叉 | 16 | 1,683 | 277 | 2419.TW |
| RSI | 低檔黃金交叉 | 1 | 1,698 | 277 | 3171.TWO |
| KD | 高檔死亡交叉 | 6 | 1,693 | 277 | 2303.TW |
| KD | 低檔黃金交叉 | 18 | 1,681 | 277 | 1590.TW |
| MACD | 零軸下方接近 | 57 | 1,641 | 278 | 1233.TW |
| MACD | 零軸上方接近 | 30 | 1,668 | 278 | 1236.TW |
| MACD | 向上穿越零軸 | 47 | 1,651 | 278 | 1219.TW |
| MACD | 向下穿越零軸 | 11 | 1,687 | 278 | 1409.TW |
| MACD | 零軸下黃金交叉 | 73 | 1,625 | 278 | 1295.TWO |
| MACD | 零軸下死亡交叉 | 14 | 1,684 | 278 | 1905.TW |
| MACD | 零軸上黃金交叉 | 22 | 1,676 | 278 | 1593.TWO |
| MACD | 零軸上死亡交叉 | 18 | 1,680 | 278 | 1217.TW |
| MACD | 任意黃金交叉 | 101 | 1,597 | 278 | 1295.TWO |
| MACD | 任意死亡交叉 | 35 | 1,663 | 278 | 1217.TW |

各代表商品的 evidence 均保存 D／P／P2、實際公式參數、raw indicator 值、逐子條件 verdict／reason 與 SHA-256 evidence hash；驗證工具會從 snapshot 重新查詢並核對 hash，不以畫面格式化值重新判定。

## 量能與翻頁

- 量能代表樣本 D 為 2026-09-22，baseline 使用 2026-08-25 至 2026-09-21 共 20 個交易日，明確排除 D。
- 該樣本平均量為 1,769,321.05 股，D／baseline 比為 2.2512126897489857。
- BOLL 上軌外共 122 筆，API 以 50／50／22 三頁完整取得，unique rows 122，沒有重複。
- 第 101 筆候選為 `6674.TW`，查核時不在個人清單；實際 UI 點選後指定 K 線圖切換為 6674，結果卡顯示 2026-09-22、公式版本與 evidence，瀏覽器 console 無 error。

## 原子發布與副作用

- integration test 證明 staging／D1 batch 寫入失敗時會清除 staging 且保留既有 head；checkpoint 落後時維持 preparation pending。
- 合法的逐商品缺 session 不阻擋整批發布，而是保留該商品並標示 `non_adjacent_sessions`；非法 OHLCV 則標示 `invalid_ohlcv`。
- 驗證查詢前後 D1 `total_changes()` 為 0；`user_tabs` 6、`user_instruments` 67、`screener_chip_receipts` 143、`screener_tdcc_weekly` 13,822、`screener_snapshots` 11，均未改變。
- 實際 UI 驗收沒有按下任何加入清單控制；沒有觸發 provider、DDL、Shioaji、行情訂閱、runtime lifecycle、交易草稿或委託。
- `pnpm local-runtime status` 顯示 simulation API、business session、5173 Web 與 5174 MultiView 正常，smart-order write master disabled，active obligations 0，unprotected remainder 0。

## 自動化驗證

- `pnpm test`：255 個 test files、2,582 個 tests 全部通過。
- `pnpm test:multiview`：793 個 tests 全部通過。
- focused v7／criteria UI／gateway：3 個 test files、29 個 tests 全部通過。
- v7 publisher／route integration：10 個 tests 全部通過。
- 選股 browser tests：25 個 tests 全部通過。
- `pnpm build`：通過。
- `pnpm typecheck:multiview`：通過。
- v7 相關 ESLint：通過。
- `openspec validate add-bollinger-rsi-kd-macd-screener-signals --strict`：通過。
- `git diff --check`：通過。

完整 `pnpm test:browser` 另有 4 個與本 change 無關的 `intraday-monitor-panel.browser.test.ts` 失敗：fixture 使用 2026-09-04，但測試執行時 current session authority 為 2026-09-22，導致事件被正確拒絕而未顯示。其餘 153 個 browser tests 通過；本 change 的 25 個選股 browser tests 全數通過。`pnpm lint:multiview` 另有兩個既有警告，分別位於 v4 publisher test 的未使用變數及 v6 route 的 expression statement；v7 相關檔案以 `--max-warnings=0` 驗證通過。
