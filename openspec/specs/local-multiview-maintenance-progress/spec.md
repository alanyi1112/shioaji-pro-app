# local-multiview-maintenance-progress Specification

## Purpose
TBD - created by archiving change repair-local-multiview-after-hours-progress. Update Purpose after archive.
## Requirements
### Requirement: 維護排程持久接續與漏做檢查
系統 SHALL 在維護開始時持久化三組 checkpoint，上下文壓縮後保留既有進度；未巡訪組別不可通過結束檢查，未驗收工作不可標記整體成功。

#### Scenario: 壓縮後重入
- **WHEN** 存在 running 維護紀錄且未收到新取消指令
- **THEN** 恢復原始 checkpoint，不覆蓋為新工作，不套用歷史收工要求

#### Scenario: 一組受阻而其他組漏做
- **WHEN** 僅 tick-tape 有進度，local-data 與 cloudflare 尚未巡訪
- **THEN** finish 失敗並保留 running；全部巡訪仍有阻擋時僅能標記 incomplete

### Requirement: 本機日 K 維護有界接續
系統 SHALL 在受保護本機維護入口提供日 K 稽核批次，使用正式來源及既有逐商品 lease，並由 daily runner 有界接續。完成、失敗與等待重試必須可區分。

#### Scenario: 批次仍有待處理商品
- **WHEN** 日 K 維護尚未涵蓋完整目標
- **THEN** 回傳進度供下一批次接續，不把 HTTP 成功視為全商品完整

#### Scenario: 未授權請求
- **WHEN** 呼叫來源不是 loopback 或 secret 不符
- **THEN** 拒絕呼叫，不執行稽核

### Requirement: 籌碼失敗不可阻塞其他商品
系統 SHALL 對已選取商品記錄每 dataset 嘗試時間，使 eligibility 或 provider 失敗仍遵守冷卻，並保留既有 verified 資料。

#### Scenario: 第一檔失敗
- **WHEN** 首檔商品資格檢查或資料來源失敗
- **THEN** 下一次選取可推進其他到期商品，失敗商品不立即重複領取

### Requirement: PE 佇列公平且排除 ETF
系統 SHALL 排除含英文字尾 ETF，保留排隊與重試狀態，並以當次合格商品集合限制領取。

#### Scenario: 重複啟動
- **WHEN** 同一範圍再次排入 PE 工作
- **THEN** 不重設既有排隊時間、blocked 狀態或 retry 冷卻，後方商品仍可領取

#### Scenario: ETF 舊工作
- **WHEN** 舊佇列含有 00981A.TW 等 ETF
- **THEN** 不再領取該工作，不刪除既有證據

### Requirement: 籌碼目標涵蓋啟用台股清單
系統 SHALL 將啟用個人台股清單與 TDCC 活躍目標合併去重，不因 TDCC registry 未涵蓋而漏掉日籌碼商品。

#### Scenario: 商品不在 TDCC 活躍 registry
- **WHEN** 個人清單商品已啟用且為台股，但不在 TDCC 活躍目標
- **THEN** 日籌碼排程仍納入該商品並遵守既有來源與冷卻限制

### Requirement: 本機排程符合 macOS 日曆定義
系統 SHALL 使用 launchd 星期編號，daily 為週一至週五16:45，TDCC 為週六主同步及週日重試22:30；修正日曆不得中斷正在執行的行情服務。

#### Scenario: 以實際日期核對星期
- **WHEN** 安裝或修改日曆排程
- **THEN** 0／7 解讀為週日、1–5為週一至週五、6為週六；測試以真實日期比對，並讀回launchd已載入設定

### Requirement: 官方歷史 PE 驗證同步資料與工作狀態
系統 SHALL 解析正式月報實際日期、欄位與財報年季，只有同商品同日收盤與PE符合既有差異門檻才提升歷史驗證，並同步閒置工作狀態；足量歷史須有至少 220 筆正值且涵蓋至少 300 個日曆日，並保留嘗試紀錄及其他執行者的lease。

#### Scenario: 舊月份與最新官方日期並存
- **WHEN** 官方歷史月報核實既有待驗證歷史
- **THEN** 同時滿足 220 筆與 300 日跨度者為complete，任一條件不足者保留insufficient_history，較新的official_source_date／latest_source_date不得倒退

