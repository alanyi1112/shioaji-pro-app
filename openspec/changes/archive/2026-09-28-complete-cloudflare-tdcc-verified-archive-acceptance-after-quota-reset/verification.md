# Cloudflare TDCC verified archive 驗證紀錄

## 2026-09-22 08:27–08:36 fresh 額度續補

- GitHub `main`、最近成功 deploy 與本輪兩次 workflow 均為 exact SHA `2e18b938b1984615433ef8abec557ed56e198cb8`；dispatch 前沒有進行中的 runner。Cloudflare D1 全帳戶今日窗口 `September 22 - September 22` 為 reads 0、writes 0、storage 404.67 MB，保留正常服務 reads 622,690／writes 26,720 後可容納下一未 prepared 期的 50,000 結構成本保留。
- Run `35672370897` 成功取得並 prepare `2026-07-24`，邏輯估算 `estimatedRowsWritten=5,000`，archive 仍 `processed=12/18`、`remaining=6`、`failed=overdue=0`；這是 prepare-only，沒有冒充 processed 前進。批後 fresh 全帳戶用量已更新為 reads 83.46k、writes 6.99k、storage 404.67 MB，確認本批已入帳。
- 在上述用量已包含前一批且無在途 runner 後，Run `35672607714` 成功 finalize `2026-07-24`，邏輯估算 `6,976/10,000`；archive 前進為 `processed=13/18`、`remaining=5`、`failed=overdue=0`、`complete=false`，守恆 18=13+5。
- 第二批完成後儀表板仍只顯示 reads 83.46k／writes 6.99k，尚未包含 finalize。保留 31,000 writes 未入帳成本，當下停止續發；16:26 必須重新整理全帳戶用量，確認第二批已入帳、無 runner 且下一批加正常服務預留可容納時才續補。這是計費延遲 gate，不是每日一期或兩批硬上限。
- 依目前剩 5 期與實際每批入帳速度，若每日可安全完成 1–3 期，archive 約需 2–5 個額度日；每輪仍以 fresh 用量與來源狀態取代日期保證。task 2.2、2.6 及後續 readback／51 週／Access／Free-tier 驗收保持未完成。

## 2026-09-16 額度與安全基線

- Cloudflare D1 Free 顯示每日上限為讀取 5,000,000 rows、寫入 100,000 rows，總儲存空間上限 5 GB；執行前儀表板顯示當日讀／寫均為 0，資料庫大小 383.02 MB。
- 儀表板在首批 workflow 完成後仍顯示當日讀／寫為 0，但 D1 Insights 的 rolling 24-hour 指標已變動，因此確認儀表板存在更新延遲。此後同一 UTC 額度日不再追加 archive dispatch。
- 為涵蓋 index write amplification 與日常服務流量，Cloudflare archive workflow 的估算寫入預算由 45,000 降為 10,000 rows，使每個 UTC 額度日至多 period-atomic finalize 一期；每次執行前仍須先核對額度與前一 run 守恆。

## D1 基線

- 遠端 export 已成功匯入本機 SQLite 作唯讀驗證：41 tables、`page_count=93,371`、`page_size=4,096`、檔案約 365 MB、`PRAGMA integrity_check=ok`。
- migration ledger 共 31 筆，包含 `0030_tdcc_verified_archive_bootstrap.sql`。
- archive 執行前：distribution／provenance 各 1,675 rows、30 symbols、58 periods，日期 2025-08-01 至 2026-09-11。
- 固定 universe：2,330 symbols，其中 1,974 equities、356 ETFs，來源日期 2026-09-01。
- archive 執行前：`target=18`、`processed=0`、`failed=0`、`overdue=0`，11 prepared receipts、25,472 staging rows。
- continuous lane：1,739 completed items、30 completed symbols、`expectedWeeks=completedWeeks=1,739`、`failed=0`；最新完成日期 2026-09-11。
- Cloudflare D1 不接受直接遠端 `PRAGMA integrity_check`；完整性證據採官方 export 後在本機 SQLite 執行，不把 API 拒絕誤記為資料庫失敗。

## Exact release 與部署

- `d02d388794428209bf4fd7a243fa6782277317dc` 新增逐期寫入估算、period-atomic finalize、向前移動的官方 latest anchor 驗證與可續跑 runner；完整 `npm test` 698/698、lint、build、OpenSpec strict validation 與 `git diff --check` 通過。
- deploy workflow `35070626662` 成功，protected health 回報 exact SHA、`deploymentTarget=cloudflare`、D1 persistence；匿名 Access 邊界為 302。
- 額度保護調整 commit 為 `2e18b938b1984615433ef8abec557ed56e198cb8`；deploy workflow `35071447032` 成功，Cloudflare Worker version `328cad81-2ccb-4a5e-99b4-fafe4ae290e3`，additive migration 無待套用項目，匿名 Access 302、protected smoke 第一次通過。
- 固定 manifest、validator、immutable archive source 與 18 個 period hashes 由同一 release 的 tests 與 workflow preflight 驗證；workflow 不接受任意日期或動態 archive source。

## 首批 bounded archive 結果

- fresh workflow `35070821418` 成功，固定 universe 2,330。
- 已原子完成 6 期：2026-04-30、2026-05-08、2026-05-15、2026-05-22、2026-05-29、2026-06-05；估算累計 41,649 rows，下一期會超過當時 45,000 預算，因此安全停止。
- run 後守恆：`target=18`、`processed=6`、`remaining=12`、`failed=0`、`overdue=0`、`complete=false`。
- receipts：6 verified、5 prepared；verified staging symbols 合計 13,875，inserted 13,695、matched 180。
- run 後 distribution／provenance 各 15,370 rows、2,316 symbols、58 periods；remaining prepared staging 11,597 rows。
- 2.2 尚未完成；後續每天最多執行一次，直到 18/18，再進行 protected readback、official 51-week、API、DB-only warm path 與 owner UI 驗收。

## 本機 runtime 隔離基線

- 2026-09-16 核對 simulation mode、business watchdog healthy、API 8080、Web 5173、MultiView 5174 均維持運作；Shioaji production／真實下單未啟用。
- Cloudflare 修改在獨立 worktree 與獨立 repo 完成，未啟停或重啟上述本機服務。

## 2026-09-17 當日補跑（成功完成）

- 使用者明確要求能補即補、不延後。台北 11:04:08 已 dispatch 當日唯一 archive workflow `35176769526`，exact source SHA `2e18b938b1984615433ef8abec557ed56e198cb8`，與最近成功 deploy 及目前 main 相符；workflow 先核對 protected health exact SHA，再進入補檔。
- 執行前重新登入正常 Cloudflare 儀表板：9/17 當日總覽 reads=0、writes=0，總容量 391.06 MB；D1 Insights 明確選取台北 9/17 08:00–11:03（UTC 額度重置後），queries=reads=writes=0、40 tables、目前容量約 391 MB。過去 24 小時 398k writes 包含昨天，沒有誤當今天的已使用量。
- fresh GitHub 查核今日尚無 archive run；遠端 main workflow 的 `TDCC_ARCHIVE_D1_WRITE_BUDGET_ROWS=10000` 已重新核對。只允許本次一個 period，不再同日 dispatch；下午排程必須先讀取本 run 結果，不重複補跑。
- 原 6/18 成功紀錄及失敗歷史保留。run 尚未完成前不增加 processed、不勾 task 2.2。
- 執行前 API 8080、Web 5173、MultiView 5174 listeners 均維持原 PID；未修改或啟停本機服務。

### 完成結果

