# RealTimeStock 專案工作規則

## 專案入口

- 專案名稱：RealTimeStock
- 主要工作目錄：`/Users/alanyi/Documents/RealTimeStock`
- 預設 branch：`main`
- GitHub repo：`https://github.com/alanyi1112/shioaji-pro-app.git`；此 fork 追蹤上游 `Sinotrade/shioaji-pro-app`。
- 專案用途：Shioaji Pro 台灣市場交易終端的本機 Web 開發工作區，前端以 React、TypeScript 與 Vite 實作，透過本機 Shioaji HTTP API / SSE 取得行情與執行交易。

## Obsidian 對應筆記

- 主要 Obsidian vault：`/Users/alanyi/Library/CloudStorage/GoogleDrive-alanyi1112@gmail.com/我的雲端硬碟/2026Codex/secondbrain`
- 專案駕駛艙：`RealTimeStock/專案工作流程.md`
- 收工時優先更新專案駕駛艙與 `知識庫/log.md`，再依使用者要求處理 commit / push。
- `AGENTS.md` 記固定規則；每日進度、踩坑、下一步寫在 Obsidian 駕駛艙，避免雙寫漂移。

## 工作桌 + 三個家

- 工作桌：`/Users/alanyi/Documents/RealTimeStock`
- Git：本機 repo，`origin` 為 `alanyi1112/shioaji-pro-app`，branch `main` 追蹤 `origin/main`。
- Obsidian：`RealTimeStock/專案工作流程.md`
- 執行環境：Web 前端預設 `127.0.0.1:5173`，由 Vite 將 `/api` 代理到本機 Shioaji server；不使用遠端資料庫。

## 同步規則

- 開工：先讀本檔、Obsidian 專案駕駛艙、`git status --short --branch` 與 OpenSpec 狀態，再開始修改。
- 收工：整理本輪完成事項、下一步、踩坑與驗證結果到 Obsidian；沒有明確要求時不主動 commit、push 或部署。RealTimeStock 的「收工」只同步紀錄與 Git，必須保持既有 simulation API、business-session watchdog、5173 Web、5174 MultiView、盤後 pipeline 與行情連線運作；只有使用者另外明確要求停止服務或關閉行情連線時才可停止。
- 專案初始化：只補缺口，不覆蓋既有規則、README、Git 歷史或 Obsidian 筆記。
- OpenSpec：proposal、design、spec、tasks 與說明文件使用繁體中文（台灣）；技術名詞、程式碼、API 名稱、路徑、指令與錯誤訊息可保留英文。
- 股票資料：正式來源必須確認實際欄位、資料日期、授權、自動化限制與市場覆蓋；不得以猜測或假資料冒充正式行情。

## 主要檔案

- `README.md`：專案用途、工作模式與安全原則。
- `package.json`、`pnpm-lock.yaml`：前端依賴與執行指令。
- `vite.config.ts`：本機 Web server、API proxy 與 build 設定。
- `src/`：React / TypeScript Web 終端原始碼。
- `openspec/config.yaml`：OpenSpec 專案語言與安全規則。
- `openspec/changes/`：進行中的 OpenSpec change。
- `openspec/specs/`：已同步的正式規格。

## 安全規則

- 禁止將帳號、密碼、API key、token、金鑰等機密資料寫入 repo、Obsidian 或交給 Gemini / 其他 AI Agent。
- 如需記錄秘密值存在，使用 `[REDACTED_SECRET]`。
- 不提交任何 `.env*`（僅 `.env.example` 例外）、本機 AI 設定、憑證、暫存檔、建置輸出或大型原始資料。
- 不把尚未確認授權或展示權的股票資料納入正式產品或公開發布。
- 預設使用 Shioaji simulation 模式；未經使用者明確要求與完整驗證，不啟用 production 或真實下單。
- 自訂指標透過 `new Function` 執行 JavaScript，不是完整安全沙箱；禁止貼入或匯入來源不明的指標程式碼。
