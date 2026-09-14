## ADDED Requirements

### Requirement: 專用選股 workspace 必須先於自選清單完成而呈現

版面路由為 `layout=stock-screener` 或 `layout=intraday-stock-selection` 時，系統 MUST 將專用 workspace 的可見性與 server-backed watchlist 初始完成狀態分離。只要 React root 與 grid 容器已就緒，系統 MUST 渲染該 workspace，並只在背景載入 watchlist metadata；一般交易 workspace MUST 保留既有完整啟動政策。

#### Scenario: 從版面選單開啟且 watchlist 尚未完成

- **WHEN** 使用者啟用「版面 → 選股篩選」，新頁已進入 `layout=stock-screener` 但 watchlist 初始化尚未完成
- **THEN** 新頁 MUST 顯示選股與 K 線兩個專用 block
- **AND** MUST NOT 以全頁 loading 遮蔽已可使用的選股功能

#### Scenario: 直接開啟且 watchlist 無回應

- **WHEN** 使用者直接開啟合法的 `?layout=stock-screener` URL，且 watchlist 請求沒有在初始期間回應
- **THEN** 專用 workspace MUST 仍可渲染及操作不依賴 watchlist 的控制

#### Scenario: 盤中選股作用中清單行情持續等待

- **WHEN** 使用者開啟 `layout=intraday-stock-selection`，且作用中自選清單的合約解析或行情訂閱未完成
- **THEN** 新頁 MUST 先顯示盤中監控與 K 線兩個專用 block，不得持續只顯示「載入交易終端…」
- **AND** 開頁 MUST NOT 因作用中清單內容建立 Tick、BidAsk 或 Quote 訂閱
- **AND** watchlist metadata 完成後 MUST 仍可供監控名單匯入使用

#### Scenario: 一般 workspace 維持原啟動契約

- **WHEN** 使用者開啟一般交易 workspace
- **THEN** 系統 MUST 繼續使用其既有 initial loading、watchlist hydrate 與行情啟動政策
