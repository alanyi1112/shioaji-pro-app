## MODIFIED Requirements

### Requirement: 版面選單必須以新分頁開啟盤中選股 workspace

RealTimeStock 本機主介面的 viewport-safe「版面」選單 MUST 提供「盤中選股」入口。啟用後 MUST 同步開啟同源完整交易終端新分頁，保留頂部工具列，並套用專用 route／workspace identity；MUST NOT 在來源主頁套用 preset、覆寫 current workspace、切換自選清單或變更選取商品。

直接開啟合法盤中選股 URL MUST 顯示相同完整 workspace。開新分頁 MUST 保留 `noopener` 隔離；`window.open` 因 `noopener` 回傳 `null` 時，來源頁 MUST NOT 將其當成 popup 已被阻擋的證據並顯示自製警告。popup 真正被阻擋時 MUST 保留瀏覽器原生可操作的阻擋指示與相同入口的重試能力；本機監控服務不可用時 MUST 在新頁提供可操作原因。任何失敗都 MUST NOT 誤報為監控已啟動或自行啟停服務。

#### Scenario: 從版面選單開啟盤中選股

- **WHEN** 使用者在「版面」選單啟用「盤中選股」
- **THEN** 系統 MUST 同步開啟或聚焦專用新分頁，並保留來源主頁的 workspace、自選清單與選取商品
- **AND** 新分頁 MUST 取得自己的 selection generation 與 page lease identity

#### Scenario: `noopener` 開頁回傳空值

- **WHEN** 使用者啟用「盤中選股」，瀏覽器以 `noopener` 開啟新分頁並讓 `window.open` 回傳 `null`
- **THEN** 來源頁 MUST NOT 顯示「瀏覽器已阻擋」或其他肯定開頁失敗的自製 alert
- **AND** 來源頁 MUST NOT 變更目前版面、自選清單或選取商品

#### Scenario: 直接開啟盤中選股網址

- **WHEN** 使用者從書籤或貼上合法盤中選股 URL
- **THEN** 系統 MUST 顯示完整交易終端、盤中監控、達標結果與 K 線，不得退回只有設定表單的獨立根頁面

#### Scenario: popup 或服務不可用

- **WHEN** 新分頁被瀏覽器阻擋，或盤中監控本機服務無法回應
- **THEN** 系統 MUST 保留瀏覽器原生阻擋指示及相同入口重試能力，或在已開啟的新頁顯示精確可操作的服務錯誤原因
- **AND** 系統 MUST NOT 修改來源 workspace 或自動啟動／重啟任何 runtime
