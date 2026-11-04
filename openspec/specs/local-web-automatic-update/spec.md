# 本機 Web 自動更新與畫面接續

## Purpose

為本機 Vite 看盤頁建立獨立於 HMR 事件的版本偵測，在操作結束及狀態可驗明保存後自動載入新版，恢復各分頁的原清單、canonical 商品、工作區及逐圖視窗；保留原行情與交易安全權威，不把此能力外推為桌面安裝包或遠端靜態站自動升級。

## Requirements

### Requirement: 本機前端必須獨立偵測已穩定的新版
系統 MUST 在本機 Vite Web 的 HTML 標示實際載入的來源版本，並以每 15 秒的本機唯讀 GET 核對磁碟來源 SHA-256。版本計算 MUST 排除秘密檔、測試與 symlink，不輸出來源內容或檔案路徑。候選新版 MUST 至少兩次相同且相隔 2 秒才允許更新，不得依賴 HMR WebSocket 已送達。

#### Scenario: 漏接 HMR 仍有新版
- **WHEN** 分頁未收到 HMR 事件，但本機 GET 兩次確認同一合法新版
- **THEN** 系統 MUST 進入保存後自動重載流程，不要求使用者每次手動重新整理

#### Scenario: 同版、變動中或讀取失敗
- **WHEN** 版本相同、候選仍在變動、離線、逾時或格式不合法
- **THEN** 系統 MUST 保留目前畫面，不重載；失敗後重新確認候選，並避免平行檢查及同一輪重複 reload

### Requirement: 一般前端更新必須等待操作與可靠保存
一般 src／public 來源更新 MUST 由可交接保存的 client 主導，不先透過普通 HMR 重建圖表。輸入、拖曳、選單、指標對話框、背景分頁或最近一秒仍有操作時 MUST 延後。更新 MUST 先擷取各圖視窗，再保存頁面交接並讀回確認；缺少頁面 checkpoint、已知指標／畫線保存失敗或寫入不可驗明時 MUST NOT 由版本檢查強制重載。

#### Scenario: 設定對話框尚未關閉
- **WHEN** 已偵測到新版，但指標設定視窗仍開著
- **THEN** 原設定視窗與畫面 MUST 保持；關閉後在安全條件成立時自動接續

#### Scenario: 交接保存失敗
- **WHEN** 任一必要 checkpoint 拒絕或 sessionStorage 讀回不一致
- **THEN** 系統 MUST 延後自動更新，不能以丟失原狀態換取強制 reload

### Requirement: 重載必須延續各分頁原商品清單及圖表設定
系統 MUST 延續原 workspace／鎖定商品、每頁清單 ID、canonical 全域與逐圖商品、逐圖週期及 daily generation，沿用既有已儲存的指標與完成畫線。交接 MUST 限每分頁、同版型 scope、60 秒內且單次消費；新分頁一般導覽或跨 scope MUST 不套用他頁交接。交接 MUST NOT 包含 Snapshot、帳務、秘密或待送出的交易動作；原商品復原驗真與取消契約 MUST 沿用 hmr-selection-continuity。

#### Scenario: 非清單首檔與日 K 自動接續
- **WHEN** 原分頁看的是非首檔商品與 1D，並完成自動 reload
- **THEN** 原清單、商品及週期 MUST 恢復，metadata 解析期間不得短暫改選清單第一檔

#### Scenario: 同頁改選與多分頁
- **WHEN** 同一版型分頁改選清單後發生 reload，或另一個新分頁從 URL 開啟
- **THEN** reload MUST 優先恢復該頁保存的清單；新分頁一般導覽 MUST 不消費其他分頁的狀態，且不回寫 profile 或服務端清單內容

### Requirement: 圖表視窗復原必須依同商品週期及實際錨點
系統 MUST 保存每圖的實際 K 棒時間錨點、相對 logical range、autoScale／手動價格範圍與分區高度，僅在同商品、同週期及錨點已重新取得時套用；歷史前補 MUST 不造成原 K 棒位置錯移。

#### Scenario: 歷史前補後恢復視窗
- **WHEN** 更新後資料在原序列之前新增歷史 K 棒
- **THEN** 系統 MUST 以原實際時間錨點重新定位範圍，保留縮放、價格軸模式及分區高度

#### Scenario: 商品週期或錨點不符
- **WHEN** 已切換商品／週期，或原時間錨點尚未取得
- **THEN** 系統 MUST 暫不套用不相符視窗，不改抓額外歷史或捏造資料以冒充復原
