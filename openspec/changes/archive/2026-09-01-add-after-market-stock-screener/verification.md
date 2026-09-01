# 收盤後選股實作與真實資料驗收

日期：2026-08-31（Asia/Taipei）。範圍僅 RealTimeStock 本機 Web；正式 specs 同步、歸檔、commit、push、Sites／Cloudflare 部署不包含在本輪。

**驗收完成：32／32 tasks，remaining 0。** OpenSpec apply 狀態為 `all_done`；這代表本機功能與本文件列出的驗收完成，不表示官方來源零缺值，也不表示已歸檔或已部署。

## 官方母體、來源與使用邊界

母體為 **1,975 檔：上市 1,085、上櫃 890**。依官方公司名冊、產業別、普通股股數、有效上市櫃日期與 `FL033103` 分類，不以自選清單、券商排行或四碼形狀代替普通股種類。TWSE 名冊日期 8/30、TPEx 日期 8/31，保留原日期，不重標；允許的來源時差上限三日。

TDR 排除十檔：9103、910322、9105、910861、9110、911608、911622、911868、912000、9136。早期候選數 1,979 多算四檔四碼 TDR，已修正且加入回歸測試；不沿用早期數字作正式母體。

- [上市公司基本資料](https://data.gov.tw/dataset/18419)、[上櫃公司基本資料](https://data.gov.tw/dataset/25036)、[上市個股日成交資訊](https://data.gov.tw/dataset/11549)、[上櫃股票行情](https://data.gov.tw/dataset/11370)、[TDCC 股權分散表](https://data.gov.tw/dataset/11452) 的政府資料目錄標示政府資料開放授權條款第 1 版；面板保留來源顯名與連結。
- 日量採 TWSE `STOCK_DAY_ALL.TradeVolume`、TPEx `tpex_mainboard_daily_close_quotes.TradingShares` 及同口徑正式日期報表的「成交股數」。不乘 1,000、不使用均量比、不與主圖 Shioaji 張數混算。
- [TWSE 日期報表](https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=20260828&type=ALLBUT0999&response=json) 的完整交易範圍含一般、零股、盤後定價與鉅額，不含拍賣與標購；[TPEx 日期報表](https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=2026%2F08%2F31&id=&response=json) 與正式 OpenAPI 逐檔同日對帳。18:41–18:43：TWSE 8/28 四碼資料 1,085 筆、TPEx 8/31 四碼資料 888 筆，股數 mismatch 均為 **0**。此為 adapter 對帳集合，TWSE 其中 TDR 仍排除於普通股母體外。
- 舊 TPEx `d` 日期參數會被新版入口忽略；實作只接受新 `afterTrading/dailyQuotes` 的實際回傳日期，不相信 URL 自稱的日期。
- [TWSE 使用條款](https://www.twse.com.tw/zh/terms/use.html) 的政府開放資料例外不被擴張成任意歷史抓取權。本次只使用已核對正式批次報表的最近兩日。
- TDCC 最新整批資料優先；必要前週延用既有正式 TDCC 規格與使用者授權的本機 operator，使用[官方公開表單](https://www.tdcc.com.tw/portal/zh/smWeb/qryStock)原生 GET／POST。不是任意歷史 API，不擴張公開展示或轉售權；session 僅在記憶體，遇 CAPTCHA／封鎖停止，不改入口繞過。
- TDCC 第 15 級是 1,000,001 股以上、占集保庫存數比例。歷史格式接受完整 17 列，或十五級＋合計的 16 列；後者只有股數、人數精確等於合計才能證明調整為零。台積電帶負調整的 17 列與台泥 16 列均實測；台泥合計股數 7,523,181,742、人數 507,027。格式與證明規則保存在 parser／測試及 `screener-official-v1` 正規化版本，逐筆保留正規化 17 級、來源 URL、日期與 payload hash；不保存含 session 的原始 HTML，也不宣稱每筆保留原 HTML 列數。
- 各級比例與精確股數容許誤差至多 0.01 個百分點；實際已取得列的最大單級誤差約 0.00999965、比例加總誤差最大 0.11，均通過。完整級距／合計未通過者只污染該股，不補假值。

### 非敏感 SHA-256

| 來源 | SHA-256 |
| --- | --- |
| TWSE 名冊 | `7a1c8165bddf6cf38bc72a39f6a25939362276c0678b869b69d1278982a949bf` |
| TPEx 名冊 | `a2a39e8380d6fb0769355135bac384a13297d3b9cbec41cbaaf10df273486509` |
| TWSE 8/28 OpenAPI 日量 | `b5036d3cca8b3df657de609dbe9065aecc88e51a87ab09559998916f16f938b1` |
| TWSE 8/28 日期報表 | `4cab8ac730a007961b354efcb270fa19d00eb1442c634d113aa0e2af60d0f2df` |
| TPEx 8/31 OpenAPI 日量 | `402d2b9cf0c487ccce6e3c67f74588e74631c33937cdeec5cf9a741611b7cff0` |
| TPEx 8/31 日期報表 | `0dcee744fed0efc8cb1b60e6c10e36c8eb5dfcb661ae1bb1a4c055ba50b1d06c` |
| TDCC 8/28 整批 | `b3d0cb3f83a231e470e3e58c421c7e0e965e9d0323e39fa59fc8b273ef08c78c` |
| TWSE 年曆 | `7fefe785ea7155a5004a2eb74486ad865ea5c4b5f02ee0cffbbdacb1ca2ea390` |
| TPEx 年曆 | `c5cea6bd3a10bc7cd3e577d9ad78e600ae7d64508a1bc9b09be32fb396d0dc41` |
| TDCC 官方週期集合 | `f191b2164ac2bfa0fd1b88153c6cc5a1d0f7cdaf1a5dfc6c524527898b11dce7` |

官方交易日固定 D／P＝**8/31／8/28**；官方期別固定 W／Wprev＝**8/28／8/21**。下一正式交易日 9/1，快照 `validThrough=2026-09-01T10:00:00.000Z`，不以瀏覽器昨天或硬減七天猜日期。

## 本機遷移與資料隔離

- 既有一致性備份：`multiview-20260831T102201Z.sqlite`；live migration 前再次備份 `multiview-20260831T105010Z.sqlite`。皆在 repo 外 App Support backups，`integrity_check=ok`。早期一般複本不作備份證據。
- 隔離 staging 套用並測試 0027 六張選股表。live 透過既有 migration 工具套用待執行 0026 的 IF NOT EXISTS schema 與 0027；未啟動 continuity 工作。僅將六張原本空白的 screener 表從 staging 以 transaction 匯入，沒有覆蓋整份 live DB。
- 既有 TDCC 前週 51 檔只重用完整性／精度通過的 40 檔，其餘由必要前週來源核對；舊 `tdcc_continuous_symbols`、active targets、一年佇列不改寫。初始 active setup 24／user 27、inactive user 1；舊 completed items 2,862。
- bootstrap 逐股 checkpoint：104 → 322（當次來源錯誤中止，已存部分保留）→ 834 → 1,346 → 1,858 → **1,975**。每 run 最多 512、15 分鐘，單線間隔至少 1.2 秒；不在 UI 查詢中抓取。最終完成紀錄另列於下方。
- 只保留必要比較期及最新兩版 immutable 快照；整期 receipt 與官方日曆證據共同授權日期，逐股資料不能自行生成期別。相同期稀疏修訂拒絕，新官方期別的合法 unknown 可發布並保留前版。

## 真實資料案例與缺口

- 4535 至興 6,000 → 18,000 股，恰好 **3 倍**。
- 2836 高雄銀持股 82.53% → 82.73%，恰好 **+0.20 個百分點**；4111 濟生 32.73% → 32.93% 同樣達標。1102 亞泥 79.12% → 79.31% 為 **+0.19**，不達標。
- 1104 環泥 931,772 → 8,828,367 股、1110 東泥 24,996 → 304,034 股、4305 世坤 120 → 1,015 股；不是只依量大排行選出股票。
- 19:23 唯讀取得四組現有前百排行（漲／跌、量、金額），各 100 筆、聯集 284 個代碼。1104、1110、1233、4535、4305 均不在四組內，也不在使用中的 15 檔觀察清單，仍可被全市場結果找到。
- 日量無法判定 12 檔：1563、1589、2867、4804、5371、6949 當期／兩期缺列；4747 缺前期；2073、6236、7716、8917、8923 官方前日量為零。以官方實際缺列／零量說明，不猜停牌原因，也不刪出母體。
- TDCC 最新 8/28 缺 2867、5371；前週 8/21 缺 6241。三筆均另用官方原生表單唯讀複查為查無資料。保留對應 unknown，不假補、不跳接其他週；處理完成不等於來源每股都提供兩期值。

## 已驗證的 UI 與測試邊界

### 真實 5173 DOM／canvas

- 面板兩條件預設 3／0.2、AND，可單獨開關。日量實際 141 筆分成 50／50／41 三頁，另可查看 12 筆無法判定；不是僅掃描一頁。
- 點 1104／1110 等非清單股票只更新指定第二張 K 線；原圖與下單／五檔／成交明細仍為 IX0001，圖表數量輸入維持 1，未操作任何委託控制。
- 原圖 canvas 714×256、指定股票圖 470×46／48 與非零時間軸。新增圖 DOM 確認預設 1D、原圖仍 5m；快速 1101→1104 最終只留 1104。
- 鎖定會鎖目前真正顯示商品，已鎖圖不在目標選項；全鎖時結果停用並提供解鎖／新日 K 提示。解鎖一張自選該圖，移除目標使舊目標失效。測試新增第三圖已移除；原有圖保留。
- 從自選清單切大立光再切回加權，未鎖定圖恢復全域跟隨，下單仍是指數不支援下單的狀態。
- 真實 1040×600 viewport：內部寬 283、scrollWidth 283，高 533／scrollHeight 779；1280×720、20.8px 字級下寬 353／scrollWidth 353，50 筆結果於面板內部捲動。
- 互動後 error console 為空。最後兩條件、持股與 OR 真實驗收另列於下方。

### 隔離測試（不以此冒充 live 證據）

- 主介面完整單元測試 **168 files／2,026 tests 通過**。
- MultiView 完整測試 **650 tests 通過**；含 collector lease／checkpoint、逐股無效隔離、來源 timeout／429／封鎖、完整市場分類、防縮水、相鄰期別、同版分頁、快照 CAS／非退化與只讀 GET 零 provider／零 DB 寫入。
- Chromium 選股 browser suite **5 tests 通過**：320px 寬、根字級 24px、550px 高、鍵盤焦點、內捲動、手動套用、無圖／多圖、儲存失敗、延遲回應隔離、pending／partial／stale 與離線保留結果。
- Shioaji／5174 離線與請求失效使用 fixture 注入，不為驗收停止使用者任何服務。
- MultiView lint（零警告）、全量 typecheck、來源治理均通過。根 `tsc -b`＋Vite build、MultiView build 通過；既有 bundle 大小／動態 import 警告不阻擋建置。
- 修正既有測試讀取已歸檔智慧下單 artifact 的舊路徑：僅 test helper 於隔離目錄重現原 manifest 邏輯路徑，原始 bytes／hash 不改；未改交易 validator、授權、門檻或交易執行器。兩個日期依賴的日 K fixture 固定時鐘。補齊真正全量 Worker ambient types 與既有型別錯誤，而非以選股 scoped typecheck 代替全量。

測試暫存紀錄：`/private/tmp/screener-acceptance-{root,multiview,build,lint,types,governance}-20260831.log`。非敏感永久摘要即本文件；暫存檔不提交。

## 排程與既有服務

- 使用既有每日／每週維護及每五分鐘 TDCC watcher，在原工作完成或佇列空閒後執行選股 `--scheduled`，舊資料工作優先；沒有新增 LaunchAgent。
- 原每日 16:45 太早，選股另守台北 18:00 gate；成功冷卻一小時、來源 daily 六小時／weekly 二十四小時。403／CAPTCHA 持續封鎖；429 遵守 Retry-After；最多每日三次失敗嘗試。一般排程不帶歷史 bootstrap。
- 已備份 installed launcher 至 `/private/tmp/screener-runtime-before-20260831`，原 SHA `d19af8b6c4cb899b986efad85a3f4f95d54ad85b91829bd3d6dd80a1cdaf4da4`。只原子更新入口檔，未操作 launchctl 啟停。
- repo／已安裝入口檔 SHA 均為 `2d90a67e75c42e3f9bec3c564eee6ff0b4c076d26cafe1e22315b363e36985db`。初次驗收前既有 watcher 自然執行並記錄 `schedule_disabled`；**19:42:48 啟用 gate**（`bootstrapHistory:false`）。19:43:24 已從既有 watcher log 觀察到原 `queue_empty` 工作後的選股 `backoff`，下次允許時間 `2026-08-31T12:40:33.626Z`（20:40:33 台北）。確實走到啟用後路徑且遵守冷卻，未增加無節制來源請求。
- 5173／5174 於 19:39 仍為原 PID **915／922**；simulation API、watchdog、pipeline 與行情連線未停止／重啟。

## 最終全市場 run 與逐筆對帳

19:40:33 原子發布 `8f3df8b7-fd24-42fe-8260-18d9f3d18bc4`；前週 target／processed＝**1,975／1,975**、remaining＝**0**、有效資料 1,974、已說明官方無資料 1。保留前版 `13ea3c03-e43f-4bb0-854d-28cc50db636d`，沒有半成品 staging 對外可見。

| 市場 | 母體／processed | remaining | 日量 8/28 | 日量 8/31 | TDCC 8/21 | TDCC 8/28 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TWSE | 1,085 | 0 | 1,081 | 1,081 | 1,085 | 1,084 |
| TPEx | 890 | 0 | 887 | 888 | 889 | 889 |
| 合計 | 1,975 | 0 | 1,968 | 1,969 | 1,974 | 1,973 |

19:42:28 以 live DB 唯讀單一快照，獨立 BigInt 計算量倍數、百分之一百分點相減；逐模式將 pass／fail／unknown **所有頁**取完與全部 1,975 檔比較，無重複、漏列或 verdict mismatch。每次回應均核對 snapshotId、anchors、universeRevision、formulaVersion、criteriaFingerprint、expectedSessionDate；`integrity_check=ok`。

| 條件 | 符合 | 不符合 | 無法判定 | 可判定 | 上市符合／上櫃符合 |
| --- | ---: | ---: | ---: | ---: | --- |
| 成交量 ≥ 3 倍 | 141 | 1,822 | 12 | 1,963 | 75／66 |
| 大戶週增 ≥ 0.2 百分點 | 278 | 1,694 | 3 | 1,972 | 187／91 |
| AND | 10 | 1,961 | 4 | 1,971 | 9／1 |
| OR | 409 | 1,555 | 11 | 1,964 | 253／156 |

每列符合＋不符合＋無法判定＝1,975。AND unknown：1563、2867、4747、5371；OR unknown：1589、2073、2867、4804、5371、6236、6241、6949、7716、8917、8923。欄位缺漏仍分別是日量 12、持股 3，不將重疊缺漏當互斥總數。

| 非敏感版本／對帳集合 | SHA-256 |
| --- | --- |
| universeRevision | `194bdc8586990e651b95dace4670a003931755937a9ae7f5acdec166a78d53ad` |
| 按 symbol 排序的快照輸入 JSON | `07c202175a4dfbadeaaac310418bdaba3fe647394fd7e59caf1ec09bfe662523` |
| 日量所有 `[symbol, verdict]` | `a62e9d7a33b5ea01bdb516c92ecfb0b778fc8f01bc87e87e32e1b3d232409016` |
| 持股所有 `[symbol, verdict]` | `89873c62fc2735009f9b02c7e1b73c02db8255c97785379b65a603a53dfc6526` |
| AND 所有 `[symbol, verdict]` | `04997ae46a5ccc4046e662e4137f3dbcf199be2a4a21cc16f06b5efb8e048a70` |
| OR 所有 `[symbol, verdict]` | `065c140dbb2e08879d28dfe101e8e12393486ffd33e0ae5a61c678d26f50ae5b` |

最後真實 UI：AND 10、持股單條件 278、OR 409 均與上表一致；持股缺口畫面列出三商壽／中光電「缺本期」、鑫永洋「缺前期」。點高雄銀後第二圖為 **2836、1D**，實際 8/31 OHLC 12.05／12.05／11.85／11.85、K 棒量 2,749 張，canvas 452×48＋26px 時間軸；原圖維持 IX0001、5m，下單仍 IX0001。主圖沿用既有 Shioaji 量口徑，未以選股歷史值冒充最新 quote。驗收後保留預設兩條件 AND，console errors＝0。

最終 `openspec validate --all --strict`：**27／27 通過、0 失敗**；`git diff --check` 通過。最後 listener 核對仍是 5173 PID 915、5174 PID 922。本輪沒有正式 specs 同步、歸檔、commit、push、部署、停止服務或關閉行情連線。
