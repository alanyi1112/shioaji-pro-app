# 依實際額度逐批續補計畫（2026-09-17）

本計畫依使用者「在 D1 額度與 TDCC 讀取限制下盡快補完」的最新要求，取代先前每日一期／每日唯一 dispatch 的操作限制；不改變來源驗證、資料守恆及不超額原則。既有 workflow 每批 10,000 邏輯列估算仍維持，這是批次大小，不是每日額度，也不是官方限制。使用現行 workflow 即可逐批續跑，不需為加速擅自部署或增加並行來源請求。

## 已確認的限制

- Cloudflare 官方 D1 Free：全帳戶每日 reads 5,000,000、writes 100,000、總 storage 5 GB，UTC 00:00（台北08:00）重置。INSERT／UPDATE／DELETE 與索引更新均須計入；回傳資料筆數不等於掃描列數。
- 官方來源：https://developers.cloudflare.com/d1/platform/pricing/
- TDCC 股權分散查詢頁建議多檔需求採開放資料批次下載；本次未找到公開的固定每日查詢次數。未知不代表無限制，不自行捏造「每天 N 次」。
- 官方來源：https://www.tdcc.com.tw/portal/zh/smWeb/qryStock
- verified archive 以固定 immutable commit、manifest hashes 為限；prepared receipt 已通過來源驗證者由現行程式直接返回，不重新下載。未 prepared 才下載該期全市場檔；最新錨點維持官方驗證。不得擴增未驗證鏡像或輪替 IP 繞過來源限制。
- 官方歷史查詢維持單工、既有合理間隔及來源冷卻；429 尊重完整 Retry-After，403／驗證碼／來源拒絕即停該來源，不密集重試。來源間隔與批量是本機節流策略，不能寫成 TDCC 官方上限。

## 依序處理，避免重讀與重寫

1. 優先處理已 prepared、尚未 verified 的 archive 期別，完成整個固定 2,330 檔母體，不拆成逐股重新抓來源。每批完成檢查 receipt／target=processed+remaining／failed=overdue=0。
2. 未 prepared 的期別，預算必須涵蓋 prepare、索引維護、finalize、staging 清理、checkpoint 與核對查詢。不能只拿本次 prepared 的成本套在未 prepared 批次。
3. 18/18 後立即停止 archive 重寫，將逐商品／日期 coverage 與 official 51-week 計畫做差集，只補真正缺口；接近官方一年保存期限的缺口優先，最新週例行更新預留額度。
4. 相同來源檔取得一次後，在允許的受控環境做驗證與重用，不為不同商品、不同視窗重抓；失敗及使用紀錄不清除。

## 每批可否執行的判斷

每次先讀 GitHub active run／receipt，禁止並行 runner，禁止重試未確定是否完成的寫入。明確標示 quotaDateUTC、telemetryWindowEnd、最近已完成 run、來源冷卻、剩餘期數與下一批準備狀態。

- 可用 reads = 5,000,000 − 當日全帳戶已使用 reads − 其他在途工作已保留 reads − 正常服務及其他當日維護預留 reads。
- 可用 writes = 100,000 − 當日全帳戶已使用 writes − 其他在途工作已保留 writes − 正常服務及其他當日維護預留 writes。
- 預留從現行 `scripts/cloudflare-budget-check.mjs` 的維護 headroom 起算（reads 250,000、writes 20,000），另加尚未執行的正常服務／其他 pipeline 預測；若實測高於此值，採較高值。這是操作緩衝，不是 Cloudflare 官方額度。
- 下一批成本取同類批次已核實實際峰值與資料表／索引／清理結構估算的較高值；未知結構、未核實的寫入放大不得使用單純 6,955 邏輯列當成本。reads、writes、storage 三項都須有餘裕。
- 用量必須涵蓋最近完成的批次，來源與時間窗可比較，且無未計入的在途工作。若 dashboard／Insights／query meta 尚未能核對，不追加批次、不以0當未用量，安排當日下一次檢查。
- 同日上一批完成、用量更新且下一批仍可容納：立即串行續補下一批。取消固定每日一期；也不預先承諾每日固定多期。每批均重新判定，餘額不足才停到重置。
- 目前 metadata 尚未由 runner 完整輸出計費 rows；本階段以人工代理讀回 fresh 全帳戶 billing＋資料庫 Row Metrics 逐批核對。不能把排程更新說成已部署自動精算額度的 runner。

## 時間安排

依使用者 2026-09-21 最新決定，排程每天台北08:26與16:26檢查，包括假日。08:26接在 D1 每日額度重置後；16:26讓上午批次的用量有時間入帳，再判定當日能否續補。這是每日兩次排程喚醒，不把檢查次數冒充已完成批數；每次仍依上述 gate 決定是否 dispatch，未符合時記錄原因。資料未入帳、來源冷卻或額度不足時不強行寫入；不為已完成資料重新 dispatch。每日先處理補檔判斷，不被本機維護或盤中驗收延後。

若某批正在執行，後續只追同一 run。若帳戶用量接近界線，停止當日新增寫入，避免讓正式站查詢一起被限流。所有資料及驗收完成才停補檔線，其餘維護任務保留。

## 本次量測與完成時間