- workflow `35176769526` 於台北 11:04:08 建立、11:04:51 完成，conclusion=success；protected exact release 與 protected archive health 皆通過。
- 固定 universe 2,330。今天新增 2026-06-12 一期，processed 由 6 增至 7，remaining 由 12 降至 11；target=18、failed=overdue=0、complete=false，18=7+11 守恆。
- finalizedPeriods=1，估算 rowsWritten=6,955／10,000。下一期 2026-06-18 估算需 6,958，合計將超出本次預算，所以正常停止。估算並非 D1 實際計費 rows；沒有宣稱全部 18 期完成。
- 今天 UTC 額度日唯一補跑已完成，後续同日不得重複 dispatch。下午 13:27:21 盤中終驗排程維持；Cloudflare 讀到此紀錄後跳過已完成的今日補檔。
- task 2.2 保持未勾選，待 18/18 後再做完整 D1／API／owner UI 驗收。沒有更動 production 交易、共用行情或本機服務。
- 執行證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35176769526

## 2026-09-17 每日補檔排程更新

- 使用者要求只要D1額度允許即每天補檔直到完成。已更新既有 automation-2，不新建重複runner：每天台北08:26優先檢查額度與補檔，13:26作同日尚未dispatch的補跑檢查，含週末／假日。
- 先查當日UTC run與fresh D1用量；已成功不重跑。上午因統計延遲／連線等暫時阻礙而未dispatch，下午重新核對，能安全執行就當日補跑，不默認等明天。額度不足／未知仍保留阻礙，不盲寫。
- 現有已驗證的10,000估算rows／單日一期策略維持，並考量索引放大及正常服務餘額。18/18後停止archive寫入，接續官方51週缺口及完整驗收，不把archive完成當作全部資料完整。
- 與盤中驗收分成獨立工作分支，仍使用同一heartbeat；Cloudflare不再排到其他任務最後。今天已成功run35176769526，下午跳過重抓並保留收盤驗收。
- 工具更新成功後，已讀回儲存設定及scheduler資料庫：ACTIVE、綁定目前task，下次實際觸發為2026-09-17 13:27:21 Asia/Taipei。已刪除舊的「收盤驗收後改回09:02」指令，避免覆蓋新排程。

## 2026-09-17 實際餘額加速策略取代每日一期

依使用者最新要求，操作策略改為 [逐批額度計畫](adaptive-backfill-plan.md)。之前每日唯一dispatch／一期為保守操作紀錄，已被本計畫取代；取消固定每日期數，每批仍需可核對的真實額度。今日進度仍7/18，本輪沒有新增dispatch。

## 2026-09-17 13:32 同日續批實證

- Cloudflare 全帳戶 D1 用量頁（September 17–17）與資料庫 Row Metrics 在 UTC 00:00／台北08:00起的窗口一致：reads108.18k、writes20.75k、storage392.36MB，全帳戶僅1個D1資料庫。資料庫上方 Insights 摘要22k／9k不可代替計費頁；先前差異不再作為永久阻擋。
- 正常服務按現行預算腳本完整日情境保留 reads622,690、writes26,720（已含250,000／20,000維護緩衝），未扣掉已過時間，避免低估晚間其他工作。下一 prepared 批次沿用現行10000邏輯列批量；檢查資料及provenance主鍵／次級索引、staging刪除、checkpoint後，本次暫以40,000計費writes保留。20,750+26,720+40,000=87,470，小於100,000；reads仍有超過4m餘裕，資料量增長也遠低於storage餘額。此保留為單次保守估計，不是新每日上限。
- fresh dispatch run35186161284，13:32:47–13:33:31成功，exact SHA 2e18b938b1984615433ef8abec557ed56e198cb8。補完2026-06-18，processed8／target18、remaining10、failed0、overdue0、complete=false；下一prepared期2026-06-26估算6964邏輯列。既有verified期別沒有重寫，prepared路徑沒有重新下載TDCC來源。
- 13:34帳戶頁目前reads142.16k、writes20.76k，僅比批前增加約10writes，顯然尚未完整含新一期；不能據此認定第二批只花10次寫入。待計費反映再續下一批，保留該批40,000在途／未入帳估計直到核銷。
- task2.6同日串行部分已有實證，但prepared實際增量尚待完整入帳，未prepared成本也未完成量測，因此整項仍不勾選。task2.2維持未完成。
- automation-2保留每日08:26／10:26／13:26／16:26／20:26；13:30真實收盤驗收完成後移除臨時段落。scheduler實際下次為2026-09-17 16:27:01 Asia/Taipei。

## 2026-09-17 15:52 使用者要求立即補一批

- 15:51全帳戶D1當日用量已更新：reads223.21k、writes41.51k、storage393.76MB，只有1個資料庫。相較前次批前20.75k，新增約20.76k寫入、115.03k讀取，與相同prepared路徑一致；這是區間共用用量，不冒充workflow逐statement精確計費。前次40,000未入帳保留已核銷。沒有其他進行中run。
- 本次下一期2026-06-26已prepared，staging2320列、現行邏輯finalize估算6964。按現行schema：staging刪除最多3次計費寫入／列；其餘邏輯列以最多5次（包含continuous item兩索引舊／新項目）估算，上界(6964−2320)×5+2320×3=30,180，再保留checkpoint／lease及計量四捨五入餘裕，合計31,000。這是本批schema推導保留，不是每日硬上限，也不是換掉workflow的10000邏輯列批量。
- 加既有正常服務全日預留26,720：41,510+31,000+26,720=99,230<100,000；reads223,210+622,690預留及同類約115,030讀取遠低於5m，storage亦充足。若遇未知重試寫入，下一輪不得先釋放本批保留。
- 已fresh dispatch run35196690809，只執行使用者要求的一批，等待結果後續記錄。

- 本次結果：run35196690809成功，15:52:27補完2026-06-26；15:52:43 protected health確認processed9／target18、remaining9、failed0、overdue0、complete=false。邏輯估算6964，下一期2026-07-03仍prepared且估算6964。完成exact-release、seed、protected health各步，沒有另啟動下一批。
- 31,000為本批尚未入帳的保留，待fresh billing包含本批後才能核銷；41.51k是批前用量，不能當作批後用量。下一次排程以本節及最新GitHub run優先，不能沿用舊7/18、8/18或前批40,000保留。原task2.2仍未完成；task2.6未prepared成本仍待實測。

## 2026-09-17 16:27 排程核對

最新archive run35196690809仍success、exact release不變、9/18／remaining9／failed0／overdue0，無其他在途run。全帳戶D1計費已含第三批：reads345.1k、writes62.28k、storage395.07MB；相較批前增加約reads121.89k／writes20.77k。核銷31,000未入帳保留。扣正常服務26,720後可追加writes11,000，低於下一prepared期2026-07-03的31,000結構成本保留，也低於最近同類20.77k實測，因此未dispatch。此為餘額判斷，不是每日三次限制；20:26仍會核對當日正常服務實耗與餘額，無足夠證據不取消預留。


## 2026-09-17 20:27 heartbeat 額度判定

