## 1. v6 條件模型與純函式

- [x] 1.1 新增 `CriteriaV6`、`foreignReversal`／`trustReversal` 型別及預設值，涵蓋連賣日數、今日買超張數、週轉率、平均期間、倍數、MA、流動性、回補強度與成交參與率參數
- [x] 1.2 實作 v6 criteria 有界驗證、effective criteria、canonical fingerprint 與非法上下限拒絕
- [x] 1.3 實作 v5 preference／criteria 到 v6 的決定性遷移，保留舊設定並讓兩項新條件預設關閉
- [x] 1.4 建立共用法人反轉價量 evaluator，以官方 session index 切開 `D0`、前期賣超、過去平均、MA 與流動性時間窗
- [x] 1.5 實作外資反轉 evaluator 與逐子條件 evidence，正確處理 shares／lots 換算、嚴格比較及 `unknown` reason
- [x] 1.6 實作投信反轉 evaluator、回補強度與成交參與率公式，固定使用流量語意並保留既有投信累計買超占股本條件
- [x] 1.7 擴充 v6 combine、condition keys、排序值與 counts，使複合條件內部固定 AND、外部仍服從全域 mode
- [x] 1.8 新增純函式測試，涵蓋端點相等、零買賣超、缺日、上市歷史不足、無效股本、平均窗排除今日與代表性 pass／fail／unknown

## 2. 外資 canonical schema 與來源驗證

- [x] 2.1 建立 additive D1 migration，替選股法人 daily rows 增加外資買進／賣出／淨額及新 mapping verification 欄位，並新增不改寫 v1 receipt 語意的 verification evidence
- [x] 2.2 擴充 canonical institutional row 與 repository upsert／readback，保存外資整數 shares、receipt、mapping version 及 invalid reason
- [x] 2.3 升級 TWSE T86 parser，分別驗證一般外陸資與外資自營商後合計外資買進、賣出及淨額
- [x] 2.4 升級 TPEx 歷史法人 parser，依已核對群組取得外資及陸資合計欄位並驗證 `buy - sell = net`
- [x] 2.5 補齊 TWSE／TPEx fixture、表頭漂移、日期不符、重複商品、非法整數及淨額不一致測試
- [x] 2.6 擴充 migration 測試，證明 schema／integrity 正常且既有 v5 snapshot、publication head、個人清單與其他本機資料 hash 不變

## 3. 外資歷史回填與 readiness

- [x] 3.1 建立新 institutional mapping 的逐市場逐官方交易日回填 planner，固定 targets、request／time budget、single-flight、timeout、cooldown 與 Retry-After
- [x] 3.2 實作可續跑 checkpoint 與 receipt verification；只有重新取得並通過日期、schema、hash、row coverage 與 mapping version 才能完成 target
- [x] 3.3 處理相同舊 payload hash 的新 mapping 驗證，不改寫 v1 normalization version，來源內容改變時建立可追溯的新 receipt
- [x] 3.4 擴充 readiness／health，依 TWSE／TPEx、日期及 mapping version 回報 target、verified、missing、invalid、failed、remaining 與 last verified source date
- [x] 3.5 新增回填與 coverage 測試，證明局部圖表 cache、自選清單、單一商品及只有投信欄位的 row 不能完成全市場外資 gate

## 4. v6 immutable snapshot 與 API

- [x] 4.1 建立 v6 snapshot metadata、row evidence、schema／formula／mapping version 與 evidence hash 驗證
- [x] 4.2 建立 v6 repository，限制單列／全 snapshot 資源、原子 staging→published、保留筆數及衝突回復
- [x] 4.3 建立 v6 publisher，以同日已發布 v5 為 base，讀取相鄰法人 flows、必要 OHLCV、股本與 receipts，完整後才產生全母體 rows
- [x] 4.4 擴充 v6 coverage gate，拒絕跨日期、跨市場、跨 mapping、缺股本或缺必要交易日的 candidate，且保留商品為 `unknown` 而非縮小 universe
- [x] 4.5 建立 v6 results／status route 與 query parser，支援新 criteria、排序、cursor、counts、逐子條件 evidence 及安全錯誤 payload
- [x] 4.6 更新本機 gateway 型別與 forwarding，v6 pending 時保留 v5 可用性且 GET／排序／翻頁不得觸發 provider 或 D1 寫入
- [x] 4.7 新增 repository、publisher、route、cursor 與 gateway 測試，涵蓋 atomic publication、staging hash 失敗、舊 head 保留及 raw row 比 head 更新

## 5. 精簡條件面板與結果呈現

- [x] 5.1 將外資與投信反轉條件加入「籌碼／價量」分類、condition registry、摘要、enabled 判定及「全部取消」
- [x] 5.2 以緊湊 grid 建立外資條件編輯器，所有數值可調且沿用單一 active condition accordion
- [x] 5.3 以緊湊 grid 建立投信條件編輯器，明示回補強度與成交參與率公式及「不是持股比例」短說明
- [x] 5.4 更新 v6 preference local storage、草稿／已套用狀態、查詢序列化與 v5→v6 UI migration
- [x] 5.5 擴充結果摘要與 evidence 檢視，顯示 `effectiveSessionDate`、前期日期、法人張數、價量基準、回補強度、成交參與率及 unknown 原因
- [x] 5.6 新增元件與瀏覽器測試，涵蓋預設收合、展開互斥、全部取消、參數編輯、錯誤語意禁用、偏好遷移與窄面板高度

## 6. 驗收、回復與文件

- [x] 6.1 在 staging D1 執行 migration、`PRAGMA integrity_check`、既有個人資料 hash 與 v5 publication head 前後比對
- [x] 6.2 以有界作業完成必要 TWSE／TPEx institutional v2 歷史回填，保存逐日期 receipts、coverage、missing 與 retry 證據
- [x] 6.3 發布並獨立讀回 v6 snapshot，保存全市場數量、逐條件 matched／fail／unknown、material hash 及 pass／fail／unknown 代表性公式重算
- [x] 6.4 執行 domain、normalizer、migration、publisher、route、gateway、元件與瀏覽器 focused tests，以及 TypeScript／build／OpenSpec strict validation／`git diff --check`
- [x] 6.5 進行本機 UI 驗收，確認兩項條件位於正確分類、設定精簡、日期與證據正確、console 無錯誤，且查詢不改變清單、行情訂閱或交易狀態
- [x] 6.6 演練停用 v6／回退 v5，證明最後合法 v5 結果、偏好來源資料、個人清單與 simulation runtime 保持可用
- [x] 6.7 更新選股文件與 change verification，記錄正式來源欄位、版本、實際資料日期、coverage、限制、未提供投信持股的邊界及未宣稱績效
