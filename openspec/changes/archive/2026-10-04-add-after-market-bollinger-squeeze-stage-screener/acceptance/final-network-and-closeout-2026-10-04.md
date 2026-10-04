# 最終圖表、雙清單與網路驗收（2026-10-04）

時間均為 Asia/Taipei。這是使用者要求繼續至可結案後的真實本機驗收，不是 fixture、人工發布或重新下載來源。承接原自動發布／逐商品重算證據，以及先前已授權的 2408 操作；原失敗文件與收據全部保留。

## 結論與證據範圍

- 完成 tasks 7.4／8.8，現為 **47／47**。160 日準備、320 市場日期、316,320 個商品日期點、1,977 檔獨立分類重算、真正 watcher 自動發布及後次同鍵休眠，沿用 `live-publication-and-reader-scale-2026-10-04.md` 的已成立證據，本輪沒有人工重新發布。
- 正式 head 仍為 `72dd8c83-792e-4217-a8ab-398cf8513c51`；實際 API／UI 為 16 筆（壓縮 14、準備 1、突破 1），無法判定 61。沒有將 unknown 改成未符合。
- 補齊兩段**真實瀏覽器** HAR：主工作區查詢／指定日 K 圖，以及獨立選股頁查詢／加入雙清單。兩段分別觀測，不宣稱隔離頁有圖表，也不以它代替主工作區圖表驗收。
- 清單與圖表操作完成後，精準還原原清單、三項草稿及 IX0001／5m。沒有覆寫整份清單、每日 profile 或使用者版面。

## 新失敗、修正與限制（保留原件）

1. 10:50 第一輪 124 筆 Network 紀錄在關閉／重開 DevTools 時遺失，無法據此重建 counts；未將這輪當作完整網路證據。原 10:16 的 0 bytes HAR 及較早 503 HAR 保留。
2. 10:57:00.075 真正布林查詢 HTTP 503，5,442.995 ms。正式發布底稿序列化約 260,093,254 字元；逐元素 canonical serialization 的大量中間字串是可重現的讀取成本。沒有服務端原始堆疊可證明該次 503 的完整原因，因此不把逾時猜測寫成已確定根因。
3. `stableJson` 對密集 primitive 陣列採用原生序列化，sparse、undefined、物件及自訂 `toJSON` 仍走原路徑。以整份真實 rows 唯讀比較確認 canonical 字串完全相同；隔離基準舊路徑 1,864.805 ms、新路徑 1,249.333 ms。沒有跳過完整性驗證、變更 hash／公式／日期或提高 timeout／下載預算。
4. 修正後實際瀏覽器查詢：11:01:25.223 HTTP 200，5,606.822 ms；11:06:30.489 HTTP 200，5,559.160 ms，均顯示同一期 16 筆結果。這是兩次成功實證，不保證未來所有來源／查詢永不失敗。
5. 10:57:34 的精準清單 API 預檢誤用 Origin，留下 HTTP 403／same_origin_required；對未加入項目的刪除回 409／source_changed，沒有刪掉使用者項目。10:57:43 改用各端點正確 Origin 後 API 操作成功；此 API 預檢不冒充後述 UI 加入請求。

## 主工作區：指定日 K 與逐請求證據

Chrome 原 `?layout=stock-screener` 工作區，不重載、不新增 login／行情連線。使用本分頁已確認的 2408 契約快取；11:07:55 暫回 IX0001、11:08:02 再從真實布林結果點選 2408，指定既有圖表切為 1D。DOM 顯示「已在指定 K 線圖開啟 2408 南亞科」、`2026/10/02（1D）`、開 532、收 526、量 35,255 張；完整圖表 screenshot 已保存。

HAR 全區間 10:56:23–11:08:13.020，共 352 筆（含修正前失敗與既有輪詢）：

| Method／path | 次數 |
|---|---:|
| GET `/__realtimestock/runtime-mode` | 68 |
| POST `/api/v1/data/snapshots` | 48 |
| POST `/api/v1/portfolio/position_unit` | 68 |
| POST `/api/v1/order/trades`（讀取委託狀態，非下單） | 84 |
| GET `/api/v1/health` | 29 |
| GET `/api/intraday-monitor/v1/status` | 22 |
| POST `/api/v1/portfolio/account_balance` | 7 |
| POST `/api/v1/portfolio/margin` | 12 |
| GET `/api/stock-screener/results` | 2（503、200 各一） |
| POST `/api/v1/data/kbars` | 11（全數 200） |
| GET `/api/v1/watchlist` | 1 |