- fresh刷新全帳戶D1日窗口September17–17：reads345.1k、writes62.28k、storage395.07MB。扣正常服務預留reads622690／writes26720後，writes11000仍不足下一prepared7/3期的31000結構成本保留。未dispatch，原未入帳批次保留已核銷；並非每日三期硬上限，沒有憑時間經過取消正常服務預留。
- Insights重新開啟預設過去24h：摘要459k reads／147k writes，Row Metrics348k／62.29k；窗口涵蓋UTC前一日且摘要與圖非同一統計，不能拿它取代9/17全帳戶用量。本輪已因寫入餘額不足停止，不新增寫入嘗試。
- 首次GitHub查核main exact2e18b938b1984615433ef8abec557ed56e198cb8、最近10個runs無在途，最新archive35196690809success；最後已驗收archive9/18、remaining9、failed=overdue=0。後續擴大run列表與查deploy-cloudflare-production.yml回HTTP404，未能取得fresh最新deploy；不推論release改變或授權失效，下一輪須先重新查核。未重新執行已成功run或將舊health當fresh終驗。
- 2.2、2.6及後續驗收仍未完成。UTC重置（台北9/18 08:00）後，既有08:26時段再核對actual next trigger、fresh用量及GitHub／protected exact-release，符合gate才續補。完成日仍受未prepared成本及官方51週來源限制，沒有新增保證日期。


## 2026-09-18 08:28 heartbeat：額度重置，GitHub 存取受阻

- 今日全帳戶D1窗口September18–18：reads0／writes0、storage395.19MB。正常服務預留reads622690／writes26720、下一prepared期31000成本保留本可容納；但額度足夠不是dispatch的唯一條件。
- main與最新runs皆HTTP404；gh auth status的結構化結果state=error、HTTP401、invalid token，git ls-remote亦認證失敗。Chrome正常頁顯示未登入與404；已開啟並保留GitHub正常登入頁，未讀cookie／token、未改憑證或權限。需使用者重新登入，不能繞過exact release及無在途runner查核。沒有dispatch、migration、seed、Cloudflare D1寫入或另用workflow。
- 9/18期／remaining9仍是最後成功驗收基線，不冒充本輪fresh protected health。無法查核fresh deployment與workflow；不得據此判定repo刪除或資料補完。
- 更新既有automation-2尾段接續基線，移除過時16:37的TDCC timeout／日K未驗證敘述，保留五個每日檢查時段及通知偏好；actual next trigger=2026-09-18 10:26:12 Asia/Taipei。登入恢復後當日重新核對gate續補，不預設延到明天。全部驗收尚未完成，不歸檔、不勾2.2。


## 2026-09-18 10:26 例行重查

fresh D1當日讀0／寫0、storage395.19MB；單次gh auth仍401 invalid token，原Chrome登入頁仍未完成。阻擋與08:33相同，不反覆查不可存取的main／runs、不dispatch，不以最後9/18當fresh進度。登入恢復後當日續查gate；未新增使用者待辦或重複通知。


## 2026-09-18 10:50 使用者登入後同日補跑成功

- 使用者恢復Chrome GitHub登入。CLI仍401，但正常GitHub UI可讀repo/main、所有workflow與執行紀錄；main完整SHA仍2e18b938b1984615433ef8abec557ed56e198cb8、最新成功deploy #101同版、未見在途run。沒有讀取cookie/token、建立新憑證或擴大權限。
- fresh D1日窗口September18–18：批前reads0/writes0/storage395.19MB。正常服務reads622690/writes26720加下一prepared期結構保留31000可容納，既有workflow10000邏輯批量未改。透過已登入正常UI在main fresh dispatch #15（run35300832157），未重跑舊run。
- 工作41秒成功，protected exact-release、seed與protected archive health均通過：固定universe2330，新增2026-07-03，estimatedRowsWritten6964／budgetRows10000；target18、processed10、remaining8、failed0、overdue0、complete=false。18=10+8，task2.2仍未勾。
- 批後刷新全帳戶billing只見reads22.52k/writes0/storage395.19MB，尚未完整包含新一期寫入。保留31000未入帳writes，不能以0當未用量立刻續批。下一次當日13:26依fresh入帳狀態重新核銷及判定，不設定每日一期上限；未prepared成本未核實，不能保證剩8期完成日期。
- 已更新原automation-2：瀏覽器登入有效時可走同一workflow正常UI，不因gh憑證失效錯誤停止；加入本次run、10/18與未入帳保留。五時段與通知偏好維持。本機資料/成交明細唯讀核對、已完成不重跑；本機simulation與行情服務未啟停，無production交易、無repo commit/push/部署。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35300832157 及 outputs/local-maintenance/cloudflare-dispatch-20260918.json。


## 2026-09-18 13:29 同日第二批成功與未 prepared 成本 Gate

- 正常 Chrome GitHub UI 查核 main 完整 SHA 2e18b938b1984615433ef8abec557ed56e198cb8、最近 deploy #101 與 archive #15，同版且無在途 runner。D1 全帳戶當日 reads128840／writes20850／storage396.57MB；資料庫 Row Metrics 對齊台北08:00–13:28亦為128.84k／20.85k，核銷上午31000未入帳保留。
- 下一 prepared 期為2026-07-09（不是7/10），finalize估算6970。20850+26720正常服務預留+31000結構成本=78570<100000，reads/storage亦可容納。13:29正常UI fresh dispatch #16 run35311006869，工作34秒成功；fixed universe2330、新增7/9，target18、processed11、remaining7、failed0、overdue0、complete=false。protected exact release及archive health通過，task2.2不勾。
- 批後初次billing讀206.71k／寫41.63k；13:47刷新讀250.96k／寫41.65k／storage397.9MB，已包含本批，相對批前增加約20.80k寫入；此為區間共用用量，不冒充逐statement計費。未入帳保留已核銷，沒有其他在途archive。
- 現在11個先前prepared期均已verified。下一2026-07-17未prepared，不能套用31000的finalize成本。現行10000邏輯批量會先prepare（估算至少5000），再因5000+約6970超出而停止，不會同一run完成這一期；prepare成功本身不會增加processed。後續用同一workflow才能finalize。
- 逐行檢查fixed-release `prepareTdccArchivePeriod`及runner：staging每列主表＋複合主鍵＋次級索引最多3寫；同一次call最多4次HTTP嘗試，未完成prepared receipt時可能先刪partial staging再插入。以universe上限2330涵蓋初次插入及3次完整刪／重建，7×2330×3=48930，另計receipt／run／lease／讀回checkpoint後保留50000。這是目前程式重試路徑的保守成本保留，不是Cloudflare官方限制、每日上限或已量測費用；未prepared實際成本仍未知，task2.6不勾。成功prepared receipt會直接返回，不重抓來源。
- 目前100000−41650−26720=31630，低於上述未prepared成本；不開第三批、不清計数或以其他workflow繞過。16:26／20:26仍fresh重查；若沒有新證據降低成本或釋放真實預留，UTC重置後才能容納，不能承諾今天再完成一期。reads及storage有餘裕；剩7期至少各有prepare與finalize階段，完成日期仍依未prepared實測更新，不套用先前每日三期示例。
- 證據：outputs/local-maintenance/cloudflare-dispatch-20260918-1329.json；https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35311006869 。本輪沒有Cloudflare程式部署、commit／push，也未啟停本機行情服務。

- 本輪結束前scheduler實際next_run_at=2026-09-18T16:26:11+08:00；三組checkpoint皆巡訪，整體仍incomplete。simulation、2330 business Snapshot、watchdog healthy零重啟、8080／5173／5174 listeners及D1 integrity皆正常，production停止、write master disabled；未commit／push／archive。


## 2026-09-18 16:27 額度例行重查

