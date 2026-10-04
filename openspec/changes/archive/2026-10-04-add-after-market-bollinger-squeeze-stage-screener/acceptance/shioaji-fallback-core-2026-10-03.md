# Shioaji 備援核心實作與來源缺口（2026-10-03）

## 結論與任務邊界

完成 **8.2**，目前 **30／41**。這是可供後續接線的核心程式，不是正式啟用備援、自動發布或 160 日 ready。

新增 `scripts/stock-screener-shioaji-daily-quotes.mjs`、24 項隔離測試、0037 additive migration 及對應 schema／journal。沒有套用 live DB、建立正式 verified review、修改 watcher/profile、啟動歷史下載、重啟共用服務或改 publication head。

8.3 僅完成獨立 cache／receipt 的 schema 部分；逐列正式 provenance、source-selection manifest、provider review repository、發布 mapping／cursor 等尚未接線，不勾整項。8.4 只有必要 admission port／拒絕防護，沒有冒稱已接上集中持續保留的實際預算。8.5–8.8 尚未完成，不因單元測試成功而勾正式驗收。

## 核心防護

- 固定 loopback `POST /api/v1/data/daily_quotes`、明確 date／exclude=true；每次一次 request，不帶秘密或自行登入、不跟轉址／重試。15 秒預設整體 deadline（可調至 30 秒）、2 MiB 硬上限，主動 Abort／半份 response 不回成功。
- Column-array 專用 JSON decoder 保存數字原 lexeme，不經 Number；拒絕重複 keys／代碼、欄數／長度破損、錯日、HTML、非法 OHLC、非 int64 整數及範圍外值。Volume 股數與 Amount 真實原值分開保存，不乘 1,000、不用收盤價乘量。零成交分類 no_trade、不造 K 棒；矛盾金額／筆數拒絕。
- 依已驗證普通股 universe 投影上市／上櫃，額外商品不加入策略母體；來源缺失、上市前、下市後、明確停牌分列，不從代碼猜市場。
- SQLite date-level lease 與不可變成功 response／hash；跨市場或下一程序只讀已保存日期，不重抓。review 換版不自動重置同日嘗試／invalid 或覆寫已凍結 cache，後續正式 review 更正流程仍待 8.3。
- 來源 review／官方 authority／母體缺口／舊 schema 均零 request。真正請求還需新鮮 simulation business session、相同 API generation 及集中 admission port；未接 admission 預設拒絕。額度 reserve／settle 與來源 request 分開，不冒稱 JSON bytes 等於 broker 扣量。
- 同來源日期最多 18 次；開始時即保存 20 分鐘 nextAttemptAt，避免程序中止於 request 後立刻重打。429 至少一小時且完整尊重合法 Retry-After，不截短長期限；invalid 不自動解除。收據 append，未知任意 error.message 不持久化。

## 來源契約查證：8.1／1.1 仍未完成

本輪重新查閱 [Shioaji 官方每日行情參考](https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/MARKET_DATA.md#daily-quotes-每日行情) 與 [官方使用限制](https://sinotrade.github.io/tutor/limit/)。文件支持指定日期、全股票每日行情、column JSON，以及盤後查歷史／查後快取／避免反覆登入的模式；不是完整行情再散布或展示權利聲明。

前一輪兩日期實際 response 及 2449 與 TWSE 對照保留於 [可行性紀錄](shioaji-daily-quotes-feasibility-2026-10-03.md)。仍須核實雙市場歷史價格／交易範圍一致性（含日報涵蓋範圍、零股等）、完整母體／窗口與本機使用／展示限制。故不得把測試 fixture 的 `localDisplayVerified=true`／review hash 搬到 live，不建立正式 verified checkpoint；原 TPEx 失敗也未解除。共同日曆 Gate 仍獨立，備援行情有資料不能代替它。

本輪只對既有 API 做 `/api/v1/info` 與 `/api/v1/auth/usage` GET：info HTTP 200、simulation=true、version=1.7.1；usage HTTP 200、connections=1、bytes=5,779,209、limit=524,288,000、remaining=518,508,791。沒有新的 daily_quotes POST、broker login 或 subscription。

## 測試與修復

- Node 24.19.0：備援 24／24；連同官方準備器／transport／保留測試 **52／52**。
- Vitest：v8、布林 history／query／API、v7，5 files **60／60**。合計 focused **112／112**。
- `pnpm exec tsc -b --pretty false`、`pnpm build` 通過；build 既有 >500 kB chunk 提示保留，不把它當功能失敗或隱藏。
- 首輪 17／18，一項並行狀態分類顯示 source_cooldown 而非 lease_busy。已修正優先顯示仍有效的租約，並補 review 換版、18 次上限及 Retry-After 長期限／秘密訊息測試；沒有放寬要求。
- 最後審查補強第二次 session 核對期間租約過期的防護：零來源請求、零 started 收據並釋放額度；實際 started receipt 與 attempts 以同一時間條件保存，完成後再核對擁有權。另補半份 response 與途中 Abort 隔離測試。
- OpenSpec strict、tracked diff 及本輪新檔 whitespace 檢查通過。沒有執行 repo-wide 測試或宣稱其他進行中變更皆正常。

## 真實唯讀 API／UI

2026-10-03 **15:33:05 Asia/Taipei** 執行既有 `stock-screener-bollinger-local-readonly-check.mjs`，使用隔離 browser storage；只准本機選股 status/results/daily-profile GET，其他 API 請求即阻擋。

- actual requests：daily-profile v8 兩次、status v7 兩次、results v8 一次；non-GET=0、blocked=0、pageErrors=0、console errors=0。
- results HTTP 200、state=pending、reason=v8_preparation_pending、rows=0；profile=null，UI 顯示等待完整資料／尚未發布，不冒稱備援已啟用。
- 8080 PID 1273、5173 PID 933、5174 PID 938 listener 與本輪前相同。未停止／重啟、未真實下單、未 archive／commit／push；既有 dirty tree 保留。

此為 actual pending 畫面與查詢隔離驗證，不能代替來源驗收、160 日覆蓋、自動 fallback 或正式結果操作。

## 後續

先核實 8.1 的來源語意／本機權利，及 8.4 的集中實際 reservation 接線；再完成 8.3／8.5–8.7 provider／mapping／發布／UI／回歸，最後才准正式有界回補與 8.8／7.2–7.4。現有服務與停用策略不變。
