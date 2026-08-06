## 實作證據

### 2026-08-06 前置工作樹保護

- RealTimeStock branch：`main`，開始實作時與 `origin/main` 同步。
- 本 change 以外的既有異動：`plan-cloudflare-private-access-shioaji-server` 原 active 目錄刪除，以及 `openspec/changes/archive/2026-08-06-plan-cloudflare-private-access-shioaji-server/` 未追蹤歸檔目錄。
- 上述檔案屬於先前取消 change 的合規歸檔，不納入本 change 的匯入、驗證或未來精準 stage 範圍。

### 2026-08-06 MultiChart 乾淨來源基準

- Repository：`https://github.com/alanyi1112/MultiChartOnCodexSite.git`
- 乾淨隔離 checkout：位於本機暫存目錄，不讀取 sibling checkout 的未提交或未追蹤內容。
- 遠端最新分支：`codex/restore-cloudflare-small-group-login`
- 原始完整 SHA：`ecae7cac837f06085801c96f3da0c570051d66e7`
- Commit 時間：`2026-08-05T22:13:26+08:00`
- 相對 `origin/main`：最新分支領先 25 commits，沒有落後 commit。
- 另一個 `codex/add-shioaji-realtime-taiwan-charts` 分支相對 `main` 已分岔，且其 change 明確停止 Cloudflare realtime 方案，因此不直接 merge。

### 2026-08-06 初步 ownership 與資產盤點

- 全部 306 個既有 commits 的 author identity 均為 repo 擁有者 `alanyi1112`；使用者另已確認應用程式為本人自行開發。
- Repository 內可見二進位／視覺資產只有 `public/favicon.svg` 與 `public/og.png`，最初提交者同為 repo 擁有者；未發現字型、影片、PDF 或 WASM vendored asset。
- 圖表核心目前由 `public/static/index.html` 從 unpkg 載入 `lightweight-charts@5.0.9`，必須在授權基準 commit 改成本機固定 dependency。
- 套件 lock metadata 含 MIT、Apache-2.0、ISC、MPL-2.0、LGPL-3.0-or-later 等第三方授權；這些依賴不重新標示為專案 AGPL，正式聲明以 direct dependency 與實際 bundle／distribution 掃描為準。

### 2026-08-06 授權完成來源 SHA

- 授權基準完整 SHA：`d6d7e0d64b928958f6b20523f39d8651ca584bae`
- Parent：`ecae7cac837f06085801c96f3da0c570051d66e7`
- 本機 source branch：`codex/license-local-integration`；此 SHA 尚未 push，RealTimeStock 以完整 commit tree 匯入並在 `UPSTREAM.md` 保存 parent 與 local licensing commit。
- 新增：AGPL-3.0-only `LICENSE`、`package.json` license、README 授權段落、`THIRD_PARTY_NOTICES.md`、Lightweight Charts Apache-2.0 副本與 UI attribution。
- `lightweight-charts` 固定為 `5.0.9`，由 lockfile 安裝並在 build／start 前複製至本機 public output；靜態掃描未再發現 unpkg／jsDelivr runtime 載入。
- 授權基準建立時 `npm run test`：433 tests 全數通過；build 通過。
- `npm run lint`：通過；生成的第三方 vendor bundle明確排除 lint，仍由版本與 hash gate 管理。
- 授權基準建立時 `npm audit --omit=dev`：0 vulnerabilities；整合後再以 workspace 與來源 lockfile override 固定已修補的 PostCSS、Undici、Babel 與 esbuild，完整 `pnpm audit` 及 `npm audit --package-lock-only` 均為 0 vulnerabilities。
- 秘密與外部圖表 CDN pattern scan：未發現結果。

### 2026-08-06 匯入與 workspace 驗證