GitHub正常UI確認main完整SHA仍2e18b938b1984615433ef8abec557ed56e198cb8、最新deploy101及archive35311006869成功，無在途run。全帳戶日窗口September18–18與資料庫台北08:00–16:27 Row Metrics一致：reads250960／writes41650／storage397.9MB。沒有未入帳保留；扣正常26720後31630仍不足下一未prepared7/17的50000結構成本。未dispatch、未重寫，最後成功進度11/18不冒充本輪新protected health。actual next_run_at為2026-09-18 20:27:05 Asia/Taipei；同日再核對，無新的可操作變化。


## 2026-09-18 20:30 晚間額度巡訪

正常瀏覽器登入後 fresh 查核 main exact SHA 2e18b938b1984615433ef8abec557ed56e198cb8；Actions 最新 archive #16（35311006869）成功、無在途 archive，最新 deploy #101 成功。全帳戶當日 billing reads250960、writes41650、storage397.9MB，與下午一致；上一批已入帳。Insights 過去24小時圖表 reads554.26k、writes46.52k，與UTC當日帳單期間不同，不相減推算可用額度。扣正常服務26720後可用writes31630，仍不足下一未prepared7/17期結構保留50000，本輪未dispatch。最新已驗證archive仍11/18、剩7（沿用#16既有health證據，本輪未另呼叫受保護health）。等待9/19台北08:00 UTC重置後於08:26 fresh gate，先prepare-only；未將今天成功次數當作上限。2.2／2.6及後續驗收仍未完成。

## 2026-09-21 08:56–09:07 台北：來源批次先 prepare，計量延遲阻止續批

- Fresh GitHub CLI 已恢復：main完整SHA仍2e18b938b1984615433ef8abec557ed56e198cb8，最新Cloudflare production deploy #35071447032同SHA成功；archive最後#35311006869為11/18，無其他在途archive。2026-09-20其他日報／日K workflow多筆失敗，單獨保留，不能冒充archive已失敗或健康。
- D1儀表板顯示唯一資料庫，08:58過去1小時Row Metrics讀0／寫0、storage398MB；這個視窗起點早於台北08:00重置，故在當時是當日用量保守上界。正常服務預留reads622690／writes26720；未prepared期使用既有50000結構保留，寫入總額≤76720，可先執行一個同版有界run。未把10000邏輯列當計費寫入。
- Fresh dispatch同一`cloudflare-tdcc-verified-archive-bootstrap.yml` run35549429949，exact-release、seed與protected health全成功。2026-07-17只完成prepare，邏輯估算5000／10000；該run停止於下一finalize邏輯估算6976。archive target18、processed11、remaining7、failed0、overdue0、complete=false；prepare不算processed前進，2.2／2.6維持未完成。
- 批後storage398→403MB；過去1小時Row Metrics仍讀0／寫0，顯然未反映本次prepare。切回過去24小時見讀243k／寫10k，批前為讀133k／寫3k，但不同滑動視窗的差額不是本批精確計費量。全帳戶每日計費用量頁當次只顯示Spectrum，無D1日數據可核對。依gate保留本次50000未核銷寫入，不連發finalize，也不以儀表板的0掩蓋延遲。當日後續時段重新核對包含本批的計費與Row Metrics，一致且下一prepared finalize 31000加正常服務預留可容納才續批。
- 下一缺期仍7/17，已有prepared資料，下輪不得重新抓來源。剩7期的完成日須待prepare實際成本與同日入帳速度驗證後重算，現在沒有可辯護的確定日期。原使用與失敗紀錄保留，沒有啟停本機runtime或啟用交易。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35549429949 與本輪`.codex/maintenance-runs/active.json` checkpoint。

## 2026-09-21 排程改為每日兩次

依使用者最新指示，既有 automation-2 保持 ACTIVE，將排程與提示同步改為每天台北 08:26、16:26（含假日），未建立重複排程。08:26接在 D1 額度重置後，16:26用於核對上午批次入帳及同日續補。先前五次檢查是歷史設定；兩次是排程喚醒數，實際 dispatch 仍須逐批通過來源、單一 runner、全帳戶 D1 用量與正常服務預留 gate。本次變更時本地時鐘為 09:21，依儲存的 RRULE 推算下一次為今日 16:26；排程工具未回傳 scheduler 的 `next_run_at`，故此處不冒充已取得該欄位。

## 2026-09-21 16:34–16:37 台北：當日第二次 gate 成功 finalize

- Fresh GitHub main／deploy exact SHA仍為`2e18b938b1984615433ef8abec557ed56e198cb8`，上午run `35549429949`成功且無在途archive。Cloudflare全帳戶當日D1用量已含上午prepare：reads78.97k、writes7.07k、storage403.22MB；Insights過去24小時reads243k／writes10k，視窗不同而不混算。
- 下一2026-07-17已prepared，7,070當日writes＋31,000 finalize結構保留＋26,720正常服務預留=64,790，低於100,000；reads及storage亦可容納。以同一有界workflow fresh dispatch run `35578760571`，未重抓已prepared來源。
- run成功；fixed universe2,330，finalizedPeriods=1、邏輯估算6,976／10,000，processed12／target18、remaining6、failed0、overdue0、complete=false，protected exact-release與archive health通過。批後計費仍未更新，保留31,000未入帳writes，沒有連發下一個未prepared期。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35578760571 、Cloudflare D1 2026-09-21全帳戶用量與本輪checkpoint。task2.2／2.6及18/18後驗收仍未完成。

## 2026-09-22 08:32–16:28 台北：完成 7/24，下午額度不足以 prepare 下一期

- 上午同一有界 workflow 先以 run `35672370897` prepare 2026-07-24：固定 universe 2,330、`finalizedPeriods=0`、邏輯估算 5,000／10,000，protected health 維持 `processed=12`、`remaining=6`、`failed=overdue=0`。成功 prepared receipt 後沒有重抓來源。
- 後續 run `35672607714` 完成 2026-07-24 finalize：`finalizedPeriods=1`、邏輯估算 6,976／10,000，protected health 為 `target=18`、`processed=13`、`remaining=5`、`failed=overdue=0`、`complete=false`；exact SHA 仍為 `2e18b938b1984615433ef8abec557ed56e198cb8`。
- 16:28 fresh 全帳戶 D1 日窗口已包含上午兩批：reads 219.53k、writes 27.8k、總 storage 411.08 MB；帳戶只有一個 D1 資料庫，GitHub 沒有在途 archive runner。
- 下一期尚未 prepared，沿用已說明的 50,000 結構保留並加正常服務 26,720：27,800 + 50,000 + 26,720 = 104,520，超過 Free 每日 100,000 writes。reads 與 storage 有餘裕，但 writes gate 不成立，因此下午未 dispatch，也未用 prepared 的 31,000 成本低估下一期。
- 這是實際餘額判定，不是每日兩批硬上限。下一次於台北 9/23 08:26 在 UTC 額度重置後 fresh 核對並先 prepare 下一期；task 2.2、2.6 及 18/18 後驗收維持未完成。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35672370897 、https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35672607714 與本輪 `.codex/maintenance-runs/active.json` checkpoint。

## 2026-09-23 08:39–08:46 台北：補做排程完成 7/31 prepare，等待完整入帳

