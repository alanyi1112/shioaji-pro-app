# codex-sites-rewrite Specification

## Purpose
TBD - created by archiving change rewrite-quote-chart-for-codex-sites. Update Purpose after archive.
## Requirements
### Requirement: Sites 完整執行環境

系統 MUST 在 Codex Sites／Cloudflare Workers 相容 runtime 中提供首頁、靜態資產、同源 API、即時資料與持久化，不得把既有 Render 站當作正式依賴。

#### Scenario: 正式站獨立運作

- **WHEN** 使用者開啟 Codex Sites 正式網址
- **THEN** 首頁與 `/api/health` 皆由 Sites deployment 回應
- **AND** 圖表資料請求不會導向既有 Render 網域

### Requirement: 多圖功能 parity

系統 MUST 保留來源產品的 1／2／3／4／6／8 圖、多市場頁籤、分類分頁、雙擊新分頁單圖、主副圖指標、價格資訊與 Fixed Range Volume Profile 行為。多圖中的 panel MUST 以雙擊開啟同源的新分頁單圖，不得在原分頁切換為聚焦單圖；開啟後正確商品的 panel 與 K 線 MUST 在首次載入顯示，不得因非關鍵設定請求或原頁即時長連線占用而長時間只呈現空白網站框架。`view=single` 的商品與週期鎖定 MUST 只適用於目前 1 圖生命週期；當使用者切換至多圖時，所有 panel MUST 依目前頁籤與分類頁的 canonical 商品切片建立，且不得讓 single-view 商品持續佔用第一個 panel。台股市場頁籤若含 allowlist 內的台灣市場基準指數，該指數 MUST NOT 封鎖同頁 eligible 台股商品在 1／2／3／4 圖使用多層副圖，但指數自身 panel MUST 不建立籌碼資料生命週期。

#### Scenario: 使用者切換圖表數量

- **WHEN** 使用者選擇 1、2、3、4、6 或 8 張圖
- **THEN** 系統顯示對應數量的圖表面板
- **AND** 每個面板能載入所選商品與週期的 K 線及指標
- **AND** 若目前是 `view=single` 1 圖頁面且使用者切換至多圖，系統 MUST 先將 deep-link 商品換算到新圖表數量對應的分類頁，再以該頁的 canonical 商品切片建立所有 panel
- **AND** 切換至多圖後，第一個 panel MUST NOT 因舊 single-view state 重複顯示 deep-link 商品

#### Scenario: 台股市場指數與台股商品共存

- **WHEN** 「台股」頁籤的 visible symbol slice 同時包含 allowlist 內的 `^TWII` 與 `.TW`／`.TWO` 商品，且圖表數量為 1、2、3 或 4
- **THEN** 多層副圖選項 MUST 可選
- **AND** `^TWII` panel MUST 採單一技術副圖且不得建立籌碼 pane
- **AND** `.TW`／`.TWO` panel MUST 依使用者保存狀態採多層副圖

#### Scenario: 6／8 圖固定單一副圖

- **WHEN** 使用者選擇 6 或 8 張圖
- **THEN** 系統 MUST 使用單一副圖模式
- **AND** 主圖與多層副圖選項 MUST 不可選取
- **AND** 切換至 6／8 圖時不得啟用多層副圖的頁面捲動、controller 或資料生命週期
- **AND** 使用者切回 1、2、3 或 4 張圖後，系統 MUST 恢復切換前保存的主副圖偏好

#### Scenario: 多圖分類頁切換不重複第一個商品

- **WHEN** 使用者在 2、3、4、6 或 8 圖模式按下一頁或上一頁
- **THEN** 系統 MUST 依目前頁籤、圖表數量與頁碼切換完整的 visible symbol slice
- **AND** 每個 panel 的 canonical symbol MUST 與該 slice 的同位置商品一致
- **AND** 第一個 panel MUST NOT 固定保留先前單圖 URL 的商品

#### Scenario: 單圖商品正確換算多圖頁碼

- **WHEN** 有效 `view=single` URL 的商品位於頁籤商品清單中的 index N，且使用者切換至 page size S 的多圖模式
- **THEN** 系統 MUST 以 `floor(N / S)` 作為該商品所在的分類頁 index
- **AND** 該頁 MUST 顯示包含該商品的 canonical slice，不得把商品 index N 直接當成 page index

#### Scenario: 雙擊多圖中的商品 panel

- **WHEN** 使用者在多圖工作區雙擊某個非互動控制區的商品 panel
- **THEN** 系統 MUST 在新瀏覽器分頁開啟該商品的 1 圖畫面
- **AND** 新分頁 MUST 保留該 panel 的 canonical symbol、interval 與 tab 識別
- **AND** 原頁 MAY 短暫暫停既有 panel 即時串流以釋放同源連線容量，但 MUST 自動恢復
- **AND** 原分頁的圖表數量、商品順序、頁碼、捲動位置、visible range 與副圖狀態 MUST 保持不變

#### Scenario: 新分頁重新載入單圖 URL

- **WHEN** 使用者重新載入含有效 `view=single`、`symbol`、`interval` 與 `tab` query 的同源 URL
- **THEN** 該頁 MUST 仍以指定商品與週期顯示 1 圖
- **AND** 必要商品目錄請求與 panel 建立 MUST NOT 等待非關鍵 app config 完成
- **AND** page-scoped 的 1 圖狀態 MUST NOT 把共用圖表數量偏好覆寫為 1
- **AND** 無效或不存在的 query 值 MUST 經 allowlist／商品目錄驗證後安全 fallback，不得載入任意商品或造成初始化失敗

#### Scenario: 離開單圖 URL 後不殘留 single-view state

- **WHEN** 使用者在有效 `view=single` URL 中將圖表數量由 1 改為 2、3、4、6 或 8
- **THEN** 系統 MUST 清除只屬於單圖的 page-scoped 商品／週期鎖定
- **AND** 後續分類頁切換 MUST 使用一般多圖分頁狀態
- **AND** 目前網址 MUST 不再保留會讓重新載入回到單圖模式的 `view=single` query

#### Scenario: 新分頁與原分頁隔離

