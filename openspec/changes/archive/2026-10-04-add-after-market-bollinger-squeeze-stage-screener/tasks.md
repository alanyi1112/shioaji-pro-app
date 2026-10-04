## 11. 到期前有證據的流量政策複核（2026-10-04 使用者授權）

- [x] 11.1 實作有限效期操作者複核，驗原始實測、真實用量、保守帳本與基準保留；保存原政策／複核 proof，CAS 防止競爭，完成拒絕及舊債保留回歸。
- [x] 11.2 在既有 simulation runtime 執行真實複核及不 dispatch 的 admission 驗證，核對 profile／發布 head／失敗原件不變，記錄新效期與限制，完成 strict validation 及 whitespace 檢查。

2026-10-04 11:43 使用者授權的真實複核已更新效期至10/10 23:59:59，原保護池／基準配置／舊債保留；正式 admission 通過且本輪未送出 reservation 已釋放，歷史下載／login／subscription／orders為0。新增兩項共 **49／49**；62項相關回歸通過。詳見 `acceptance/budget-policy-review-2026-10-04.md`。下方47／47及10/5到期風險為較早紀錄，保留而不覆寫。

## 1. 來源契約與版本邊界

- [x] 1.1 核實各候選來源的實際成交金額欄位、單位、資料日期、普通股覆蓋與自動化／展示限制，分列 TWSE／TPEx 與 Shioaji review；正式啟用前，兩市場實際採用來源必須通過，未採用官方入口可保留 pending／invalid 原因而不假稱已驗證。備援契約與相容性接續 task 8.1。
- [x] 1.2 建立 v8 criteria、`bollinger-squeeze-stages-v1` formula、`bollinger-history-v1` capability 與 snapshot／mapping 版本契約，保留 v1–v7 底稿及數值語意。
- [x] 1.3 定義有限、有界、具單位的設定驗證及歷史需求計算，涵蓋短長窗、lag、quantile、b、量能倍數與總歷史上限；完成 v7 偏好遷移且新分支預設關閉。

## 2. 三階段純函式與可重算證據

- [x] 2.1 實作固定 BOLL(20,2)、未格式化 BBW／b 與排除判定當日的 Type-7 quantile；不修改既有圖表指標公式。
- [x] 2.2 實作共同濾網 G(t) 與壓縮 setup S(t)，明確區分含當日的候選量能／金額基準，缺日、零寬度與暖機不足回 unknown。
- [x] 2.3 實作準備突破 R(D) 與正式突破 B(D)，逐歷史日使用截止該日的資料重算 setup，突破量基準排除 D，且不要求突破日仍量縮或縮帶寬。
- [x] 2.4 實作 breakout → preparing → compressing 的互斥分類、三態優先邏輯、逐市場計數與母體守恆，保留較高階 unknown 的原因。
- [x] 2.5 建立逐條件 evidence、實際日期窗、setup hash、來源與公式版本，以及穩定排序／分頁 fingerprint；拒絕跨設定沿用 cursor。
- [x] 2.6 加入公式與邊界測試：quantile ties、當日排除、碰軌／等量不通過、連日上軌外、setup 過期、未來資料不影響歷史、unknown 及分類守恆。

## 3. 官方歷史準備與保留政策

- [x] 3.1 建立預設 160 日、依參數動態計算且最多 400 日的官方交易日 history plan；缺少所需日數回 history_pending，不縮窗冒充完整。
- [x] 3.2 補入以股與 TWD canonical 整數保存的實際量／金額及來源 provenance；不得以收盤價乘量、零值或 carry-forward K 棒填補未知資料。
- [x] 3.3 實作 market/date 批次、最新日優先、只補缺、租約與 checkpoint 的有界準備流程，逐商品分列上市前、停牌／無成交與來源缺失。
- [x] 3.4 修改歷史清理為各有效 capability、準備中計畫及保留快照的需求聯集，防止既有 130 日 prune 刪除新策略所需資料。
- [x] 3.5 加入準備器／清理回歸測試，涵蓋中止續跑、放大參數、雙市場日期不一致、HTML／來源錯誤不推論休市與回滾引用保護。

