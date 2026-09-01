## 1. 基線、來源與資料契約

- [x] 1.1 保存 v1 選股領域、API、D1 schema、最新全市場 snapshot、兩市場母體及現有缺漏的非敏感基線，確認不覆寫 `add-after-market-stock-screener` 既有未提交變更
- [x] 1.2 逐市場核對 TWSE `TradeValue`、TPEx `TransactionAmount` 與歷史日報等價欄位的日期、幣別、交易範圍、單位、授權／自動化限制及實際 fixture，更新正式來源 review
- [x] 1.3 為成交值 canonical 整數元、0.01–10,000,000 萬輸入、三種 holder mode、1–4 週及 N+2 週期建立 TypeScript 型別與 schema 契約測試
- [x] 1.4 為 v2 D1 payload、snapshot metadata、API response、unknown reason、formula version、criteria fingerprint 及 cursor 定義版本化 fixture，證明 v1/v2 不混用

## 2. 領域計算與三態邏輯

- [x] 2.1 實作萬元十進位輸入到 `minimumTurnoverNtd` 整數字串的精確解析、上下界驗證、格式化及 `BigInt` 比較，補齊相等／略低／非法／超界測試
- [x] 2.2 擴充成交量與大戶 criteria，使各分支分別組合訊號與可選成交值限制，證明成交值不會在 `any` 下單獨通過
- [x] 2.3 保留 `weekly-increase` 行為，實作 `decrease-to-increase` 與 `increase-to-decrease` 的 1–4 週純函式判定
- [x] 2.4 補齊 N=1、N=4、前段方向錯誤、零變化、最新恰達 ±X、略低門檻、缺週、非相鄰週及 validation 不完整的 pass／fail／unknown 測試
- [x] 2.5 擴充 `all`／`any` 三態、逐分支缺漏及全市場守恆計數測試，涵蓋訊號 fail 但成交值 unknown、訊號 pass 但成交值 unknown 等邊界
- [x] 2.6 升級 sort、stable tiebreak、criteria fingerprint 與公式版本，為成交值、反轉幅度及連續週數排序加入 deterministic tests

## 3. 日成交值正規化與 D1 保存

- [x] 3.1 擴充 TWSE／TPEx 最新日批次 adapter，從同一日量列正規化 `turnoverNtd`、原欄位、幣別、交易範圍、mapping version 與 provenance
- [x] 3.2 擴充兩市場歷史日報 parser，驗證成交量與成交值使用相同 D／P 錨點；缺值或契約不相容時只標記成交值 unknown／`incomparable_source`
- [x] 3.3 加入 additive D1 migration 與 staging migration tests，確保既有 `screener_daily_volume`、snapshot 與 repo 外本機資料可無損升級／回滾
- [x] 3.4 更新 daily collector 的較新資料判定與 sparse response 保護，證明缺成交值的新列不會清空既有合法成交量或已驗證成交值
- [x] 3.5 以兩市場實際官方日資料執行非敏感 adapter 驗收，記錄 D、筆數、有效／缺漏成交值及來源 hash，不將 fixture 當成正式完成證據

## 4. 六期 TDCC 滑動窗與背景回補

- [x] 4.1 將 screener 專用 TDCC period planning 與 prune 改為最新六個已驗證官方週期，加入跨年、連假、缺中間週及受 snapshot/checkpoint 保留列測試
- [x] 4.2 更新 publisher，使每檔 snapshot row 按官方日期保存最多六期 validated 第 15 級比例與 provenance，且缺期不以更早資料補位
- [x] 4.3 建立升級 bootstrap planner：先重用同等完整 17 級與來源版本的本機列，再只產生每檔缺少的最多四期工作
- [x] 4.4 建立新商品 history planner，在 universe revision 新增商品時只排入該商品可合法取得的必要六期，不修改自選清單、active targets 或個人長歷史佇列
- [x] 4.5 實作固定 request／時間 budget、single-flight、timeout、冷卻、有界 retry、cursor 與 checkpoint 續跑，保存 target／processed／remaining／failed／overdue
- [x] 4.6 為 rate limit、timeout、來源限制、本機休眠、operator lease 競爭、中斷續跑及較新稀疏回應建立測試，證明不重跑完成項目、不提高為無界併發
- [x] 4.7 將六期準備接回既有盤後選股 operator gate，確認 UI／GET 不 dispatch 回補，且不啟停 simulation API、watchdog、5173、5174、pipeline 或行情連線
- [x] 4.8 在本機 D1 執行分段 full-universe bootstrap，定期保存各週期覆蓋與 checkpoint；未達合法終態前保持對應任務未完成，不以自然累積或部分成功冒充完成
- [x] 4.9 實作固定 commit／逐檔 SHA-256 的六期 TDCC CSV bootstrap、最新官方逐列錨定、全檔先驗證、只補缺與官方逐商品回退，補齊 tamper／缺期／不覆蓋測試

