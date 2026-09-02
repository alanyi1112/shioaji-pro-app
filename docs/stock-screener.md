# 收盤後選股（RealTimeStock 本機）

## 使用方式

1. 開啟本機 http://127.0.0.1:5173，在「＋ 新增面板」選「選股」。每個版面最多一個，可移動、縮放、移除及隨具名版面保存，不強制改動預設版面。
2. 勾選成交量／大戶持股／K 棒分型／布林通道反轉 K 條件、設定門檻與「全部符合（AND）」／「任一符合（OR）」，按「開始篩選」。成交量與大戶條件都可分別加上最低成交值（輸入單位為萬）；成交值只限制所屬條件，不會自行使商品入選。
3. 大戶模式可選單週增加、持股比例由減轉增或由增轉減。反轉前連續週數可設 1–4；設定四週代表反轉前已連續四週同方向，因此使用六個 TDCC 週期。
4. 分型可選原始三 K、纏論包含處理或任一算法，並可選底、頂或任一方向；布林條件可選下軌陽 K 下影、上軌陰 K 上影或任一型態。兩者都只判定最新完整交易日已確認的型態。
5. 從「結果種類」查看符合、不符合或無法判定；可依代碼、量倍數、成交值、最新持股變化、反轉前週數、分型確認日／算法或通道外距離排序及翻頁。每頁 50 檔是顯示限制，不是母體限制。
6. 只有一張未鎖定 K 線圖會自動選為目標；多張時請指定。全部鎖定或無圖時，可解鎖既有圖，或明確按「新增日 K 圖」。
7. 點結果只更換指定圖表，不加入自選清單、不更換下單／智慧下單商品，也不送出交易。新圖預設日 K，既有圖的週期不變。回自選清單選商品後，未鎖定圖恢復全域連動。

範圍是全部有效上市／上櫃普通股，包含尚未加入清單的股票；排除 ETF、ETN、權證、特別股、TDR、興櫃及海外股票。2026-08-31 核對母體為 **1,975 檔（上市 1,085、上櫃 890）**，這是當次日期的數量，不是寫死上限。

## 指標與狀態

- 成交量：官方日總成交「股數」D ≥ 門檻 × P，且前日 P 必須大於零。使用精確整數交叉相乘，不用畫面四捨五入倍數決定，也不與 Shioaji 主圖的張數混用。
- 成交值：使用同一正式日列的 D 成交金額；畫面以萬輸入，內部換成新臺幣整數元並以 `BigInt` 比較。停用時不要求成交值資料。
- 大戶：TDCC 第 15 級（1,000,001 股以上）的占集保庫存數比例。單週模式為 W−Wprev；反轉模式要求前 N 次變化嚴格同方向、最新一次達到 ±X，持平 0.00 會中斷。這不是相對成長率，也不代表已證實買進或賣出。
- 原始三 K 分型：只取最新三個相鄰且完整的官方交易日 A／B／C，B 為中心、C 為確認日。頂分型要求 B 的 high／low 都嚴格高於左右兩棒；底分型則都嚴格低於左右兩棒。相等、缺日或 C 尚未完成都不會通過。
- 纏論分型：先依高低區間處理相鄰 K 棒的包含關係；向上各取較高 high／low，向下各取較低 high／low，再對最後三根標準化 K 棒套用相同嚴格分型。方向無法由先前兩根無包含 K 棒唯一決定時回 `containment_direction_unknown`，不以收盤漲跌猜測。明細保留每根合併棒的原始日期範圍。
- 布林反轉 K：固定使用與主圖相同的 canonical BOLL(20,2)。前一交易日 P 收盤須在含邊界的通道內；最新日 D 才能以嚴格不等號首次跌破下軌且為陽 K／有下影，或首次突破上軌且為陰 K／有上影。碰軌、十字線、零影線與 P 已在通道外都不通過。
- 比較期以官方日曆與官方週期固定；缺任何指定期資料，不補零、不向更早一期跳接。
- 「符合＋不符合＋無法判定＝母體」，「可判定＝符合＋不符合」。欄位缺漏可以重疊，不能加進互斥總數。
- 單條件不被另一資料族群的缺口阻擋；AND／OR 採三態邏輯，OR 已符合仍顯示另一欄的缺漏。
- pending 表示比較期或新一期來源尚待備齊；partial 表示已處理全母體但有個股缺口；stale 表示保留快照已超過下一個官方交易日 18:00 的檢查期限；unavailable 表示本機資料服務不可用。均不得讀成「市場沒有符合股票」。
- 重整只重新讀取後端狀態，不信任 localStorage 的市場資料。localStorage 只存非敏感條件偏好；翻頁固定相同快照、條件及排序，舊版淘汰時明確要求重篩。

## 正式來源與更新

官方公司名冊搭配產業別、普通股數及有效上市櫃日分類，代碼僅作交叉檢查；產業 91 的四碼／六碼 TDR 都排除。