- **WHEN** 雙擊手勢成功觸發新分頁
- **THEN** 系統 MUST 使用 `noopener`，新分頁不得取得可操作原分頁的 `window.opener`
- **AND** 本次手勢 MUST NOT 同時觸發原分頁聚焦模式、圖表數量持久化或第二個新分頁
- **AND** 即使新分頁遭瀏覽器阻擋，原頁被暫停的即時串流 MUST 在有限時間內恢復

### Requirement: Workers 市場資料與指標
系統 MUST 以 Workers 相容方式取得 Yahoo Chart、Hyperliquid 或 sample 行情，並以 TypeScript 產生既有前端需要的指標 payload。指標 payload MUST 支援經驗證的全域副圖參數，其中 RSI 預設為 5／10 Wilder 雙序列，KD 預設為 9／3／3 且 K、D 初始值為 50；candles 與 stream MUST 使用相同參數與公式。

#### Scenario: 讀取台股日 K
- **WHEN** 前端請求 `/api/candles?symbol=2330.TW&interval=1d`
- **THEN** API 回傳 K 線、quoteTime、quote、marketSession、indicators 與 dataWindow
- **AND** indicators MUST 包含 RSI 雙序列、KD、MACD、ATR 與本次使用的正規化參數
- **AND** 不暴露上游秘密或內部錯誤細節

#### Scenario: 以自訂副圖參數讀取 K 線與 stream
- **WHEN** 前端以合法 RSI、KD、MACD 或 ATR query 參數請求 `/api/candles` 或 `/api/stream`
- **THEN** Worker MUST 以同一份正規化設定計算回傳 indicators
- **AND** candle payload cache MUST 區分不同設定簽章

#### Scenario: Massive 維持免費方案
- **WHEN** Massive 免費方案不包含特定指數、外匯或期貨資料
- **THEN** 系統 MUST 維持 `unverified`
- **AND** 系統 MUST 顯示安全且可診斷的 entitlement 原因
- **AND** 完成條件 MUST NOT 要求升級 Massive 付費方案

### Requirement: 使用者清單持久化

系統 MUST 使用 Sites D1 保存使用者自訂頁籤與商品清單，並以 Sites 伺服器端使用者識別隔離資料。每個新加入的台股商品 MUST 同時保存伺服器判定的 `addedAt`、可選 `recommender` 及加入紀錄識別碼；既有項目缺少可信加入日期時 MUST 以 nullable 欄位與 `legacy_unknown` 向後相容，不得偽造日期。系統 MUST NOT 因這些 metadata 建立投資報酬、報酬率、理論上下限或績效追蹤資料。

#### Scenario: 儲存個人頁籤
- **WHEN** 已識別使用者新增或修改個人頁籤
- **THEN** 重新載入頁面後 MUST 取得該使用者保存的資料
- **AND** 其他使用者不得讀取或寫入這些內容

#### Scenario: 儲存新加入商品的 metadata
- **WHEN** 已識別使用者在個人頁籤加入台股商品並填寫推薦人
- **THEN** D1 MUST 原子保存商品、伺服器加入日期、推薦人及加入紀錄識別碼
- **AND** 重新載入或從另一裝置登入後 MUST 顯示相同資料

#### Scenario: migration 遇到既有商品
- **WHEN** D1 既有清單項目沒有 `addedAt`
- **THEN** migration MUST 保留該項目並設定 `addedAt=null` 與 `legacy_unknown`
- **AND** MUST NOT 使用 migration 執行日、檔案時間或最後修改日冒充加入日期

#### Scenario: 刪除後重新加入
- **WHEN** 使用者刪除某商品後再次加入
- **THEN** 系統 MUST 建立新的加入紀錄識別碼及新的伺服器加入日期
- **AND** MUST NOT 恢復前一筆已刪除紀錄的 metadata

#### Scenario: 不建立績效資料
- **WHEN** 系統保存、讀取或更新清單商品的加入日期與推薦人
- **THEN** D1 與 API MUST NOT 建立績效結果、交易日窗口或投資報酬欄位
- **AND** 前端 MUST NOT 因 metadata 變更觸發價格追蹤計算

### Requirement: 台股官方第二來源核對必須保守且一致

系統 MUST 只對 `.TW` 與 `.TWO` 的已完成日 K 進行官方第二來源核對；`.TW` MUST 優先使用可依日期取得同日一般交易收盤行情的 TWSE 官方資料，`.TWO` 使用 TPEx，先對齊官方交易日再比較收盤價，且 candles 與 stream MUST 回傳一致的市場階段、來源時間與核對結果。盤中日 K MUST 標示為不適用收盤核對，不得顯示成核對失敗。

#### Scenario: 台股盤中日 K 不進行收盤核對

- **WHEN** 主來源回傳台股當日尚未完成的日 K
- **THEN** `quote.kind` MUST 為 `intraday`
- **AND** `quote.verification.status` MUST 為 `not_applicable`
- **AND** 系統 MUST NOT 呼叫 TWSE、TPEx、TWSE MIS 或 TPEx mirror 收盤資料

#### Scenario: 官方交易日與收盤價一致

- **WHEN** 主來源報價為已完成日 K
- **AND** 主來源與官方第二來源的 `sessionDate` 相同
- **AND** 兩者收盤價依官方資料精度正規化後相同
- **THEN** `quote.verification.status` MUST 為 `verified`
- **AND** API MUST 回傳實際解析出的 `referenceSessionDate` 與 `checkedAt`
- **AND** 前端 MUST 明確顯示「已核對」

#### Scenario: 上市商品取得 TWSE 同日收盤行情

- **WHEN** `.TW` 主來源報價為已完成日 K
- **AND** TWSE 日期指定的 `MI_INDEX` 已發布相同 `sessionDate`
- **THEN** 系統 MUST 從同時含有「證券代號」與「收盤價」欄位的 table 尋找商品
- **AND** 系統 MUST 依欄位名稱定位資料，不得依賴固定 table index 或固定欄位順序
- **AND** 只有官方回傳日期、證券代號與主來源交易日均一致時才能比較收盤價

#### Scenario: 官方資料尚未發布目標交易日

- **WHEN** 主來源報價已轉為已完成日 K
- **AND** 官方第二來源交易日早於主來源 `sessionDate`
- **THEN** 核對狀態 MUST 為 `pending`
- **AND** reason MUST 為 `reference_not_published`
- **AND** 系統 MUST NOT 將此情況標示為「未驗證」或價格不一致