- Fresh GitHub main及最近成功正式deploy仍為exact SHA `2e18b938b1984615433ef8abec557ed56e198cb8`，補跑前沒有在途archive runner。Cloudflare全帳戶D1日窗口已於UTC重置，批前reads0／writes0／storage411.17MB；50,000未prepared結構保留加正常服務26,720可容納，故只啟動同一有界workflow。
- Fresh dispatch run `35803128528` 成功；fixed universe2,330，2026-07-31取得prepared receipt，`finalizedPeriods=0`、邏輯估算5,000／10,000。protected health守恆為target18、processed13、remaining5、failed0、overdue0、complete=false；prepare不算processed前進，已verified期別未重寫。
- 08:43–08:46全帳戶日頁只顯示reads1／writes3.24k／storage411.17MB，尚未足以證明完整包含本批。資料庫過去24小時Insights顯示reads465k／writes9k，圖表為reads456.3k／writes11.05k，並可見`tdcc_archive_staging` INSERT 2,017次、6.05k writes；這些是滑動24小時與當日計費兩種不同視窗，不能相減或以其中任一局部值核銷50,000保留。
- 因上一批尚未完整入帳，本輪未dispatch已prepared的finalize，也未以3.24k或6.05k低估本批成本。16:26依fresh全帳戶當日用量再次核銷；完整包含prepare後，若當日writes加31,000 finalize保留及26,720正常服務預留仍小於100,000，才串行finalize。task2.2／2.6維持未完成。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35803128528 與本輪 `.codex/maintenance-runs/active.json` checkpoint。

09:00全帳戶當日計費完成更新為reads88.08k／writes7k，資料庫列顯示2.4k queries及416.24MB；這與前次prepare約7.07k writes的實測相符，足以核銷50,000保留。7,000＋31,000 prepared-finalize結構保留＋26,720正常服務預留=64,720，小於100,000，且無在途runner，因此沒有等到16:26，立即串行dispatch run `35804537311`。

run `35804537311` 成功finalize 2026-07-31：fixed universe2,330、`finalizedPeriods=1`、邏輯估算6,985／10,000，protected health為target18、processed14、remaining4、failed0、overdue0、complete=false，exact SHA不變。批後31,000保留尚待fresh入帳核銷；下一期未prepared，即使採最近同類實測，7,000＋約20,800 finalize＋50,000 prepare＋26,720正常服務已超過100,000，故不連發下一期，16:26再讀實際全帳戶用量。證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35804537311 。

## 2026-09-23 21:45 台北：補做下午額度 Gate

- Fresh Cloudflare D1 帳戶日窗口為 September 23–23：reads 231.07k、writes 27.84k、總 storage 417.61 MB；資料庫 Insights 的過去24小時視窗為 reads 599.29k、writes 31.89k、storage 約418 MB。兩者視窗不同，本輪以帳戶日窗口判斷 Free 額度，沒有相減混算。
- GitHub 最新兩個 archive run `35803128528`、`35804537311` 皆為 success，main exact SHA 仍為 `2e18b938b1984615433ef8abec557ed56e198cb8`，且沒有在途 archive runner。上午 prepare 與 finalize 已完整入帳，先前31,000未入帳保留可以核銷。
- 下一期尚未 prepared，依現行重試路徑保留50,000 writes，另保留正常服務26,720 writes：27,840＋50,000＋26,720＝104,560，超過 Free 每日100,000 writes。reads與storage仍有餘裕，但writes gate不成立，因此本輪未dispatch、未重寫已完成期別，也未以prepared期31,000成本低估下一期。
- Cloudflare正式archive維持processed14／target18、remaining4、failed0、overdue0、complete=false；task2.2、2.6及18/18後驗收仍未完成。下一個允許重試條件是UTC日額度重置後的台北2026-09-24 08:26 fresh gate；這是實際餘額判定，不是每日兩次dispatch上限。

## 2026-09-24 16:06–16:12 台北：補做排程已完成 8/07 prepare，等待計量完整入帳

- Fresh GitHub main 與最新 production deploy 的 exact SHA 均為 `2e18b938b1984615433ef8abec557ed56e198cb8`；前一個 archive finalize run `35804537311` 成功，開始前沒有在途 archive runner。Cloudflare 帳戶日窗口批前為 reads 0、writes 0、總 storage 417.72 MB，可容納下一個未 prepared 期的 50,000 writes 結構保留與正常服務 26,720 writes 預留。
- 以既有 `cloudflare-tdcc-verified-archive-bootstrap.yml`、`main` 與每批 10,000 邏輯列預算執行 fresh run `35973524964`。run 於 16:09 成功：固定 universe 2,330，2026-08-07 完成 prepare，`finalizedPeriods=0`、`estimatedRowsWritten=5000`，下一 finalize 邏輯估算 6,985；protected health 維持 target 18、processed 14、remaining 4、failed 0、overdue 0、complete false。prepare 不算 processed 前進，task 2.2 不勾選。
- run 完成後反覆刷新帳戶日窗口仍只顯示 reads 734、writes 78、總 storage 417.72 MB，顯然尚未完整包含本批 prepare。依實際餘額 gate 保留 50,000 未核銷 writes，不以低值立刻 finalize；待 fresh 用量完整入帳後，只有 `當日 writes + 31,000 finalize 保留 + 26,720 正常服務預留 < 100,000` 且無在途 runner 時才續跑。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35973524964 。未清除既有用量／失敗紀錄，未更換 workflow、未重寫已完成 period，也未啟用 production 交易。

## 2026-09-24 16:28–16:30 台北：計量完成入帳後成功 finalize 8/07

- 16:28 fresh 全帳戶日窗口已完整反映 prepare：reads 92.8k、writes 7.08k、總 storage 417.72 MB；GitHub 無在途 archive runner。`7,080 + 31,000 finalize 結構保留 + 26,720 正常服務預留 = 64,800`，低於 Free 每日 100,000 writes，reads與storage亦有充足餘額，因此符合 prepared 期的續跑 gate。
- 以同一有界 workflow fresh dispatch run `35975469760`，exact SHA仍為 `2e18b938b1984615433ef8abec557ed56e198cb8`，未重新取得已prepared來源。run 35秒成功：固定 universe 2,330、2026-08-07 `finalizedPeriods=1`、邏輯估算6,985／10,000；protected health為target18、processed15、remaining3、failed0、overdue0、complete=false，且15+3=18守恆。
- 批後日窗口暫仍為reads92.8k／writes7.08k，尚未完整包含finalize，故保留31,000未核銷writes並停止連發。下一期尚未prepared，待finalize完整入帳後仍須以當日實值加50,000未prepared結構保留與26,720正常服務預留重新判斷；不得直接套用prepared成本。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/35975469760 。archive已實際前進至15/18、剩3；task2.2／2.6與18/18後驗收仍未完成。

## 2026-09-25 18:05–18:08 台北：新額度日完成 8/14 prepare

- 本輪實際開始時本機台北時間為18:05。Fresh GitHub archive清單顯示9/24 finalize run `35975469760`成功，沒有在途archive；正式main exact SHA仍為 `2e18b938b1984615433ef8abec557ed56e198cb8`。Cloudflare全帳戶9/25日窗口為reads0／writes0／storage424.24MB，可容納未prepared期50,000 writes結構保留與正常服務26,720 writes預留。
- 以同一有界workflow fresh dispatch run `36122216459`，成功prepare 2026-08-14：固定universe2,330、`finalizedPeriods=0`、邏輯估算5,000／10,000，下一finalize邏輯估算6,985。protected health維持target18、processed15、remaining3、failed0、overdue0、complete=false；prepare不算processed前進，已verified期別未重寫。
- 批後全帳戶日窗口仍為reads0／writes0，尚未完整包含本批，故保留50,000未核銷writes，不以0值直接finalize。只有fresh用量完整入帳、無在途runner，且`當日writes + 31,000 finalize保留 + 26,720正常服務預留 < 100,000`時才續跑。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/36122216459 。task2.2／2.6及18/18後驗收維持未完成。

