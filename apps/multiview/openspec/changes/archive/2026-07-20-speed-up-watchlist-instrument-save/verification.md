## 驗收紀錄

### 問題基線

- 正式站變更前 `GET /api/instruments` 三次唯讀量測約為 1.526、1.539、1.561 秒。
- 變更前正式站有 38 個 TDCC continuous targets；互動式儲存會在 foreground 執行完整 target reconciliation，使等待時間隨 catalog、使用者商品與 target 數量成長。

### 自動化驗證

- focused tests：59／59 通過。
- `npm test`：139／139 通過，包含 production build。
- `npm run lint`：通過，零 warning。
- `node --check public/static/app.js`：通過。
- `git diff --check`：通過。
- `npx openspec validate --all --strict`：13／13 通過。
- `npx tsc --noEmit`：不是本專案目前可用的獨立 gate；既有設定未載入 Cloudflare `D1Database`／`Fetcher` 型別，且既有 Worker 檔案仍有型別技術債。本 change 以實際 Sites TypeScript build、ESLint 與 regression tests 作為適用檢查，均已通過。

### 本機瀏覽器驗收

- 在 `http://localhost:3000/` 開啟「我的清單」，對既有 `2330.TW 台積電` 做內容不變的冪等儲存。
- 從按下「儲存商品」至出現「商品已儲存」為 294 ms。
- 儲存後 `2330.TW` 仍位於「台股」第 9／24 位，商品內容與清單順序均正確。

### 正式站驗收

- exact validated source commit：`1b597d7d07ad0f2ebf3f7676ca260dd40e20dc0a`。
- Codex Sites owner-only version：54；deployment：`appgdep_6a5c5f4ff3fc81919c68d12ab6de24aa`；狀態 `succeeded`。
- 正式 URL：`https://quote-chart-multiview.alanyi1112.chatgpt.site`。
- access policy 維持 `custom`，允許 1 位使用者、0 群組。
- 部署後 `/api/instruments` 三次唯讀量測為 1.943、2.006、1.925 秒；此完整 GET 仍包含 canonical payload 的多筆讀取，不含已移除的 foreground full reconciliation。
- 已登入瀏覽器在「錢線百分百」對既有 `2324.TW 仁寶` 做兩次內容不變的冪等儲存：第一次冷啟動 2.284 秒，緊接的 warm request 531 ms，均出現「商品已儲存」。
- 兩次儲存後 `2324.TW` 仍位於第 15／17 位，名稱仍為「仁寶」，清單順序未改變。
- `/api/health` 回傳 `200`、runtime 為 `codex-sites`；TDCC continuous 38／38 targets completed，watchlist prewarming 38 targets 中 3 ready、35 pending、0 retry-waiting，仍由 `github-actions+worker-wait-until` 接手。
- `2324.TW` 的 shareholder distribution target 為 `active: true`、`status: completed`，1／1 週完成、`missingDates: []`、`lastErrorCode: null`；背景單一 target upsert 已更新狀態且未破壞 coverage。