#### Scenario: TWSE 同日端點明確尚未發布

- **WHEN** `.TW` 已完成日 K 查詢 TWSE 日期指定的同日資料
- **AND** 官方回覆目標日期尚無資料或沒有目標日期的有效 table
- **THEN** 核對狀態 MUST 為 `pending`
- **AND** reason MUST 為 `reference_not_published`
- **AND** 系統 MUST NOT 將正常產製延遲視為 provider failure

#### Scenario: TWSE 同日端點真正失敗

- **WHEN** `.TW` 已完成日 K 的 TWSE 同日端點發生連線、HTTP 或無法安全解析的格式錯誤
- **THEN** 系統 MAY 使用 TWSE MIS 的 `tse` 行情作保守 fallback
- **AND** MIS 失敗時 MAY 再使用既有 `STOCK_DAY_ALL`
- **AND** 所有 fallback 仍 MUST 先對齊交易日再比較收盤價
- **AND** provider MUST 明確反映實際完成核對的官方來源

#### Scenario: 官方商品沒有可比較的收盤價

- **WHEN** 同交易日官方商品的收盤價為 `--`、空值、非有限數值或其他無成交標記
- **THEN** 系統 MUST NOT 產生 `mismatch`
- **AND** 核對結果 MUST 使用安全且可診斷的 `unverified` reason

#### Scenario: 多個上市面板查詢同一交易日

- **WHEN** 多個 `.TW` 面板同時核對相同 `sessionDate`
- **THEN** 系統 MUST 共用同一個全市場請求或 inflight promise
- **AND** 成功結果與尚未發布結果 MUST 使用有界快取，避免每個面板重複呼叫官方端點

#### Scenario: TPEx 官方網域無法由 Sites Worker 存取

- **WHEN** `.TWO` 已完成日 K 的 TPEx 官方端點在 Codex Sites runtime 回應失敗
- **THEN** 系統 MAY 使用 TWSE 官方 MIS 的 `otc` 行情作為保守 fallback
- **AND** provider MUST 明確標示為 `twse-mis`
- **AND** fallback 仍 MUST 先對齊交易日再比較收盤價

#### Scenario: Sites 使用獨立 TPEx 官方資料鏡像

- **WHEN** Sites runtime 無法直接存取 TPEx 與 TWSE MIS
- **THEN** private GitHub Actions MAY 定期抓取並驗證 TPEx 官方全市場收盤資料後寫入 Sites D1
- **AND** 寫入請求 MUST 同時通過 Sites bypass token 與獨立 ingest secret
- **AND** D1 payload MUST 驗證單一官方日期、至少 500 筆有效代號與有限收盤價
- **AND** provider MUST 標示為 `tpex-mirror`
- **AND** 只有鏡像交易日與主來源相同且收盤價一致時才能標示 `verified`
- **AND** 此流程 MUST NOT 依賴 Render 服務

#### Scenario: candles 與 stream 讀取同一商品

- **WHEN** `/api/candles` 與 `/api/stream` 讀取相同台股商品與日 K
- **THEN** 兩者 MUST 共用相同的正規化與核對流程
- **AND** 兩者 MUST 回傳相同的 `marketPhase`、`kind`、`verification`、來源與最後有效交易日

### Requirement: 台股官方全市場資料必須受快取與併發保護

系統 MUST 對 TWSE 與 TPEx 全市場官方回應分別使用短期快取與 single-flight，不得為同批多圖中的每個商品重複下載完整市場資料。

#### Scenario: 多個台股 panel 同時核對

- **WHEN** 多個 `.TW` 或 `.TWO` panel 在快取有效期間同時載入
- **THEN** 同一官方市場 MUST 只產生一個進行中的全市場請求
- **AND** 後續商品 MUST 重用該回應

### Requirement: 台股占位資料與驗證狀態必須可診斷

系統 MUST 在指標與報價計算前排除符合零量、OHLC 平盤及前收相同條件的台股日 K，並公開中性 `dataQuality` metadata 與保守驗證狀態。

#### Scenario: 排除零量平盤占位 K

- **WHEN** 台股日 K 尾端含有符合條件的占位資料
- **THEN** candles、indicators、quote 與 stream MUST 使用最後有效交易日
- **AND** `dataQuality.ignoredSessionDates` MUST 列出被忽略日期
- **AND** reason MUST 使用 `zero_volume_flat_carry_forward`

#### Scenario: 核對失敗或資料過期

- **WHEN** 第二來源無法核對或只能使用過期 cache
- **THEN** 前端 MUST 分別顯示「未驗證」或「資料過期」
- **AND** API MUST 使用安全原因碼，不得回傳官方原始收盤價、秘密或完整上游錯誤內容

### Requirement: Codex Sites 部署驗收

系統 MUST 在成功建置、API smoke 與核心互動驗證後才建立並部署 Sites 版本。

#### Scenario: 部署成功

- **WHEN** Sites deployment 狀態為 `succeeded`
- **THEN** 回報正式網址
- **AND** 以正式網址確認首頁與 `/api/health` 可用

### Requirement: Sites 台股個股籌碼資料鏈

系統 MUST 在 Codex Sites／Cloudflare Workers 相容 runtime 中，依資料族群提供台股普通股與 ETF 的日頻籌碼、TDCC 週頻股權分散、D1 快取與副圖資料，不得把既有 Render 站作正式依賴，也不得由瀏覽器直接攜帶上游 token。

#### Scenario: Sites Worker 取得普通股籌碼
- **WHEN** 正式站請求 eligible `.TW` 或 `.TWO` 普通股的日頻籌碼
- **THEN** 同源 Worker API 從 D1 或允許介接的上游回傳正規化資料
- **AND** response 不導向 Render、不暴露 token 或內部錯誤

#### Scenario: Sites Worker 取得 ETF 籌碼
- **WHEN** 正式站請求商品目錄確認為 TWSE／TPEx ETF 的日頻籌碼或 TDCC 週頻股權分散
- **THEN** 同源 Worker API MUST 逐 dataset 回傳 eligibility、availability、來源及可用資料
- **AND** 某 dataset 無資料時不得拒絕同一 ETF 的其他可用 dataset