18:12 fresh日窗口完成更新為reads97.42k／writes7.08k／storage424.24MB，足以核銷prepare保留；`7,080 + 31,000 + 26,720 = 64,800`，prepared finalize gate成立且無在途runner。立即以同一workflow dispatch run `36122706367`，未重抓8/14來源。

run `36122706367` 35秒成功finalize 2026-08-14：固定universe2,330、`finalizedPeriods=1`、邏輯估算6,985／10,000，protected health為target18、processed16、remaining2、failed0、overdue0、complete=false。批後日窗口暫仍為reads97.42k／writes7.08k，保留31,000未入帳writes。下一期尚未prepared，必須待finalize完整入帳後以50,000未prepared成本重新判定；不因同日已成功兩個run停止，也不以prepared成本低估下一期。證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/36122706367 。

18:15 fresh日窗口已完整包含prepare與finalize：reads254.17k、writes27.92k、storage424.24MB，31,000未入帳保留可以核銷。下一期尚未prepared，`27,920 + 50,000未prepared結構保留 + 26,720正常服務預留 = 104,640`，超過Free每日100,000 writes；因此停止當日續批，沒有用prepared期成本低估下一期。下一個可重試條件為UTC日額度重置後的fresh gate；這是實際額度結果，不是每日兩個run硬上限。

## 2026-09-26 09:30–09:45 台北：補做排程完成 8/21 prepare，等待帳戶日用量完整入帳

- Fresh GitHub `main` 與最近成功 production deploy 仍為 exact SHA `2e18b938b1984615433ef8abec557ed56e198cb8`；前一個 archive finalize run `36122706367` 成功，dispatch 前沒有在途 archive runner。Cloudflare 全帳戶 9/26 日窗口已重置為 reads 0／writes 0／總 storage 430.69 MB，未 prepared 期 50,000 writes 結構保留加正常服務 26,720 writes 預留可容納。
- 以同一有界 workflow fresh dispatch run `36208659396`。run 成功 prepare 2026-08-21：固定 universe 2,330、`finalizedPeriods=0`、邏輯估算 5,000／10,000，下一 finalize 邏輯估算 6,985；protected health 維持 target 18、processed 16、remaining 2、failed 0、overdue 0、complete false。prepare 不算 processed 前進，已 verified 期別未重寫。
- run 後至 09:45 反覆 fresh 刷新全帳戶日頁仍只顯示 reads 2.84k／writes 607／總 storage 430.69 MB，尚未完整包含 prepare。資料庫過去 24 小時 Row Metrics 已看見 `tdcc_archive_staging` INSERT 5,002 次、15.01k writes，但這是滑動視窗，不能取代 UTC 當日全帳戶用量或與其相減。
- 依 gate 保留 50,000 未核銷 writes，本輪不以局部 607 值 dispatch finalize。台北 16:26 fresh 核對全帳戶日用量；只有完整入帳、無在途 runner，且 `當日 writes + 31,000 finalize 保留 + 26,720 正常服務預留 < 100,000` 時才續跑 8/21 finalize。剩餘兩期至少還需要本期 finalize，以及最後一期 prepare／finalize；完成日依計費入帳速度逐批更新，不以固定每日批數承諾。task 2.2／2.6 維持未完成。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/36208659396 與本輪 `.codex/maintenance-runs/active.json` checkpoint。本輪未啟用 production 交易，亦未啟停本機 simulation API、watchdog、5173、5174 或行情連線。

## 2026-09-26 16:27–16:45 台北：完整入帳後成功 finalize 8/21

- Fresh 全帳戶日窗口已完整反映上午 prepare：reads 101.89k、writes 7k、總 storage 435.75 MB；GitHub `main` 與最近成功 production deploy 均為 exact SHA `2e18b938b1984615433ef8abec557ed56e198cb8`，上午 run `36208659396` 成功且沒有在途 archive runner。
- 下一期 2026-08-21 已 prepared；`7,000 + 31,000 finalize 結構保留 + 26,720 正常服務預留 = 64,720`，低於 Free 每日 100,000 writes，reads與storage亦有餘裕，因此以同一有界 workflow fresh dispatch run `36229882477`，未重抓已 prepared 來源。
- run 36 秒成功 finalize 2026-08-21：固定 universe 2,330、`finalizedPeriods=1`、邏輯估算 6,985／10,000；protected health 為 target 18、processed 17、remaining 1、failed 0、overdue 0、complete false，且 17+1=18 守恆。
- 批後帳戶日窗口截至 16:45 仍為 reads 101.89k／writes 7k，尚未完整包含 finalize；保留 31,000 未核銷 writes。最後一期尚未 prepared，必須等 finalize 完整入帳後，改用未 prepared 期 50,000 結構保留再加正常服務 26,720 重新判斷；不以 7k 局部值連發，也不以 prepared 成本低估最後一期。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/36229882477 。archive 已實際前進至 17/18、剩 1；task 2.2／2.6 與 18/18 後驗收仍未完成。

## 2026-09-27 09:11–09:16 台北：最後一期完成，verified archive 達 18/18

- 本輪開始時先建立 maintenance receipt。Fresh GitHub 查核 `main` 與最新成功 production deploy 仍為 exact SHA `2e18b938b1984615433ef8abec557ed56e198cb8`，最新 archive run `36229882477` 已成功且沒有在途 runner。Cloudflare 全帳戶當日日頁在批前顯示 reads 0／writes 0／storage 437.21 MB，帳戶只有一個 D1 資料庫。
- 以未 prepared 結構保留 50,000 writes，加正常服務預留 26,720 writes，`0 + 50,000 + 26,720 = 76,720 < 100,000`。Fresh dispatch run `36284804232` 成功 prepare 最後一期 2026-08-28：固定 universe 2,330、`finalizedPeriods=0`、邏輯估算 5,000／10,000；protected health 維持 `processed=17`、`remaining=1`、`failed=overdue=0`，receipt 狀態為 `prepared`。
- 全帳戶日頁仍有計量延遲；唯一資料庫的 fresh Row Metrics 視窗自台北 9/26 18:45 起至 9/27 09:00，已顯示 reads 683.16k／writes 37.38k。此視窗起點早於本日 UTC 額度重置，且帳戶只有此一資料庫，因此 37.38k 是本日 writes 的保守上界並已涵蓋本批活動；`37,380 + 31,000 + 26,720 = 95,100 < 100,000`，reads 加正常服務預留亦遠低於 5m。沒有用延遲中的日頁 0 作為續批依據，也沒有平行 runner。
- Fresh dispatch run `36284972005` 成功 finalize 2026-08-28：`finalizedPeriods=1`、邏輯估算 6,991／10,000，fixed universe 2,330；protected health 回傳 `target=18`、`processed=18`、`remaining=0`、`failed=0`、`overdue=0`、`complete=true`，18 期 receipts 全部為 `verified`。`target=processed+remaining` 守恆成立，已完成期別沒有重寫。
- Finalize 後 fresh Row Metrics 視窗更新至台北 09:15，reads 854.32k／writes 61.36k；即使視為本日保守上界，加正常服務預留後為 `61,360 + 26,720 = 88,080 < 100,000`。這項數值只用於確認本輪沒有壓縮正式服務寫入餘裕，不再啟動 archive run。
- verified archive 補檔線至此停止再 dispatch；task 2.2 完成。接續工作依序為 task 2.3 D1 readback／integrity、2.4 bounded official 51-week、3.x protected API／DB-only warm path、4.x Access owner UI，以及 5.x 與 Free-tier task 8.7 的 fresh 驗收，不能以 18/18 代替這些尚未完成項目。
- 證據：https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/36284804232 、https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/36284972005 。全程維持本機 simulation、watchdog、5173、5174 與行情服務；未啟用 production、真實下單或 CA。