| 資料 | 官方來源／欄位 | 比較範圍 |
| --- | --- | --- |
| 上市名冊 | TWSE t187ap03_L | 公司代號、產業別、上市日、普通股數 |
| 上櫃名冊 | TPEx mopsfin_t187ap03_O | 公司代號、產業別、上櫃日、發行股數 |
| 上市日量／成交值 | STOCK_DAY_ALL／MI_INDEX 的 `TradeVolume`／成交股數與 `TradeValue`／成交金額 | 最近兩個正式交易日；成交值條件使用 D |
| 上櫃日量／成交值 | tpex_mainboard_daily_close_quotes／afterTrading/dailyQuotes 的 `TradingShares`／成交股數與 `TransactionAmount`／成交金額 | 最近兩個正式交易日；成交值條件使用 D |
| 集保持股 | TDCC 1-5 最新整批資料；必要歷史重用合法本機列或核准原生歷史表單。本次六期升級另可由明確的 `--bootstrap-history` 使用固定 commit／SHA-256 公開鏡像，只補缺、不覆蓋官方列 | 最新六個相鄰官方週期 |
| 上市 OHLC | TWSE 官方全市場歷史日報表；依欄名解析日期、開盤、最高、最低、收盤並核對 requested／actual date | 最新 60 個已驗證市場交易日，加仍被兩版 v3 snapshot 引用的錨點 |
| 上櫃 OHLC | TPEx 官方全市場歷史日報表；依欄名解析日期、開盤、最高、最低、收盤並核對 requested／actual date | 最新 60 個已驗證市場交易日，加仍被兩版 v3 snapshot 引用的錨點 |

兩市場日量均採官方收盤完整交易範圍。同日 OpenAPI 與日期報表已全筆核對；歷史 URL 必須核實實際回傳日期，不能相信被忽略的日期參數。授權與來源證據見本 change 的 verification；頁面亦顯示官方來源名稱與連結。

TDCC 必須完整驗證十五級、調整項與合計。公開歷史表格若省略零調整列，只有在十五級股數、人數都精確等於官方合計時才正規化為 17 級；非零差異、缺級距或精度失真一律拒收。官方百分比截至兩位小數，每級與原股數誤差不得超過 0.01 個百分點。

本次六期 bootstrap 的公開鏡像固定在 `wirelessr/tdcc-opendata-archive` commit `17944774a7a37c8ef52a7ca919817fe6f949891c`，逐期固定原始位元組數與 SHA-256。operator 會先完整驗證六檔，再把 2026-08-28 的 68,799 筆逐列與 TDCC 官方全市場 OpenAPI 對帳；任一檔不符會在寫入前整批拒收並回退官方逐商品流程。鏡像不是一般 schedule 來源，不能從 UI、GET、環境變數或任意 URL 啟用。

### 自動維護與有界補跑

資料準備與 UI 查詢完全分離。既有 daily／weekly 維護完成後，以及既有每五分鐘 TDCC watcher 完成原工作或確認舊佇列為空後，才檢查選股更新；不新增 LaunchAgent，不改既有排程，不重啟行情服務。

- 選股 gate 須首次兩日／兩週驗收通過才啟用；18:00 前不抓取，成功後冷卻一小時。
- daily／weekly collector 共用 lease，最多兩個公開請求並行、每批 50 檔、逐批 checkpoint；來源成功快取分別為 6／24 小時。
- v2 排程會為最新六期缺口啟動 screener 專用有界官方歷史補取；單線間隔至少 1.2 秒、預設 64 個商品週期、最大 512 個／run，依 checkpoint 分批續跑。固定鏡像只在明確的手動 `--bootstrap-history` 啟用；GET 與 UI 永不觸發任何補取。
- v3 OHLC bootstrap 以 `market + session` 為 120 個目標（60 日 × 2 市場），一次正式批次服務該市場全母體；固定 request／時間 budget、逐目標 checkpoint、來源冷卻、Retry-After、operator lease 與中斷續跑。只有 120 個 receipt 都進入正式終態、remaining／failed／overdue 為 0，才可原子發布 v3。
- 新上市商品依正式上市／上櫃日起算，只要求實際存在的市場交易日；不足 21 日會明確回 `insufficient_history`，不會向上市日前、`candle_history`、Yahoo 或 Shioaji 偷補。正式一日兩市場都明確回報無交易，且日期已過時，才可保守修正為臨時休市；單邊或傳輸錯誤不得排除該日。
- run 最多 15 分鐘，完整 fetch＋body 最多 30 秒；失敗採退避、遵守 Retry-After，每日最多三次。CAPTCHA／封鎖持續停住，不繞過或自動改入口。
- 原子發布 v2 immutable 快照，保留最新兩版。底稿保留最新六個官方 TDCC 週期及已發布快照錨點，與個人清單、舊 active targets、一年歷史佇列隔離。
- 同一期稀疏修訂不覆蓋已驗證版本；完整官方新一期可帶合法 unknown 發布，但不混入舊日期值。

## 操作與復原指令

使用專案指定的 Node 24，資料庫路徑以 `scripts/multiview-state status` 顯示的實際 db_file 為準；不可填入遠端 D1 或另一份資料庫。以下 `/absolute/local.sqlite` 是占位符。

