# MultiChartOnCodexSite

本專案用來將 [`alanyi1112/quote-chart-multiview`](https://github.com/alanyi1112/quote-chart-multiview) 完整改寫為 Codex Sites 相容網站。目標是保留原產品的多圖版型、圖表與指標、即時行情、商品搜尋、清單管理、持久化與報價核對能力，完成程式與功能等效驗證後部署到 Codex Sites。

目前狀態：Sites runtime 改寫版已以 private access 部署至 `https://quote-chart-multiview.alanyi1112.chatgpt.site`，最新為 Sites version 22。已包含多圖前端、Worker API、Yahoo Chart／Hyperliquid 行情、TypeScript 技術指標、Workers SSE、D1 個人清單、D1 K 線快取、TWSE／TPEx 台股核對、Massive 第二來源，以及台股個股十種籌碼副圖與 A／B 顯示模式。正式站 `2330.TW`／`8069.TWO` 的 API 與可見 UI 驗收均已通過，pane lifecycle 也不再產生預期取消請求的 console error。

## 架構方向

- 前端：以 React / vinext 改寫並由 Codex Sites 託管。
- 後端：以 Sites / Cloudflare Workers 相容的 TypeScript API、streaming 與資料存取重寫，不沿用 Render 作為新版正式後端。
- 來源專案：`/Users/alanyi/Documents/報價線圖multiview`。
- 既有 Render 正式服務：僅作為改寫期間的功能與 live 行為對照，不作新版正式依賴，也不在本專案中變更。

正式實作前，需先以 OpenSpec 建立完整 parity 清單，確認市場資料來源、即時傳輸、指標計算、持久化、前端互動與部署驗收標準。

## 主要入口

- `AGENTS.md`：Codex 工作規則、第二大腦路徑與安全邊界。
- `openspec/`：OpenSpec proposals、design、specs、tasks 與 archive。
- `.codex/skills/openspec-*`：本機 OpenSpec 指令入口；預設不提交。
- Obsidian 駕駛艙：`MultiChartOnCodexSite/專案工作流程.md`。

## 本機圖表時框與台股成交量

本機 `127.0.0.1:5174` MultiView 提供 1／5／15／60 分 K 與日／週／月 K；
「分 K」是分鐘 K 線。分鐘 K 在相鄰 `Asia/Taipei` 日期之間顯示 1.2 CSS px
亮黃色分日線，日／週／月 K 與同日缺口不顯示。

台股整股 `STK` 的 canonical 圖表成交量為 `common_lot`（張）。Shioaji lot
不換算，Yahoo／TWSE shares 除以 1,000 並保留小數張。只有同一批 Shioaji
Kbars 才要求與 RealTimeStock 主交易畫面的 daily OHLCV 完全相同；Yahoo／TWSE
fallback 保留 provider 與 source unit，只保證單位與完整 payload 內部一致。
這項本機能力不會替 Sites／Cloudflare 啟用 Shioaji，也不會寫入 D1 verified
canonical history。詳細安全與驗收矩陣見 `docs/local-runtime.md`。

## 台股個股籌碼副圖

- 適用範圍：商品目錄中 `quoteType=EQUITY` 且 exchange／canonical symbol 相符的 `.TW`、`.TWO` 普通股；目前只支援日 K。
- 十個 pane：外資、投信、自營商、三大法人合計、外資持股、融資、融券、借券、大戶持股、散戶持股。
- 1／2／3 圖可切換 A 單一副圖或 B 多層副圖，首次預設 B；4／6／8 圖與 focus mode 固定 A，離開後恢復原偏好。
- B 預設顯示三大法人合計、融資、融券、大戶持股、散戶持股；每個 panel 依 `tabId + symbol` 保存 A 最後項目與 B 勾選組合。
- 大戶／散戶是 TDCC 集保持股級距，不代表投資人身分。預設大戶為分級 15（1,000,001 股以上），散戶為分級 1 至 3（10,000 股以下）。
- 日資料以 FinMind 歷史 API 為主；TPEx／TWSE 合法 OpenAPI 可補最新可證明欄位；股權分散使用 TDCC 每週全市場快照。來源細節見 `docs/research/2026-07-15-taiwan-stock-chip-data-sources.md`。

### Runtime 設定與限制

- `FINMIND_API_TOKEN` 為可選的 Sites runtime secret；已設定時提高免費額度並允許完整要求範圍，未設定時每次 FinMind 查詢保守限制在約 370 天內。
- token 只會放在伺服器端 `Authorization: Bearer` header；健康檢查只回傳是否已設定，不回傳值。
- 同源 API 為 `GET /api/taiwan-stock-chip`。D1 依資料族群保存 coverage、最近成功時間與安全 reason code，並提供 single-flight、12 秒 timeout、negative cache 與 stale fallback。
- TDCC OpenAPI 主要提供最新週快照；更早歷史只顯示 D1 已合法累積的日期，不爬一般網頁、不插值、不 forward-fill。
- 八大行庫買賣超已依需求延後，不在本次變更範圍。

### Sites version 22 正式驗收

- 已登入 owner-only 正式站驗證 `2330.TW` 與 `8069.TWO` 的十個 pane；日資料日期為 2026-07-15，法人、外資持股、融資融券與借券來源為 FinMind／合法官方 fallback，顯示單位為普通股張數或百分比。
- TDCC 股權分散實際資料日期為 2026-07-09；`2330.TW` 大戶／散戶為 85.01%／5.68%，`8069.TWO` 為 68.81%／7.73%。第一筆柱顯示中性「持平／首筆」，週資料只落在實際 `dataDate`，未 forward-fill 到其他交易日。
- `8069.TWO` 三大法人合計為 -2,494.2 張，外資持股 41.17%，融資餘額 9,237 張，融券餘額 0 張，借券成交 4.1 張；來源未提供的借券餘額維持「無資料」，未顯示為零。
- 1／2／3 圖可切 A／B，A 單選替換與 B 十項選擇恢復通過；寬 1512px 的 3 圖為三個等寬欄，4／6／8 圖強制 A 並停用 B。
- 非日 K 顯示「籌碼副圖只支援日 K」並清除舊讀值，切回日 K 後恢復選擇。連續切換 25 個分頁、pane 增刪與 2／3／8／1 圖後，version 22 沒有新增本站 console error。

## 工作模式

- 開工：讀 `AGENTS.md`、Obsidian 駕駛艙、git 與 OpenSpec 狀態。
- 規劃：重要功能或架構調整先建立繁體中文 OpenSpec change。
- 實作：依 tasks 逐步完成，並驗證實際頁面、互動與 live API。
- 收工：更新 Obsidian 駕駛艙與必要 log；commit、push 或部署依使用者指示處理。

## 安全原則

- 不把帳號、密碼、API key、token 或金鑰寫入 repo、筆記或 OpenSpec。
- 不把機密資料上傳到 Gemini 或其他 AI Agent。
- 前端不得嵌入秘密；必要時只使用 `[REDACTED_SECRET]` 作為文件占位。

## 授權與來源

- 本專案自有程式由 `alanyi1112` 開發，採 [GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）。
- 圖表核心使用 TradingView Lightweight Charts v5.0.9，該套件採 Apache License 2.0；完整第三方聲明與授權副本分別見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 與 [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt)。
- Lightweight Charts 由 lockfile 固定並從本機 bundle 載入，不在 runtime 從 unpkg、jsDelivr 或其他第三方 CDN 下載。
- 本專案與 TradingView 無從屬或背書關係；使用者介面中的 attribution 只用於符合第三方套件要求。
- 原始改寫來源與後續整合 revision 必須以完整 commit SHA 記錄，不以 `latest` 或浮動 branch 取代。

## 待確認

- 評估 Massive 方案是否需要升級，以涵蓋指數、外匯與期貨第二來源。
- 持續與來源 repo 的完整驗收腳本逐項比對，追蹤尚未納入 Sites 改寫的 parity 差距。