## 2026-09-27 22:14–22:20 台北：D1 readback 守恆成立，PRAGMA 仍受平台限制

- Fresh GitHub 唯讀核對：`main` 與最近成功 production deploy 的 exact SHA 仍為 `2e18b938b1984615433ef8abec557ed56e198cb8`；archive runs `36284804232`／`36284972005` 均成功，沒有在途 archive runner。本輪未再 dispatch archive workflow，也沒有重寫任何 verified period。
- Cloudflare D1 主控台唯讀聚合：固定 universe 為 `2,330` rows／`2,330` distinct symbols；period receipts 為 `18/18 verified`，日期範圍 `2026-04-30`～`2026-08-28`。`tdcc_archive_staging=0`，verified archive provenance `41,217` rows，`source-mismatch=0`，主資料缺 provenance 與孤兒 provenance 都為 `0`。
- 18 期收據的 `inserted_rows + matched_rows = staged_symbol_count` 不一致數為 `0`，非正值 row／symbol count 為 `0`，非 64 字元 material hash 為 `0`；合計 distribution rows `1,224,459`、staged symbols `41,757`。這些欄位語意不同，不以 `row_count=symbol_count` 作錯誤守恆條件。
- Cloudflare D1 網頁主控台執行 `PRAGMA integrity_check;` 回覆 `not authorized: SQLITE_AUTH`；一般 `SELECT` readback 正常。此為平台主控台權限限制，未繞過、未更換 credential，也不把上述 table-level 守恆冒充 `PRAGMA integrity_check=ok`。因此 task 2.3 仍未完成，後續需由受保護、可執行 PRAGMA 的既有驗收路徑補足，或以平台正式支援的等價完整性證據修訂規格後再驗收。
- Fresh D1 全帳戶當日用量為 reads `277.47k`、writes `27.95k`、storage `443.64 MB`；資料庫 Insights 台北 08:00～22:15 為 reads `588.71k`、writes `33.45k`。兩個視窗分開記錄，不相減推算額度；當日未執行新的 D1 寫入工作。

## 2026-09-28 08:54–09:05 台北：bounded official 51 週完成驗收

- Fresh GitHub 唯讀核對：`main` 與最近成功 production deploy 的 exact SHA 仍為 `2e18b938b1984615433ef8abec557ed56e198cb8`；最新 Cloudflare TDCC continuous run `36341014295` 同一 SHA 成功。該 run 判定既有 orchestrator 已完成，history-only 為合法 no-op，沒有重抓已完成 dates，也沒有再 dispatch verified archive workflow。
- Protected health 顯示 latest data date `2026-09-24`、target／completed `30/30`、queued／running／blocked `0/0/0`。D1 主控台 fresh 聚合進一步核對 active targets `30`、expected／completed weeks `1,799/1,799`、failed weeks `0`、remaining weeks `0`、completed targets `30`；計畫日期範圍為 `2025-08-01`～`2026-09-24`，所有 active target 的 `official_plan_through` 都為 `2026-09-24`。
- Archive 與 official lane 分列成立：verified archive 維持 `18/18`、remaining／failed／overdue `0/0/0`；official lane 為 expected／completed／remaining／failed `1,799/1,799/0/0`。provenance 唯讀聚合為 official-confirmed symbol-weeks `120`、verified-archive symbol-weeks `41,217`、source conflicts `0`；兩種來源身份沒有混寫成同一完成數字。
- Cloudflare 全帳戶 9/28 日窗口在本輪查核時為 reads `0`、writes `0`、storage `443.66 MB`；資料庫過去 24 小時 Row Metrics 為 reads `586.27k`、writes `22.68k`、storage 約 `444 MB`。視窗不同而分開記錄；本輪沒有 D1 寫入，也未以日窗口歸零觸發任何 archive 或 official 補跑。
- 同期 Cloudflare 帳戶過去 24 小時顯示 requests `65`、Worker calls `61`、errors `0`、CPU P90 `98 ms`。這個視窗仍包含先前維護活動，故不能完成私人小群組 task 8.7；task 2.3 也仍因 Cloudflare D1 主控台拒絕 `PRAGMA integrity_check` 而保持未完成。
- 另有 fresh daily candle continuity run `36343079195` 在處理 `2/30` 後以 `provider_unavailable` fail closed；已完成的 TDCC official 計畫與 verified rows 未被改寫。此來源失敗另行保留，不把它冒充 TDCC official 51 週未完成。以上 fresh 證據符合 task 2.4，故完成勾選。

## 2026-09-28 13:20–14:05 台北：可立即完成的 D1 與 owner UI 驗收