- 以 `d6d7e0d64b928958f6b20523f39d8651ca584bae` 的固定 tree 匯入 `apps/multiview/`；排除來源 `.git`、`node_modules`、build output、D1／SQLite、`.env*` 與 `.dev.vars`。
- `apps/multiview/UPSTREAM.md` 保存來源 URL、branch、原始 SHA、授權基準 SHA、匯入方式、排除項目及後續更新規則。
- 根目錄 pnpm workspace 已納入 `apps/multiview`，並提供獨立 dev、build、test、lint、typecheck 與 governance 驗證入口。
- 根 CI 已加入 MultiView governance 與 433 項測試；`npm run lint:multiview`、`npm run typecheck:multiview`、`npm run verify:multiview-governance` 及 `git diff --check` 均通過。

### 2026-08-06 本機 runtime、行情與交易邊界

- `scripts/multiview-state` 已以 `/private/tmp/realtimestock-multiview-state-test` 完成 22 個 migration、`PRAGMA integrity_check=ok`、schema coverage gate、migration 前備份及備份 integrity 驗證；正式預設路徑在 repo 外的 `~/Library/Application Support/RealTimeStock/MultiView/`。
- `scripts/realtimestock-runtime` 已加入 5174、獨立 status、simulation restart、非 simulation 停止／拒絕、資料保留 uninstall，以及平日 16:45 daily／PE 與週六 10:00 TDCC 有界 LaunchAgent；排程 secret 只存 repo 外 `0600` 檔案。
- Shioaji data-only adapter 的 allowlist、loopback、method、query/body、8 商品、32 KiB request、5 MiB response 與 timeout 均有 contract test；order／account／CA／token／server 與未知路徑在轉送前 `403`。
- 台股 realtime coordinator 以單一 SSE、Snapshot／Kbars bootstrap、reference count、cooldown、generation／sequence 與來源切換管理 `.TW`／`.TWO`／`^TWII`；`FUT`／`OPT` 不在 allowlist。
- 右鍵 OrderTicket bridge 只接受 `code`、`security_type`、`exchange`，並由 data-only adapter 重新解析；任何交易內容或帳戶／CA／token 欄位整體拒絕，且 MultiView runtime 靜態掃描未發現交易 endpoint 或交易模組 import。

### 2026-08-06 UI、指標與瀏覽器驗收

- 實際於 `http://localhost:5174` 驗證來源模式為自動／Shioaji 即時／Yahoo 延遲，週期只顯示日／週／月，Volume MA5／MA10／MA20 均出現在讀值區。
- 逐一切換 1／2／3／4／6／8 圖，對應 panel 數為 1／2／3／4／6／8；原終端 `http://localhost:5173` 的「版面」可見 `MultiView（開新分頁）`，且目前 workspace 未變更。
- 初次瀏覽器驗收發現 workerd 直接連線宿主 `127.0.0.1:8080` 時回 `502`，但同一宿主的 `/api/v1/info` 實測為 simulation `200`；因此改由 Vite `pre` middleware 使用同一套 data-only adapter 驗證後，透過 Node loopback transport 轉送，不放寬 endpoint、method、schema、大小或 timeout 邊界。
- 修正後在來源模式「自動」下，第一圖顯示 `08/06 14:30・即時`，tooltip 為「Shioaji 即時行情來源時間」，且不再出現 fallback 狀態；修正前的測試也已確認 adapter 不可達時會明確切換 Yahoo 延遲備援，不會把 `/health` 或 SSE heartbeat 冒充行情可用。
- 右鍵選單可顯示啟用的「下單」，代表商品契約已由本機 Shioaji adapter 解析；另以 `00919` 驗證 bridge 回 `302` 至 `http://127.0.0.1:5173/?popout=ticket&bridge=multiview&code=00919&security_type=STK&exchange=TSE`，查詢參數只有商品契約資訊，未送出任何委託。
- 即時指標使用 150 ms latest-wins full-state 計算，MA、BOLL 與副圖 series 在 selection 不變時重用；IND 無量時清空 Volume 與 Volume MA，full recompute／latest-wins／series churn contract test 通過。

### 2026-08-06 最終自動驗證

