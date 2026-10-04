# 預算 producer 與來源邊界接續（2026-10-03）

所有時間採 Asia/Taipei。本輪接續 8.4，整體仍為 **35／42**；沒有把程式接線、隔離測試或 pending UI 當正式來源／160 日／自動發布成功。

## 已完成的程式與可重現錯誤

先加入三項回歸，原程式全部失敗：正常時鐘前進 7 毫秒便使 dispatch 回 `broker_policy_changed`；usage 等待中僅刷新觀察時間亦誤拒絕；破損 quota identity 未被政策驗證拒絕。

改以 `broker-budget-terms-v2` fingerprint，只排除 commitmentsObservedAt；每次仍獨立驗 freshness，其餘額度、實測、證據、效期及 quota identity 全部綁定。正式 port 將政策 record 的 scope／quota epoch／quota 證據加入條款；usage 身份不同、查詢中途或 dispatch 前換 record 都拒絕。舊 fingerprint reservation 不改寫或直接放行；未送保留仍可循原安全 settlement 處理，已耗保留不清債。

新增 `stock-screener-broker-commitments.mjs`，接入 formal port 的 v2 配置讀取：

- 非參與中央 reservation 的工作須逐一登錄非空 roster，以 `broker-consumer-commitment:<jobKey>` 讀自己的來源觀察。
- verified 狀態不能代替 payload hash、同 scope／quota identity、非負安全整數剩餘 bytes 及 60 秒 freshness。
- 採全部工作最舊實際 observedAt；不以現在時間替工作刷新，不以 missing／unknown 當零。complete 亦須有相同身份的零剩餘承諾證據。
- 同條款重新觀察不改條款證據 hash；承諾值／來源證據修訂必須改 fingerprint 並拒絕舊 admission。
- producer 沒有 HTTP 或 DB 寫入；舊 v1 配置仍須原 freshness 驗證，不自動改成 v2 或建立假政策。

**尚未接妥**：既有盤中基準、各類歷史回補等工作的實際 receipt writer／完整 roster、可信當前 quota epoch、分別觀察的兩次 daily_quotes 用量實測及正式配置。此模組是彙整／驗證入口，不是會憑空產生外部工作事實的 writer。8.4 保持未勾。

## 當次真實本機狀態

19:00 前後以 SQLite readOnly 盤點：新 bollinger batches／daily、daily_quotes cache、source reviews／selections、profiles／publications、broker reservations 筆數全部 **0**；沒有 source-policy、broker-budget-policy 或 source-review record；只有既有 `screener-period-evidence` verified，updatedAt 為 10/2 20:15:24.341。這不代表 160 日新價量能力或當前額度政策已完成。

18:59:42.035 的 Chromium 隔離 storage 讀實際 5173 API：

- GET daily-profile(version=8) 2 次、GET status(version=7) 2 次、GET results(version=8) 1 次，合計 **5 GET**。
- profile HTTP 200／null；results HTTP 200／pending／`v8_preparation_pending`／rows=0。
- 非 GET=0、blocked=0、pageErrors=0、consoleErrors=0；畫面顯示「等待完整資料」及尚未發布報告。
- 沒有正式結果，故不能驗證真實分類案例、指定圖表或加入兩套清單，7.4 不勾。

第一次診斷呼叫只帶 `initialized-disabled` 一個參數，誤被 CLI 當截圖路徑，使用 schema-pending 模式而在預期 503／實際 200 斷言失敗；未輸出截圖。修正參數位置後通過。保留這個操作錯誤，不將它混作產品失敗。

## 來源文件查證與仍待確認

以下是公開文件 review，不是新的行情下載，也沒有代簽或變更使用者帳戶約定：

- [TWSE 使用條款](https://www.twse.com.tw/zh/terms/use.html)列有自動下載及使用限制，並將已授權政府資料開放平臺的資料列為例外；[個股日成交資訊資料集](https://data.gov.tw/dataset/11549)標示政府資料開放授權第 1 版，連結資源為 `STOCK_DAY_ALL?response=open_data`。該每日最新資源的授權不能直接當歷史 `MI_INDEX` 日期入口已通過。
- [TPEx 上櫃股票收盤行情資料集](https://data.gov.tw/dataset/11371)同樣列政府資料開放授權與每日更新，包含非普通股；尚未核實指定日期歷史入口的適用自動化／展示範圍。母體投影及日期契約仍須獨立成立。
- [永豐證券 API 使用同意書](https://www.sinotrade.com.tw/newweb/signCenter/S_openAPI/)說明程式訊號、行情風險及介面限制；[Shioaji 每日行情官方文件](https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/MARKET_DATA.md#daily-quotes-每日行情)確認指定日期查詢與 column arrays。兩者不是對本帳戶歷史儲存／個人篩選及展示適用範圍的完整獨立確認；本輪沒有據此寫 localDisplayVerified=true，不推論公開再散布權。
- [Shioaji 用量限制](https://sinotrade.github.io/zh/tutor/limit/)說明交易日 08:00 重置、訂閱推送不計下載用量，以及歷史快取與查詢限制。不能只拿現在日期當本帳戶 quota identity，休市日也不能自動清債；共用 usage 差額仍不冒稱某次 HTTP 的精確消耗。

本輪不對外傳送帳戶／憑證，也不自行聯繫券商或接受條款。若需使用者提供確認，只需適用條款或非敏感使用範圍證據，不需要金鑰。

## 回歸與保護範圍

Node 24.19.0：Node 11 files **153／153**（含新增 producer 6 項、ledger 21 項、ports 9 項）；Vitest 8 files **96／96**；Chromium 2 files **32／32**。前端 TypeScript／build、MultiView TypeScript 通過；build 原有 bundle >500 kB 提示保留。這些是真實執行的隔離測試，不是真實歷史來源／自動發布驗收。

新增 artifacts 後，此 change strict validation、`git diff --check` 及本輪 11 份文字檔（包含 untracked 模組／測試／驗收文件）的 whitespace 檢查全部通過。

19:00 前後 listener：8080 PID 1273、5173 PID 933、5174 PID 938，與前輪相同；僅表示 listener 未變，不冒稱已再驗 business session。新行情請求=0、正式資料庫寫入=0；公開條款／文件瀏覽與本機唯讀 API 檢查分開。未改盤中監控／圖表／清單／交易草稿／排程頻率，未啟停服務、新增 login／subscription、archive、commit 或 push。

19:11:49.322 再以 SQLite readOnly 核對上述八個新能力表，筆數仍全部為 0；OpenSpec apply progress 再核對為 42 total／35 complete／7 remaining，不以接線補強勾整項 8.4。

未完成 **1.1、8.1、8.4、7.2、7.3、7.4、8.8**。在正式 review、額度身份及各工作承諾未成立前，不能開始有界 160 日下載或寫正式成功 head；不以更小窗口、缺額度填零或手動發布取代真實 watcher 驗收。