## 4. 獨立發布與查詢 API

- [x] 4.1 建立不等待籌碼 head 的 v8 純價量發布器，凍結指標底稿、逐商品 readiness 與三階段報告；其他籌碼條件僅 join 同日同母體合法資料。
- [x] 4.2 實作成功發布唯一鍵、staging 核對與 atomic head；相同鍵重觸發 no-op，設定 revision 改變時保留舊報告及收據。
- [x] 4.3 提供有界唯讀條件判定／排序／分頁 API，禁止 GET 抓來源、重建指標、寫 DB 或增加 broker subscription；缺 v8 時明示 pending。
- [x] 4.4 提供獨立的本機每日 profile 儲存接口，驗證 revision 與參數；與面板草稿及唯讀查詢隔離，不立即觸發下載。
- [x] 4.5 加入發布／API 測試，涵蓋 concurrent lease、母體守恆、日期 Gate、相同鍵 no-op、cursor 拒絕、舊查詢相容與零交易副作用。

## 5. 本機每日工作與晚開機補跑

- [x] 5.1 將新 capability 接入既有本機 watcher／RunAtLoad；官方交易日 14:00 後依雙市場資料 readiness 執行，不新增 Codex 排程或瀏覽器依賴。
- [x] 5.2 實作 capability-aware idle gate、成功後休眠及晚開機補最近已完成資料日；新能力未完成不得被 v5 完成狀態略過。
- [x] 5.3 實作來源嘗試上限、cooldown／Retry-After、15 分鐘 run 邊界、checkpoint 與 append-only failed／partial receipt；schema／日期 invalid 不自動解除。
- [x] 5.4 加入時間與故障回歸測試：來源晚公布、429、當日完成重觸發、休市、晚開機、程序中止續跑及 profile 更新；確認 TDCC／盤中監控頻率與行情連線不受影響。

## 6. 選股篩選面板整合

- [x] 6.1 在「技術型態」加入「布林壓縮與突破」accordion、三階段選擇、主要門檻及收合進階設定，沿用全部取消與外層 AND／OR。
- [x] 6.2 加入分類切換、策略母體與其他條件組合筆數、簡潔結果卡及 evidence；資料日／過期／unknown 警告不得被進階收合隱藏。
- [x] 6.3 加入明確「套用至每日自動篩選」動作、已儲存 revision 與準備進度，確保修改草稿或「開始篩選」不改背景設定。
- [x] 6.4 保留指定未鎖定圖表及明確加入兩套選股清單的既有行為，新增面板測試防止自動跳商品、清單／交易草稿變動與額外訂閱。
- [x] 6.5 驗證 600 CSS px 高、最小允許寬度、特大字級及鍵盤操作的收合／捲動／焦點與警告可讀性，保存實際 DOM／畫面證據。

## 7. 回歸與真實盤後驗收

- [x] 7.1 執行相關 focused tests、型別檢查與 build，回歸既有 v1–v7 選股、官方交易日、圖表／清單及歷史保留行為，分開記錄未解決限制。
- [x] 7.2 以實際雙市場已驗證官方／備援資料核對預設歷史覆蓋、量／金額來源及逐商品 readiness，獨立重算三階段代表案例與 unknown 原因，核對混合歷史來源相容性及不可變 manifest，不用 fixture 冒充真實來源。
- [x] 7.3 保存至少一個真實官方交易日的本機自動發布、雙市場日期 Gate、atomic head、分類守恆與相同鍵 no-op 證據；未發生真實自動 run 前保持本項未完成。
- [x] 7.4 核對實際 API／UI／console、查詢與每日設定隔離、指定圖表及兩套清單操作，保存 network counts 與無交易／broker login／subscription 副作用證據。