## 5. v2 Snapshot 與本機唯讀 API

- [x] 5.1 擴充 immutable publisher 與 metadata，保存 universe／schema／formula version、D、六個週期、成交值／六期完整度、逐原因缺漏及背景進度
- [x] 5.2 確保 staging 全母體成功後才原子發布 v2，加入中斷、部分來源、舊 snapshot fallback 與較舊回應不得覆寫測試
- [x] 5.3 擴充本機 status／results GET allowlist 與固定 query schema，驗證 mode、N、X、兩個成交值門檻、排序、limit、cursor 與 version
- [x] 5.4 證明重複篩選、翻頁、history-pending 與非法輸入只讀本機 snapshot，不產生 provider、Shioaji、回補、委託或 runtime 管理副作用
- [x] 5.5 擴充 API 分支 evidence 與結果明細，回傳成交值 D、最多六期比例／週變化、連續長度、反轉幅度、unknown 原因及守恆計數

## 6. 選股面板與偏好遷移

- [x] 6.1 在成交量與大戶條件卡分別加入可選最低成交值控制、萬元說明、上下界與尚未套用狀態，非法輸入時不得送出查詢
- [x] 6.2 加入大戶三種互斥 mode、1–4 週與 X 控制，文案使用「持股比例由減轉增／由增轉減」並說明不代表確定買賣
- [x] 6.3 擴充結果列／展開明細／缺漏摘要／排序，呈現成交值日期、六期 series、每週變化、反轉方向與 history-pending
- [x] 6.4 實作 v1 偏好到 v2 的一次性安全遷移：兩個成交值關閉、holder mode 為單週增加、原門檻／組合／排序保留；未知版本有界回預設
- [x] 6.5 補齊 stale generation、跨 snapshot cursor、偏好寫入失敗、窄面板、600 CSS px、特大字級、鍵盤與螢幕閱讀器標籤測試
- [x] 6.6 驗證點選進階選股結果仍只更新指定未鎖定 K 線圖，不改自選清單、其他圖表、下單／智慧下單商品或草稿

## 7. 全市場驗證與交付

- [x] 7.1 執行 focused domain／adapter／route／publisher／UI tests、完整 `npm test`、lint、typecheck、migration tests 與 `git diff --check`
- [x] 7.2 對本機 D1 執行 `integrity_check`、全市場每市場母體守恆、成交值覆蓋、六期覆蓋及 snapshot 原子性核對，保存非敏感 evidence
- [x] 7.3 以成交量單條件、大戶單週、兩種四週反轉、各自成交值、`all`／`any`、缺中間週及不在自選清單商品跑完整 API 分頁 acceptance
- [x] 7.4 在實際本機選股面板核對 DOM、可見控制、600／768／900 px、console、結果證據與點選 K 線；若 5173／5174 未運行，取得明確授權後才啟動驗收，不得虛報完成
- [x] 7.5 核對背景 full run 的 target／processed／remaining／failed／overdue、未受控 request、來源冷卻與新商品回補；只有實際符合規格的項目才勾選
- [x] 7.6 更新繁體中文操作文件、資料來源 review、tasks 與 verification evidence，執行 `openspec validate --all --strict` 並列出仍未完成或已接受 unknown 的項目