#### Scenario: 真實歷史月報格式
- **WHEN** TPEx使用「日 期」與114Q4或TWSE日期為114年11月12日
- **THEN** 保留正確的同日資料與2025年第4季等實際年季，不將空白PE生成有效樣本

### Requirement: 借券缺列必須由官方成交明細判定
系統 SHALL 使用 TWSE 借券中心的正式全市場成交明細核對借券缺列。只有回應欄位、交易日與市場有效性全部通過時，才可把未出現商品分類為官方確認當日無成交；此分類不得寫入假的零成交列，且不得把借券賣出餘額或可借券數量冒充借券成交。

#### Scenario: 有效全市場回應未含目標商品
- **WHEN** 官方回應含其他商品的同日借券成交，但目標商品未出現
- **THEN** fetch state 記錄 `official_no_activity` 與核對日，保留最後真實成交日，不新增 `transactionShares=0` 資料列

#### Scenario: 官方回應無法證明市場已發布
- **WHEN** 回應為空市場、HTTP 失敗、欄位漂移或成交日期不是請求交易日
- **THEN** 保留既有資料並依退避稍後重試，不得分類為無成交

### Requirement: PE 缺口必須以有界官方月報接續
系統 SHALL 在第三方歷史來源缺漏或不可用時，以 TWSE 個股月本益比與月收盤資料逐月接續；每輪有固定月份上限與請求間隔，已完成月份不重抓。正本益比與收盤必須同商品、同市場、同交易日配對後才可匯入。

#### Scenario: 官方月份具有正本益比
- **WHEN** `BWIBBU` 與 `STOCK_DAY` 在同一交易日都有有效正值
- **THEN** 匯入 `official_verified` row，更新該月份 checkpoint，並重新計算五年正值樣本數

#### Scenario: 官方月份只有空白本益比
- **WHEN** 月報有效但本益比均為空白、`-`、零或負值
- **THEN** 以 `official_gap` 完成該月來源核對，不生成零值樣本、不永久排除普通股，且下次排程略過該月

#### Scenario: 五年官方月份完成但未達足量歷史
- **WHEN** 所有目標月份均已核對，但正值樣本少於 220 筆或涵蓋少於 300 個日曆日
- **THEN** 商品保留 `insufficient_history`，對使用者揭示實際樣本數，不再因第三方缺漏反覆重抓相同月份

#### Scenario: 接近完整交易年的官方歷史
- **WHEN** 商品具有至少 220 筆經核實正值，且最早與最晚樣本相隔至少 300 個日曆日
- **THEN** 商品標記為 `available` 並可計算 P5～P95 七條百分位；暫代資料不得增加門檻樣本數

### Requirement: 盤後 Shioaji 日線不因交付順序或 canonical 待核對而消失
系統 SHALL 在強制使用 Shioaji 即時來源時先交付 snapshot，再交付相同商品的歷史 Kbars；有效日線歷史不依賴後續即時事件才可顯示，canonical 尚未核實時保留 Shioaji 圖與明確狀態。日線訂閱 SHALL 直接取得每日彙整，不在瀏覽器建立全年分鐘物件；分鐘與指定日期驗證仍須保留逐分鐘資料。

#### Scenario: 收盤後 canonical 尚未核實
- **WHEN** Shioaji snapshot 與 Kbars 有效，但相同交易日 canonical 日 K 尚未通過核對
- **THEN** 顯示 Shioaji 日線、收盤價與指標，標示等待 canonical 核對，不清空既有圖表

#### Scenario: canonical 僅收盤價核實但其他欄位不一致
- **WHEN** canonical verification 狀態為verified但fieldResults或mismatchFields仍包含high、volume等不一致
- **THEN** 不以canonical完整OHLCV接手，繼續顯示Shioaji Kbars並保留待核對狀態

#### Scenario: 四圖同時載入 365 日日線
- **WHEN** 四個日線面板同時請求約 365 日 Shioaji Kbars
- **THEN** coordinator 直接彙整每日 OHLCV／成交值並共用不可變日資料，避免每格展開所有分鐘 rich object
