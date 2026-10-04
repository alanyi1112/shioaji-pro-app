# 真正自動發布、全窗口獨立稽核與查詢規模修復

日期：2026-10-04；時間均為 Asia/Taipei。這是 `automation-2` 接續驗收，不是人工下載或人工發布。

## 真正 watcher 的公告修正與發布：成功

- 原 08:51 `calendar_closure_review_required` 失敗及 09:11:13.201 冷卻保留；沒有提早清除、重設來源嘗試或手動補跑。
- 09:11:19.041 真正 watcher 保存 verified 官方公告；證據 hash `ea698586ff3d2e6fe0830da7b8b44119351be9f18d80e1905466555081b0c3ec`。09:11:19.042 保存新 effective calendar、排除 `2026-07-10`。原年度 authority hash `fa8c1db367dd1b0b7e270f49765265a63d645947678a9208d3ac74a50a01ab33` 保留；新 effective hash `e3f19254abb134e73f56a93946814c5e0911d95a9a41c0fa86dc2fc8c2afe268`。
- 新窗口 `2026-02-02 → 2026-10-02`、160 個共同交易日。2/2 是窗口向前新增的真實依賴日，**不是代填 7/10 的資料**。
- 09:11:23.637 唯一新增 Shioaji 2/2 批次，兩市場共享、attempts=1；09:11:26.695 真正 prepare 收據為 requested=1、response bytes=120,412、processed=320、remaining=0。
- 09:11:26.696 staging；09:11:32.658 publication_started；09:11:47.246 publication_complete／atomic head，snapshot `72dd8c83-792e-4217-a8ab-398cf8513c51`，profile revision=1。
- 真正後續 09:14／09:20 watcher 輪次為 `skipped / session_complete_sleeping`、同一 snapshot，下一資料工作為 10/5 14:00；沒有第二次發布或手動呼叫 publisher。
- immutable manifest hash `161e096da316e7d04dc0ab9daf8c405bbca6d44598d0e75b104fe733dd044035`；rows hash `39fada3054b0a3e9bcd3cd11f665008a3fef380cbfe08b73f579134a044601d7`。

## 原始失敗：保留，不轉寫成成功

原 158 筆 failed 收據集合 hash 仍為 `1fb7a9e0e0146249a0b61987fe9be6a2feedccdcd418fe6760b3584be27ab413`。7/10 原快取仍 pending／attempts=18／`source_not_published`；公告把這天排除出新交易日窗口，沒有把十八次空批次改成成功、當休市原始來源，或增加第十九次嘗試。

先前原紀錄見 `calendar-closures-2026-10-04.md`、`background-continuation-2026-10-04.md` 與 `local-conservative-ledger-and-watcher-2026-10-03.md`，均保留其當時狀態。

## 同一唯讀 DB snapshot 的獨立稽核：成功

`scripts/stock-screener-bollinger-live-audit.mjs` 只讀既有 SQLite，不匯入產品三階段 evaluator、不下載、不寫入。09:19:05.279 真正執行，重算原始回應 SHA、無損整數、逐列來源 hash、manifest、prefix 與直接公式。

- 320 份不可變市場日期 manifest、160 份共享日快取、316,320 商品日期點（1,977 × 160）；source date／OHLC／canonical 股數與 TWD／raw provenance 核對一致。
- 1,645 檔全部 160 日 readiness 為 ready；其餘缺漏、上市前或無成交仍獨立列示，不能把全窗口取得宣稱每檔皆可判定。
- 商品日期 readiness：ready 310,063、no_trade 986、before_listing 3,053、missing_ohlcv 1,724、source_missing 494；總和 316,320。
- 對 1,977 檔逐檔直接重算 BOLL(20,2)、Type-7 前期 quantile、setup／量與金額基準、分類，全部與凍結結果一致；BigInt 股數／金額 exact，浮點運算核對相對誤差 1e-9 只用於稽核算術，不放寬策略門檻。

| 市場 | 母體 | 今日正式突破 | 準備突破 | 正在壓縮 | 未符合 | 無法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TWSE | 1,085 | 0 | 1 | 6 | 1,065 | 13 |
| TPEx | 892 | 1 | 0 | 8 | 835 | 48 |
| 合計 | 1,977 | 1 | 1 | 14 | 1,900 | 61 |

代表案例：1608 華榮壓縮（close=36.25、BBW=0.04758170372377329、b=0.6209938247479837）；2426 鼎元準備突破（close=104、upper=105.82474417322176、b=0.8712201789784627）；8111 立碁正式突破（close=85.8、upper=83.52967649803328、b=1.1288539654363898）。1259 因近期 OHLC 缺漏、公式暖機不足仍 unknown；1101 非符合，不偷轉成缺資料。

61 檔 unknown 的原因集合為 missing_ohlcv 49、source_missing 13、no_trade 33、before_listing 3；**集合重疊，不能把這四個數字加總成股票數**。全窗口本輪皆為已驗證 Shioaji 備援，官方歷史入口 review 仍 pending；混合來源相容性有隔離回歸，本次不宣稱自然窗口發生官方／備援混用。已核准量差 ≤1%、金額 ≤1 元只適用來源比較，沒有改策略凍結原值。

重現：以 Node 24 執行 `scripts/stock-screener-bollinger-live-audit.mjs <正式 v3 SQLite 路徑>`；工具使用 readonly、單一 consistent snapshot，缺發布會拒絕，不能另設 fixture 為正式 head。

