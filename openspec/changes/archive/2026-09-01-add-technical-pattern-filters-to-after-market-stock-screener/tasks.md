## 1. 前置基線、來源與 v3 契約

- [x] 1.1 確認 `extend-after-market-stock-screener-with-turnover-and-holder-reversal` 已完成 live acceptance，保存其 exact D1 migration、v2 snapshot、全市場母體、tasks 與未提交檔案基線；不得在本 change 內改寫其證據或完成狀態
- [x] 1.2 逐市場核對 TWSE／TPEx 最新全市場日批次的日期、open／high／low／close 實際欄位、價格基礎、交易範圍、授權、自動化限制與普通股覆蓋，保存非敏感 source review
- [x] 1.3 逐市場核對歷史日期報表的 requested／actual date、OHLC 欄名、無成交／停牌語意及與最新批次同日等價性，證明不會接受忽略日期或不同價格基礎的回應
- [x] 1.4 保存本機 `candle_history`、選股日底稿、最新 60 個官方 session、逐市場 coverage 與新上市／停牌代表商品基線，確認不把局部 K 線快取冒充全市場資料
- [x] 1.5 定義 v3 criteria、formula、snapshot row／metadata、API、cursor、preference、progress 與 unknown reason schema，建立 v1／v2／v3 不混用的版本 fixture

## 2. 分型、布林與三態純函式

- [x] 2.1 建立選股專用 canonical OHLC 型別與驗證，拒絕零值、非有限值、精度失真、日期重複及不符合 high／low 邊界的 K 棒
- [x] 2.2 實作原始三 K 嚴格頂／底分型，補齊 pass、相等、方向不符、缺左／右棒、非相鄰 session 與未完成右棒測試
- [x] 2.3 實作可稽核的纏論包含關係正規化，固定向上／向下合併公式、原始日期映射及 `containment_direction_unknown`
- [x] 2.4 對正規化後最後三根有效 K 棒實作纏論頂／底分型，涵蓋連續包含、中心棒被合併、缺獨立右棒、60 日仍不足及 deterministic 重算
- [x] 2.5 讓選股 BOLL(20,2) 與 `src/lib/indicators.ts` canonical 母體標準差／rounding 共用或通過 exact parity fixture，禁止複製後漂移的近似公式
- [x] 2.6 實作前一日含邊界在通道內、最新日嚴格首次跌破／突破、陽 K 下影／陰 K 上影判定，補齊碰軌、十字、零影線、前日已在外及恰好 21 期測試
- [x] 2.7 實作 algorithm／direction／BOLL mode 內部三態 OR 與四類條件外層 `all`／`any`，證明 pass／fail／unknown 守恆及停用分支不要求資料
- [x] 2.8 升級 criteria fingerprint、stable sort 與 evidence hash，為確認日、算法、方向、通道外距離、unknown 置底及代碼 tiebreak 建立 deterministic tests

## 3. 官方 OHLC adapter 與 additive D1

- [x] 3.1 擴充 TWSE 最新日 adapter，以實際欄位正規化同列 OHLC、session、market、mapping version、payload hash 與 provenance，保留成交量／成交值既有語意
- [x] 3.2 擴充 TPEx 最新日 adapter，以實際欄位正規化同列 OHLC、session、market、mapping version、payload hash 與 provenance，拒絕不同 quotes dataset
- [x] 3.3 建立兩市場歷史報表 parser，依欄名而非固定欄序解析 OHLC，驗證 actual date、普通股 universe 與無成交列，格式漂移時 fail closed
- [x] 3.4 新增 `screener_daily_ohlcv`、必要 unique／coverage index 與 snapshot v3 additive migration，補 staging migration、重跑、rollback、個人資料 hash 與舊 v2 snapshot 保留測試
- [x] 3.5 實作較新／較完整資料優先與 sparse response 保護，證明較新缺欄回應不會清空 verified OHLC 或其衍生 evidence
- [x] 3.6 以兩市場同一實際官方日期執行最新／歷史 adapter acceptance，保存 D、筆數、合法／缺漏 OHLC、欄位 mapping 與來源 hash，不以 fixture 代替 live 證據

## 4. 60 日全市場背景準備

