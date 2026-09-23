## ADDED Requirements

### Requirement: 選股條件編輯必須以分組收合介面縮短面板

選股面板 MUST 將全部 top-level 條件以「基本條件」、「技術型態」及「籌碼／價量」等可辨識群組呈現。每個群組 MUST 顯示已啟用條件數，每個條件摘要列 MUST 顯示條件名稱、啟用狀態及足以辨識目前草稿的主要參數；同一時間 MUST 至多顯示一組完整條件設定。首次載入 MUST 展開 draft 中依固定畫面順序第一個已啟用條件；若沒有啟用條件，MUST 展開最上方的成交量條件。

展開條件 MUST NOT 隱性啟用或停用該條件。使用者將停用條件切換為啟用時，系統 MUST 同時展開該條件供設定；停用已展開條件 MAY 保持其設定可見。展開群組、目前編輯條件及其他純呈現狀態 MUST NOT 寫入選股 preference、criteria fingerprint 或 API query。

#### Scenario: 初次載入既有草稿

- **WHEN** 使用者開啟選股面板，既有合法 draft 的成交量與千張大戶條件均已啟用
- **THEN** 系統 MUST 展開包含成交量的群組與成交量設定
- **AND** 其餘條件 MUST 只顯示緊湊摘要，不同時顯示完整設定欄位與說明

#### Scenario: 展開停用條件

- **WHEN** 使用者點擊一個目前停用條件的摘要以查看設定
- **THEN** 系統 MUST 展開該條件並收合先前條件
- **AND** 該條件 MUST 保持停用，不得因此進入查詢或 criteria fingerprint

#### Scenario: 啟用條件後立即設定

- **WHEN** 使用者在摘要列將一個停用條件切換為啟用
- **THEN** 系統 MUST 將該條件設為目前展開的唯一完整設定
- **AND** 既有參數 MUST 原樣顯示，不得重設為預設值

#### Scenario: 套用長線佈局草稿

- **WHEN** 使用者啟用「套用長線佈局」草稿
- **THEN** 系統 MUST 沿用既有 preset 內容並展開固定順序中第一個已啟用的 preset 條件
- **AND** MUST NOT 在使用者按下「開始篩選」前查詢或重標既有結果

### Requirement: 選股草稿必須提供可復原的全部取消操作

選股面板 MUST 在條件摘要區提供「全部取消」按鈕及目前已啟用條件數。按下按鈕 MUST 只將全部 top-level draft condition 的 `enabled` 設為 `false`，並 MUST 保留每個條件的門檻、模式、週數、日數、period、turnover 子設定與其他參數。此動作 MUST NOT 呼叫選股 API、保存為已套用 preference、清除已套用 query、response、結果、分頁或圖表選擇。

全部取消後，面板 MUST 顯示取消數量及既有結果尚未改變的可讀回饋，MUST 沿用無啟用條件時的驗證阻止「開始篩選」。沒有任何 draft condition 啟用時，按鈕 MUST 停用。

#### Scenario: 已有結果時全部取消

- **WHEN** 使用者已有一組已套用結果，並在包含三個已啟用條件的 draft 按下「全部取消」
- **THEN** 三個 draft 條件 MUST 全部停用且原參數保持不變
- **AND** 既有結果、已套用條件及其日期證據 MUST 繼續顯示，並標示目前草稿尚未套用
- **AND** 系統 MUST NOT 發出新的 results 或 status request

#### Scenario: 重新啟用已取消條件

- **WHEN** 使用者全部取消後重新啟用其中一個條件
- **THEN** 該條件 MUST 展開並顯示取消前保留的參數
- **AND** 使用者仍須按下「開始篩選」才可提交新 query

#### Scenario: 草稿已無啟用條件

- **WHEN** 所有 draft condition 均為停用
- **THEN** 「全部取消」MUST 呈現停用狀態
- **AND** 「開始篩選」MUST 依既有驗證契約停止查詢並顯示至少啟用一項條件的原因

### Requirement: 選股結果設定與資料證據必須分層且保留主要警告

選股面板 MUST 將組合模式、結果類型、排序欄位與方向放入緊湊的「結果設定」，其摘要 MUST 顯示目前值；「開始篩選」、驗證錯誤及「條件尚未套用」狀態 MUST 保持直接可見或在正常鍵盤流程中可抵達，不得只藏於收合內容。

狀態區 MUST 常駐顯示目前 state、主要 reason，以及會影響結果可信度或可操作性的 expected／effective 日期不一致、stale／partial、來源離線或逐市場未完成警告。完整已套用條件、日期 anchors、TDCC 歷史窗、技術資料範圍、coverage、counts、逐條件缺漏及 snapshot time MUST 保留在可由鍵盤展開的「資料範圍與完整性」；收合 MUST NOT 刪除、改寫或以畫面日期推測任何 evidence。計算規則與資料來源 MAY 預設收合，但 MUST 可由鍵盤展開。

目標 K 線圖選擇與新增圖表控制 MUST 位於結果區的緊湊工具列，並 MUST 保留沒有可用目標時的可讀指引及既有圖表連動隔離。

#### Scenario: 完整資料期間預設收合

- **WHEN** 選股 response 包含 daily、weekly、technical、coverage、counts 與 snapshot time
- **THEN** 面板 MUST 以「資料範圍與完整性」摘要呈現且預設不展開全部明細
- **AND** 使用者展開後 MUST 能讀取 response 原有的完整日期、涵蓋率、缺漏與快照證據

#### Scenario: 有效資料日落後預期資料日

- **WHEN** `expectedSessionDate` 晚於 `effectiveSessionDate`
- **THEN** 面板 MUST 在未展開詳細證據時仍直接顯示日期不一致及主要等待原因
- **AND** 舊 rows 的可操作性 MUST 沿用既有 fail-closed 契約，不得因 UI 收合而恢復

#### Scenario: 服務離線但保留舊結果

- **WHEN** 本機選股服務離線且畫面仍保留最後已套用結果
- **THEN** 離線與舊資料警告 MUST 常駐可見
- **AND** 收合詳細證據 MUST NOT 清除舊結果的條件、來源日期或 snapshot time

#### Scenario: 鍵盤操作緊湊面板

- **WHEN** 使用者在 600 CSS px 高、最小允許面板寬度與特大字級下只用鍵盤選擇群組、展開條件、修改參數、查看資料完整性並提交
- **THEN** 焦點順序、展開狀態、可存取名稱、驗證訊息與主要警告 MUST 可辨識
- **AND** 內容 MUST 透過面板內捲動抵達，不得產生水平 overflow、誤觸 workspace 拖曳或讓收合內容取得不可見焦點
