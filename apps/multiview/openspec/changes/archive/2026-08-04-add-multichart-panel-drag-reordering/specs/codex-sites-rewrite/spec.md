## ADDED Requirements

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
