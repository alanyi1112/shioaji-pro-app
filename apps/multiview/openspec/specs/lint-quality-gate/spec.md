# lint-quality-gate 規格

## Purpose

確保專案以零警告 lint、可驗證型別邊界與完整掃描範圍維持長期程式品質，並避免清理技術債時改變既有產品或 runtime 行為。

## Requirements

### Requirement: 全專案 lint 必須零錯誤零警告
系統 MUST 讓 `npm run lint` 掃描既有前端、Worker、測試與建置程式時，以現行 ESLint 規則完成且回報 0 errors、0 warnings；lint script MUST 將任何 warning 視為失敗。

#### Scenario: 乾淨程式碼通過品質閘門
- **WHEN** 開發者在完整專案執行 `npm run lint`
- **THEN** 指令以 exit code 0 完成，且輸出不包含 error 或 warning

#### Scenario: 新 warning 阻擋驗收
- **WHEN** 任一受掃描檔案新增會觸發 ESLint warning 的程式碼
- **THEN** `npm run lint` 必須以非 0 exit code 失敗，避免 warning 重新累積

### Requirement: 動態資料邊界必須具備可驗證型別
系統 MUST 以具名 domain type、最小查詢 projection type、`unknown` 加驗證函式或等效安全方式處理 D1 rows、外部 provider JSON、HTTP request body 與 Worker bindings；系統 MUST NOT 使用明確 `any`、`as any`、廣泛雙重斷言或未驗證的非空斷言規避型別檢查。

#### Scenario: D1 查詢結果有明確欄位契約
- **WHEN** Worker 從 D1 `.first()` 或 `.all()` 讀取查詢結果
- **THEN** 使用端只能透過對應資料表或 SQL projection 所定義的欄位型別存取資料

#### Scenario: 外部 JSON 先驗證再進入 domain logic
- **WHEN** Worker 接收市場資料 provider、TDCC、FinMind 或 HTTP request 的動態 payload
- **THEN** payload 先以不受信任資料處理，並經欄位驗證或既有 parser 正規化後才傳入 domain logic

### Requirement: lint 修正不得以降低覆蓋率達成
系統 MUST 保留目前 lint 對產品原始碼、Worker、測試與必要靜態程式的掃描範圍，且 MUST NOT 透過停用規則、降低嚴重度、加入廣泛 ignore 或整檔 disable comment 讓問題消失。

#### Scenario: 問題檔案仍在掃描範圍
- **WHEN** lint 技術債完成清理
- **THEN** `worker/**/*.ts`、`public/static/**/*.js` 與 `tests/**/*.mjs` 仍由專案 lint 指令檢查

#### Scenario: 局部例外必須有真實外部契約
- **WHEN** 外部 callback 或 runtime interface 強制保留一個本地不使用的參數
- **THEN** 實作只能採用最小範圍且可說明的處理方式，不得關閉整個檔案或規則

### Requirement: 未使用程式碼必須依產品用途處理
系統 MUST 刪除已失效或已被取代的未使用程式碼；仍屬現行產品需求的邏輯 MUST 維持正確呼叫鏈，且不得以無效讀取、虛假引用或純消音命名掩蓋未使用狀態。

#### Scenario: 已被 Sites 實作取代的 helper
- **WHEN** 未使用 helper 已被 Sites identity、D1 清單同步或新版圖表 lifecycle 完整取代
- **THEN** helper 與其專用失效狀態必須移除，既有可見行為保持不變

#### Scenario: 測試中的未使用欄位
- **WHEN** 測試 fixture 或解構包含未參與斷言與行為的欄位
- **THEN** 測試必須縮小到必要輸入，同時保留原本驗證意圖

### Requirement: 清理後必須保持既有產品與 runtime 行為
系統 MUST 在 lint 清理後維持既有 Codex Sites／Cloudflare Workers 相容性、公開 API schema、D1 schema、排程契約、資料結果與前端可見互動；本變更 MUST NOT 新增 runtime secret 或資料 migration。

#### Scenario: 完整自動驗證通過
- **WHEN** 所有 lint 問題已清除
- **THEN** `npm test` 與 `openspec validate --all --strict` 必須通過，且秘密掃描與 `git diff --check` 不得發現問題

#### Scenario: 瀏覽器呼叫鏈被修改
- **WHEN** 清理未使用程式碼或型別邊界影響前端清單、圖表或籌碼副圖呼叫鏈
- **THEN** 必須以最小 browser smoke 驗證相關可見行為、互動與 console 沒有新增錯誤