10/4 使用者已授權並實際完成 2408 指定圖表／雙清單操作與精準復原；profile／head、原清單未變。完整操作網路紀錄匯出尚未成功，不能用共享 connections 或程式推論代替實際 counts。7.4／8.8 保持未勾；不得再將本輪當等待授權或重複使用兩筆訂閱預算。詳見 `acceptance/authorized-chart-and-list-2026-10-04.md`。
- [x] 7.5 將真實成功、失敗、partial、unknown 及隔離晚開機／續跑測試分開寫入繁體中文 verification／acceptance，再執行此 change strict validation、git diff --check 與新增檔 whitespace 檢查。

## 8. Shioaji 每日行情備援（2026-10-03 新增，核心部分完成、尚未啟用）

本節為原官方版實作之後新增範圍；上述已勾項保留其原驗證，不代表下列備援已完成。

- [x] 8.1 正式驗證 daily_quotes 來源契約、雙市場／歷史樣本、未還原價格／交易範圍相容性、Volume 股數／Amount TWD／int64 與本機使用／展示限制；分列已確認、unknown 與限制，保存獨立 review，不把兩日期探測當全窗口 ready。
- [x] 8.2 實作既有 simulation API 的有界 daily_quotes transport／無損 parser、日期與九欄 arrays 驗證、普通股市場投影、date-level single-flight 與持久批次快取；同日期兩市場只抓一次，不新增 login／subscription 或逐檔分鐘 K。
- [x] 8.3 以 additive schema／repository 建立獨立 provider review／attempt／receipt、逐列 provenance、凍結來源 manifest 與 mapping 版本隔離；保留既有 official invalid／failed、舊 head／cursor，官方恢復只追加核對與衝突，不暗中覆寫。
- [x] 8.4 接入集中持續保留的 broker 流量預算、simulation business-session Gate、實測估量與可設定行情保留額度；實作安全 admission／租約回收，分記 HTTP bytes 與 usage，不寫死剩餘流量啟動門檻、不侵占盤中保留額度。
- [x] 8.5 接通官方優先／獨立 verified 備援的 provider 選擇、冷卻及有界續跑；同 run 合計兩次來源 HTTP／8 MiB、15 分鐘、各 provider 最多 18 次並尊重 broker 限制。日曆／母體缺口仍 pending，官方在 cooldown 不重抓，瀏覽器及 GET 不觸發下載。
- [x] 8.6 更新發布／API decoder／UI：manifest 納入不可變 mapping／cache／cursor，明示備援、日期與切換原因；保留守恆、來源 pending／衝突及草稿／每日設定隔離，既有 v1–v7、圖表、清單及交易草稿不變。
- [x] 8.7 跑備援與既有回歸：官方 reset／review pending／429／HTML、備援異日／重複代碼／破損 arrays／大 int64／量單位、兩市場共享與中止續跑、額度拒絕、日曆失敗、官方恢復衝突、head no-op／cursor 隔離及零交易副作用；另跑型別／build／strict／whitespace。
- [x] 8.8 以真實有界來源完成 160 日逐商品覆蓋、雙市場 provenance 與獨立重算；保存至少一個既有 watcher 自動 fallback／atomic head／同鍵 no-op、實際 API／UI 與共用 connection／usage 證據，再接續 7.2–7.4。分列原官方失敗、備援成功／partial／unknown，不以人工請求冒充自動發布。

8.4 已完成集中 reservation schema／安全 port／實測估量與有界 admission 的隔離實作測試；正式 quota epoch、其他工作承諾的即時更新與真實估量政策尚未接妥，因此整項仍保留未完成。8.5–8.7 的完成代表程式接線與隔離回歸，不代表已啟用正式備援；本輪證據與限制見 `acceptance/provider-budget-publication-2026-10-03.md`。

2026-10-03 18:03 已備份並精準安裝 additive 0037–0039，未啟用策略；18:05 真實 admission 缺政策時拒絕並追加 denied 收據，HTTP=0。8.4 保持未完成，詳見 `acceptance/fallback-schema-activation-2026-10-03.md`。

