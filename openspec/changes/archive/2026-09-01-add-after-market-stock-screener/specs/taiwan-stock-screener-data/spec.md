## ADDED Requirements

### Requirement: 選股母體必須涵蓋全部有效上市與上櫃普通股

選股服務 MUST 使用具版本、來源日期、生效區間與商品種類的官方名冊建立母體，納入全部有效上市、上櫃普通股，包含尚未加入個人清單與未載入圖表的商品。母體 MUST 排除 ETF、ETN、權證、特別股、興櫃及海外股票，並以穩定識別去重；MUST NOT 以排行、個人清單、商品代碼字首或長度代替市場與種類分類。

#### Scenario: 全市場與顯示頁面分離

- **WHEN** 使用者只開啟數檔圖表但提交選股
- **THEN** 服務 MUST 處理完整母體，每檔恰有一筆組合判定，分頁只作用於完成判定後的集合

#### Scenario: 新上市、停牌及市場轉換

- **WHEN** 官方名冊新增股票、股票暫停交易但未下市櫃，或商品轉換上市櫃市場
- **THEN** 系統 MUST 依生效日期維持正確母體與單一商品識別，前期無可比較資料者保留 unknown 原因，不靜默刪除或重複計入

#### Scenario: 名冊分類或完整性不可證明

- **WHEN** 官方名冊缺失、解析失敗或無法確定普通股分類
- **THEN** 服務 MUST 標示母體不完整或不可用，不以現有快取商品數宣稱已完整篩選市場

### Requirement: 正式來源必須具備可稽核的欄位與使用範圍

來源啟用前 MUST 記錄官方入口、允許自動存取／保存／展示的使用依據、必要顯名、精確欄位、單位、交易範圍、日期、更新頻率與歷史可得性。每筆底稿 MUST 保留 provider、source date、擷取／可得發布資訊、正規化版本與完整性識別。系統 MUST NOT 規避 CAPTCHA、登入或速率限制，亦不得把可瀏覽頁面視為已授權自動歷史 API。

#### Scenario: 來源只有最新一期

- **WHEN** 新啟用來源只能取得本期，而前一交易日或前一週不存在
- **THEN** 服務 MUST 先尋找可驗證的合法既有資料或核准補法，否則回 bootstrap pending／unknown，等待自然累積，不偽造前期

#### Scenario: 來源單位或交易範圍改變

- **WHEN** 本期與前期的 volume 欄位定義、單位或交易範圍不相容
- **THEN** 服務 MUST 拒絕直接比值並回 `incomparable_source`，直到通過明確版本化正規化驗證

### Requirement: 日資料必須固定為已完成且正式公布的相鄰交易日

需要日量條件的查詢快照 MUST 固定日比較 D／P，並保存官方日曆版本、預期交易日與實際已公布日。D MUST 是可驗證、已完成且兩市場同錨點的正式日資料，P MUST 是適用的前一官方交易日；MUST NOT 使用瀏覽器日曆昨日、盤中累計量、估量或最近兩筆任意跳期資料。

#### Scenario: 週末、假日或臨時休市

- **WHEN** 查詢日期不是交易日，或前一天休市
- **THEN** 服務 MUST 依官方日曆使用正確 D／P；日曆衝突或未涵蓋時標示不可判定，不假定週一至週五均交易

#### Scenario: 其中一個市場尚未公布

- **WHEN** 上市與上櫃官方日資料日期不同
- **THEN** 系統 MUST 不將兩種 D 混成一份最新結果，而須保留明示日期的上一個共同快照並顯示等待新資料

#### Scenario: 個別商品缺少 D 或 P

- **WHEN** 母體商品沒有快照指定日期的合法成交量
- **THEN** 對該商品的日量條件 MUST 回 unknown 與缺漏日期，不向前跳到任意有值日期

### Requirement: 成交量倍數必須精確比較且保留零量語意

成交量條件 MUST 定義為 `V(D) >= multiplier × V(P)` 且 `V(P) > 0`，預設 multiplier 為 3。運算 MUST 使用合法非負精確量與十進位門檻，避免先四捨五入比值；原始股數與主圖 canonical 張數 MUST 有明確單位界線，MUST NOT 重複換算或使用 provider 未核對定義的 `volume_ratio`。

