## ADDED Requirements

### Requirement: 主圖疊加提供日線關鍵價位設定
K線面板「技術指標 → 主圖疊加」MUST 提供單例「日線關鍵價位」，包含日5MA、日10MA、日20MA、日60MA、日120MA及日BOLL上軌／中軌／下軌八項。功能MUST 預設未啟用，使用者首次加入後八項預設開啟，且每項MUST 可個別開關及設定顏色、線寬與線型。BOLL MUST 預設20期／2倍標準差，沿用既有BOLL參數驗證範圍；不得修改既有普通MA或BOLL實例。

#### Scenario: 新增與個別取消價位
- **WHEN** 使用者在主圖疊加加入「日線關鍵價位」並關閉日120MA
- **THEN** 系統 MUST 只建立一個功能實例，保留其餘七項設定並移除日120MA的線與標籤
- **AND** 既有分鐘MA、BOLL及壓撐啟用狀態 MUST 保持不變

#### Scenario: 非法或重複設定
- **WHEN** 保存資料包含重複功能實例、非法BOLL期數或非有限參數
- **THEN** 系統 MUST 依canonical設定驗證拒絕非法值並避免重複投影與資料需求
- **AND** 既有合法設定 MUST NOT 被清空或重設

### Requirement: 日線價位必須使用與1D一致的最新日K及公式
所有投影MUST 使用同商品、同來源／價格基準、同generation的合法canonical日K快照，以既有`referenceSma`及`bollinger`語意計算。日NMA MUST 使用最後N個合法日K close，盤中MUST 納入今日未完成日K的最新合法close；BOLL MUST 使用既有母體標準差公式與既有精度。在參數與輸入快照相同時，投影數值MUST 與1D相同。系統MUST NOT 以分鐘K序列計算後冒稱日均線。

#### Scenario: 今日盤中更新日5MA
- **WHEN** 前四個合法日K close依序為100、102、104、106，今日forming close從108更新到110
- **THEN** 日5MA MUST 從104更新為104.4
- **AND** 系統 MUST 更新同一根今日日K，不得因兩筆行情增加兩個交易日

#### Scenario: 布林與1D公式一致
- **WHEN** 同一日線快照、20期及2倍標準差同時供給1D BOLL與分鐘投影
- **THEN** 上軌、中軌及下軌 MUST 分別與1D相同輸出一致
- **AND** 已啟用的日20MA MUST 與該布林中軌相等；線條格式化不得改寫底層數值

#### Scenario: 未證實日K完成
- **WHEN** 時鐘已到收盤後，但目前商品日K來源仍未確認完成
- **THEN** 系統 MUST 保留盤中暫估或完成狀態未知
- **AND** 系統 MUST NOT 單憑台北13:30、日期換日或其他商品的收盤時刻標為已收盤

### Requirement: 四種分鐘圖必須投影同一份日線最新價位
1m、5m、15m、60m MUST 以同一商品的最新日線authority畫水平投影，切換級別、移動十字游標與捲動歷史MUST NOT 改變計算參考日。1D MUST 可核對相同來源狀態，但不重複畫這八條水平投影；其既有指標曲線保持原語意。投影MUST 明示為最新日線價位，不得宣稱是歷史當時已知數值或供給回測重播。

#### Scenario: 跨分鐘級別切換
- **WHEN** 使用者依序切換1m、5m、15m、60m，且日線authority尚無新行情
- **THEN** 四種圖 MUST 呈現相同的八項可用數值、參考日期及快照版本
- **AND** 系統 MUST NOT 依每個圖自己的歷史窗另算日均線

#### Scenario: 游標與歷史捲動
- **WHEN** 使用者將十字游標移到較舊分鐘，或向左捲動到先前交易日
- **THEN** 日線水平線 MUST 仍使用最新日線快照並保留來源日期標示
- **AND** 既有日線壓撐的固定歷史reference MUST NOT 被修改