#### Scenario: D1 或特定來源暫時不可用
- **WHEN** 某資料族群無法讀取或更新
- **THEN** 其他 K 線、技術指標、清單及可用籌碼族群 MUST 繼續運作
- **AND** 籌碼 API 回傳安全的局部失敗狀態

### Requirement: 多圖籌碼請求必須受快取與併發保護

系統 MUST 讓多個 panel、同一 panel 的多個籌碼 pane，以及多層副圖下一頁預載共用相同 symbol、dataset 與日期範圍的 D1 資料、完成 response cache 及 single-flight，不得因 1／2／3／4／6／8 圖、方式 B 同時顯示或背景預載而逐 panel、逐 pane 重複抓取相同上游資料。

#### Scenario: 八個 panel 含重複台股 symbol
- **WHEN** 八圖模式中多個 panel 同時選取相同普通股與籌碼族群
- **THEN** 相同缺口最多產生一個上游請求
- **AND** 各 panel 取得一致的 rows、來源與資料日期

#### Scenario: 多層副圖背景預取下一頁商品
- **WHEN** 現有 K 線背景預取完成下一頁 eligible 台股商品，且 effective presentation mode 為多層副圖
- **THEN** 系統 MUST 只為每檔商品已選 pane 所需的去重 datasets 建立一個 bounded chip prefetch request
- **AND** 相同 request identity 的前景 panel、其他 panel 與背景 job MUST 共用完成 cache 或 in-flight request
- **AND** 未選取 dataset、單一副圖、非日 K、非合格台股或 6／8 圖 MUST NOT 自動觸發籌碼預載或籌碼歷史回補

#### Scenario: 多個 panel 使用同一 TDCC 週快照
- **WHEN** 多個 panel 同時顯示相同或不同個股的大戶／散戶副圖
- **THEN** Worker MUST 從同一份 D1 全市場週快照提供各 symbol 資料
- **AND** MUST NOT 逐 panel、逐 symbol 重複下載 TDCC 全市場資料

#### Scenario: 同一 panel 的多個 pane 共用 dataset
- **WHEN** 方式 B 同時顯示外資、投信、自營商及三大法人合計四個 pane
- **THEN** 四個 pane MUST 共用同一份 `institutional-flow` response 與 D1 查詢結果
- **AND** MUST NOT 為每個 pane 分別呼叫相同上游

### Requirement: 台股個股籌碼正式部署驗收

系統 MUST 在 build、測試、migration 檢查與 OpenSpec strict validation 通過後才部署籌碼與主副圖模式功能，並 MUST 以已登入 Codex Sites 正式站驗證三模式、上市／上櫃代表普通股與 ETF 的可見副圖及 API。正式 HTML MUST 引用本次發布的最新 `app.js` 與 `styles.css` cache-buster，不得以瀏覽器舊資產作為驗收結果。

#### Scenario: 正式站普通股與三模式驗收
- **WHEN** 新版本成功部署至 owner-only Codex Site
- **THEN** 驗收至少涵蓋一檔 `.TW` 與一檔 `.TWO` 普通股的法人、外資持股、融資融券、可用借券及大戶／散戶資料
- **AND** 確認 1／2／3／4／6／8 圖的主圖、方式 A、方式 B，主圖模式副圖列收合且無不可見籌碼 request，方式 B 使用 document scroll
- **AND** 確認三模式切換不重新請求主 candles，並保留技術副圖、籌碼選取、series 與群組順序
- **AND** 確認多圖 panel 雙擊會在新分頁顯示正確商品的 1 圖，且原分頁狀態不變
- **AND** 確認台股單一商品頁三模式皆可用，資格只依目標商品判斷

#### Scenario: 正式站非台股與混合頁籤驗收
- **WHEN** 正式站載入非台股單一商品、非台股頁籤或台股與非台股混合頁籤
- **THEN** 主副圖下拉選單 MUST 保持可操作，主圖與單一副圖 MUST 可切換，多層副圖 MUST disabled
- **AND** 主圖模式 MUST 收合副圖並停止不可見副圖 lifecycle，單一副圖 MUST 保留既有技術副圖行為
- **AND** 返回 eligible 台股後 MUST 恢復先前保存的 multi 偏好與 pane 狀態

#### Scenario: 正式站 ETF 驗收
- **WHEN** 正式站載入至少一檔上市 ETF 及一檔可用的上櫃 ETF
- **THEN** 每個可用 dataset MUST 顯示真實資料，不可用 dataset MUST 顯示獨立原因
- **AND** 大戶／散戶 MUST 標示 TDCC 週資料、比例線、週變化柱與實際資料日期

#### Scenario: 正式站不適用與容錯驗收
- **WHEN** 驗收人員切換到主圖模式、非日 K、非台股商品、缺欄位或模擬來源失敗
- **THEN** 畫面 MUST 顯示正確的主圖-only／不適用／部分／過期狀態
- **AND** K 線、既有主圖工具、其他 panel 與保存副圖偏好 MUST 不受影響
- **AND** console MUST 沒有未處理錯誤，頁面與 panel MUST 沒有非預期水平或內層垂直捲動

### Requirement: 折線十字準線交點保持緊湊

系統 MUST 將主圖價格折線、技術副圖折線及籌碼副圖折線的原生 crosshair marker 顯示為半徑 2 CSS px、邊框 1 CSS px 的小型圓點，使圓點只略大於 1–2 CSS px 折線且不大面積遮蔽 K 棒、其他折線或讀值。系統 MUST 保留各 series 顏色、既有 marker 顯示條件、費波那契選點期間隱藏行為與跨 pane 十字準線同步。

#### Scenario: 共用十字準線穿過多條主副圖折線

- **WHEN** 使用者將十字準線移至同時具有主圖價格折線、技術副圖折線及籌碼副圖折線資料的日期
- **THEN** 每條可見折線的交點 marker MUST 使用 2 CSS px 半徑與 1 CSS px 邊框
- **AND** marker MUST 保留所屬 series 顏色且不得改變折線線寬、資料或十字準線 X 座標同步
- **AND** 多個 marker 靠近或重疊時 MUST 比原生預設大型圓點少遮蔽底層資訊

