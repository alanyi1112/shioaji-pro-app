# 成交明細實作與驗收紀錄（更新至 2026-09-16）

## 實作結果與目前 Gate

已實作台股 `AllDay`／`RangeTime`／Snapshot 三方完整性核對、IndexedDB 原子分批保存、跨視窗 Web Locks 協調、有界補齊、完整筆數虛擬列表、全域大單設定及可取消的整日重算。移除舊 120／500／2,000 筆淘汰與固定分類器。期貨／選擇權保留原本先查下一日期、空白回查今日的最近 120 筆歷史行為。

現行歷史回應仍沒有 provider 成交 ID 或逐筆 `simtrade`／`intraday_odd`，因此程式不虛構旗標。它改用可驗證的來源不變量：`AllDay` 與 regular-session `RangeTime` 逐筆、依出現次數一致，成交量與 Snapshot 守恆，再由歷史逐筆累計量與 live `total_volume` 核對交接。只有證據成立才顯示「已核實」；截斷、總量不符、累計跳號、API／空間失敗都保持部分或失敗。只有雙歷史來源空白且 Snapshot 為零才顯示「確認無成交」。

**本 change 已完成 21／21。** 2026-09-17 上午真實盤中首次載入、SSE 斷線恢復及 13:30 收盤驗收均已通過；詳細證據見 [當日驗收](live-acceptance-2026-09-17.md)。尚未歸檔、commit 或 push。

## 來源唯讀證據

讀取既有本機 2026-09-11 RangeTime（09:00–13:34）來源檔，沒有重查 160 檔或更動其排程：