#### Scenario: 恰好三倍與略低於三倍

- **WHEN** P 為 1,000 股，D 分別為 3,000 股與 2,999 股，門檻為 3
- **THEN** 前者 MUST pass，後者 MUST fail，即使顯示後的倍數都可能是 3.00

#### Scenario: 前期零量與合法當日零量

- **WHEN** P 為零或未知，或 D 為正式零量且 P 大於零
- **THEN** P 為零／未知者 MUST unknown，不以無限大或 `0 >= 0` 判定通過；D 零量且 P 正值者 MUST fail

### Requirement: 大戶週增必須使用完整 TDCC 的相鄰官方週期

千張大戶 MUST 定義為 TDCC 第 15 級「1,000,001 股以上」，使用完整且對帳有效的 1–15 級、調整與合計資料中的占集保庫存數比例。週增 MUST 為 W 比例減 Wprev 比例，W 為最新已公布官方週期、Wprev 為其前一官方週期，預設門檻至少 0.2 個百分點。MUST NOT 改用相對成長率、持有人數變化、已發行股數分母、盤中推估或跨過缺週比較。

#### Scenario: 百分點邊界

- **WHEN** 前週比例 60.00%，本週分別為 60.20%、60.19% 與 60.12%，門檻為 0.2 個百分點
- **THEN** 三者 MUST 依序 pass、fail、fail，不因浮點誤差或相對成長 0.2% 改變結果

#### Scenario: 缺前週但更早一週存在

- **WHEN** W 有值、Wprev 缺值，而較早週有值
- **THEN** 大戶條件 MUST unknown，不得用較早週、forward-fill 或零值替代 Wprev

#### Scenario: 級距不完整或缺本週

- **WHEN** 商品只有第 15 級，但完整級距對帳失敗，或快照指定 W 缺值
- **THEN** 對該商品 MUST 回 unknown 及安全原因，不改用該商品其他週資料或僅依第 15 級存在宣稱有效

#### Scenario: 官方歷史表格省略零差異調整列

- **WHEN** TDCC 官方歷史表格完整提供順序正確的 1–15 級及合計，但省略差異調整列
- **THEN** adapter MUST 以精確整數核對十五級股數及人數分別完全等於官方合計，並驗證各級官方比例，才能將「由完整合計證明為零」的調整項正規化為第 16 級
- **AND** MUST 保留官方表格格式與正規化依據；缺任何持股級距、股數差異非零、精度失真或合計不明時仍為 unknown，不得任意補零

### Requirement: 條件組合必須遵循三態邏輯並提供守恆計數

每個啟用條件 MUST 產生 pass、fail 或 unknown。`all` MUST 在任一 fail 時為 fail、全部 pass 時為 pass，其餘 unknown；`any` MUST 在任一 pass 時為 pass、全部 fail 時為 fail，其餘 unknown。未啟用條件 MUST 不參與判定。計數 MUST 滿足 `matched + notMatched + unknown = total`、`evaluated = matched + notMatched`，且每檔都已處理；逐條件缺漏數須獨立提供，不能當成互斥總數直接相加。

#### Scenario: 含未知的 AND 與 OR

- **WHEN** 兩條件分別是 pass／unknown 或 fail／unknown
- **THEN** pass／unknown 在 all 下 MUST unknown、any 下 MUST pass；fail／unknown 在 all 下 MUST fail、any 下 MUST unknown
- **AND** 另一條件的缺漏資訊 MUST 保留，不因組合已確定就偽造成合法零值

#### Scenario: 停用資料不足的條件

- **WHEN** 使用者停用尚未有完整資料的 TDCC 條件
- **THEN** 已具完整兩日量的商品 MUST 正常判定，TDCC 的不足不得污染成交量篩選狀態

#### Scenario: 只使用大戶條件且日量底稿未就緒

- **WHEN** 使用者只啟用大戶條件而日量尚未準備好
- **THEN** 服務 MUST 對已有完整相鄰兩週資料的商品正常判定；D／P 可以為 null 並標示未提供，不因未啟用資料族群阻止快照或查詢

### Requirement: 全市場底稿必須與個人回補佇列隔離並可恢復