#### Scenario: 費波那契選點暫時隱藏主圖 marker

- **WHEN** 使用者正在選取費波那契回撤或拓展錨點
- **THEN** 主圖價格折線 marker MUST 依既有規則暫時隱藏
- **AND** 選點結束或取消後恢復的 marker MUST 維持 2 CSS px 半徑與 1 CSS px 邊框

### Requirement: Workers Pivot Point 必須採 lazy 且一致的資料 contract

系統 MUST 只在合法 Pivot query 已啟用時取得必要高週期參考資料並回傳 `indicators.pivot_points`。`/api/candles`、`/api/stream`、single-flight 與 candle payload cache MUST 使用相同正規化 Pivot mode；Pivot 未啟用時 MUST 維持既有 candle payload 行為，且不得增加高週期上游請求。

#### Scenario: 未啟用 Pivot 維持既有請求成本

- **WHEN** `/api/candles` 或 `/api/stream` 未提供合法 Pivot mode
- **THEN** Worker MUST 不為 Pivot 額外取得日、週或月參考行情
- **AND** 既有 K 線、RSI、KD、MACD、ATR、Bollinger、Volume Profile 與其他 payload MUST 維持相容

#### Scenario: 啟用 Pivot 區分 cache identity

- **WHEN** 相同商品、週期與 display count 分別以停用及 `pivot=traditional` 要求 candles
- **THEN** candle payload cache MUST 將兩者視為不同 identity
- **AND** 啟用版本 MUST 包含正規化 type、reference interval、status 與七組 Pivot 序列

#### Scenario: candles 與 stream 使用相同 Pivot

- **WHEN** 前端以 `pivot=traditional` 建立 candle request 與 EventSource stream
- **THEN** 初始 candle payload、stream snapshot 與後續更新 MUST 使用相同參考週期及 Traditional 公式
- **AND** 同一有效 period 內即時報價更新 MUST NOT 改變 Pivot 水準

#### Scenario: Pivot 參考資料失敗時隔離錯誤

- **WHEN** Pivot 所需高週期參考資料暫時無法取得
- **THEN** Worker MUST 將 Pivot 標示為 unavailable 或回傳缺值
- **AND** 既有 candles 與其他指標 MUST 仍可正常回應
- **AND** response MUST 不洩漏上游 body、秘密、內部 URL 或例外細節

### Requirement: Sites 多圖即時更新必須頁面級有界

Sites 保留站 MUST 將目前可見的 1／2／3／4／6／8 個 panel 合併為頁面級有界更新，不得讓每個 panel 維持獨立且無限期占用的同源長連線。更新協調器 MUST 在新 panel 加入、分頁返回前景或網路恢復時立即安排 fresh batch，並在休市、背景分頁或離線時降低頻率或暫停。

#### Scenario: 八圖頁面首次載入

- **WHEN** 使用者開啟或切換到含八個可見商品的 Sites 頁籤
- **THEN** 八個 panel MUST 在完成初始載入後加入同一頁面級更新協調器
- **AND** 新加入的 panel MUST 立即納入下一個 batch，不得等待既有長週期 timer
- **AND** 系統 MUST NOT 為八個 panel 建立八條無限期 `EventSource`

#### Scenario: 部分 panel 較晚完成初始載入

- **WHEN** 第一個 batch 執行期間仍有其他可見 panel 完成初始載入
- **THEN** 協調器 MUST 在目前 batch 結束後立即補跑一次
- **AND** 較晚加入的 panel MUST 不必等待一般盤中或休市輪詢間隔才取得 fresh payload
- **AND** 單一商品失敗 MUST NOT 清除其他 panel 的有效資料

#### Scenario: 背景分頁恢復

- **WHEN** Sites 頁面由 hidden 返回 visible，或瀏覽器由 offline 返回 online
- **THEN** 協調器 MUST 取代尚未到期的低頻 timer 並立即刷新目前可見 panel
- **AND** 更新 MUST 保留每個 panel 的商品、週期、指標參數與已載入資料

#### Scenario: 使用者切換頁籤或圖表數量

- **WHEN** panel 被銷毀、商品被替換，或使用者切換分類頁籤與圖表數量
- **THEN** 舊 panel MUST 取消其頁面級 subscription
- **AND** 後續 batch MUST 只包含目前仍有效且可見的 panel

#### Scenario: Sites 保留站正式驗收

- **WHEN** 修正版本部署到 Sites 保留站且台股盤中有新報價
- **THEN** 驗收 MUST 確認同一八圖頁面每個 panel 都顯示本交易日的新鮮 K 線與報價時間
- **AND** MUST 實際切換至少兩個八圖頁籤並確認沒有部分 panel 長時間停留在前一交易日

### Requirement: Cloudflare 正式站恢復受控的小型私人群組登入

Cloudflare 正式站 MUST 先驗證 Cloudflare Access JWT，再以私有 D1 `access_users` allowlist 授權人員；正規化 email 對應 `active owner` 或 `active member` 時 MUST 允許使用網站，未列名、inactive、JWT 無效或 D1 不可用時 MUST fail closed。Sites 保留站 MUST 維持既有獨立身分邊界。

#### Scenario: active owner 或 member 登入

- **WHEN** 有效 Access JWT 的正規化 email 對應 D1 中的 `active owner` 或 `active member`
- **THEN** Cloudflare 正式站 MUST 建立已授權使用者 principal 並允許存取一般應用功能
- **AND** MUST 以正規化 email 隔離該使用者的個人頁籤與商品清單

#### Scenario: 未列名、停用或無效身分登入

- **WHEN** Access JWT 無效、email 未列入 D1、記錄為 inactive，或 D1 授權查詢失敗
- **THEN** Cloudflare 正式站 MUST 拒絕存取
- **AND** MUST NOT 建立登入名單、個人頁籤或商品清單資料

### Requirement: owner 可以管理多人登入名單

Cloudflare 正式站 MUST 只向 `active owner` 提供登入名單管理介面與 API，可新增、修改、啟用、停用及刪除 `owner`／`member`；一般 member MUST 不得讀取完整名單或執行管理動作，且系統 MUST 始終保留至少一位 `active owner`。

#### Scenario: owner 新增或重新加入 member