- 以既有正式 D1 設定執行唯讀 remote export，輸出只存放於 `/tmp`，未加入 repo、未記錄帳號、database ID、signed URL、token、cookie 或 credential。將 export 載入本機 SQLite 後，`PRAGMA integrity_check` 回傳 `ok`，補足 Cloudflare 網頁 SQL console 拒絕 PRAGMA 的平台限制；此結果與正式來源同一份 export 對應，沒有改寫遠端資料。
- export readback 顯示 verified archive run `tdcc-archive-2026-v1:full-market` 為 `complete`，target／processed／remaining／failed／overdue=`18/18/0/0/0`；18 期 receipts 全部 `verified`，日期範圍 `2026-04-30`～`2026-08-28`。固定 universe 為 2,330 個 distinct symbols；receipts 合計 distribution rows `1,224,459`、symbol count `72,027`、staged `41,757`、inserted `41,217`、matched `540`。staging rows、重複 period、非 verified receipt、receipt balance mismatch 與 universe conflict 均為 `0`。staging-first、insert-only 與 row／symbol 守恆成立，因此 task 2.3 完成。
- 歷次 fresh 全帳戶日窗口已同時量到未 prepared prepare 與 prepared finalize：prepare 約 `6.99k`～`7.08k` writes、約 `78.97k`～`101.89k` reads；finalize 在同日用量完整入帳後約增加 `20.75k`～`20.92k` writes、約 `115k`～`157k` reads。先前 `50,000`／`31,000` 是涵蓋重試、索引與正常服務的結構保留，不是實際計費量或每日批次上限。每批皆等前批計量入帳、確認單一 runner 與餘額後才串行續批，task 2.6 完成。
- 在已登入 Cloudflare Access 的 owner session 驗證正式站；登入名單顯示 owner 為 active，未讀取 cookie／token、未變更權限，也未使用 machine bypass 或 `SAMPLE`。重載後新增商品仍存在，console 沒有相關 warning／error。
- 代表商品實測：`2330.TW` 顯示 2026-09-24 大戶 `84.77%`、散戶 `5.86%`；ETF `00919.TW` 顯示 2026-09-24 大戶 `8.02%`、散戶 `18.06%`；`4768.TWO` 顯示 2026-08-28 大戶 `19.49%`、散戶 `29.19%`；`8103.TW` 顯示 2026-08-28 大戶 `32.16%`、散戶 `23.11%`。每檔大戶與散戶區各有 4 個可見且尺寸非零的 canvas；切頁、捲動到 viewport 與重載後仍能繪製。
- 完整商品依實際資料顯示最新日期與歷史缺口提示；`4768.TWO`、`8103.TW` 只顯示 verified archive 18 期與官方補缺尚餘 33 期，沒有虛構完整 51 週、跨缺口計算週變化或隱藏 partial 狀態。對應 task 3.4、4.1、4.2、4.4 完成。
- 本輪驗收前後 `pnpm local-runtime status`、listeners 與 HTTP probe 顯示 simulation API、business-session watchdog、8080、5173、5174、2330 Snapshot、D1 integrity／coverage 都維持可用；沒有重新啟動服務，也沒有啟用 production、真實下單或 CA。task 5.3 完成。
- repo 仍包含其他進行中的無關變更；本 change 後續若 archive／commit／push，必須只納入自己的 OpenSpec 檔案，排除 `/tmp` export、SQLite、logs、screenshots、outputs、秘密與其他 dirty work。task 5.4 的 scope 盤點完成，各外部動作仍需獨立授權。
- GitHub 正常登入頁 fresh 核對 deployment run `35071447032`：exact SHA `2e18b938b1984615433ef8abec557ed56e198cb8`，`Apply additive D1 migrations`、`Deploy exact commit`、`Anonymous Access boundary smoke` 與 `Protected smoke` 全部成功。final archive run `36284972005` 的 protected health 回傳 complete=`true`、processed／remaining／failed／overdue=`18/0/0/0`；最新正常 TDCC schedule run `36341014295` 的 protected health 回傳 target=`cloudflare`、D1=`true`、status=`healthy`、data date `2026-09-24`、target／completed／queued／running／blocked=`30/30/0/0/0`。配合 D1 readback 的 official remaining／failed=`0/0` 與 bounded missing dates 為空，task 3.1 完成。
- task 3.2～3.3 尚缺可直接核對的 protected shareholder-distribution API response、17 級距 provenance、`cache.mode=d1_hit` 與 provider calls=`0`；task 4.3 尚缺可靠的瀏覽器 network request 清單，不能由 UI 成功、空白 Performance API 或 source inspection 代替。task 5.1／5.2 與 Free-tier task 8.7 仍須等這些證據及乾淨觀測窗後完成。
- 聚焦 TDCC、籌碼 API、partial 狀態與副圖測試共 `141/141` 通過；`npm run lint`、兩個 change 的 OpenSpec strict validation 與兩個 repo 的 `git diff --check` 通過，production build 亦成功。完整 `npm test` 為 `616/618`，兩個既有日 K 狀態測試失敗：`latestSessionCoverage` 預期 `1` 實得 `0`，以及官方核對狀態預期 `unknown` 實得 `complete`。失敗不屬本輪 TDCC/UI 文件修改，但完整 gate 尚未全綠，因此 task 5.2 保持未完成。
- 驗收過程曾以手動 symbol 建立錯誤 suffix `8103.TWO`，內建搜尋才確認 canonical 為 `8103.TW`；後續 continuous run 因同時處理兩者而以 `invalid_response` fail closed。既有 verified archive 與 30 個原 active target 的 official 51 週結果未受影響。
- 2026-09-28 13:59 台北，依 owner 明確確認只刪除正式站個人清單的 `8103.TWO`，保留 `8103.TW`。刪除後與整頁重載後的「我的清單」皆為 28 項，只找到 `8103.TW`，錯誤 suffix 未再出現。正式 D1 唯讀核對顯示 `8103.TWO` 已為 `active=0`；既有 completed `12` 與 queued `39` 筆保留作稽核，沒有清除計數器或資料列，且不會被 continuous runner claim。canonical `8103.TW` 的個人清單項目與既有 TDCC 資料均保留。

## 2026-09-28 15:35–16:05 台北：protected API、DB-only warm path、network 與完整測試收束

- Fresh 遠端 `main` 仍為 exact SHA `2e18b938b1984615433ef8abec557ed56e198cb8`，與本 change 既有正式 deployment／protected health 證據相同。正式 D1 主控台唯讀查詢 `00919.TW`、`2330.TW`、`8103.TW`、`4768.TWO` 的最新 shareholder-distribution：每筆皆由 `levels_json` 的 15 個一般級距、`adjustment_json` 的第 16 級與 `total_json` 的第 17 級組成完整 17 級距；provider=`tdcc`、frequency=`weekly`。`00919.TW`、`2330.TW`、`8103.TW` 最新日期為 `2026-09-24`，provenance 為 `official-openapi`／`official-confirmed`；`4768.TWO` 最新日期為 `2026-08-28`，provenance 為 `verified-archive`／`verified`。四筆皆有 `tdcc-official-distribution-v2` normalization、64 字元 material hash；archive row 另有 receipt、來源 URL、payload hash 與 archive commit。配合正式 owner 頁實際送出的 protected `/api/taiwan-stock-chip` request 與可見多期持股資料，task 3.2 完成。
- `4768.TWO` 是先前不在 owner 個人清單、但 D1 已有 18 個 verified archive weeks 的代表商品。正式 owner 頁以序列化切頁重新送出 same-origin `/api/taiwan-stock-chip` request 後，畫面快速顯示 `4768.TWO / 日 已載入`、18 期持股資料與 33 期官方缺口，沒有建立 provider 外連。另新增服務層精準回歸：預置兩期 `4768.TWO` D1 rows 與可涵蓋的 market fetch state，對 fresh no-cache request 明確斷言 `cache.mode=d1_hit`、兩期 rows、TDCC weekly provenance 與 provider calls=`0`；該測試通過。這組正式請求、D1 readback 與零上游呼叫回歸共同驗證 DB-only warm path，task 3.3 完成。
- 使用瀏覽器 `pageAssets` 在正式 owner 頁資料載入後擷取 72 筆已觀測資源：host 集合只有 `multichart-production.alanyi1112.workers.dev`；same-origin API 路徑只有 `/api/candles`、`/api/candles/batch`、`/api/config`、`/api/instruments`、`/api/taiwan-stock-chip`。TDCC open data、GitHub／raw、FinMind、TWSE、TPEx 與其他非預期外部 host 命中數為 `0`；同一頁 console warning／error 數為 `0`。此為瀏覽器實際觀測清單，不以 source inspection 或空白 Performance API 代替，task 4.3 完成。
- 完整 gate 已修復先前 616/618 的兩項日 K 狀態測試。根因是測試 fixture 固定在 `2026-08-28`，產品邏輯卻以執行當日推算台灣最近完成交易日，隨時間前進後測試把過期 fixture 誤判為產品回歸。兩項測試現以 Node test timer 固定 `Date` 在 fixture 的驗收時點，保留產品的真實 session 判定，不放寬 production 條件。`npm test`（含 production build 與 migration suites）結果為新增精準 D1 測試後 `619/619` 全過；`npm run lint` 通過；build／TypeScript 編譯通過，只有既有 Vite native config 相容性提示；MultiChart repo `openspec validate --all --strict` 為 `39/39`，本 change strict validation 通過，兩個 repo 的 `git diff --check` 均通過。task 5.2 完成。
- 本 change 的 exact SHA、archive receipts、D1 export／守恆、official 51 週、protected health／API、DB-only warm path、owner DOM／canvas／console／network 與完整測試證據已全部以非敏感資訊收束於本檔，task 5.1 完成。`deploy-cloudflare-private-small-group-free-tier` task 8.7 仍是獨立的 rolling 24 小時 Free-tier 驗收：前一窗口含 30 個 Worker errors，最早須於 `2026-09-29 13:32` 台北時間後重新量測乾淨 request、CPU、D1 reads／writes、storage 與 error rate；此處沒有把主 change 完成冒充 8.7 完成。