2026-10-03 18:18 官方 2/2 歷史對照發現 2330 成交量與先前 Shioaji 記錄差 1 股，根因未確認，不放寬契約。新增政策前置驗證、usage／dispatch 途中重驗及整數／conflict 防護，138 項 Node tests 通過；18:26 真實 admission 零 HTTP 追加 denied，舊收據不變。1.1／8.1／8.4 及後續真實驗收仍未完成，保持 34／41，詳見 `acceptance/source-contract-and-budget-preflight-2026-10-03.md`。

## 9. 成交量來源容差（使用者確認，2026-10-03）

- [x] 9.1 修訂來源數值相容性為官方量分母、≤1%（含等號）、零官方量只接受雙零；以 canonical BigInt 實作獨立比較政策／append-only 收據、保留舊衝突與凍結原值，唯讀 API／UI 分列容差 evidence。驗證一股、±1% 邊界、大 int64、零量、超限、其他欄位與缺資料仍嚴格、policy／decoder tampering、同鍵 no-op、舊收據／head 不變及零來源／交易副作用；不得把本項當正式來源 review 或全窗口完成。
- [x] 9.2 使用者確認後新增金額絕對差 ≤1 元的版本化來源政策；BigInt 邊界、舊衝突並存、API／UI／decoder 嚴格驗證、凍結值／manifest／head 不變，真實 30 筆一元差異重核對只追加證據。不得放寬價格、日期、readiness、其他金額差或策略門檻。

9.1 已完成，最新 **35／42**。原始 strict 判定紀錄保留，政策變更、回歸與仍未完成的七項見 `acceptance/source-volume-tolerance-2026-10-03.md`。

2026-10-03 19:06 接續 8.4：已補 v2 唯讀工作承諾 producer、quota identity 綁定，並重現／修正單純更新觀察時間造成 `broker_policy_changed` 的誤拒絕。缺少工作觀察仍拒絕，不虛填零或刷新來源時間；各工作正式 receipt writer／可信 quota epoch／兩次獨立實測及完整 roster 尚未完成，因此不勾 8.4，進度維持 **35／42**。真實本機 UI 為 pending，沒有正式 source review、160 日或自動發布，詳見 `acceptance/budget-producer-and-source-boundary-2026-10-03.md`。

2026-10-03 21:45 接續：新增 append-only 工作 observation writer／v2 head CAS，9 項 writer 測試及相關回歸通過。只有通用接口已完成，各工作實際接線、可信額度週期、獨立用量實測及全窗口仍未成立，8.4 不勾。使用者確認已簽署證券 API 同意書，修正先前額外要求個人分析特別書面許可的過度保守判斷；不以簽署確認代替資料契約或正式預算。真實唯讀 business-session 成立，正式新能力資料表仍全部 0，進度 **35／42**，詳見 `acceptance/commitment-writer-and-api-purpose-2026-10-03.md`。

接續使用者要求修正不必要限制：已從 daily_quotes review／來源 repository 移除 Shioaji 額外展示許可 Gate，本機使用範圍與技術契約仍保留；官網限制不互相冒充。新增無旗標亦能使用的回歸，首次在舊程式失敗後修正通過；writer 另補原 archive 破壞不得抹掉舊 head，最新 writer 共 10 項。正式資料／預算尚未建立，不以解除不必要 Gate 勾 1.1／8.1／8.4。

2026-10-03 22:10–22:46 真實兩日期全普通股校準、官方逐列核對、版本化金額一元容差及獨立來源契約 review 完成，勾 1.1／8.1／9.2，進度 **38／43**。Shioaji 兩市場技術來源 review verified；未採用的官方網站歷史入口各自 pending，不假稱來源使用契約已通過。兩日期 3,865 筆可核對、89 筆 unknown，原 30 筆金額一元 conflict 保留，追加新版通過。集中預算尚缺可信 quota identity／各工作真實承諾，8.4 不勾；160 日及真正 watcher／APIUI／fallback 驗收亦未完成。詳見 `acceptance/source-amount-tolerance-and-contract-review-2026-10-03.md`。