- **WHEN** active owner 提交合法、正規化且尚未存在的 email 作為 active member
- **THEN** 系統 MUST 建立 allowlist 記錄並立即套用於後續登入
- **AND** MUST 保存不含 JWT、cookie、token 或其他秘密的私人稽核紀錄

#### Scenario: member 嘗試管理名單

- **WHEN** active member 呼叫登入名單讀取或寫入 API
- **THEN** 系統 MUST 回覆 `owner_required` 或等價拒絕結果
- **AND** MUST NOT 洩漏完整名單或修改任何記錄

#### Scenario: 嘗試移除最後一位 active owner

- **WHEN** 管理動作會使 active owner 數量變成零
- **THEN** 系統 MUST 以 `last_owner_required` 或等價結果拒絕
- **AND** 原 owner 記錄 MUST 保持不變

### Requirement: 相同登入信箱重新加入後沿用保留的個人資料

個人頁籤與商品清單 MUST 繼續以正規化登入 email 作為 `user_id`，不得改以新產生的 `access_users.id` 作為個人資料鍵。重新建立相同 email 的 allowlist 記錄時，系統 MUST 讀取既有個人資料，不得另建空白身分、跨 email 合併或重寫其他使用者資料。

#### Scenario: 先前成員以相同 email 重新加入

- **WHEN** owner 將先前刪除但仍保留個人資料的相同正規化 email 重新建立為 active member
- **THEN** 該成員重新登入後 MUST 看到原有個人頁籤與商品清單
- **AND** 系統 MUST NOT 變更其他使用者的個人資料

#### Scenario: 以不同 email 新增帳號

- **WHEN** owner 新增一個與既有個人資料 `user_id` 不同的 email
- **THEN** 系統 MUST 視為獨立使用者
- **AND** MUST NOT 自動移轉或合併舊 email 的個人資料

### Requirement: 多人登入不得啟用 Cloudflare 即時行情

恢復小型私人群組登入時，Shioaji 即時行情 production feature flag MUST 維持關閉，Cloudflare runtime MUST NOT 取得 Shioaji API key、secret、憑證或登入資料；owner 與 member MUST 使用相同的既有延遲行情及官方收盤核對備援。

#### Scenario: owner 與 member 使用行情功能

- **WHEN** 任一已授權 owner 或 member 載入台股日、週、月 K 線或報價
- **THEN** 系統 MUST 使用既有非 Shioaji 行情路徑
- **AND** member 不得因 realtime 相關休眠程式取得額外 capability

### Requirement: 小型群組發布必須通過安全與額度驗證

Cloudflare 正式站 MUST 在完整測試、OpenSpec strict、Free-tier 小型群組預算、D1 安全摘要、匿名拒絕、Service Token health 與已登入 owner 驗收成立後才完成發布；實際成員登入驗收若需要不同的既有登入工作階段，MUST 明確記為待使用者完成，不得以模擬、owner session 或匿名結果冒充。

#### Scenario: 發布多人登入版本

- **WHEN** exact commit 部署至 Cloudflare 正式站
- **THEN** 部署證據 MUST 證明 owner 管理能力、member 授權單元／整合測試、個人資料鍵不變及 realtime feature-off
- **AND** 任何尚缺的真實 member session 驗收 MUST 保留為未完成 gate

### Requirement: 多圖重建必須隔離已銷毀圖表的非同步工作

系統 MUST 讓每次多圖 panel 重建擁有不可與舊畫面混用的生命週期識別，並在 panel 銷毀時取消或隔離所有可能操作 Lightweight Charts、series、controller、observer、listener、timer、animation frame 與 DOM 的延遲工作。已銷毀 generation 的 callback MUST NOT 呼叫已移除的圖表實例、改寫新 generation 狀態或造成未捕捉的 browser Console error。

#### Scenario: 快速連續切換圖表數量

- **WHEN** 使用者在前一批 panel 尚在載入或 layout 時，連續切換 1、2、3、4、6 或 8 圖
- **THEN** 每一批被取代的 panel MUST 先失效並停止後續圖表操作
- **AND** 最後一次選擇 MUST 顯示正確 panel 數量與 canonical 商品切片
- **AND** 6／8 圖 MUST 維持固定單一副圖模式
- **AND** browser Console MUST NOT 出現 `Value is null` 或其他已銷毀圖表生命週期錯誤

#### Scenario: 快速切換分類分頁

- **WHEN** 使用者在圖表仍載入時連續按下一頁或上一頁
- **THEN** 最後顯示的每個 panel MUST 對應最終頁碼的完整 canonical 商品切片
- **AND** 舊頁面的資料、layout、crosshair、overlay 或 resize callback MUST NOT 操作新頁面或已移除的 chart
- **AND** browser Console MUST 保持沒有未捕捉的圖表生命週期錯誤

#### Scenario: 快速切換市場或個人清單頁籤

- **WHEN** 使用者在前一頁籤 panel 尚未完成載入時切換至另一個市場或個人清單頁籤
- **THEN** 舊頁籤的 fetch、stream、timer、frame、observer 與 controller callback MUST 被取消或因 generation 不符而失效
- **AND** 最後頁籤 MUST 完整載入其商品與有效主副圖模式
- **AND** 舊頁籤 callback MUST NOT 覆蓋最終頁籤畫面或產生未捕捉錯誤

#### Scenario: panel teardown 可重複呼叫

- **WHEN** 同一個 panel 因重建、頁面卸載或上層清理而被重複要求銷毀
- **THEN** teardown MUST 具備冪等性
- **AND** Lightweight Charts 實例 MUST 最多移除一次
- **AND** 所有後續 callback MUST 將該 panel 視為已失效

#### Scenario: ATR 副圖建立自訂 price scale

- **WHEN** panel 啟用 ATR 技術副圖並建立 Lightweight Charts series
- **THEN** 系統 MUST 先建立使用 `atr` price scale 的 ATR series
- **AND** 系統 MUST 只在該 series 建立後設定 `atr` price scale 選項
- **AND** browser Console MUST NOT 出現 `Trying to apply price scale options with incorrect ID: atr`、`Value is null` 或其他自訂 price scale 初始化錯誤

#### Scenario: in-flight batch 期間以相同 panel ID 重建

