# 完整重驗與修正（2026-10-04）

時間使用 Asia/Taipei。依使用者「完整驗收一次，有錯誤就改正」要求，重新檢查本 change 的規格、程式、公式、持久資料、真正 watcher、API、瀏覽器與既有圖表／雙清單原始證據。不人工發布、不下載歷史來源、不重啟服務、不新增 broker login／訂閱、不歸檔或提交；其他 dirty work 保留。

## 結論與界線

- 現有 47／47 項完成證據經重驗維持成立；本輪發現並修正兩個讀取／狀態問題，未更改策略公式、凍結原值、日期、來源容差或下載預算。
- 實際同一期結果仍為 16 筆：正在壓縮 14、準備突破 1、今日正式突破 1；無法判定 61。1977 檔不等於 1977 檔都 ready，未知不能改列未符合。
- **下一交易日的無人值守準備仍有明確風險**：目前流量政策 `validThrough=2026-10-05T06:00:00.000Z`，即明天 14:00，恰與下一次盤後策略時點一致。到期後 `policyRecord()` 會拒絕新下載，不能拿今日重驗冒充明日一定成功。這是既有 fail-closed 行為，不擅自延長期限或偽造新的額度／校準證據；需在明日排程前重新核實與處理政策有效性。今日已發布報告不因此被改寫。
- TPEx-only 臨時公告 transport／schema 尚未獨立驗證、provider quota epoch 未驗證的既有限制仍保留。正式採用本機持久保守帳本，不能宣稱已取得提供者的額度週期權威。

## 問題一：擴大歷史窗口造成解碼錯誤

將查詢 lookback 調為 250、setup 調為 20，實際所需 290 日而底稿只有 160 日。 evaluator 正確判斷 `history_pending`，但 route 原本保留發布 envelope 的 `canUseResults=true`，與空 rows 的待準備狀態不一致；透過正式 decoder 重現 `invalid_v8_response`，新增測試先失敗。

修正 `stock-screener-v8-route.ts`：以查詢結果的 `history_pending` 同步 state／reason，只有 ready 且非 stale 才允許 `canUseResults`。不重算或改寫發布 head。

修正後 Node 端到端測試通過；真實 5173 API 回 HTTP 200／`history_pending`／`canUseResults=false`，required=290、available=160、無 rows／cursor。Chrome 實際畫面可讀「所需官方歷史尚未備齊」與所需／已備日數，不再出現解碼錯誤，也不顯示舊結果卡。新增 Chromium 回歸確認此狀態不觸發圖表、清單或 profile 寫入。

## 問題二：全市場完整性驗證的暫存配置成本

本輪原失敗：11:20:20.655 5173 預設查詢 HTTP 503，5100 ms；11:20:20.804 長窗查詢 HTTP 503，147 ms，均為 `local_data_service_unavailable`。11:20:50.935 直接 5174 同期查詢 HTTP 200，5167 ms。沒有服務端原始堆疊證明兩次 503 的全部原因，尤其不能把 147 ms 那次也直接斷言為逾時。

讀取程式原先為驗證完整 rowsHash，建造整份大型 canonical 字串與 UTF-8 中間陣列。改為逐列 canonical serialization 增量 SHA-256，payload byte budget 用 `Buffer.byteLength`；canonical 編碼與 digest 完全相同，沒有跳過任何完整性驗證。每個新 DB／clone／manifest／rowsHash 仍嚴格驗證，沒有僅憑 snapshot ID 快取略過。

新增 hash 等價與篡改拒絕測試：空陣列、Unicode、巢狀資料、undefined，以及更改持久股票名稱但保留 features hash 的情境；既有大量資料完整 hash／分批讀取測試維持通過。

修正後真正 5173／5174 查詢成功，沒有提高 timeout 或放寬來源限制。這是本輪成功實證，不保證未來任何查詢永不逾時。

| 時間 | 實際查詢 | HTTP／耗時 | 結果 |
|---|---|---|---|
| 11:23:17.865 | 5174 預設 | 200／4687 ms | ready，16 筆 |
| 11:23:22.567 | 5173 預設 | 200／4701 ms | ready，16 筆 |
| 11:23:26.770 | 5173 長窗 | 200／4203 ms | history_pending，290／160 |
| 11:23:31.411 | 5173 預設 | 200／4641 ms | ready，16 筆 |
| 11:26:06.688 | 5173 突破 | 200／4580 ms | 8111.TWO，1 筆 |
| 11:26:11.031 | 5173 準備 | 200／4342 ms | 2426.TW，1 筆 |
| 11:26:15.616 | 5173 unknown 第一頁 | 200／4585 ms | 50 筆，filtered=61，有 cursor |
| 11:26:20.209 | 5173 unknown 第二頁 | 200／4593 ms | 11 筆，無 cursor，無重複 |

## 持久資料與獨立公式重算

11:18:53.444 完成 `scripts/stock-screener-bollinger-live-audit.mjs`，同一 readonly DB snapshot，無 HTTP／DB 寫入；不匯入產品策略公式，直接從原 OHLCV 重算 BOLL、分位數、prefix、分類及 exact int64，全部一致。