- 本機資料目錄：`/Users/alanyi/Library/Application Support/RealTimeStock/intraday-baselines/2026-09-11-direct160-source/`。
- `6230.ticks.json`：19 筆，1,304 bytes，09:00:01.509252–13:30:00。
- `2409.ticks.json`：53,694 筆，3,526,285 bytes，09:00:00.126167–13:30:00。
- 兩份來源的 datetime＋close＋volume＋tick_type 完全同值重複均為 0；這不能證明其他商品沒有同值不同成交。
- 欄位為 datetime、close、volume、bid_price、bid_volume、ask_price、ask_volume、tick_type，沒有成交 ID、simtrade 或 intraday_odd。
- [Shioaji 歷史資料文件](https://sinotrade.github.io/tutor/market_data/historical/) 支援 AllDay／RangeTime／LastCount，且提醒 ticks／kbars 不可作為盤中反覆輪詢來源。
- [Shioaji 使用限制](https://sinotrade.github.io/tutor/limit/) 為帳戶共用限制；本功能預算無法保證其他程序尚有可用配額，API 拒絕時保留既有資料並回報。

2026-09-16 新增的正式來源核實、欄位邊界、6,832 筆真實正面證據與零成交商品 `14381` 證據，見 [source-verification-2026-09-16.md](source-verification-2026-09-16.md)。新查詢以當日 09:00:00–13:59:59 為 regular-session 範圍，包含一般與延後收盤、排除 14:00 起固定價格交易。live 明確排除試撮／零股；歷史端點只在三方守恆成立時接受為 regular-session 序列。

## 身分、世代與保存

歷史批次按成交時間穩定排序後逐筆累加 `volume`，產生與 live `total_volume` 相同語意的來源序號。history/live 相同累計量只保留一次；相同時間／價格／張數但不同累計量仍是兩筆真實成交。累計量跳號立即降為部分資料並只做一次有界補齊，補回缺口並再次通過來源核對後才恢復已核實。

同商品＋日期的請求使用 Web Locks（owner 關閉即釋放）與本頁 pending Promise；保存與載入使用同一把鎖。IndexedDB 每塊 2,000 筆，所有塊與 metadata 在同一交易替換；同步 clone 錯誤、quota 或交易失敗均保留上一版。保留當日資料，寫入時清理超過 7 日的其他日期快取。每 10 秒合併保存一次及面板卸載時嘗試保存，強制關閉瀏覽器前最後尚未落盤資料仍須歷史補齊。

切股／跨日以本地世代拒收舊請求；共用 SSE 以 connection 身分拒收舊連線的 tick、heartbeat 與 error，不新增大單專用訂閱。斷線保留現有資料，恢復時有界補齊。

## 已鎖定資源預算

| 項目 | 預算與超額處理 |
| --- | --- |
| 本功能歷史查詢 | 不再使用沒有來源依據的「每日 8 次」產品硬上限；IndexedDB 保留每日累計請求數及最近 100 次 query type／reason 稽核，不清除既有 usage。一次完整核實使用 AllDay＋RangeTime 兩次，相鄰實體請求至少 1.5 秒，同商品＋交易日以 pending Promise、Web Locks 與 60 秒快取合併；fetch＋body、單次容量及整體 deadline 仍有界。429 優先採 `Retry-After`，其餘失敗以 30 秒起、最長 15 分鐘指數退避，冷卻持久化在 IndexedDB，重新掛載或跨視窗也不得立即重試。2026-09-17 程式查核確認「每次 SSE 重連立即強制補齊」是請求放大路徑；舊 8 次計數沒有 reason，無法逐次還原今天最初 8 次的觸發原因，不將推論當成逐次實證；現改為重連後先等下一筆累計量，只有確有缺口才補一次，同一頁後續缺口至少退避 60 秒。官方 intraday ticks 為 request-rate 限制並另受每日流量限制；本次調整前以 `/api/v1/auth/usage` 核對仍有 521 MB 以上餘額。 |
| 同商品快取 | 60 秒內共用已取得的歷史；重連可要求一次補齊 |
| 等待鎖／網路 | 等待商品鎖最多 20 秒、跨商品查詢間隔排隊最多 10 秒，fetch＋body 最多 15 秒；取得來源階段最多約 45 秒，計算另列 |
| 單次回應 | 48 MiB，檢查實際串流 bytes，超額取消 |
| 分類輸入 | 每商品／日期最多 500,000 筆；超額回報並保留已載入資料，不冒稱完整 |
| 儲存 | 寫入前至少保留 128 MiB 可用 quota；實際交易失敗也明確回報 |
| 工作記憶體 | 單一 50 萬筆面板實測約 337 MB JS heap；部署評估預留 768 MiB／活動商品作為保守規劃值，非可強制保證的瀏覽器 heap 上限 |
| UI | 24 px 固定列高，視窗可見列＋10 列緩衝；最新 50 萬筆驗收 33 列 DOM |
| 重算 | 每 1,000 筆讓出事件迴圈；快取 identity 合併也分段；50 萬筆完整載入目標 10 秒內 |
| 數值設定 | 金額 0 < x ≤ 1 兆元，張數 0 < x ≤ 1,000 萬張，樣本 1–2,000，P1–P100，1 ≤ 暖機 ≤ 樣本 |

## 測試證據

- 2026-09-16 新增來源核實、累計身分、同值獨立成交、亂序、截斷、非法來源列、Snapshot 超前、確認無成交及交接缺口測試；相關非 browser 4 檔／22 項通過，相關 browser 3 檔／22 項通過。
- 完整 browser suite 14 檔／132 項通過；`pnpm build` 通過，僅保留既有大型 chunk 提醒。
- 實際開啟 `/?popout=tape&code=2330` 顯示全部 6,832、大單 133，資訊狀態為「已核實完整」，範圍 09:00:09.721819–13:30:00；與 bounded source check 完全一致。實際開啟 `14381` 顯示全部 0、大單 0、當日已確認無成交。
- 完整非 browser suite 為 232 檔／2,446 項通過、6 檔失敗。5 個失敗源自同工作樹先前將 intraday-monitor change 歸檔後，舊測試仍引用 `openspec/changes/add-configurable...` 或錯誤的 archive 相對路徑；另 1 個為既有 smart-order LaunchAgent 暫存 bundle `realpath` 失敗。相關成交明細測試全部通過，這些失敗未由本 change 引入，也未在本 change 擴大修正。

- 全套非 browser：223 檔／2,379 項通過（新增 SSE 世代保護前的全套）；後續相關 4 檔／16 項通過，含 SSE 舊連線拒收、分類、來源正規化與有界 HTTP。
- browser 包含：全部／大單 2,500 筆、最早列可達、微秒、捲動 anchor、暖機、設定重算、同頁雙面板、storage 事件、重載、重算中的新成交、原子替換、空回應、來源失敗、quota／clone 失敗保留舊版，以及斷線補齊、切股舊請求、跨日與期貨夜盤回歸。
- 獨立 Playwright 兩視窗驗證：設定同步＋重新載入保存、同商品只 1 次歷史請求、owner 關閉接手成功、瀏覽器 errors 為空。使用真實 TickTape 元件及合成資料 harness。另完成完整 App 路由的真實資料驗收，見下段。
- 10 萬筆分類重播約 0.75 秒；50 萬筆約 3.94 秒。後者 IndexedDB 寫入約 98 ms、讀取約 146 ms；合成資料 JSON 約 108.5 MB。IndexedDB compression／usage 估計不能當作實際行情容量保證。
- 50 萬筆實際元件完整載入（含分段合併）8.19 秒、33 列 DOM、JS heap 337,271,120 bytes、捲動約 7 ms，沒有 page／console error。
- 正式 App 路由：`/?popout=tape&code=2330` 實際載入 4,732 筆／226 筆大單（09:00:07.349593–13:30:00）；`/` 主工作區實際載入 608 筆／23 筆大單。兩者均明確顯示部分資料，設定由主面板同步至獨立視窗，page errors 為空。證據為 `outputs/tick-tape-verification/app-route-report.json`。
- 小高度主面板的設定改用原生 modal dialog，完整顯示欄位、鍵盤 focus trap、Escape 關閉與回復開啟按鈕焦點；實際截圖 `app-1.png`、`app-2.png` 已檢視。
- 跨商品 1.5 秒間隔原先直接失敗，完整 App 驗收發現後改為最多 10 秒排隊；新 browser 回歸確認兩商品同時載入皆成功。
- Browser 最終涵蓋 19 項；對話框焦點回歸曾失敗，修正先關閉 modal 再還原焦點後，該項重跑通過。其餘 18 項同輪通過。
- 最終 build、TypeScript、OpenSpec strict、git diff --check 通過。Vite 仍有既有大型 chunk 提醒，未因此擴大調整打包範圍。
- 本機證據：`outputs/tick-tape-verification/browser-report.json`、`settings.png`、`full-session.png`；不提交大型原始行情資料。

## 2026-09-16 當時待完成（歷史紀錄，已完成）

1. 下一個真實交易時段於盤中首次開啟 2330 成交明細，確認由開盤歷史接至當下 live 累計量；再執行一次可恢復的行情斷線／重連，核對補齊前為部分資料、補齊後重新核實且既有成交不消失。

此限制只對應 task 5.1；目前完成 20／21。tasks 1.1、2.3、2.5 已有正式來源、程式與測試證據。

已建立一次性 thread heartbeat `automation-2`（成交明細盤中終驗），排程以本機 `Asia/Taipei` wall clock 計算，下一次且唯一一次觸發為 2026-09-17 09:02。它只允許在驗收頁的瀏覽器網路層製造可恢復斷線，不得停止共用 API 或 160 檔 runner；成功才勾選 5.1，不會自動歸檔、commit 或 push。

## 17:21 截圖回饋調整

已將狀態、成交範圍與大單條件收進工具列 i 按鈕的資訊對話框，預設不占列表高度。金額欄位改為萬元：預設 100，125.5 萬元保存為 1,255,000 元，重開仍顯示 125.5。三個 browser 測試檔共 20 項通過，build 通過；實際元件截圖確認列表上方資訊已收起，設定顯示萬元，page errors 為空。證據為 outputs/tick-tape-verification/compact-tape.png、info-dialog.png、wan-settings.png。


2026-09-17 上午實際驗收及保留的失敗紀錄，見 [當日證據](live-acceptance-2026-09-17.md)。13:25／收盤尚待今日實際時點，不提前勾選 5.1。

## 2026-09-17 13:30 收盤終驗完成

13:27:54–13:30:25 沿用同一隔離驗收 profile，沒有重設計數。原始證據：`outputs/tick-tape-verification/closing-acceptance-2026-09-17T052754576Z.json`。首次 AllDay／RangeTime 各 4,555 筆、Snapshot 13,993 張一致；其後 SSE 收到 13:30:00 的 1,958 張收盤成交，全部清單增至 4,556 筆，最早 09:00:08.789371 不消失，重複識別碼與累計缺口均為 0。收盤成交 isLarge=false，reason=outside_continuous_session，13:25 起大單數為 0。來源 metadata 的 verifiedThrough 仍保留首次歷史核對的 13:24:58，不冒充收盤後又重查歷史；收盤尾端由真實 live 累計量驗證。

本次僅新增 2 次歷史請求；加上午 7 次驗收的 22 次，共 24 次本任務新增實體歷史請求。原使用者 profile 已知 8 次及其他共用帳戶使用仍另列。上午首次載入／歷史即時交接／隔離 SSE 斷線恢復不重跑。先前零成交、來源空白、截斷與分類邊界測試，加上今天上午和收盤真實證據，已完成 task 5.1；本 change 21/21，不代表已歸檔或提交。
