# 共用交易日曆後端獨立本機提交驗證

2026-10-23，Asia/Taipei。基準 HEAD `f3ffdc4`，接續 UI 獨立提交。依使用者授權只建立本機 commit；不歸檔、不 push，不重啟／操作既有服務、頁面或排程，不新增官方／行情／HTTP 請求、不修改真實休市設定。

## 本筆範圍

**21 個來源檔、9 份測試、2 份文件**。共用純核心、全域 store／v1 唯讀相容、cache v2／authority、同源 API、固定 bridge、Worker 現成資料 SELECT，與 HEAD 已存在的盤前／盤後／重試／稽核、晚登入、collector／runner／session 必要休市守門同批提交。

來源清單：

- `apps/multiview/worker/app.ts`
- `apps/multiview/worker/local-market-calendar-checks.ts`
- `scripts/intraday-monitor-runtime/audit-monitor-failures.mjs`
- `scripts/intraday-monitor-runtime/current-session-authority.mjs`
- `scripts/intraday-monitor-runtime/daily-calendar-cache.mjs`
- `scripts/intraday-monitor-runtime/daily-minute-volume-collector.mjs`
- `scripts/intraday-monitor-runtime/daily-minute-volume-postclose.mjs`
- `scripts/intraday-monitor-runtime/daily-minute-volume-runner.mjs`
- `scripts/intraday-monitor-runtime/daily-session-runtime-authority.mjs`
- `scripts/intraday-monitor-runtime/late-boot-catchup.mjs`
- `scripts/intraday-monitor-runtime/local-api-service.mjs`
- `scripts/intraday-monitor-runtime/postclose-daily-baseline.mjs`
- `scripts/intraday-monitor-runtime/premarket-orchestrator.mjs`
- `scripts/intraday-monitor-runtime/special-market-closures.mjs`
- `scripts/intraday-monitor-runtime/trading-calendar-authority.mjs`
- `scripts/intraday-monitor-runtime/vite-local-api-gateway.mjs`
- `scripts/local-calendar-check-bridge.mjs`
- `scripts/market-calendar-legacy-reader.mjs`
- `scripts/market-calendar-local.mjs`
- `scripts/market-calendar-store.mjs`
- `src/lib/market-calendar.ts`

其中 12 檔取日曆完整內容，9 個混合來源只取日曆片段；不把必要 import 當作納入整個名單／動態執行系統的理由。`market-calendar.ts` 接續 UI 已提交的一行型別，沒有覆寫或遺失該契約。

- local API／gateway 不含 config v2／backup／preview、roster status／自然載入證書、動態 execution／threshold／candidate status 或無關 status 防護。
- 盤前／盤後／稽核／晚登入只取共用日曆與休市守門，不含 dynamic prepare／live、roster original、LaunchAgent／安裝參數及新接線。
- collector 不含 phaseContext／original／delta 目錄或新收據格式；runner 不含 gap health／repairFailures 展示。相關未完成變更完整留在工作檔。
- Worker 只用 HEAD 已有 mapping 常數；保留 HEAD MultiView ES2017，沒有納入法人選組／transport／BigInt／target 改動。
- 所有 21 個既有來源工作檔均未重寫，避免此次拆 commit 觸及 live HMR。legacy reader 多餘 EOF 空行只在 index 修正，工作檔原件保留。

## 測試與文件拆分

四份日曆專用測試完整納入：純核心、Node projection、Worker／bridge、authority。collector 的現有 diff 全部是休市案例，完整納入；runner 僅納入新增的休市比較／transport／health 案例，其他補件與健康案例保留未提交。

`special-market-closures.test.mjs` 只納入 store／CAS／跨程序競爭／selector、既有 no-op、API 純函式及同源授權；未納入未提交的 roster delta／02:00 finalize 及其 imports。`local-api.test.mjs` 只納入日曆 HTTP describe 與日曆 fixture／imports，其他混合 API 測試保留。

另加入 `market-calendar-api-offline.test.mjs` 的三項實際 middleware 管線測試：EventEmitter 分段 JSON body → API service → 暫存 store → 注入 bridge → Worker → 記憶體 SQLite SELECT。覆蓋新舊路由同版、改設定後重新檢查、同源／JSON／白名單／無效 body／大小限制、缺 provider、CAS 衝突與缺確認。不建立 listener／socket，也不發出 HTTP。**真正 HTTP 測試保留但本輪不執行**，不把離線物件串接稱作 TCP／正式服務驗收。

`docs/special-market-closures.md` 只暫存操作、資料範圍、儲存與本筆守門說明；未納入安裝歷史及尚未提交 roster 整合的全面生效敘述。原工作檔完整歷史未刪改。另一份文件為本提交範圍與驗證紀錄。

## 從實際 index 驗證

將實際 index 匯出至新的隔離目錄，僅連結既有 root／MultiView 依賴，未安裝套件。測試／build 使用 Node 24.19.0 與網路拒絕 preload，阻擋 HTTP／HTTPS／fetch／socket／listener 及 launchctl／runtime 管理。預設 App Support 指向隔離空目錄；設定寫入僅在測試暫存目錄或記憶體 SQLite。

| 檢查 | 結果 |
| --- | --- |
| Vitest：12 檔核心／store／authority／既有入口／collector／runner／離線 API | **153／153 通過** |
| Node：cache／projection／Worker／bridge 三檔 fixture | **27／27 通過** |
| 主專案 TypeScript | exit 0 |
| MultiView 完整 TypeScript（HEAD ES2017） | exit 0 |
| Vite build | exit 0；既有 chunk 大小提示保留 |
| 相對 import 圖 | 155 檔、缺漏 0 |
| MJS source／test syntax | 26／26 通過，含保留但未執行的 HTTP 測試 |
| 網路／listener／服務管理阻擋紀錄 | 0 筆，沒有嘗試真連線或管理命令 |
| staged diff check／範圍與高可信機密／產物檢查 | 通過 |

驗證來源為實際 index 的程式／測試，不能用舊盤點候選或 mixed 工作樹結果替代。驗證後只追加本紀錄，程式與測試 blob 未改。第一個 staged diff check 發現 legacy reader EOF 空行，已在上述正式驗證前修正；未掩蓋測試失敗。

本機完整日誌、config／preload、index tree、source/test blob 清單及 SHA 保存在 Git 忽略的 `outputs/acceptance/calendar-backend-commit-20261023/`，不將產物、截圖、暫存設定、憑證或資料庫納入提交。

## 保留的缺口與正式狀態

本筆不是整個 active change 結案或部署。日曆 **21／22、4.3 未完成**；名單同步 **39／41、6.3／6.4 未完成**；晚登入 **12／13、4.4 未完成**。未修改 tasks／主規格、未歸檔，也未把操作說明已整理視為自然收據齊備。

全部 roster-sync／dynamic workflow／execution／threshold／自然載入、candidate builder／installation planner 與正式安裝文件、其他 active／archive change 及無關 UI／篩選器／MultiView 修改保留未提交。未查正式 API／Worker／DB、未重新整理交易頁、未查詢或延效年度日曆、未執行排程／collector／watchdog／status；沒有填寫真實休市或製造自然收據。

原 453 個 dirty 路徑的原件及刪除狀態、23 份 plist／automation／已安裝 wrapper，以提交前後 SHA-256 核對。純 lsof 核對 8080／5173／5174 listener 仍是 PID 1200／934／940。這些保留檢查不能代替自然交易日、原生載入與跨日完整週期驗收。