2026-10-03 23:18–23:38：使用者同意改為本機持久保守帳本後，完成 8.4，進度 **39／43**。不偽造 provider quota epoch；換日／generation／counter 下降仍保留舊債並累加新段增量。真實基準完整 forecast 保留 85,667,193 bytes，加可設定 300 MiB 保護池（未逐請求中央協調的用途不宣稱已接線）；真實 admission／watcher 完成兩日期。23:21 全域限流逐日污染 pending 的缺陷已修正，原 158 失敗及冷卻保留。Node 149／149、Chromium 9／9、型別／build 通過；160 日與真實發布／ready UI 四項仍未完成。詳見 `acceptance/local-conservative-ledger-and-watcher-2026-10-03.md`。

## 10. 官方臨時全日休市修正（2026-10-04 使用者要求）

- [x] 10.1 驗證官方年度新聞實際契約，實作民國／西元／連日全市場全日休市優先規則與完整性、日期、身份檢查；排除個股及部分時段語意，未知不推定休市，明列 TPEx-only 尚未自動接線限制。
- [x] 10.2 在既有 watcher 日曆入口加入有界公告快取／冷卻／single-flight 與 append-only 原文／重規劃證據，原年度表、18 次來源失敗及舊快照保留；固定交易日窗口向前重算，成功 idle gate 核對窗口。
- [x] 10.3 跑公告解析／冷卻／租約／zero-write／舊窗口 Gate 及既有發布回歸，型別、build、strict validation、diff／新增檔 whitespace，記錄實際官方 7/10 公告與各項限制。
- [x] 10.4 核對下一次真正 watcher 以官方公告修正共同日與新 160 日計畫、僅補新增依賴日，原 failed／partial、來源 attempts、額度及連線不變；不以手動解析或 fixture 冒充自動完成，完整窗口後再接續 7.2–7.4／8.8。

2026-10-04 09:11 原 watcher 於既定冷卻到期後，自動核實全日休市公告／重規劃，僅新增一次 2/2 批次並共享兩市場；09:11:47 自動發布，後續自然輪次同鍵休眠。09:19 唯讀獨立重算 320 份 manifest、316,320 個商品日期點及 1,977 檔全部分類一致；09:24 真實 API／隔離 UI 顯示 16 檔、零 console error。另修正全市場 metadata 重複 JOIN 及 D1 SQL 參數超限兩個真實 HTTP 503 問題，原失敗證據保留。完成 7.2／7.3／10.4，現為 **45／47**；7.4／8.8 尚缺指定圖表及雙清單操作與復原，不能以隔離頁或 fixture 代替。詳見 `acceptance/live-publication-and-reader-scale-2026-10-04.md`。

2026-10-04 11:10 接續使用者有界授權，已補齊主工作區指定 2408 日 K 與獨立選股頁雙清單的真正 HAR（352／6 筆），查詢／圖表／清單成功；實際零額外 subscription／login／下單請求，沒有拿隔離頁冒充圖表。原清單、三項草稿、IX0001 5m、profile revision1／hash 與 head 均復原或保持不變。修正大型 primitive 陣列 canonical serialization，50 Vitest＋30 Node、最終 build／型別通過，原 503／0 bytes 匯出／帳務 400 保留。完成 7.4／8.8，**47／47，可結案**；前述 45／47 等各時點紀錄為保留的歷史狀態，不是最新未完成項目。詳見 `acceptance/final-network-and-closeout-2026-10-04.md`。未歸檔／commit／push。

2026-10-04 11:18–11:30 使用者要求完整重驗：獨立持久資料／公式全數一致，修正長窗 pending envelope 與大型 hash 暫存成本，509程式測試＋39Chromium、build／型別通過；真正 API／畫面分類、分頁、長窗待準備及復原正常，47／47維持。另發現流量政策於明天10/5 14:00到期，與下一策略時點一致；保留 fail-closed，不擅自延長，明日自動下載尚需有證據的政策複核，不宣稱未來無人值守已通過。詳見 `acceptance/reacceptance-2026-10-04.md`。未歸檔／commit／push。