11:01:25.223 修正後區間共 251 筆；結果 GET 1 次成功，KBar 8 次（IX0001 復原 4、2408 快取重選 4），全數 200。2408 重選包含當前短窗、45 日窗、長日 K 窗及向前延伸歷史，未將它們錯稱為單次日 K request。

兩區間均無 login、subscribe、unsubscribe、daily_quotes、來源下載、每日 profile 寫入或下單／改單／刪單端點。原首次冷選的兩筆授權預算已使用，沒有宣稱那個未成功匯出的原輪次是零訂閱；本次**快取重選**的零訂閱由 HAR 實際證明。

全區間仍有既有帳務讀取 HTTP 400：position_unit 34、order/trades 42、margin 12，以及修正前結果 503 一次。這些原件不刪；不能宣稱整份工作區零 error。本輪 CUA console reader 捕捉區間無新 error／warn，不代表歷史 DevTools console 為空。

## 雙清單：真實 UI 加入及精準復原

原主面板保留先前「已加入」狀態，故未強改 React state 或移除原面板；使用 `?popout=screener` 的獨立選股頁，只做結果查詢和清單驗收。此頁不載入交易 App／圖表，不以未連接圖表狀態假稱圖表驗收成功。開始操作前開啟 Network 記錄。

11:06:41.946 點 2408 的「加入清單」，實際 HAR **6 筆，全數 200**：

| Method／path | 次數 | 實際結果 |
|---|---:|---|
| GET `/api/stock-screener/results` | 1 | 同一期 16 筆 |
| POST `/local-multiview/api/v1/stock-screener-list/items` | 1 | 2408.TW、status=added |
| GET `/api/v1/data/contracts/2408` | 1 | STK／TSE／2408 |
| GET `/api/v1/data/contracts/2408/info` | 1 | 南亞科、日期 2026-10-02 |
| GET `/api/v1/watchlist` | 2 | 前後「選股」皆原 13 項、2408 already_present |

DOM：「已加入 Shioaji『選股』與 MultiView『選股篩選』」；該頁 console 無 error／warn。完整操作區間無 subscription／SSE／login／下單請求。不是只憑 connections=1 推論沒有額外訂閱。

- Shioaji 原 13 項及順序保持：1560、2454、1527、2485、2363、8358、00406A、2408、6770、1809、3715、3149、2472；原有 2408 不移除。
- MultiView 原 6 項：2454.TW、3675.TWO、8054.TWO、3715.TW、2436.TW、1809.TW。11:06:46.141 唯讀 API 核對新增後 7 項，2408.TW 在末項。
- 11:07:36.205 使用既有 `/api/instruments/remove-from-tab`、`personal:stock-screener-filtered`，僅精準移除本輪新加 2408.TW，HTTP 200／ok；11:07:36.223 唯讀 API 重核對回原 6 項及原順序。此還原請求由本機 API 實作，不假稱列在瀏覽器 HAR。
- 隔離頁關閉。主面板恢復原千張大戶比例趨勢 0–100%／3 週、十張以下散戶下降 3 週、價漲融資不增 5 日，AND／pass／code／asc；重新查詢與原 IX0001／5m、原全螢幕還原，最終 DOM／畫面已保存。

## 正式設定、共用用量與安全核對

- 10:50:54.584 與 11:09:53.295 的唯讀 DB 核對：profile revision=1，payload SHA-256 皆 `4ce25d3d72813b4b0b05939920cb6779fbd96b54afecaa1415981cf035407028`；head／updated_at 仍為原 09:11:47.246，沒有瀏覽器人工發布。
- 共用 broker usage：11:06:26.759 bytes=3,590,646／remaining=520,697,354；11:07:36.283 bytes=3,648,852／remaining=520,639,148，connections 皆 1。該 58,206 bytes 差額含共用背景輪詢，**不歸因為此功能獨占用量**。11:09:53.200 bytes=3,722,276／remaining=520,565,724，connections 仍 1。
- 前後 `/api/v1/stream/status` 為 healthy／active_connections=63。沒有使用這些 aggregate 取代逐請求 HAR；未建立第二條 broker 行情連線。
- 11:09 `pnpm local-runtime status`：simulation healthy、business session available、2330 Snapshot available、8080／5173／5174 listener up；production stopped、write master disabled、watchdog restart count=0、active obligations=0、drain items／records=[]。沒有停止／重啟 API、watchdog、Web 或 MultiView，也沒有操作交易草稿。
- 原 v3 保守帳本、300 MiB 保護池、85,667,193 bytes 基準保留、兩 HTTP/run／兩 request/minute 不變；不以本輪 UI 用量冒充 provider quota epoch 已驗證。