### Requirement: 日線資料需求必須按商品共用且有界
功能MUST 能在使用者未先開1D時，透過既有已授權圖表資料流程取得日線authority，優先重用合法快取及在途請求。需求MUST 以商品、來源／價格基準、交易時段契約與coverage識別，目標日K數為所有已開啟MA週期及已開啟布林軌期數的最大值；首次八項預設為120日，全部關閉MUST 沒有新增資料需求。歷史不足時MUST 先保留可用項目，不得為已關閉的長週期繼續補足歷史。補足資料MUST 單一循序，30日chunk不重複，最多涵蓋365個日曆日、單次冷載最多13個chunk，且MUST 服從既有來源授權、預算、限流、取消及逾時守門。時框切換MUST NOT 觸發同coverage的重抓；既有守門拒絕時MUST 明示不可用，不新建下載權限。

#### Scenario: 分鐘圖直接啟用且已有日線快取
- **WHEN** 使用者在1m啟用功能，相同商品已具有足夠且新鮮的合法日線快取
- **THEN** 系統 MUST 直接計算並畫線，新增歷史請求數為0
- **AND** 後續切換5m、15m、60m MUST 重用同一份coverage

#### Scenario: 多面板同時缺相同日線歷史
- **WHEN** 兩個同商品面板同時啟用，且必要歷史尚未完成載入
- **THEN** 系統 MUST 共用相容資料需求與在途chunk，不重複請求相同區間
- **AND** 關閉單一面板 MUST NOT 取消仍被另一面板使用的請求；最後consumer離開後MUST 清理本功能的請求與listener

#### Scenario: 只需短均線或全部關閉
- **WHEN** 使用者只開啟日5MA且已有足夠合法coverage，或將八項全部關閉
- **THEN** 系統 MUST 停止為已關閉的120MA或BOLL補歷史，且不得增加這些項目的資料請求
- **AND** 其他consumer仍需要的共享請求與其設定 MUST 保持

#### Scenario: 冷載遇限流或資料界限
- **WHEN** 既有Gate拒絕或最多365日曆日仍不足120個合法日K
- **THEN** 系統 MUST 停在原授權／資料界限，保留可用快照並逐項明示不足或不可用
- **AND** 系統 MUST NOT 因切換時框而重設預算、擴大日期範圍、無限重試或補造日K

### Requirement: 資料不足與過期必須逐項明示
系統MUST 顯示來源交易日、來源更新時間及「盤中暫估／已收盤／完成狀態未知」，並逐項區分available、insufficient、stale及unavailable。合法休市期間的已完成資料MUST 依既有市場感知freshness判定，不能只按牆鐘判過期。來源失敗時僅可保留同商品最後可證明快照，且MUST 明示舊值時間與原因並以不同視覺區分；沒有快照不得畫線。已知缺日、錯商品、錯generation、非有限值或不一致價格基準MUST NOT 當作正常資料。

#### Scenario: 僅有40日資料
- **WHEN** 最新快照只有40個合法交易日日K，BOLL設定20期且資料連續合法
- **THEN** 系統 MUST 顯示可計算的5／10／20MA及三條BOLL價位
- **AND** 60／120MA MUST 明示所需與現有日數，不得補零、改用分鐘MA或隱藏不足狀態

#### Scenario: 同商品刷新失敗
- **WHEN** 已有同商品合法快照，但後續資料刷新失敗或行情被判為過期
- **THEN** 系統 MUST 保留並清楚標為stale，顯示該快照的真實來源時間及原因
- **AND** 系統 MUST NOT 更新as-of為現在以假裝新鮮，也不得標成已收盤來掩蓋失敗

#### Scenario: 新交易日尚無合法日K
- **WHEN** 系統時間換日但來源尚未提供合法新交易日日K
- **THEN** 系統 MUST 保留原參考交易日及真實狀態
- **AND** 系統 MUST NOT 插入零量或昨收複製日K以湊日數

### Requirement: 水平線標籤必須可辨識且不破壞圖表視窗
可用價位MUST 在目前分鐘plot上以真正價格畫水平線，右側MUST 顯示「日」前綴、指標／週期名稱及格式化價位。標籤MUST 與本功能及既有壓撐共同避碰，位移時以connector指回真實價位；完全同價的本功能輸出可合併標籤但MUST 保留全部名稱及各項設定。僅接近或格式化後相同的不同值MUST NOT 合併。日線價位MUST 固定不參與autoscale，不提供擴張Y軸選項，並忽略既有autoscale設定；任何更新MUST NOT 改變原K線大小、面板大小、縱軸價位區間、重設X軸或執行fitContent。只有真實價格座標位於原可見價格視窗內的線與標籤可以繪製；範圍外項目MUST 在標籤避碰配置前排除。

