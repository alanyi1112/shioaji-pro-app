## ADDED Requirements

### Requirement: MultiView 必須從乾淨且固定的授權版本匯入
系統 MUST 只從 `alanyi1112/MultiChartOnCodexSite` 完成授權整理後的乾淨 commit 匯入 `apps/multiview/`，並 MUST 在 `UPSTREAM.md` 保存 repository URL、branch、完整 commit SHA、匯入日期、匯入方式、授權與本地修改摘要。浮動 branch、dirty sibling checkout 或未追蹤檔案 MUST NOT 成為匯入來源。

#### Scenario: 固定來源版本匯入
- **WHEN** 實作者準備把 MultiChart 原始碼納入 RealTimeStock
- **THEN** 匯入工具只讀取已記錄的完整 SHA，且匯入後檔案可追溯至該 SHA
- **AND** `UPSTREAM.md` 不得只記錄 `main`、`latest` 或其他浮動名稱

#### Scenario: 現有 checkout 有未追蹤內容
- **WHEN** sibling repo 存在未提交、未追蹤或不同 branch 的內容
- **THEN** 系統 MUST 使用乾淨 clone／fetch 或等效隔離 worktree 取得固定 SHA
- **AND** 未追蹤內容 MUST NOT 被複製進 `apps/multiview/`

### Requirement: 自有程式與第三方套件授權必須分開保存
MultiChart 自有程式 MUST 明確採 `AGPL-3.0-only`；TradingView Lightweight Charts v5.0.9 MUST 維持 `Apache-2.0`，且系統 MUST 保存完整 Apache 授權副本、官方 NOTICE、版本、來源與使用方式。系統 MUST NOT 將第三方程式誤標成自有 AGPL 程式。

#### Scenario: 驗證來源 repo 授權文件
- **WHEN** 授權整理 commit 進入匯入候選
- **THEN** repo 根目錄 MUST 有完整 AGPL `LICENSE`、`package.json` 的 `AGPL-3.0-only`、README 授權段落與 `THIRD_PARTY_NOTICES.md`
- **AND** Lightweight Charts 項目 MUST 記錄 v5.0.9、Apache-2.0、TradingView copyright 與官方來源

#### Scenario: 發現非本人或授權不明程式
- **WHEN** ownership、dependency 或 vendored asset 掃描發現共同作者、未知來源或不相容授權
- **THEN** 對應檔案 MUST 在取得許可、確認相容或完成替換前阻擋正式匯入
- **AND** 系統 MUST NOT 以「公開在 GitHub」當成可重新授權的證據

### Requirement: 使用者介面必須提供 TradingView attribution
MultiView 的使用者可見頁面 MUST 提供 TradingView Lightweight Charts attribution 與指向 `https://www.tradingview.com/` 的安全連結，並 MUST 提供可閱讀的專案及第三方授權入口。attribution MUST NOT 暗示 TradingView 為本產品背書。

#### Scenario: 使用者開啟 MultiView
- **WHEN** MultiView 頁面完成載入
- **THEN** 使用者可在頁尾、關於或授權入口看見 Lightweight Charts／TradingView attribution 與官方連結
- **AND** 連結在新分頁開啟時 MUST 使用安全的 `noopener noreferrer`

### Requirement: Lightweight Charts 必須使用本機固定 dependency
MultiView MUST 以 lockfile 固定的本機 `lightweight-charts` v5.0.9 dependency 建置，不得在 runtime 從 unpkg、jsDelivr 或其他第三方 CDN 載入圖表核心。將版本升至 5.2.0 或其他版本 MUST 經獨立公式、互動、pane、圖片輸出與 browser 回歸後才可調整固定版本。

#### Scenario: 離線啟動 MultiView
- **WHEN** 本機沒有網際網路但 dependency 已安裝且本機服務正常
- **THEN** 圖表核心 MUST 從本機 bundle 載入並可建立圖表
- **AND** 頁面 MUST NOT 對 unpkg 或其他圖表 CDN 發出 runtime request

#### Scenario: 未經驗證嘗試升版
- **WHEN** dependency resolution 產生非 5.0.9 的 Lightweight Charts 版本
- **THEN** lockfile／版本 gate MUST 失敗，直到完成明確的升版規格與回歸證據

### Requirement: 後續 upstream 更新必須可審查且不可自動漂移
每次更新 MultiView upstream MUST 比較目前 import SHA 與候選 SHA 的程式、schema、來源、授權、依賴與 OpenSpec 差異，並提升可見的 import revision。build 與 runtime MUST NOT 自動追蹤遠端 branch 或在啟動時抓取 upstream 原始碼。

#### Scenario: upstream 發布新提交
- **WHEN** 參考 repo 在固定 SHA 之後新增功能或修正
- **THEN** 現有 RealTimeStock build MUST 維持原 import revision
- **AND** 只有完成差異審查、測試與 provenance 更新的變更才能更新匯入內容
