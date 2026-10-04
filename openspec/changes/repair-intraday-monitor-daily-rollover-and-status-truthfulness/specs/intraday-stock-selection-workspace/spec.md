## ADDED Requirements

### Requirement: 面板必須分開呈現容量核准與今日監控狀態

盤中監控面板 MUST 將 durable capacity approval 與 current-session live status 分成可辨識區塊。容量核准 MUST 顯示 limit、decision、evidence trade date、reviewedAt 與 reviewer type；今日監控 MUST 顯示 authority trade date、session phase、current／stale、data active、control-plane requested、第一筆 KBar 與 freshness。歷史 `GO` MUST NOT 單獨顯示成目前功能正常。

#### Scenario: 9 月 16 日 GO 但 9 月 22 日未啟動
- **WHEN** approval 為 2026-09-16 Stage 160 `GO`，而 2026-09-22 current session 缺失
- **THEN** 面板 MUST 顯示「容量核准：160／GO／2026-09-16」與「今日監控：未啟動」
- **AND** MUST NOT 顯示今天「訂閱已接受」或讓 `GO` 被解讀為今日 live ready

#### Scenario: 今天 session 正在收資料
- **WHEN** current session identity 完整且已有 149 檔收到今日合法第一筆 KBar
- **THEN** 今日監控區 MUST 顯示 `data active 149` 與其餘逐檔狀態，容量核准區仍只呈現 durable decision

#### Scenario: 今日 session 缺失且結果為空
- **WHEN** 歷史容量核准仍為 `GO`，但今日 current session 缺失且當日結果為空
- **THEN** 空結果區 MUST 說明「今日監控未啟動」與沒有可驗證的當日達標結果
- **AND** MUST NOT 顯示「監控已啟動，目前沒有達標結果」；只有 current session、freshness、lease 與 data active 同時成立，才可使用監控已啟動的文案

### Requirement: Reviewer 文案必須符合實際 provenance

面板與 evidence 詳情 MUST 依 review artifact 顯示 `human`、`codex_delegated` 或其他規格允許的 reviewer type。只有人類 reviewer 親自簽核時才能顯示「人工核准」；Codex 依使用者委託代理審閱 MUST 顯示「Codex 代理審閱」，不得假冒使用者或人類簽核。

#### Scenario: Codex 代理審閱的 GO
- **WHEN** review artifact 的 reviewer type 為 `codex_delegated`
- **THEN** 面板 MUST 顯示「Codex 代理審閱」，不得顯示「人工核准」

### Requirement: Stale 與分類統計必須以可理解文案顯示

面板 MUST 顯示互斥 state counts 與獨立 baseline summary，並在 session stale、revision mismatch、artifact invalid、generation mismatch 或 current session missing 時顯示直接原因。provider usage、other usage、ownership、release 與 headroom 未證實時 MUST 保持「未知」，但 MUST 與今日 session 未啟動分開呈現。

#### Scenario: Provider 證據未知且今日 session 缺失
- **WHEN** provider physical evidence 全部未知，且 today current session 未建立
- **THEN** 面板 MUST 同時顯示 provider evidence unknown 與 `current_session_missing`
- **AND** MUST NOT 將 provider unknown 當成今日未啟動的唯一原因，亦不得用 configured、SSE connection count 或 request accepted 推定 capacity

#### Scenario: Waiting baseline 為零但 baseline unknown 非零
- **WHEN** `waitingBaseline=0` 且 baseline summary 的 unknown／missing 大於 0
- **THEN** 面板 MUST 顯示兩組數字及其不同語意，不得顯示「基準完整」或等效成功文案

### Requirement: 背景盤中監控不得依賴 K 線畫面是否開啟或選定週期

正式擷取、`firstKbarAt`、`dataActive`、封閉分鐘比對與收尾驗收 MUST 依背景串流收到並接受的合法 Shioaji KBar 事件及持久化 observation 判定，MUST NOT 依賴任何 K 線畫面、圖表渲染速度、選定週期、頁籤可見性或被動圖表證據檔。`firstKbarAt` 代表後端首次接受的合法 KBar，並不代表畫面已繪製 K 棒；僅收到連線或訂閱確認也不能算資料已活動。開盤資料壅塞時，MUST 將尚未收到、已收到但封閉分鐘未完成、畫面尚未更新分別呈現，不得互相替代。

主工作區 MAY 在今日 Stage 160 session `running` 期間收集既有可見 K 線的真實 visual commit 作為選用 UI 診斷。收集器 MUST 僅讀取現有圖表診斷 DOM，透過既有本機端點提交證據，且 MUST NOT 新增行情訂閱、圖表載入、broker 操作或偽造更新。若提交圖表證據，來源日 MUST 為今日 session，且同圖表後續來源時間 MUST 嚴格前進；重繪昨日 K 棒不能算今日資料。證據缺少或無效時 MUST 明記 `missing`／`invalid`／`unreadable`，不得偽造量測值，也不得使背景監控失敗。

#### Scenario: 只開標準看盤版面
- **WHEN** 今日 Stage 160 session 正在執行、標準看盤版面有可見 K 線，且監控面板未掛載
- **THEN** 真實 K 線 visual commit 推進時仍可提交被動證據
- **AND** 若沒有真實推進，僅將圖表診斷列為未觀測，不得以狀態輪詢代替圖表證據或阻擋背景擷取收尾

#### Scenario: 使用者查看日 K、其他週期或關閉圖表
- **WHEN** 背景行情串流收到並接受今日合法 KBar，且封閉分鐘 observation 可供核對
- **THEN** 盤中監控 MUST 按相同 session 與 generation 更新資料面狀態、結果及正式收尾
- **AND** MUST NOT 要求使用者切到 1 分 K 或保持看盤頁面可見

### Requirement: 大量量比結果必須保持可讀並區分來源

盤中選股面板 MUST 在結果數量超過可見高度時保持每張結果卡片的可讀高度，並由清單獨立捲動；MUST NOT 以 flex 縮小卡片至僅剩邊框。結果總數若同時含即時觸發及歷史重播，MUST 分別顯示兩者筆數，不得將總數誤標為全部即時觸發。

#### Scenario: 狹窄面板載入大量當日結果
- **WHEN** 結果清單含 97 筆，其中 32 筆即時觸發、65 筆歷史重播，且面板高度不足以一次顯示全部卡片
- **THEN** 面板 MUST 顯示分類筆數、保持卡片文字可讀並允許捲動查看後續商品
- **AND** 不得因顯示修正修改結果資料、觸發權限或背景行情訂閱

### Requirement: 今日監控狀態欄必須適應窄面板

盤中監控的今日狀態欄 MUST 在顯示「啟動來源」及長時間戳記後，仍於 480px 寬面板內排版，不得造成狀態區水平溢出。視覺上 MAY 截斷過長值，但完整內容 MUST 可由既有 title 讀取，不得更改 underlying status 語意。

#### Scenario: 13 項今日狀態顯示於窄面板
- **WHEN** 面板寬度為 480px，今日監控含 13 項狀態與完整時間戳記
- **THEN** 狀態欄 MUST 留在可見寬度內，不產生水平捲動或覆蓋鄰近欄位
- **AND** 完整值仍 MUST 於各項 title 保留