#### Scenario: 日20MA與BOLL中軌同價
- **WHEN** 日20MA與20期BOLL中軌的底層值完全相同且兩者皆開啟
- **THEN** 系統可畫一個位置及「日20MA／日BOLL中軌」標籤，但 MUST 保留兩個output的身分與開關
- **AND** 取消其中一項 MUST 留下另一項正確名稱及數值，不影響其他價位

#### Scenario: 與PP或CDP價位接近
- **WHEN** 日線價位與既有壓撐標籤接近，面板寬度縮小或多個價位同時顯示
- **THEN** 系統 MUST 配置可讀標籤及必要connector，保留PP／三關／CDP的既有名稱、數值與reference
- **AND** 系統 MUST NOT 以避碰為由改寫任何真實價格或靜默移除公式

#### Scenario: 120MA遠離目前價格
- **WHEN** 日120MA位於目前價格視窗外，包括保存資料仍有舊autoscale啟用設定
- **THEN** 系統 MUST 保留目前K棒大小與原縱軸範圍，只畫視窗內的其他日線價位，在本功能清單標明該價位位於視窗外
- **AND** 系統 MUST NOT 為顯示遠端價位而縮小K棒、擴張Y軸或將該價格夾到視窗邊界畫成另一個價格；使用者自行拖曳／縮放改變視窗後才按新的可見範圍重新判斷

### Requirement: 設定保存與生命週期必須隔離舊資料及其他consumer
功能的啟用、output開關、樣式及BOLL參數MUST 沿用canonical store保存與同origin同步，計算價位MUST NOT 當成永遠有效設定保存。快速換股、來源generation變動、取消與unmount MUST 清除本圖舊投影並拒絕遲到回覆；新商品不得短暫顯示舊商品價位。共用renderer的其他consumer MUST NOT 自動渲染此最新日線primitive或新增資料需求。

#### Scenario: 快速換股時舊資料晚到
- **WHEN** 使用者從A切到B，而A的日線請求稍後才回覆
- **THEN** 目前面板 MUST 只接受B的商品key及generation，A回覆不得覆蓋B
- **AND** A資料若仍被其他合法consumer使用，可依其生命週期保留，不能污染目前面板

#### Scenario: 保存設定後重新開啟頁面
- **WHEN** 使用者已保存個別開關與BOLL參數並重新開啟面板
- **THEN** 系統 MUST 恢復設定並重新核實來源快照的新鮮度與身分
- **AND** localStorage失敗時 MUST 保留目前記憶體設定並提示未保存，不清除其他指標

#### Scenario: 回測renderer讀到新設定
- **WHEN** 其他共用設定consumer不具本功能的日線authority或正顯示歷史回測
- **THEN** 該consumer MUST 忽略此最新日線primitive，不把今日價位回畫到歷史
- **AND** 既有普通MA、BOLL及其他指標 MUST 繼續按原契約渲染

### Requirement: 功能不得擴張交易與正式runtime權限
日線價位MUST 僅使用既有已授權canonical圖表資料與行情，不新增login、訂閱、SSE、獨立provider、背景採集或無界請求；計算及投影MUST NOT 觸發通知、策略、送單、修改監控名單或放寬broker Gate。交易、警示、拖單與既有壓撐手勢MUST 保持原流程，新增水平線不得註冊改價或選棒副作用。本提案MUST NOT 作為重啟API／watchdog／MultiView或操作自然排程的授權。

#### Scenario: 開啟日線價位後操作既有交易工具
- **WHEN** 使用者啟用日線價位並使用原點價、拖單、警示或日線壓撐選棒功能
- **THEN** 日線價位MUST 僅作顯示，原手勢及安全檢查保持
- **AND** 單純切換線條或參數 MUST NOT 產生交易、通知、訂閱或正式採集請求