- 160 交易日：2026-02-02 至 2026-10-02，7/10 依原已保存官方全日休市公告排除；不把 2/2 當成 7/10 資料。
- 320 市場日期 manifest／160 共享來源日快取／316320 商品日期點／1977 股票；其中 1645 完整 ready histories。
- 分類：壓縮 14、準備 1、突破 1、未符合 1900、unknown 61。上市 1085（壓縮6、準備1、突破0、未符合1065、unknown13）；上櫃892（壓縮8、準備0、突破1、未符合835、unknown48）。
- readiness 日期點原因：ready310063、no_trade986、before_listing3053、missing_ohlcv1724、source_missing494；不填入假 OHLCV。
- unknown 原因可重疊：missingOHLC49、source_missing13、no_trade33、before_listing3。
- 原自動 head `72dd8c83-792e-4217-a8ab-398cf8513c51`、09:11:47.246 發布時間不變；rowsHash `39fada3054b0a3e9bcd3cd11f665008a3fef380cbfe08b73f579134a044601d7`。
- sourceManifestHash `161e096da316e7d04dc0ab9daf8c405bbca6d44598d0e75b104fe733dd044035`；原158failed hash `1fb7a9e0e0146249a0b61987fe9be6a2feedccdcd418fe6760b3584be27ab413` 不變，7/10 十八次失敗保留。

## 真實畫面、原驗收網路證據與復原

本輪使用新建隔離 screener 分頁，未點股／加入清單／停用每日策略；實際驗證預設16筆、長窗pending、恢復120／5後16筆、突破分類1筆及原三項 legacy 草稿重新查詢25筆。隔離頁 console reader 捕捉 error／warn=[]，原工作區既有帳務400與歷史503不因此消失。

11:30 關閉本輪測試分頁；原主工作區仍為千張大戶比例0–100%／3週、十張以下散戶3週、價漲融資5日，AND／pass／code／asc、IX0001圖表。11:30:37.564 readonly DB 再核對 profile revision1、payload hash `4ce25d3d72813b4b0b05939920cb6779fbd96b54afecaa1415981cf035407028`、原 head／updated_at 不變。

原圖表／雙清單驗收的私人 HAR 重新核對 hash 與逐請求 counts（不是本輪新操作）：chart HAR352筆、list HAR6筆。仍與 `final-network-and-closeout-2026-10-04.md` 一致，原503及400保留；列表 HAR6筆全200，無 login／subscription／下單端點。本輪沒有新 HAR，不把先前 counts 冒充本輪操作 counts。

11:27–11:28 readonly API 確認 Shioaji原13項與MultiView原6項及順序不變。broker usage=4143245 bytes／remaining=520144755，connections=1；stream healthy／active_connections63。這些為共享背景用量與連線指標，不歸因為本 change 獨占用量或代替逐請求證據。

圖像原件僅存本機私人資料夾，不加入 repo：

`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/bollinger-20261004-closeout.ddtGTo/`

| 原件 | bytes | SHA-256 |
|---|---:|---|
| bollinger-reacceptance-ready-1128.jpg | 78968 | 705b594b07bb1035f6a140c9de43c05c8388f639fccbd298edeed576db6270a5 |
| bollinger-reacceptance-history-pending-1126.jpg | 68302 | f5375acfe6cf3f6cb0bd31deb206b39f3b7414180f7585971c9a6af44712d092 |

## 排程與安全

11:18 `pnpm local-runtime status`：simulation／business session／2330 Snapshot healthy，8080／5173／5174 up；production stopped、write master disabled、watchdog restart0、active obligations0、drain=[]。未操作交易草稿。

真正五分鐘 LaunchAgent 原 watcher：runs478、exit0；原自然輪次同鍵 `session_complete_sleeping`，下一策略時點10/5 14:00。未手動 kickstart／補跑下載器；兩 HTTP/run／兩 request/minute 不變，300 MiB 保護池／85667193 bytes 基準保留不放寬。持久保守帳本 retained估計65362668 bytes（charged178），未因換日／generation／counter下降清債。

流量政策到期與下次排程同時，是本次新發現的維運風險，**尚未以明日真實執行驗證排除**。需另做有證據的政策複核，不以更改日期、清空舊債或任意延長 validThrough 取得綠燈。

## 回歸與工具驗證

- Node24.19.0：全 stock-screener Node 回歸 **300／300**。
- Vitest20檔相關 lib／圖表選取回歸 **182／182**。
- 集中 ledger／bandwidth 相關測試 **27／27**；合計509項程式測試，focused重跑3項已含於300，不重複計數。
- Chromium兩檔面板回歸 **39／39**（含新長窗pending測試）。
- `pnpm build`、MultiView screener `tsc --noEmit` 通過；既有 bundle>500kB 警告保留。
- 最後追加文件後再執行 change strict validation、型別、`git diff --check` 與 scoped untracked text whitespace；結果以下方收尾紀錄為準，不把測試成功寫成來源或明日排程已成功。

收尾實際結果：`openspec validate add-after-market-bollinger-squeeze-stage-screener --strict` valid；MultiView screener 型別檢查 exit0；`git diff --check` exit0；本輪8份程式／測試／文件（含 untracked）文字 whitespace 全數通過。未改動其他 change 或既有生成檔的內容以消除無關警告。
