# MultiChartOnCodexSite — AGENTS.md

## 專案入口

- 專案名稱：MultiChartOnCodexSite
- 主要工作目錄：`/Users/alanyi/Documents/MultiChartOnCodexSite`
- 專案用途：將 `alanyi1112/quote-chart-multiview` 的全部產品能力完整改寫為 Codex Sites 相容網站，完成程式、功能等效驗證與正式部署。
- 預設分支：`main`
- GitHub repo：private repo `https://github.com/alanyi1112/MultiChartOnCodexSite`，預設 remote 為 `origin`。
- 來源專案：`/Users/alanyi/Documents/報價線圖multiview`，GitHub private repo `quote-chart-multiview`。

## Obsidian 對應筆記

- 主要 vault：`/Users/alanyi/Library/CloudStorage/GoogleDrive-alanyi1112@gmail.com/我的雲端硬碟/2026Codex/secondbrain`
- 專案駕駛艙：`MultiChartOnCodexSite/專案工作流程.md`
- 收工時優先更新專案駕駛艙；重要操作再追加到 `知識庫/log.md`。
- `AGENTS.md` 只放固定規則；進度、下一步與踩坑紀錄放 Obsidian 駕駛艙，避免雙寫漂移。

## 工作桌 + 三個家

- 工作桌：本機專案資料夾 `/Users/alanyi/Documents/MultiChartOnCodexSite`。
- GitHub：private repo `alanyi1112/MultiChartOnCodexSite`，以 `main` 為預設分支。
- Obsidian：使用上方第二大腦 vault 與專案駕駛艙。
- 部署：同一核心程式同時維持 Sites 保留站與 Cloudflare 正式站兩個獨立部署；`.openai/hosting.json` 管理 Sites，相容 Wrangler / Cloudflare workflow 管理 Cloudflare，兩者版本與驗收分開記錄。
- 資料庫：需要持久化的清單、分頁與快取改寫為 Sites 支援的儲存能力；外部市場資料服務的秘密值只能存放於 Sites runtime 環境變數。

## 環境名稱約定

- 「本機開發環境」：本機以 `localhost` 執行的版本；簡稱「本機」。
- 「Sites 保留站」：原 Codex Sites 版本 `https://quote-chart-multiview.alanyi1112.chatgpt.site/`。
- 「Cloudflare 正式站」：自管 Cloudflare production `https://multichart-production.alanyi1112.workers.dev/`；單稱「正式站」時一律指此環境。
- 不使用「本地站」或「遠端站」等模糊名稱；部署、驗收與問題回報必須明確寫出目標環境名稱。

## 同步規則

- 使用者說「開工」、「開始工作」、「接續工作」時：先讀本檔、Obsidian 駕駛艙、git 狀態、OpenSpec 狀態與必要服務狀態，再回報上次進度與下一步；不主動 pull、commit、push。
- 使用者說「收工」、「先到這裡」、「準備換電腦」時：盤點本次更動，更新 Obsidian 駕駛艙與必要 log，必要時再整理 commit / push；不得提交秘密資料。
- 使用者說「專案初始化」時：先檢查現況，只補缺少的專案入口、Obsidian 駕駛艙、Git / OpenSpec 入口，不覆蓋既有規則與資料。

## 開發與變更規則

- 重要架構或產品變更先用 OpenSpec 建立 proposal、design、spec 與 tasks，再進行實作。
- 所有 OpenSpec 內容必須使用繁體中文（台灣）；技術名詞、程式碼、API 名稱、路徑、指令與錯誤訊息可保留英文。
- 改寫既有功能前，先核對來源專案的實際 API、瀏覽器行為與正式站結果，不以推測取代 live 驗證。
- UI 修改要驗證實際可見結果與互動，不只檢查 source 或單元測試。
- Flask、Python indicators、yfinance、SSE 與 Supabase 邏輯必須改寫為 Sites / Cloudflare Workers 相容的 TypeScript、Web API、streaming 與持久化實作，不以 Render 作為新版正式後端。

## 主要檔案

- `README.md`：專案用途、架構方向與工作模式。
- `.gitignore`：排除系統檔、秘密、本機 AI 設定、依賴與建置輸出。
- `openspec/`：可提交的變更提案、規格、設計、任務與歸檔。
- `.codex/`：本機 Codex / OpenSpec skill 入口，預設不提交。
- `.openai/hosting.json`：Codex Sites hosting 與資源綁定設定。

## 安全規則

- 禁止將帳號、密碼、API key、token、金鑰等機密資料上傳到 Gemini 或其他 AI Agent。
- 禁止把實際秘密資料寫入 repo、Obsidian、OpenSpec、commit、PR 或外部 AI 工具；必要時使用 `[REDACTED_SECRET]`。
- 不提交 `.env`、憑證、private key、token 快取、瀏覽器 cookie 或個人帳號資料。
- 前端不得內嵌後端秘密；只允許呼叫經確認可公開使用的 API 路徑。

## 不要做

- 不把工作資料夾移進 Obsidian vault。
- 不把每日進度寫進 `AGENTS.md`。
- 不變更既有 Render 正式服務；新版只在完成改寫與驗證後依 Sites 流程部署。
- 不自動 pull、commit、push 無關變更。
- 不覆蓋既有 Obsidian 筆記；檔案存在時先讀取並小幅合併。