- [x] 4.1 以官方市場交易日曆建立至少 60 個遞增 session 的 planner，涵蓋跨年、連假、颱風休市、未發布未來日及曆法來源不一致
- [x] 4.2 將 bootstrap target 固定為 `market + session`，以一次正式批次服務該市場全母體；建立 target／processed／remaining／failed／overdue／cursor 守恆測試
- [x] 4.3 新商品 planner 依 universe revision 與上市日只補合法 session，涵蓋不足 21 日、已可取得 60 日、轉市場及不在自選清單商品
- [x] 4.4 實作固定 request／時間 budget、single-flight、完整 fetch＋body timeout、冷卻、Retry-After、有界 retry、operator lease 與中斷續跑
- [x] 4.5 實作最新 60 日加兩版 snapshot anchors 的 retention，證明不清除成交量／成交值、TDCC、`candle_history`、自選清單、個人 target 或交易資料
- [x] 4.6 將 OHLC 準備接到既有 18:00 後盤後 operator gate；UI／GET、5173／5174 啟停、Shioaji session、TDCC 長歷史與交易 runtime 均不得成為 bootstrap 捷徑
- [x] 4.7 為 rate limit、來源封鎖、歷史日期忽略、部分市場失敗、本機休眠、lease 競爭、較新稀疏回應及自然累積退路建立 operator tests
- [x] 4.8 在備份後的本機 D1 分段執行 full-universe 60 日 bootstrap，逐市場／日期保存 coverage 與 checkpoint；未達正式終態前不得勾選或發布 v3

## 5. v3 Snapshot、API 與版本切換

- [x] 5.1 擴充 publisher，在 staging 對全母體計算原始三 K、纏論、BOLL P／D、兩種反轉 K 與逐原因 unknown，只嵌入必要衍生證據
- [x] 5.2 實作全市場 market／session receipt gate、staging row 守恆與原子 v3 發布，涵蓋個股合法 unknown、部分市場拒發、CAS 競爭及只保留兩版
- [x] 5.3 擴充 status／results GET allowlist、固定 query schema、排序、limit 與 cursor，支援分型 algorithm／direction、BOLL mode 及四分支 `all`／`any`
- [x] 5.4 擴充 API evidence，回傳中心／確認日、標準化 K 原始日期範圍、P／D OHLC／bands、影線、逐分支 verdict、unknown 與全市場守恆計數
- [x] 5.5 證明查詢、排序、翻頁、展開與 history pending 只讀 immutable snapshot，provider、Yahoo、Shioaji、回補 dispatch、DDL、runtime 管理與交易呼叫皆為零
- [x] 5.6 實作 v2 snapshot／preference 到 v3 的安全切換：新條件預設關閉，舊 cursor 不重解釋；v3 bootstrap 未完成時保留最後合法 v2 與 preparation progress

## 6. 選股面板與圖表連動

- [x] 6.1 在選股面板新增「K 棒分型」條件卡，提供原始三 K／纏論／任一算法及底／頂／任一方向，文案明示中心日與確認延遲
- [x] 6.2 新增「布林通道反轉 K」條件卡，提供下軌陽 K 下影／上軌陰 K 上影／任一型態，明示固定 BOLL(20,2) 與前日通道內、今日首次穿越
- [x] 6.3 擴充條件套用、尚未套用提示、結果種類、缺漏摘要與排序，使四類分支的 pass／fail／unknown 可區分且可鍵盤操作
- [x] 6.4 擴充結果列與明細，呈現分型算法／方向／日期映射、P／D OHLC／bands、影線與 `missing_ohlcv`／`insufficient_history`／`containment_direction_unknown`
- [x] 6.5 實作 v2 preference 一次性遷移與未知版本有界預設，補 localStorage 寫入失敗、stale generation、跨 snapshot cursor、600 CSS px、特大字級及螢幕閱讀器測試
- [x] 6.6 驗證點選未加入清單的技術型態商品仍只更新指定未鎖定 K 線圖，不新增清單、不改其他圖表、行情訂閱、下單／智慧下單商品或草稿

## 7. 全市場與實際 UI 驗收

- [x] 7.1 執行 focused OHLC／分型／纏論／BOLL／三態／adapter／planner／publisher／route／UI tests，以及完整 `npm test`、MultiView tests、lint、typecheck、migration tests 與 `git diff --check`
- [x] 7.2 對本機 D1 執行 `integrity_check`、schema、60 日 session、TWSE／TPEx 母體與逐日期守恆、unknown reasons、snapshot 原子性及新商品 coverage 核對
- [x] 7.3 以原始三 K 頂／底、纏論頂／底／方向不明、兩種 BOLL 首次穿越、all／any、缺日、新上市及未加入清單商品跑完整 API 分頁 acceptance
- [x] 7.4 在實際本機選股面板核對 DOM、可見控制、600／768／900 px、鍵盤、console、結果 evidence 及點選日 K；若 5173／5174 未運行，須先取得明確授權才啟動
- [x] 7.5 核對 full run 的 target／processed／remaining／failed／overdue、逐市場 receipts、來源冷卻、未受控 request 與新商品補資料，只有實際符合規格才勾選
- [x] 7.6 更新繁體中文操作文件、正式來源 review、tasks 與 verification evidence，執行 `openspec validate --all --strict`，清楚列出仍未完成或已接受的 row-level unknown
