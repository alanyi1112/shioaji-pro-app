# 驗證紀錄

## 目前判定

- 程式、simulation、localhost Durable Object preview、UI 圖數矩陣、安全掃描與靜態免費額度模型已完成。
- Cloudflare 產生設定的 `SHIOAJI_REALTIME_ENABLED` 仍為 `false`；Sites 保留站固定不配置 realtime binding 或 secret。
- 本變更尚不可啟用 production、不可歸檔。未完成項目是外部 gate，不得以 fixture、localhost、`workflow_dispatch`、舊 health 或匿名結果冒充。

## 已完成的本機證據

- Gateway simulation：80 個測試通過，涵蓋 data-only、no-order、OS secret handle、callback 有界佇列、正規化、訂閱 single-flight、session buffer、當日 Kbars 回補、倒序／重送／跨日／reconnect、provider quota、circuit breaker、uplink 微批次、完整 demand snapshot、空集合釋放、預設 universe reference 保留與安全輸出。
- Realtime JavaScript 契約：26 個針對性測試通過，涵蓋 ingest 授權、雙 secret slot、timestamp、connection ID、replay、64 KiB／32 商品／128 backfill 點上限、SQLite Durable Object、Hibernation、quota 降載、state machine、日週月 overlay、Yahoo fallback、分時 accumulator 與雙部署 fail closed。
- 完整 `npm test` 為 `372/372`；單一 owner／member 拒絕、owner-only capability、去識別 scope、清單刪除完整 snapshot、空集合釋放與 Yahoo fallback 的針對性回歸為 `40/40`。`npm run lint`、預設 production build、`ENABLE_REALTIME_LOCAL_TEST=true` production build、OpenSpec strict `37/37`、`git diff --check`、gateway safe-artifact scan 與 Cloudflare budget gate 全數通過。
- `npm run realtime:preview-verify` 實際啟動 localhost Durable Object，完成 simulation ingest→browser WebSocket 傳遞，health 證明 `d1TickWrites=0`。
- `npm run realtime:ui-preview-verify` 以 headless Chrome 驗證 1／2／3／4／6／8 圖、兩個分時 panel、同商品重複 panel、每頁同時只有一條 realtime WebSocket 與雙擊單圖。測試過程另發現並修正分時模式誤用不存在函式，以及延遲來源未完成前不建立即時連線的順序問題。
- Feature-off cache key 保持原 contract；只有 realtime 真的啟用且週／月需要 daily period base 時才使用隔離 key，避免 Sites 保留站與既有 Cloudflare stale cache 失效。
- Realtime capability、browser WebSocket、日週月 period base 與 batch cache 已全部改為 request-scoped owner gate；gateway、Tick 或 WebSocket 失效時仍以完整 Yahoo snapshot 原子 fallback，畫面不得把延遲行情標示為即時。Sites 保留站固定 feature-off 並沿用原本延遲行情。

## 靜態額度模型

- 單一 owner、八圖、32 檔 active universe、一秒 gateway 微批次模型：一般 Worker requests `5,582 / 50,000`、D1 reads `374,230 / 3,500,000`、D1 writes `22,240 / 50,000`、realtime inbound messages `16,200`、Durable Object request-equivalent `812 / 50,000`、最壞情境 Durable Object GB-s `2,025 / 6,500`、D1 Tick writes `0`。
- 以上是保守靜態 gate，不是 production 帳務證據。正式啟用仍需量測 Worker CPU、Durable Object requests／GB-s、D1 24 小時 rolling reads／writes／storage 與錯誤率。

## 仍待外部證據