- **WHEN** 頁面級 batch request 尚未回應，原 panel 被銷毀且新 panel 以相同 ID 訂閱不同商品、週期或參數
- **THEN** 舊 request 的 response item MUST 只在目前 subscription token 仍等於 request snapshot token 時投遞
- **AND** token 已變更的 response item MUST 被忽略
- **AND** coordinator MUST 為最新 subscriptions 補跑 request，不得把舊 payload 套用到新 panel

### Requirement: 多圖 panel 排序不得破壞既有功能 parity

系統 MUST 在 2／3／4／6／8 圖加入永久 panel 排序時，保留既有分類分頁、主副圖模式、圖表互動、雙擊新分頁、即時連線與資料生命週期；1 圖及 single-view MUST 維持無排序入口的既有行為。

#### Scenario: 不同圖數完成 panel 排序

- **WHEN** 使用者分別在 2、3、4、6 或 8 圖完成合法 panel 排序
- **THEN** grid MUST 保持該圖數的既有 row／column 版面與 responsive 規則
- **AND** 1／2／3／4 圖的有效主副圖偏好 MUST 保持不變
- **AND** 6／8 圖 MUST 繼續固定單一副圖，主圖與多層副圖選項仍不可選取

#### Scenario: 排序保留 panel 圖表狀態

- **WHEN** panel 在拖曳前已有自訂 interval、visible range、主圖 overlay、技術／籌碼副圖、hover readout 或即時 stream
- **THEN** 合法 drop 後這些狀態 MUST 跟隨原 panel controller 移到新位置
- **AND** 系統 MUST NOT 因純排序重新建立 candles、指標或籌碼資料 request
- **AND** 即時連線數 MUST NOT 因排序增加

#### Scenario: 排序手勢不觸發單圖新分頁

- **WHEN** 使用者從 panel 上方可拖曳區或提示把手移動並放開 panel
- **THEN** 同一 pointer sequence MUST NOT 觸發 panel 的 `dblclick` 新分頁行為
- **AND** 完成或取消拖曳後，使用者再次正常雙擊非互動區域 MUST 仍可開啟正確 panel 的單圖新分頁

#### Scenario: 台股指數與多層副圖規則維持不變

- **WHEN** 台股頁籤同頁含 allowlist 指數與 `.TW`／`.TWO` 商品，且使用者重排 panel
- **THEN** 指數 panel MUST 仍只使用單一技術副圖且不建立籌碼 lifecycle
- **AND** eligible 台股商品在 1／2／3／4 圖的多層副圖資格 MUST 不受順序影響

### Requirement: panel 排序必須完成雙環境可見驗收

系統 MUST 在完整自動化 gate 通過後，分別於 Sites 保留站與 Cloudflare 正式站的已授權 session 驗證 panel 排序、永久同步與既有圖表互動；不得只以 source 或單元測試宣稱完成。

#### Scenario: 驗收各圖數與多頁持久化

- **WHEN** 候選版本部署至 Sites 保留站及 Cloudflare 正式站
- **THEN** 驗收 MUST 涵蓋 2／3／4／6／8 圖中的 pointer 排序及至少一種 responsive grid
- **AND** MUST 在有第二頁的頁籤完成非第一頁排序，重新整理後確認 panel、「我的清單」、分頁與下拉選單順序一致
- **AND** MUST 確認 6／8 圖單一副圖限制、雙擊新分頁及 console 0 errors

#### Scenario: 驗收取消、臨時重複商品與零額外 request

- **WHEN** 驗收人員執行 `Escape`／pointer cancel、臨時重複商品及合法 drop
- **THEN** 取消操作 MUST 不保存且不殘留 dragging UI
- **AND** 臨時重複商品 MUST 不造成 API validation failure 或清單成員異動
- **AND** network／debug evidence MUST 證明拖曳與純順序 drop 未新增 K 線、籌碼 request 或 SSE connection

### Requirement: 已載入資料後的前景更新必須原子套用

系統 MUST 將快取首繪與後續 `/api/candles` 前景更新限制在目前有效的 panel generation、load token、symbol、interval 與 chart instance，並在資料正規化及完整圖表套用成功後才提交新的 canonical payload、last payload 與 panel cache。圖表套用失敗 MUST 保留上一份完整可用畫面，且不得把成功的 API response 誤報為資料來源失敗。

#### Scenario: 相鄰頁預載後切換至該頁

- **WHEN** 使用者切換至已有 panel payload cache 的分類頁，系統先顯示快取再收到前景 `/api/candles` 成功回應
- **THEN** 系統 MUST 以同一個有效 panel 生命週期依序完成快取首繪與前景更新
- **AND** 前景 payload MUST 在完整套用成功後才取代 cache 與 canonical payload
- **AND** panel 狀態 MUST 最終顯示目前 symbol 與週期已載入
- **AND** browser Console 與 panel 狀態 MUST NOT 出現 `Value is null`

#### Scenario: 快取更新期間快速往返分類頁

- **WHEN** 使用者在第 1、2 頁或其他相鄰分類頁之間快速往返，且前景 request、series 重建或延遲 refit 尚未完成
- **THEN** 已失效 generation 的同步與延遲圖表工作 MUST 停止或被忽略
- **AND** 最後頁面的 panel MUST 對應最後選定的 canonical 商品
- **AND** 最後一次前景更新 MUST 能完成，不得停留在「使用已載入資料，更新失敗」

#### Scenario: payload 含可略過的指標空值

- **WHEN** `/api/candles` 成功回應的指標 line 或 histogram 含 null、undefined、NaN 或非有限 value
- **THEN** 系統 MUST 在呼叫 Lightweight Charts 前略過該資料點，或在支援 whitespace 的 series 轉換成只有有效 time 的資料點
- **AND** 系統 MUST NOT 將缺值改成 0
- **AND** 其餘有效 K 線與指標 MUST 繼續顯示

#### Scenario: payload 沒有可繪製 K 線

- **WHEN** `/api/candles` 回應不含任何具有效 time 與 OHLC 的 K 線
- **THEN** 系統 MUST 拒絕套用及寫入 cache
- **AND** 若 panel 已有成功載入資料，MUST 保留該完整畫面並顯示「圖表更新失敗」類型的診斷狀態
- **AND** 訊息 MUST 與 request timeout、HTTP error 或來源資料載入失敗區分

