# 驗證紀錄

## 功能與持久化

- MultiView built-worker 整合測試以本機 SQLite D1 驗證：目標頁籤不存在時建立一次、已存在時沿用、重複加入回覆 `already_present`，並發寫入會收斂為單一頁籤與單一商品列。
- catalog fixture 同時驗證 `2449.TW` 與 `8069.TWO`，保留 TWSE／TPEx market 與 provider identity；ETF、未知代碼、重複同名頁籤及保留 identity 衝突皆 fail closed。
- 以新 built-worker 實例模擬 5174 重載，由同一 D1 重新讀取後，「選股篩選」與已加入商品各只出現一次。Shioaji 端的重複、建立衝突回讀及確認邏輯由既有 focused tests 驗證。

## 真實商品回歸修正

- 2026-09-22 實際驗收發現 `2454.TW` 被回覆 `catalog_symbol_not_found`。唯讀查核顯示本機 `instrument_catalog` 僅 57 筆本地化 seed，其中 `.TW`／`.TWO` 為 0；同一 D1 的最新 verified `screener_universe` 則有 1,976 檔。
- 修正後仍優先使用 `instrument_catalog`；精確 symbol 缺少時，只讀取最新已發布且 `sourceReview=verified` snapshot 鎖定的 `screener_universe`，並重新驗證 revision、official ordinary-stock classification、市場後綴、代碼與名稱。
- 現行 5173 固定 gateway 重送 `2454.TW` 後回覆 `added`，D1 回讀確認 `local-sites-user / stock-screener-filtered / 選股篩選 / 2454.TW / 聯發科 / yfinance / 台灣股市 / 上市股票`，頁籤維持啟用且非預設。

## 部分失敗與恢復

- 為不中斷目前受管理的 5174 runtime，以隔離式 fetch timeout／offline 故障注入代替實體停服。gateway 回覆不含內部詳情的可重試 503，前端 orchestration 保留 Shioaji 成功、呈現 MultiView 未完成。
- 恢復測試對兩端再送冪等請求：Shioaji 回覆 `already_present`，MultiView 成功，整體收斂為 `complete`，期間沒有補償刪除。

## 安全邊界

- gateway 只接受 loopback 同源、固定 POST path 與單一 canonical `symbol`；不轉送 cookie、authorization、caller header 或 target 控制欄位。
- endpoint source-contract 與 built-worker 測試確認只讀取 catalog，只寫入 `user_tabs`／`user_instruments`，不執行 DDL、provider fetch、行情訂閱、籌碼預熱／回補、委託或 runtime lifecycle。schema 未完成 migration 時回覆可重試 `persistence_unavailable`，不自行建表。
- MultiView focus／visibility refresh 只走 read-only purpose，以 single-flight 收斂，不輪詢、不切換目前頁籤或圖表。

## 自動驗證

- `pnpm build`：通過。
- `pnpm typecheck:multiview`：通過。
- 本 change 的 MultiView focused lint：通過。
- `npm --prefix apps/multiview test`：786 項通過、0 失敗。
- MultiView 新增 focused integration tests：15 項通過、0 失敗。
- 選股雙端 helper／gateway focused tests：21 項通過、0 失敗。
- `stock-screener-panel.browser.test.ts`：23 項通過、0 失敗；測試執行仍有一則既有 React `act(...)` warning。
- `openspec validate sync-stock-screener-results-to-multiview-list --strict`：通過。
- `git diff --check`：通過。

## Repo-wide 非本 change 失敗

- `pnpm test`：2556 項通過、4 項失敗。失敗均為 smart-order 測試 timeout：`scripts/smart-order-runtime/launchagent-installer.test.mjs` 1 項，`scripts/smart-order-readonly-gate-runner.test.mjs` 3 項。
- 單獨重跑後仍有兩項 timeout：LaunchAgent bundle 安裝驗證 1 項，Runtime-owned clock 驗證 1 項。這些檔案本 change 未修改。
- `pnpm lint:multiview` 被既有 `apps/multiview/tests/stock-screener-v4-publisher-route.test.mjs` 的未使用 `evidenceHash` warning 擋下；本 change 檔案的 focused lint 通過。