## 實際 HTTP 503 根因與修正：原失敗保留，重新驗收成功

第一輪真實查詢回 HTTP 503：`D1_ERROR: Failed to parse body as JSON, got: RangeError: Invalid string length`。原查詢每檔重複 JOIN 同一份 460,934 字元 metadata，1,977 檔額外超過 9 億字元，加凍結列 260,093,254 字元突破字串邊界。修改為 metadata 只讀一次、keyset 每批 50 列、逐列身份及完整 rowsHash 驗證；保留有界總量、不可變報告／head，不改 DB 資料。75 檔規模回歸在舊程式先 red（metadata_repeated_per_stock），修正後 green，核對後段竄改拒絕、無 JOIN、唯讀零寫入。

第二輪真實查詢回 HTTP 503：`D1_ERROR: too many SQL variables at offset315: SQLITE_ERROR`。320 個來源日期 selection key 超過 D1 單句 100 個 bind 參數。修改為每批 80 keys＋1 status，保留全域 800 筆比較上限與穩定排序；衝突及容差皆分批讀取，不漏整體來源鍵。新增真實上限模擬回歸在舊程式先 red（too_many_sql_variables），修正後 green：8 句查詢各 ≤81 bind、空集合唯讀；既有最後資料日的衝突／容差回歸也通過。

兩輪失敗由本串真實 browser network response／console 工具輸出保留，本檔記錄原錯誤而不刪、覆寫或當成發布失敗。正式報告本身未重建。

## 真正唯讀 API／UI：成功；端到端整項仍 partial

09:24:41.422 `scripts/stock-screener-bollinger-local-readonly-check.mjs` 對真正 5173 `?popout=screener` 執行，隔離 Chromium storage、不 fulfil 假 response。真實 daily-profile 200／enabled／revision 1、results 200／ready／canUseResults／資料日10/2／16列／1977母體／320來源選擇。實際查看 screenshot 後確認警告與卡片可讀。

- 5 個 GET：daily-profile v8 2次、status v7 2次（StrictMode）、results v8 1次；0 非 GET、0 被攔截、不走 broker 路徑、0 page error、0 console error。
- UI：壓縮14、準備1、突破1、未符合1900、unknown61；明示 Shioaji 備援、160日與官方來源契約尚待驗證。修改查詢草稿／開始篩選沒有儲存背景 profile，正式 revision 1 未變。
- 畫面 `/tmp/bollinger-published-20261004.png`，SHA-256 `da1d1d29e1fe95a94adb9d596e72adae50896d789029deb57f6f916a4a60f543`；暫存圖不是來源原始資料／持久成功收據，後續若暫存清除仍以不可變發布及可重現 GET 為準。
- **限制：隔離分頁沒有圖表目標，並未執行加入兩清單；不能以「API ready／卡片可見」勾整項 7.4 或 8.8。** 使用者既有 Chrome 原草稿仍3項，目標IX0001／5m，未由本輪改動。唯讀預查 Shioaji「選股」13檔、MultiView「選股篩選」6檔，未增刪／覆寫。

## 預算、行情及安全 Gate

09:20 真正 charged 178 筆／估量65,362,668／response19,477,476 bytes；前次177筆／64,995,462／19,357,064，增量只有合法2/2的一批（估量367,206／實際120,412）。released1筆估量367,206，沒有 active reserved／dispatched／quarantined。可設定300MiB保護池與85,667,193基準保留不改；quotaEpochVerified=false仍明列，不把本機保守帳本稱為 broker官方週期。

既有 LaunchAgent interval300秒、09:20 runs454／exit0，未重啟。API8080 PID1273、Web5173 PID933、MultiView5174 PID938不變；simulation business-session／2330 Snapshot成立、production stopped、write master disabled、watchdog healthy／restart0。未登入、訂閱、下單或改交易草稿。只讀 stream/status 返回healthy／active_connections63，不把連線數冒充逐商品broker subscription證明。

## 回歸與判定

Node 四檔41／41（發布、來源比較、獨立稽核、臨時公告）；Vitest四檔45／45（v8、decoder、雙清單協調、圖表指定）；MultiView型別及前端build通過，原 bundle >500kB提示保留。OpenSpec strict validation、git diff --check及本 change／新稽核工具等42個新增檔 whitespace核對皆通過。

完成7.2／7.3／10.4，進度 **45／47**。7.4／8.8只差指定圖表、雙清單操作／復原及完整無額外broker副作用實證，保持未勾。TPEx-only臨時公告transport/schema尚未驗證，保留限制，不把TWSE公告當TPEx獨立證據。舊維護三組本輪deferred，非巡訪成功。不得歸檔、commit或push。

09:35 以產品automation工具更新既有heartbeat的接續提示至45／47與兩項尚缺的端到端驗收，保留20分鐘頻率／原thread／ACTIVE，不新增排程。直接唯讀scheduler資料庫核對當時 `next_run_at=1791077805187`，為台北10/4 **09:36:45.187**，不只憑RRULE宣稱已安排。尚未全部完成，不刪heartbeat。

維護 run receipt 的 tick-tape／local-data／cloudflare 三組均保存deferred與本輪範圍原因；finish回傳incomplete／exit2，代表三組未巡訪，不是布林發布失敗，也不把ACTIVE／turn完成冒充維護成功。最後runtime核對仍為simulation／2330available／production stopped／write master disabled／watchdog restart0；其他盤後總體 `verification_required`／partial保留，不把本 change的160日成功涵蓋它。
