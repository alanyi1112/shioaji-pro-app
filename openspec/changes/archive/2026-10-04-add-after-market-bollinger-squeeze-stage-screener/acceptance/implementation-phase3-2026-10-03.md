# 第三階段：發布、排程及面板整合（2026-10-03）

時間採 Asia/Taipei；本階段是程式實作、隔離測試及實際本機 pending 查證，**不是正式日報回補／自動發布成功**。先前來源失敗及第一、二階段紀錄保留。

後續 13:06 的本機 migration／runtime 精準接線與 13:09 自然 watcher 成功，另記於 [本機接線驗證](local-activation-2026-10-03.md)。下文未安裝及 schema_pending 是本階段當時真實狀態，保留不覆寫。

## 完成的程式

- 新增 additive migration `0036_screener_bollinger_publication.sql`：profile revision、immutable publication／rows、atomic head、preparation state；0035／0036 僅在隔離 SQLite 安裝，未變更正在運作的 DB。
- 發布器獨立於籌碼 head。兩市場官方批次與逐商品 projection／source hash 完整驗證後，建立 frozen features／readiness／互斥分類報告。來源未知維持 unknown，不補假 OHLC／金額。相同成功鍵先做唯讀 fast path；新 profile 可重用經 hash 驗證的同日底稿，舊報告與失敗收據不刪除。
- lease、staging、母體／hash／日期／profile CAS 與 atomic head；失敗／逾時 append receipt。publisher 使用排程剩餘時間，不重開一份 15 分鐘預算。單列最多 512 KiB、發布列合計最多 256 MiB、母體最多 10,000；這是程式上限，不是已量測真實全市場資源消耗。
- v8 GET results／status：有界唯讀條件判定、排序、stage filter、cursor；cursor 綁 snapshot／全設定／其他條件 join。只 join 同日同母體合法 v7 底稿；舊 schema／非法舊底稿只令舊分支 unknown，不遮蔽純價量結果。GET 不 fetch／重建指標／寫 DB。
- 本機 daily-profile GET／PUT：strict criteria、revision CAS、same-origin／loopback、防代理來源、16 KiB／3 秒 body 上限。只由明確儲存動作寫設定，sourceRequests=0；不立即下載。gateway v8 回應上限 8 MiB，舊版 1 MiB 規則保留。
- repo watcher 純價量入口移到 TDCC secret／queue／backfill 前；新增 `--bollinger-only`，不改 watcher 的 300 秒頻率或 RunAtLoad，不碰盤中監控排程。獨立 idle gate、同鍵唯讀休眠、官方日 14:00、晚啟動／續跑、profile 更新均有隔離測試。
- 日曆不依賴 TDCC：有效 cache 共用；缺少／到期可獨立準備最近三年度 TWSE／TPEx 官方 grid。新年度 cache 最多 30 日且不跨年度，避免每天重抓；最多六次單次 HTTP、每次 30 秒／2 MiB、整輪 180 秒／12 MiB，計入整體 15 分鐘。共享 lease、20 分鐘失敗冷卻／429 至少一小時、append-only 失敗收據；來源錯誤不推論休市。這個 authority 僅供盤後規劃，沒有交易授權。
- 技術型態新增「布林壓縮與突破」：預設停用，啟用才展開，主要／進階分離；保留全部取消、外層 AND／OR、stage 分類、策略母體與組合筆數、明示日期／stale／unknown／準備進度。
- 草稿、唯讀查詢、每日 profile 分開；修改／全部取消不改背景設定。只有手動點股才連動指定未鎖定圖表，手動加入才沿用兩套清單。分類切換固定同一期 snapshot。停用每日策略使用已儲存 criteria，非法草稿不阻擋停用。

## 隔離測試與型別／build

使用支援版本 Node 24.19.0：`PATH=/opt/homebrew/opt/node@24/bin:$PATH`。

- Vitest 19 files／183 tests 通過：v8／v7／v6／v5／v4／domain、API、condition-ui、history／query／gateway、圖表選取、既有官方日曆、session readiness、雙清單／watchlist／技術型態。修改後 v8／query／API 3 files／44 tests 再跑通過（不重複加總）。
- Node 13 files／117 tests 通過：新 history 準備／retention、舊 idle／operator／route／v3–v7 publisher、兩套歷史 bootstrap、清單同步、viewport／personal tabs。另 v8 publication 18／18 與 HTTPS transport 5／5 通過；合計本階段這組為 15 files／140 tests。
- Browser 2 files／31 tests 通過：舊面板 25、新布林 6。核對草稿／profile 分離、keyboard、分類 snapshot、未知／舊資料禁操作、手動圖表／雙清單 callbacks；這些 callbacks 是 fixture，不當作正式兩套清單寫入成功。
- 根目錄 `tsc -b`、MultiView `tsc --project apps/multiview/tsconfig.json --noEmit` 通過；`pnpm build` 通過。保留既有超過 500 kB chunk 提示；新增程式避免 BigInt literal 造成 Safari 13 語法警告，無 BigInt 支援時新條件驗證 fail closed，未宣稱測過真實 Safari 13。
- 新增 calendar／schedule／prepare TypeScript script 的獨立 `tsc --noEmit` 檢查亦通過；不把根 tsconfig 未涵蓋 scripts 的檢查範圍混為一談。
- `zsh -n scripts/realtimestock-runtime`、本 change strict validation、`git diff --check` 與新增檔案 whitespace 檢查通過。