- RealTimeStock：21 個 test files、140 tests 全數通過；build 通過。
- MultiView：451 tests 全數通過；lint、typecheck 與 build 通過。
- `pnpm audit`：0 vulnerabilities；`apps/multiview` 的 `npm audit --package-lock-only`：0 vulnerabilities。
- Governance、授權／attribution／CDN／交易 import／秘密掃描、`git diff --check` 與 `openspec validate integrate-local-multiview-with-shioaji --strict` 全數通過。
- 使用者於 2026-08-06 確認本 change 完整移除正式行情唯讀驗收；MultiView 改為 simulation-only，adapter 對非 simulation 行情／契約／串流回 `simulation_required`，runtime 切至其他模式時停止 5174。
- 未執行／仍保持未完成：Cloudflare 私有 D1 export 授權與 seed、正式盤後 coverage、Mac 重新登入實測，以及任何正式環境行情或交易能力。

### 2026-08-06 個人清單最小化遷移

- 以既有合法 Cloudflare OAuth session 唯讀確認權威 `multichart-production` D1；active owner 可唯一對應目前使用者，來源為 4 個 `user_tabs` 與 24 個 `user_instruments`。
- 遠端查詢在 SQL 投影階段即把來源 `user_id` 替換為 `source-user`；匯出 snapshot 不含 email、Access 名單、audit、secret、交易帳戶或 RealTimeStock watchlist。
- 新增本機 opaque user 遷移路徑，將單一使用者 snapshot 映射為 `local-sites-user`，預設 dry-run，只在明確 `--apply` 時以 SQLite transaction upsert。
- 正式本機 D1 migration 22/22 通過；寫入前備份 `PRAGMA integrity_check=ok`。匯入 4 個頁籤、24 個商品後回讀 28 rows，target hash `f5e7132cb80b965e6b1762d8c889317975244cb1ed448b351d78008c43452c65` 與計畫一致，最終 `PRAGMA integrity_check=ok`。

### 2026-08-06 loopback 啟動修正

- 實際 E2E 發現 vinext CLI 不接受 Vite 的 `--host`／`--strictPort` 參數，會退回預設 `localhost` 並只監聽 `::1`，造成既定 `127.0.0.1:5174` 入口與健康檢查拒絕連線。
- 本機 dev／start 與 runtime 改用 vinext 支援的 `--hostname 127.0.0.1 --port 5174`；Vite config 仍保留 `strictPort: true`。
- LaunchAgent 執行 pnpm 產生的 `/bin/sh` command shim 時另回 exit 126；runtime 改以固定 `/opt/homebrew/bin/node` 執行 workspace `vinext/dist/cli.js`，避免依賴 shell shim，仍由 lockfile 固定相同 vinext 版本。

### 2026-08-06 simulation 下單、改單與刪單端到端驗收

- 使用者明確授權僅在 simulation 以最小有效數量驗收；送單、改價與取消前皆重新確認 `runtime_mode=simulation`、`api_simulation=true`，且 `production_readonly_job=stopped`。
- 從 MultiView 的 `00919` 圖表右鍵選單開啟 RealTimeStock OrderTicket；bridge 僅帶入 `code`、`security_type`、`exchange`，下單內容仍由既有 OrderTicket 的兩階段確認流程建立。
- 以 1 張、LMT、ROD、現股送出非市價化的 simulation 買進委託，畫面顯示委託成功且狀態為 `PreSubmitted`。
- 在 RealTimeStock 委託表中精確鎖定 `00919` 該列，將價格由 26.95 改為 27.00；畫面顯示改價成功，列表回讀 27.00。
- 隨後取消同一筆 `00919` 委託；畫面顯示委託已取消，列表最終狀態為 `Cancelled`，且該列不再提供改價、改量或取消動作。
- 全程未切換非 simulation、未載入 CA、未呼叫真實委託；非 simulation fail-closed 邊界另由 runtime 與 adapter contract tests 驗證。