#### Scenario: 代表性 ETF 完成快取後更新

- **WHEN** `00919.TW` 或 `00982A.TW` 在單圖多層副圖模式先使用預載資料再完成前景更新
- **THEN** 主圖、技術副圖與已選籌碼副圖 MUST 保持可讀
- **AND** 可視範圍與游標對齊 MUST 對應目前圖表寬度與最後載入資料
- **AND** panel MUST 不顯示 `Value is null` 或假性資料更新失敗

### Requirement: 分類下一頁預載必須依圖表數量與資源預算執行

系統 MUST 以目前分類頁圖表數量作為下一頁預載商品上限，依 canonical ordering 只處理下一頁實際商品，並以 priority、並行、timeout、generation、visibility 與 network gate 保護可見頁面及資料來源。背景預載 MUST 為 best-effort，不得阻塞或改寫目前頁面。

#### Scenario: 四圖模式預載完整下一頁
- **WHEN** 使用者位於四圖模式且下一頁至少有四檔 canonical 商品
- **THEN** K 線預載完成後 MUST 最多排入四檔下一頁 chip prefetch jobs
- **AND** jobs MUST 保持 canonical 下一頁順序，不得擴張至再下一頁或相鄰頁籤

#### Scenario: 最後一頁商品不足
- **WHEN** 目前圖表數量為四，但下一頁只剩兩檔商品
- **THEN** 系統 MUST 只預載該兩檔商品
- **AND** MUST NOT 以 placeholder、重複商品或前一頁商品補滿四檔

#### Scenario: 分頁 context 在預載期間改變
- **WHEN** 使用者在 chip prefetch 尚未完成時切換頁面、頁籤、圖數、presentation mode、週期或 canonical ordering
- **THEN** 舊 generation 的未開始 jobs MUST 取消，已失效 callback MUST NOT 操作目前 panel 或 notice
- **AND** 相同 request identity 已完成的合法 payload MAY 留在 bounded cache 供後續使用

#### Scenario: 頁面隱藏或使用節省流量
- **WHEN** 頁面不可見，或瀏覽器明確回報 `saveData=true` 或受支援的低速網路狀態
- **THEN** 系統 MUST 暫停啟動新的籌碼預載 request
- **AND** 目前頁面前景載入、既有 cache 與使用者主動切頁 MUST 繼續正常運作

### Requirement: 預載效益必須能以安全指標驗收

系統 MUST 以不含個人清單、秘密值、完整商品清單或完整 payload 的 aggregate metrics，區分籌碼預載 request、完成 cache hit、in-flight join、切頁後實際使用、未使用淘汰、失敗與 queue depth，並量測切頁至主圖及已選副圖首繪完成時間。

#### Scenario: 使用者切到已完成預載的下一頁
- **WHEN** 下一頁所需 K 線與 chip payload 已在 cache，且使用者切換至該頁
- **THEN** debug／驗收報告 MUST 將該 payload 計為 `usedAfterNavigation`
- **AND** foreground revalidate MUST NOT 被誤計為第二次背景預載

#### Scenario: 預載完成但沒有被使用
- **WHEN** payload 因 cache 上限淘汰前未被對應頁面使用
- **THEN** aggregate metrics MUST 計入 `evictedUnused`
- **AND** report MUST NOT 暴露該使用者的頁籤名稱、完整 symbol 清單或 request URL

### Requirement: 多圖籌碼更新必須採非退化原子提交

系統 MUST 在 1／2／3／4 圖的多層副圖與相鄰頁預載中，讓不同完成順序的 foreground、background、cache hit 與 in-flight join 結果都先通過 generation／identity 檢查及逐 dataset reconcile，再原子提交完成 cache 與可見 UI。任一 panel 或 dataset 的弱回應不得清除其他 panel 或相同 panel 已驗證的籌碼資料，aggregate metrics 不得包含完整 payload、商品清單或秘密值。

#### Scenario: 四個 panel 依不同順序完成弱回應
- **WHEN** 四圖多層副圖先各自顯示最後有效大戶／散戶資料，之後四個背景 request 以不同順序回傳空或較舊 TDCC slice
- **THEN** 四個 panel MUST 全部保留各自最後有效持股 series 與實際資料日期
- **AND** 不得出現線圖依 request 完成順序逐欄消失的狀況

#### Scenario: 預載與前景共用候選結果
- **WHEN** 相鄰頁背景預載與目前頁前景 request 共用相同完成 response 或 in-flight request
- **THEN** 候選 response MUST 只 reconcile 一次並以相同非退化結果供兩者使用
- **AND** 未通過 reconcile 的原始候選 payload MUST NOT 寫入完成 cache

#### Scenario: 開盤期間四圖長時間驗收
- **WHEN** 驗收在台股開盤更新或等價 deterministic fixture 中，以四圖、多層副圖、至少一檔普通股與一檔 ETF 等待超過背景 revalidate 完成時間
- **THEN** 每個 panel 已選法人、融資券、大戶與散戶 pane 的 DOM、canvas、可繪製點及最後有效日期 MUST 維持一致且不退化
- **AND** console MUST 無未處理錯誤，network evidence MUST 能區分原始候選與 retained／accepted dataset 結果

#### Scenario: 技術副圖同場景隔離驗證
- **WHEN** 相同 panel 在開盤 K 棒更新期間同時顯示技術副圖與籌碼副圖
- **THEN** KD、RSI、MACD、ATR 等已選技術 series MUST 由合法 candles／indicator payload 持續更新，不得因籌碼 reconcile 被清除或重建
- **AND** 若技術副圖另有空資料退化，MUST 以其獨立 identity 與 root cause 修正，不得讀取籌碼 verified-slice store

#### Scenario: 發布資產與 rollback 驗證
- **WHEN** 本變更進入可部署版本
- **THEN** build、完整測試、migration 檢查、OpenSpec strict validation 與實際瀏覽器驗收 MUST 通過，HTML MUST 引用本次 `app.js` 與 `chip-panes.js` cache-buster
- **AND** rollback MUST 不需刪除或轉換既有 D1 籌碼 rows