```sh
scripts/multiview-state backup
scripts/multiview-state migrate
/opt/homebrew/opt/node@24/bin/node scripts/stock-screener-preflight.mjs
/opt/homebrew/opt/node@24/bin/node scripts/stock-screener-update.mjs --database=/absolute/local.sqlite --bootstrap-history --limit=64
/opt/homebrew/opt/node@24/bin/node scripts/stock-screener-ohlcv-resume.mjs --database=/absolute/local.sqlite --limit=20 --pause-ms=5000
/opt/homebrew/opt/node@24/bin/node scripts/stock-screener-update.mjs --database=/absolute/local.sqlite --enable-schedule
/opt/homebrew/opt/node@24/bin/node scripts/stock-screener-update.mjs --database=/absolute/local.sqlite --scheduled
```

先備份與 integrity_check，再依 migration 流程套用 additive schema；GET 絕不自行建表。v2 migration 新增 snapshot `schema_version` 與 run 查詢索引；v3 migration 新增選股專用 `screener_daily_ohlcv`、逐市場日期 receipt／checkpoint 與必要索引，均不刪除 v1／v2、TDCC、`candle_history`、自選清單或交易資料。resume 只延續既有有界 OHLC run，不啟停任何服務。

要停用「選股更新」而維持全部行情服務：

```sh
/opt/homebrew/opt/node@24/bin/node scripts/stock-screener-update.mjs --database=/absolute/local.sqlite --disable-schedule
```

停用保留資料與快照，已在執行中的有界 run 會完成或逾時；不強制中斷任何服務。完整 D1 覆蓋復原需要另行取得停機授權，不能因選股故障自行停止 simulation API、watchdog、5173、5174、pipeline 或行情連線。

本機 API 為 `GET /api/stock-screener/status?version=3`、`GET /api/stock-screener/results?version=3&…`；v2 route 與最新兩份 v2 snapshot 暫留一個 release window，供本機回滾。gateway 固定同源 loopback 5174，拒絕其他 path／method／任意 URL。GET 只讀 immutable snapshot，不連 provider、不訂閱、不派送回補、不執行 DDL，也不依賴 Shioaji session。Sites／Cloudflare 不啟用選股功能；即使 additive migration 隨共同 schema 套用，hosted route 仍須維持 `local_only`。

## 當次驗收狀態

2026-08-31 的 v1 驗收已完成：母體 1,975 檔全部處理、remaining 0；日量比較 8/28→8/31、持股比較 8/21→8/28。成交量條件符合 141 檔、持股條件 278 檔、AND 10 檔、OR 409 檔。日量 12 檔、持股 3 檔有官方缺資料／前量為零的明確原因。

2026-09-01 已完成 v2 全市場六期 bootstrap：合法 target 11,843、processed 11,843、remaining／failed／overdue 均為 0；D1 有 11,840 筆完整 `full-17` 列，另有 3 個商品週次為 TDCC 官方本身未提供資料，因此保存 `official_no_data` 而不造值。最新 v2 snapshot 含 1,975 檔（上市 1,085、上櫃 890），六期為 2026-07-24、07-31、08-07、08-14、08-21、08-28。

同日 API 全分頁驗收涵蓋成交量、大戶單週、兩種四週反轉、各自成交值、AND／OR 與缺中間週；實際本機 UI 已核對 600／768／900 CSS px、console、結果明細與點選不在自選清單的 1101 台泥。背景工作已完成不代表每檔都有來源值；大戶四週反轉仍有 6 檔依法為 `history_pending`，介面正確顯示 `partial`。

完整非敏感版本、缺口、測試與 run 證據見 `openspec/changes/archive/2026-09-01-extend-after-market-stock-screener-with-turnover-and-holder-reversal/verification.md`。v2 已歸檔並以 commit `a63a342` 保存；功能維持本機限定，未另行部署至 Sites／Cloudflare。

2026-09-02 已完成 v3 技術型態升級：60 日 × 兩市場共 120 個 OHLC target 全部 processed，remaining／failed／overdue 為 0；D1 保存 116,886 筆合法 OHLC，並原子發布 1,975-row snapshot `273e72b9-dc65-4320-8753-1d1520a61179`。原始三 K 底／頂分別有 482／52 檔，纏論底／頂 530／317 檔；BOLL 下軌陽 K 下影為 2701，BOLL 上軌陰 K 上影為 1735、6153、6532。

背景完整不代表每檔每天都有成交四價；API 因合法 row-level `missing_ohlcv`、`containment_direction_unknown` 或 `insufficient_history` 可能顯示 `partial`。新上市 7814 自 2026-07-16 起有 34 筆，7855 自 2026-08-11 起有 16 筆且 BOLL 仍為 `insufficient_history`，兩者都沒有上市前假資料。完整 v3 source、D1、API、UI、responsive、console 與測試證據見 `openspec/changes/archive/2026-09-01-add-technical-pattern-filters-to-after-market-stock-screener/verification.md`。v3 已歸檔並以 commit `972f781` 保存；功能維持本機限定，未另行部署至 Sites／Cloudflare。