- 1.1：2026-07-31 重新核對永豐金官方 streaming、使用限制、金鑰與條款頁；文件證明盤中應使用訂閱且不得輪詢行情查詢，也說明 API key 行情權限與個人正式環境前置程序，但未明確授權 API 登記人本人把行情送到只有自己可登入的私人網站。已在 `gateway/docs/operator-pilot-checklist.md` 固定化待書面確認的單一 owner 拓樸與問題；技術上限制為同一人不等同取得展示授權，在取得回覆前仍不得勾選。
- 單一 owner 登入名單：2026-07-31 先以正式 D1 角色／狀態筆數安全摘要核對，確認原有 `2` 位 active member 與 `1` 位 active owner；依使用者指示刪除非 owner 登入 rows 及直接關聯的 `4` 筆登入稽核後，重新核對只剩 `1` 位 active owner。全程未查詢、輸出或保存信箱，個人商品清單與頁籤資料未刪除。程式層已於 branch commit `4c4a9430cf77e6a3c914e18c45e30c3c47741de4` 固定拒絕 `member`、停用新增登入帳號 API，並通過完整與針對性測試。
- 1.5：2026-07-31 20:18 Asia/Taipei 以既有已登入 Cloudflare Dashboard 重新取得該 D1 資料庫「過去 24 小時」指標：queries 約 `9k`、rows read 約 `1M`、rows written 約 `12k`、storage `38.1 MB`，分別低於本專案安全線 `3.5M`／`50k`／`3.5 GB`，task 已完成。此前同日兩次 Wrangler GraphQL HTTP 520 沒有被當成證據；本紀錄不保存帳戶、資料庫或人員識別。
- 8.2：真實 credential 必須由 operator 在小馬 OS secret provider 注入，Codex 不讀取也不代填。
- 小馬目前 system service 仍為 `disabled`／`inactive` 且指向先前已驗證 release；gateway tree 對應的 branch commit `4c4a9430cf77e6a3c914e18c45e30c3c47741de4` 已在非同步 staging 建立 lockfile runtime，於小馬通過 `80/80` tests 與 safe-artifact scan，等待 operator 執行 privileged installer。此證據只代表 release ready，不代表 credential 已注入。
- 8.3～8.7：仍需兩檔一個完整真實交易日、受限 universe 三個真實交易日、盤中新商品回補、Cloudflare 實際帳務與已授權正式站 browser-visible 驗收。
- 2026-07-31 Cloudflare feature-off 發布：`main` push 的 exact commit `1d4c73c6f4b6aeecfb544db0a630fb822d8e106e` 由 workflow run `30631649861` 完成 lint、`npm test`、OpenSpec strict、Free-tier budget、migration、exact deploy、匿名 Access boundary 與 protected smoke，結論為 success 且未觸發 rollback。隨後以既有已登入 Chrome 工作階段唯讀驗收正式站，確認單一 owner 畫面、`8/8` 日 K panel 已載入且 `8/8` 最新資料標籤皆為 `07/31 已核對`；這證明 realtime 維持關閉時仍可使用原本延遲行情。瀏覽器直接開啟 `/api/config` 遭 `ERR_BLOCKED_BY_CLIENT`，故未將該結果列為 capability 證據。
- 8.8：程式與 localhost feature-off regression 已通過。Sites version 166 已由 exact commit `baa88ddf488cc579bda2a94fc7d54b091783a660` 保存，存取仍為一位允許使用者、零群組的 custom private；但私有部署回報平台 unknown error，沒有產生 live URL，故未重試也不把舊 version 165 的已登入可見頁面冒充新版驗收。
- 8.9～8.10：只有上述 gates 全部成立後，才可分階段開啟 feature flag、等待 exact-commit deploy、監測完整交易日並執行正式 rollback 演練。

## 回滾判定

- 未啟用前不需 production rollback；程式預設 fail closed。
- 啟用後先關閉 `SHIOAJI_REALTIME_ENABLED`，再停止 gateway uplink，網站回復 Yahoo batch；不得刪除 canonical history、D1 或 Durable Object migration。
- 已保存的無即時行情基線為 `baseline-pre-shioaji-realtime-2026-07-31`。目前判定：保留 active change，等待外部 gates，不歸檔。