### 本輪發現並修正的錯誤／限制

新增測試曾暴露日曆 receipt INSERT 欄位誤用，以及舊 schema 的 legacy join 導致整體查詢出錯。已分別改成既有 receipt 欄位與舊分支 unknown，回歸通過。其他失敗是測試 fixture 欄位／函式名稱寫錯，修正 fixture，不放寬正式條件。

新版 UI 視覺 fixture 最初未載入正式 reset／背景／字型，已改用實際主題重新驗證。新增實際 HTTP checker 首輪把預期的 profile HTTP 503 當成 JavaScript 例外，曾失敗；修正 checker 將原始 console 訊息與 pageerror 分列，不隱藏 503，重跑通過。以上屬實作／診斷錯誤，不當成真實來源成功或原失敗收據已解除。

## 真實本機 API／UI：partial

在既有 5173／5174 唯讀查證：兩邊 `GET /api/stock-screener/status?version=8` 都回 version=8、state=pending、reason=schema_pending。沒有使用 v7 的 130 日冒充 v8。

`2026-10-03T04:52:25.050Z`（台北 12:52:25），以隔離 browser storage／全 API 寫入阻擋的實際 Chromium 頁驗證 `?popout=screener`：

| 實際請求 | 次數 | 結果 |
| --- | ---: | --- |
| daily-profile GET version=8 | 2 | StrictMode mount；HTTP 503，schema 尚未安裝 |
| status GET version=7 | 2 | 既有唯讀查詢 |
| results GET version=8 | 1 | HTTP 200、pending/schema_pending、rows=0 |
| PUT／POST／其他 API | 0 | 無寫入／broker／SSE 路徑企圖；blocked=0 |

- `pageErrors=[]`。console 原訊息保留：`Failed to load resource: the server responded with a status of 503 (Service Unavailable)`，來源為 `/api/stock-screener/daily-profile?version=8`。這不是全面 console zero；是預期 schema Gate，不是程式啟動失敗。
- UI 顯示「等待完整資料／新價量資料庫尚未初始化」，每日儲存按鈕禁用，沒有結果列。未點選圖表／加入清單／儲存背景設定。測試 storage 為新隔離 context，不修改使用者原有偏好。
- 正在運作的 DB 唯讀查證：新 `screener_bollinger%` 表 0 個、既有 snapshots 12 個。SQLite CLI 曾回無法開啟資料庫；改以 Node DatabaseSync readOnly 和確切唯一檔案定位成功，沒有 DDL／資料寫入。
- 實際已安裝的 `/Users/alanyi/Library/Application Support/RealTimeStock/bin/realtimestock-runtime` 還沒有 `--bollinger-only` 前置 hook。repo 程式已接線，但不宣稱現行 LaunchAgent 已載入，因此 task 5.1 保持未完成。
- 8080／5173／5174 listener 持續運作；未重啟服務、新增 login／subscription、啟用 production 或下單。這只證明本次驗證頁沒有企圖送出副作用，不宣稱已全日觀察所有背景流程。

實際頁面：[本機 pending 畫面](local-readonly-2026-10-03-1255.png)。先前 viewport 畫面 [原畫面](local-readonly-2026-10-03-1252.png) 保留；檔名後綴是識別，不當作排程執行時間。

## 窄面板與可讀性

隔離 Chromium 使用正式 reset／深色主題：320 CSS px／600 CSS px 高／32 px 根字級，另測 240 px 窄格。工作區最小寬度為 24 欄中的 5 格，會隨工作區寬度改變，不把它錯寫為固定 320 px。兩個窄格均無水平溢出，主要輸入在 panel bounds 內；超高內容只在面板內捲動。鍵盤可啟用、開關進階、操作主要輸入，焦點保留；日期／stale 警告不在 details 內。

隔離畫面（不能當正式市場結果）：

- [主要參數](/Users/alanyi/Documents/RealTimeStock/src/components/bollinger-editor-320px-600px-32px-fixture.png)
- [舊日期警告及分類](/Users/alanyi/Documents/RealTimeStock/src/components/bollinger-320px-600px-32px-fixture.png)

## 未完成／不得結案

1. task 1.1：TPEx 本階段一次有界 `curl --http1.1 --tls-max 1.2 --max-time 12 --retry 0` 重查仍是 `(56) Recv failure: Connection reset by peer`、HTTP 000、0 bytes。保留原錯誤；指定日期歷史入口使用範圍尚未完全核實，無真實 verified review。
2. task 5.1：repo hook 已完成，但 live DB 未安裝 0035／0036、installed watcher 未同步。不得直接覆蓋整份 dirty runtime 或重啟共用服務；應先有界套用新增 schema、精準同步這項 hook、保持新策略停用，再以真實新輪次證明載入。沒有做這些動作，不勾任務。
3. task 7.2／7.3：沒有真實雙市場 160 日來源、逐商品 ready／unknown 獨立重算，也沒有真實官方交易日自動 publication／atomic head／同鍵 no-op 證據。
4. task 7.4：已做真實 pending API／UI／network／console，但沒有正式結果可做指定圖表／兩套清單端到端操作；fixture callbacks 不能代替實際操作，維持未完成。

未 archive、commit、push、建立 Codex 排程、安裝 migration、修改原失敗 evidence 或停止任何既有行情服務。