- 已成功一期：run35176769526，7/18，尚餘11；本次 prepared finalize 的邏輯估算6,955。
- 台北11:22重新讀取D1 Insights，時間窗08:00–11:22：摘要顯示reads22k／writes9k，同頁Row Metrics圖顯示reads108.18k／writes20.75k。這些值不可當成已一致的全帳戶計費明細；目前不能據此直接連發多批。
- 若後續核實同類批次約需20,750實際writes，且其他工作預留僅20,000且reads/storage也足夠，算式 floor((100000−20000)/20750)=3 期／日，表示固定每日一期可能浪費餘額。此為條件式容量示例，未包含未 prepared 成本，不能承諾3期／日或4天完成。
- 先取得一致成本，再每日依剩餘批次成本更新預估完成日；不再把11個執行日當最低必需時間。官方51週缺口及UI終驗另列，不能用18期archive推算全部補檔完成日。

排程已於本輪以automation_update實際更新並讀回：ACTIVE，五個每日時段；scheduler下次實際觸發為2026-09-17 13:27:21 Asia/Taipei，今天收盤時點不受影響。OpenSpec strict及diff檢查通過。

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

## 2026-09-21 16:34 台北：批後入帳後完成 7/17

- GitHub fresh 查核 main 與最近成功 deploy 皆為 exact SHA `2e18b938b1984615433ef8abec557ed56e198cb8`，上午 run `35549429949` 已完成且沒有在途 archive runner。
- Cloudflare 全帳戶 D1 當日用量已由上午尚未入帳的 0 更新為 reads 78.97k、writes 7.07k、storage 403.22MB；資料庫 Insights 過去24小時為 reads 243k、writes 10k，且可見 staging INSERT 7.51k。兩個視窗口徑不同，不互相相減；當日計費頁已足以核銷上午 prepare 的 50,000 保留。
- 下一期 2026-07-17 已 prepared；按既有 finalize 結構保留 31,000，加正常服務 26,720 後，7,070+31,000+26,720=64,790，小於 100,000，reads與storage亦有充分餘裕。fresh dispatch run `35578760571`，exact-release、seed及protected health皆成功。
- 本批 finalizedPeriods=1，估算邏輯列6,976／10,000；固定 universe 2,330，processed 11→12、remaining 7→6、failed=overdue=0、complete=false，18=12+6守恆。下一缺期尚未取得可核對的 prepared 成本；批後D1計費頁仍停在reads78.97k／writes7.07k，尚未包含本批finalize，因此保留31,000未入帳writes，不連發下一批。
- 這是額度gate下的實際前進，不是每日一次或每日兩批硬上限。下一次台北08:26在UTC重置後fresh核對；若今日批次已入帳且下一未prepared成本及正常服務預留可容納，才續補。task 2.2、2.6仍未完成。

## 2026-09-26 09:45 台北：8/21 已 prepared，等待完整計費後 finalize

- UTC 日額度重置後，批前全帳戶日窗口為 reads 0／writes 0／storage 430.69 MB；未 prepared 期的 50,000 writes 結構保留加正常服務 26,720 writes 預留可容納。run `36208659396` 成功 prepare 2026-08-21，固定 universe 2,330，archive 維持 processed 16／remaining 2／failed 0／overdue 0。
- 帳戶日頁到 09:45 僅入帳 reads 2.84k／writes 607；過去 24 小時 Row Metrics 雖已看見 staging INSERT 5,002 次、15.01k writes，視窗仍不同。50,000 未核銷保留不釋放，也不以局部值 finalize。
- 16:26 重新 fresh 核對；完整入帳且無在途 runner時，8/21 已 prepared，使用 31,000 finalize 結構保留判定。剩餘兩期至少還有 8/21 finalize 與最後一期 prepare／finalize，完成日期依逐批入帳速度更新。

## 2026-09-26 16:45 台北：8/21 已 finalized，最後一期等待 fresh gate

- 上午 prepare 已完整入帳為 reads 101.89k／writes 7k／storage 435.75 MB，`7,000 + 31,000 + 26,720 = 64,720`，故 run `36229882477` 成功 finalize 2026-08-21；固定 universe 2,330，processed 17／remaining 1／failed 0／overdue 0。
- 批後帳戶日用量仍停在上午值，保留 31,000 未核銷 writes。最後一期尚未 prepared，待計費完整入帳後以 50,000 未 prepared 結構保留及正常服務 26,720 重新判定；額度不足則等 UTC 重置，不以每日批數作為停止理由。

## 2026-09-27 09:16 台北：archive 18/18 完成後停止 archive dispatch

- run `36284804232` 先 prepare 最後一期 2026-08-28；fixed universe 2,330，archive 維持 17/18、remaining 1、failed 0、overdue 0。
- 全帳戶日頁尚未入帳時，唯一 D1 資料庫自台北 9/26 18:45 起的 fresh Row Metrics 顯示 reads 683.16k／writes 37.38k。該視窗涵蓋 UTC 重置前活動，是本日用量的保守上界；`37,380 + 31,000 + 26,720 = 95,100 < 100,000`，且無在途 runner，故可安全 finalize。
- run `36284972005` 完成最後一期；protected health 為 target 18、processed 18、remaining 0、failed 0、overdue 0、complete true，18 期 receipts 全部 verified。自此不再執行 archive workflow；後續額度優先留給 official 51-week、正式服務與獨立驗收，依 tasks 2.3 起逐項推進。
- Finalize 後台北 09:15 的 Row Metrics 已更新為 reads 854.32k／writes 61.36k；這個自前一日19:15起的滑動視窗仍是本日用量保守上界，且加正常服務 writes 預留為 88.08k。archive 既已 complete，不因尚有餘額重寫任何 verified period。