## 原始檔保護與可稽核位置

原始 HAR 可能包含私密帳務回應，僅存在本機私人目錄，HAR 權限 600、目錄 700；不加入 repo／OpenSpec、不上傳。永久本機目錄：

`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/bollinger-20261004-closeout.ddtGTo/`

| 檔案 | bytes | SHA-256 |
|---|---:|---|
| bollinger-ui-chart-network-20261004-1109.har | 18,902,022 | 815f9d0a3a15fca533e14c953988bab5ad610a0f58793883f26d67c244b9a0c0 |
| bollinger-ui-list-network-20261004-1107.har | 1,733,905 | 1e1eea70eb8e87260e52f472ca5a4658f60a88b63670ca85aea1134beac3aac9 |
| bollinger-canonical-fastpath-20261004-1102.har | 7,958,507 | 0d6f090fa114feca1db78de88493e8bc868a07564a06fd49f8c140fcbc94c6ad |
| bollinger-final-chart-20261004-1109.png | 124,516 | a5031bff7921c9d92e305b2473c0a97cb6155ebfe4aed28f06a97986c0d5df26 |
| bollinger-list-complete-20261004-1107.png | 15,217 | bb1181bc25d52b3895e743a3c6ad54f27e7f9ab899c538c955b6a754983aa592 |
| bollinger-complete-restored-20261004-1110.png | 159,024 | c1bf1c05d961cfbc53e94ada8145e8d30ba9e486754476c10c945f8a364f43dd |

同目錄另複製保存原 idempotent HAR、503 prequery HAR 及 0 bytes failed export；沒有刪除／覆寫原 `/tmp` 檔案。最初建立永久目錄時曾因父目錄不存在而 mktemp 失敗，建立新父目錄後成功，與來源或正式發布無關。

## 最終回歸與保留限制

- Node 24.19.0：5 個 Vitest 檔 **50／50**；大型陣列 canonical hash 保持相同，涵蓋 sparse／undefined／自訂 toJSON、v3 技術 evidence、凍結 features、查詢 gateway、指定圖表與雙清單。
- Node 24 發布／備援 tests：2 檔 **30／30**；320 keys 分批、完整 rowsHash、manifest tampering、容差 policy、同鍵 no-op、profile CAS、watcher／日曆回歸通過。
- 最終 build／MultiView 型別通過；原 bundle >500 kB 提示保留。
- 結案標記後 OpenSpec strict、git diff --check 通過。全域 363 份 untracked 文字檔檢查發現既有產生檔 `apps/multiview/worker-configuration.d.ts` 的 5 處 trailing whitespace（11534、12048、12116、12536、12971 行），不修改無關產生檔；其餘本輪來源／測試／OpenSpec 文字檔沒有 trailing whitespace。不將全域檢查的非零退出碼寫成全域成功。
- 保留已知範圍：TPEx-only 臨時公告 transport/schema 尚未驗證；官方歷史入口契約 pending 由已驗證 Shioaji 備援承接；quotaEpochVerified=false 由保守帳本保護；61 檔 unknown 與既有帳務 HTTP 400 不改成成功。這些已在設計／先前驗收分列，不是本輪未完成的操作證據。
- 舊維護三組本輪未巡訪、checkpoint 維持 deferred，不把此 change 完成冒充三組維護全部成功。沒有 archive、commit 或 push；全部 tasks 完成後移除僅為此 change 接續的 automation-2。

結案收尾：OpenSpec apply 回傳 total=47、complete=47、remaining=0、state=all_done。Codex App 正式刪除接口回傳 automation-2／deleteStatus=deleted，僅終止「布林三階段選股結案接續」heartbeat；既有本機五分鐘 watcher／每日策略與行情服務保持運作。最終 DOM 再核對原三項草稿、AND／pass／code／asc 與 IX0001／5m 均維持還原。
