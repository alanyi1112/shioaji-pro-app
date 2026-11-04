# 自選清單左鍵導覽

## Purpose

讓使用者在既有看盤版面透過自選清單下拉選單完成左鍵單擊切換與雙擊新分頁，明確定義版面入口和分頁清單的隔離、鍵盤焦點及取消行為；保留服務端清單內容與交易快捷鍵邊界，避免雙擊先改變原頁選擇。

## Requirements

### Requirement: 左鍵單擊及雙擊必須分流且互斥
系統 MUST 在自選清單下拉選單以左鍵單擊切換目前分頁清單，保留約 500ms 的雙擊判斷窗口。同一清單於窗口內第二次左鍵 MUST 取消單擊且只開啟一個新分頁，不先切換原分頁。不同清單的連點 MUST 不被當成雙擊，右鍵 MUST NOT 觸發上述自訂動作。

#### Scenario: 單擊另一份清單
- **WHEN** 使用者只左鍵點擊另一份清單一次，且判斷窗口結束
- **THEN** 目前分頁 MUST 切到該清單，不開啟新分頁

#### Scenario: 雙擊另一份清單
- **WHEN** 使用者在判斷窗口內連續左鍵點擊同一清單兩次
- **THEN** 系統 MUST 只另開一個分頁，原分頁 MUST 保留原清單

#### Scenario: 不同選項或取消待執行選取
- **WHEN** 使用者改點其他清單、點到外部、焦點離開、關閉選單或卸載元件
- **THEN** 過時的單擊 MUST 被取消，不得稍後覆寫目前選擇或錯開分頁

### Requirement: 新分頁必須保留版面入口與清單選擇隔離
另開 URL MUST 保留目前 pathname、layout、profile 等查詢參數，以 watchlist 參數指定所選清單，並使用 `_blank`／`noopener`。初始化 MUST 讓合法指定清單優先於全域上次選擇，且不覆寫原全域偏好；目前 URL 已含 watchlist 時，手動改選 MUST 同步更新自己的 URL。

#### Scenario: 雙擊已儲存版型中的清單
- **WHEN** 原頁面入口為 saved-profile 且具有 profile 名稱
- **THEN** 新分頁 MUST 保留該入口及 profile，載入指定清單，不改原分頁選擇或服務端清單內容

#### Scenario: 重試及無效 URL 清單
- **WHEN** 清單服務重試，或 URL 指定清單不存在
- **THEN** 重試 MUST 優先保留目前仍存在的選擇；無效指定值 MUST 沿既有上次／預設／第一份清單 fallback，不自行建立清單

### Requirement: 清單選單必須支援鍵盤與焦點隔離
系統 MUST 提供可辨識的 listbox／option，支援方向鍵、Home／End、Enter／空白鍵；鍵盤啟用 MUST 立即選取而不等待雙擊。Escape MUST 關閉選單且不傳給交易快捷鍵，焦點離開選單與觸發鈕 MUST 關閉選單並取消待執行動作。

#### Scenario: 鍵盤選取與離開
- **WHEN** 使用者以鍵盤移動選項並按 Enter 或空白鍵，或以 Escape 離開
- **THEN** 選取 MUST 立即生效；Escape MUST 只關閉此選單，不觸發交易快捷鍵