底稿 MUST 存在 repo 外的本機 D1，使用獨立 universe、日量、週摘要、run 與快照資料；資料準備 MUST 以官方批次為主，僅補必要比較期間。不得把全母體加入個人清單、既有 active targets 或一年歷史回補佇列。更新 MUST 使用 lease、checkpoint、single-flight、有界併發／timeout／retry，source row 修訂須可追溯。

#### Scenario: 首次建立全市場選股

- **WHEN** 選股資料初始化
- **THEN** 系統 MUST 盤點兩日與兩週所需覆蓋，只補所需日期，既有自選清單及 TDCC 長歷史工作數不得因母體加入而成比例增加

#### Scenario: 中斷、休眠或錯過更新窗口

- **WHEN** 更新因網路、來源限制或本機休眠中斷
- **THEN** 已驗證資料與 checkpoint MUST 保留，恢復後只處理未完成工作且維持有界重試，不重啟行情服務或建立全市場 broker 訂閱

#### Scenario: 單檔錯列與較新稀疏回應

- **WHEN** 來源某檔不合法，或較新的回應較既有底稿稀疏
- **THEN** 系統 MUST 隔離受影響商品與原因，保留其他合法資料及最後已驗證版本，不把未知寫成零、不清空整個已驗證集合

### Requirement: 選股 API 必須是本機限定的有界唯讀查詢

選股 status／results API MUST 只從本機底稿查詢，主介面以固定 loopback allowlist 的同源 GET 路徑存取。條件、數值、排序、cursor、頁大小、path 與 method MUST 受固定 schema 驗證；每頁最多 100 筆。查詢 MUST NOT 觸發 provider 抓取、全市場 Kbars／Snapshot、帳務、委託或 runtime 管理；底稿可用時 MUST 不依賴 Shioaji session。hosted target MUST 不啟用此本機路由。

#### Scenario: 重複篩選與翻頁

- **WHEN** 使用者反覆提交合法條件或翻頁
- **THEN** 服務 MUST 只查詢既有底稿，不新增外部來源請求、訂閱或 backfill dispatch

#### Scenario: 惡意參數或錯誤方法

- **WHEN** 請求包含未知 path、寫入 method、任意 upstream URL、未列名排序、過量 page size 或無效門檻
- **THEN** 服務 MUST 有界拒絕且不轉送至 Shioaji、管理端或外網，不回傳秘密與內部 stack

### Requirement: 查詢快照必須固定條件版本與資料版本

每份結果 MUST 包含 `snapshotId`、名冊版本、公式版本、條件指紋、比較日期、計數、來源狀態及生成時間；同一 cursor MUST 綁定相同版本、條件與排序。底稿更新 MUST 在 staging 處理完整母體後原子發布新版本，保留較舊快照的真實日期；原始列缺失不可包裝成全資料 ready。

#### Scenario: 有效查詢跨越快照發布

- **WHEN** 使用者讀下一頁時已有較新快照
- **THEN** 服務 MUST 使用 cursor 原快照，或在原快照不存在時回 `snapshot_expired`，不靜默替換資料集合

#### Scenario: 只有部分來源就緒

- **WHEN** 已處理全母體但啟用條件仍有未發布／缺漏的來源資料
- **THEN** 回應 MUST 呈現 partial／pending 及逐條件缺口，不因 processed 等於 total 或 HTTP 200 宣稱所有資料完整

### Requirement: 正式驗收必須證明覆蓋與不影響既有服務

驗收 MUST 保存非敏感名冊／來源／公式版本、實際 D／P／W／Wprev、每市場母體與處理數、符合／不符合／unknown、逐條件缺漏原因及結果 hash。首次兩期 bootstrap 或來源 mapping 未通過時 MUST 保留對應任務未完成；合法新股無前期或前量為零可為已解釋的 unknown。測試 MUST 證明自選清單、TDCC 既有回補、交易路由與 simulation runtime 未被選股操作改寫。

#### Scenario: 宣告完成全市場驗收

- **WHEN** 實作準備標記完成
- **THEN** 證據 MUST 同時包含完整母體守恆、上市與上櫃代表商品、未加入清單且非排行前百名的案例、無未解釋來源缺口，以及實際 UI 點選 K 線成功
- **AND** 僅 fixture 成功、全域成功時間或來源目錄存在 MUST NOT 代替上述證據
