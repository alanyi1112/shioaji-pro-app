## Purpose

定義永豐金 Shioaji 台股即時行情進入 Cloudflare 正式站時的資料專用閘道、安全隔離、訂閱回補、來源健康與免費額度邊界，確保即時能力失效時既有網站仍可安全降級。

## ADDED Requirements

### Requirement: Shioaji 必須由外部資料專用閘道接入

系統 MUST 由 Cloudflare Workers 外部的常駐行情閘道維持 Shioaji 登入與市場訂閱，並以單一受保護 outbound 連線傳送正規化行情；瀏覽器與一般 Worker MUST NOT 直接登入 Shioaji 或取得其登入秘密。

#### Scenario: 閘道正常連線

- **WHEN** 行情閘道完成資料專用登入且 Cloudflare ingest 驗證成功
- **THEN** 閘道 MUST 只傳送 allowlist 欄位、來源時間、商品代碼、session 與遞增序號
- **AND** Cloudflare MUST 將該連線標示為可供即時行情使用

#### Scenario: 唯一 owner 瀏覽器要求 Shioaji 行情

- **WHEN** Cloudflare 正式站唯一 active owner 開啟支援的台股商品
- **THEN** 瀏覽器 MUST 只連到同源 Cloudflare API
- **AND** response、DOM、前端資產與瀏覽器儲存 MUST NOT 包含 Shioaji 帳號、API key、secret、憑證、cookie 或登入 session

### Requirement: 行情閘道必須與下單能力隔離

行情閘道 MUST 以 data-only 設定執行，不得載入下單憑證、提供委託／帳務路由或訂閱委託成交回報；任何行情 callback MUST 只把資料放入有界佇列，不得在 callback 內執行阻塞工作。

#### Scenario: 檢查正式閘道能力

- **WHEN** operator 檢查閘道設定、health 或公開路由
- **THEN** 可用能力 MUST 僅包含行情登入、商品查詢、行情訂閱、必要歷史回補與安全診斷
- **AND** 下單、改單、刪單、帳務、部位與憑證狀態 MUST 不可由網站或 Cloudflare 呼叫

#### Scenario: 行情佇列達到上限

- **WHEN** 上游 Tick 速度超過閘道送出能力且有界佇列達到上限
- **THEN** 閘道 MUST 保留各商品最新狀態並合併可取代的舊更新
- **AND** MUST NOT 無限制累積記憶體或阻塞 Shioaji callback

### Requirement: Shioaji API key 必須只存在閘道主機的受保護秘密邊界

Shioaji API key 與 secret MUST 只由指定閘道主機的 OS 級秘密儲存或權限受限的 runtime secret provider 注入程序記憶體；MUST NOT 保存於 repository、Cloudflare、Sites、D1、一般 `.env` 備份、前端、CI、OpenSpec、Obsidian、測試資料或支援訊息。

#### Scenario: 閘道正常啟動

- **WHEN** service supervisor 啟動正式行情閘道
- **THEN** credential MUST 由受保護秘密來源注入
- **AND** credential MUST NOT 出現在 command line、process arguments、process listing 或 service 定義明文
- **AND** 只有閘道 service identity MUST 能讀取該秘密

#### Scenario: 開發、測試或文件需要 credential

- **WHEN** 開發者執行本機測試、CI、產生文件或回報錯誤
- **THEN** 系統 MUST 使用假值、simulation adapter 或 `[REDACTED_SECRET]`
- **AND** MUST NOT 要求使用者把真實 API key 或 secret 貼入對話、issue、commit、PR 或 log

### Requirement: 日誌與診斷必須預設防洩漏

gateway、service supervisor、Cloudflare ingest 與 health MUST 採 allowlist logging，只能輸出安全狀態、代碼、時間、筆數、延遲與去識別錯誤碼；request header、環境變數、完整 exception、上游 response、credential 與帳戶識別 MUST NOT 被記錄。

#### Scenario: 登入或 reconnect 失敗

- **WHEN** Shioaji 登入、續線或訂閱發生例外
- **THEN** log MUST 只保存 allowlist phase、時間與安全 reason code
- **AND** MUST NOT dump exception locals、環境變數、完整 request、帳戶物件或 credential

#### Scenario: 自動化檢查輸出

- **WHEN** CI、operator health 或測試檢查 gateway 安全摘要
- **THEN** 輸出 MUST 通過秘密 pattern 掃描
- **AND** 命中疑似 key、secret、authorization、cookie、帳戶識別或未遮蔽 header 時 MUST 使 gate 失敗

### Requirement: Shioaji credential 與 Cloudflare 機器授權必須可獨立輪替

Shioaji 登入 credential、gateway-to-Cloudflare ingest secret 與瀏覽器人員授權 MUST 為三個獨立 trust domain；輪替或撤銷任一項 MUST 不要求把其他秘密複製、輸出或重新發佈到不相關環境。

#### Scenario: 輪替 Cloudflare ingest secret

- **WHEN** operator 輪替 gateway uplink 的機器秘密
- **THEN** Shioaji API key 與 secret MUST 維持不變且不得離開閘道主機
- **AND** 舊 ingest secret MUST 在有限重疊窗口後失效

#### Scenario: 疑似 Shioaji credential 外洩

- **WHEN** 偵測到疑似洩漏、未授權登入或秘密 pattern 命中
- **THEN** operator MUST 能先停用 realtime feature flag 與 gateway
- **AND** MUST 依 runbook 撤銷／輪替 Shioaji credential、清查安全日誌並以新 credential 恢復
- **AND** MUST NOT 在事故紀錄中保存舊秘密值

### Requirement: Ingest 必須驗證來源並防止重送

Cloudflare realtime ingest MUST 使用與 Shioaji credential 無關的 hosted secret、來源時間、連線識別與單調遞增序號驗證閘道資料；失敗、過舊、倒序或重送資料 MUST 被拒絕或去重，且安全摘要不得輸出秘密。

#### Scenario: 合法微批次

- **WHEN** 已驗證閘道送入時間有效且序號大於該連線最後接受序號的微批次
- **THEN** Cloudflare MUST 接受正規化行情並更新對應商品最新狀態
- **AND** health MAY 回報安全的接受筆數、最後來源時間、延遲與商品數

#### Scenario: 偽造、過舊或重送微批次

- **WHEN** ingest 缺少有效機器授權、時間超過容許偏差或序號未前進
- **THEN** Cloudflare MUST 拒絕或忽略該批次
- **AND** MUST NOT 更新行情、建立瀏覽器廣播或在錯誤內容中輸出 credential

### Requirement: 訂閱與回補必須有界、可釋放且立即接續

系統 MUST 以目前預設台股、唯一 owner 清單及其可見 panel 的聯集管理 active universe，遵守內部訂閱上限並保持遠低於 Shioaji provider 上限；清單與 panel demand MUST 以去識別完整集合取代，新增支援商品時 MUST 立即排入訂閱，移除或離線時 MUST 釋放不再需要的 reference，盤中缺少當日開盤至目前資料時 MUST 先執行一次有界回補再接續 Tick。

#### Scenario: 盤中新增支援台股

- **WHEN** 已登入使用者新增合格 `.TW` 或 `.TWO` 商品且 active universe 尚有容量
- **THEN** gateway control plane MUST 立即要求該商品訂閱
- **AND** 系統 MUST 優先使用閘道既有 session buffer，否則只執行一次當日 Kbars 回補
- **AND** 完成部分回補後 MUST 立即顯示已有資料並接續即時 Tick

#### Scenario: 重複新增或多個 panel 需要相同商品

- **WHEN** 同一 canonical symbol 已在 active universe、其他 panel 或正在訂閱／回補
- **THEN** 系統 MUST 共用同一個上游訂閱與回補工作
- **AND** MUST NOT 按 panel 或頁籤重複登入、訂閱或查詢相同歷史

#### Scenario: 清單刪除或瀏覽器離線

- **WHEN** owner 刪除商品、刪除頁籤、panel 不再可見，或瀏覽器 WebSocket close/error
- **THEN** Hub MUST 送出包含空集合在內的最新完整 demand snapshot
- **AND** gateway MUST 釋放已移除商品的動態 reference 並套用 unsubscribe cooldown
- **AND** 預設 universe 的獨立 reference MUST 保留

#### Scenario: 訂閱或歷史查詢達到安全預算

- **WHEN** 新商品會超過設定的 active universe、訂閱、登入、歷史查詢或重試預算
- **THEN** 系統 MUST 保留清單商品但回報 `realtime_unavailable` 或等同狀態
- **AND** MUST 使用既有延遲來源，不得貼近 provider 上限繼續重試

### Requirement: 即時來源失效時必須明確降級

系統 MUST 依來源時間、heartbeat、連線與序號進度判定 Shioaji 為 `live`、`degraded`、`stale` 或 `unavailable`；只有新鮮來源可標示「即時」，其他狀態 MUST 凍結最後即時值或切換為明確標示的 Yahoo 延遲備援。

#### Scenario: Tick 持續新鮮

- **WHEN** 商品來源時間仍在設定的新鮮度門檻內且閘道 heartbeat 正常前進
- **THEN** API 與 UI MUST 將 provider 標示為 Shioaji 並顯示「即時」

#### Scenario: 閘道斷線或行情過期

- **WHEN** heartbeat 中斷、來源時間過期或 reconnect 尚未完成
- **THEN** 系統 MUST 停止宣稱即時並顯示中斷或過期狀態
- **AND** 切換 Yahoo 時 MUST 顯示「延遲備援」
- **AND** MUST NOT 把兩個來源的當日成交量、OHLC 或分時點靜默相加

### Requirement: 正式啟用必須通過使用依據與營運 gate

Cloudflare 正式站的 Shioaji realtime feature flag MUST 預設關閉；只有唯一 active owner 登入限制、已保存不含個資與秘密的使用依據確認、常駐主機就緒，以及至少三個真實交易日的正確性、斷線、延遲、盤後核定與 Free-tier 驗證均通過後才能啟用。網站帳號與 API 登記人相同只是一項風險控制，MUST NOT 被視為授權證據。

#### Scenario: 尚未確認單一 owner 私人自用展示方式

- **WHEN** 尚未取得足以支持 API 登記人本人在私人登入網站自用展示的條款或永豐金確認
- **THEN** production feature flag MUST 保持關閉
- **AND** 網站 MUST 繼續使用既有行情，不得因 Shioaji 未啟用而失效

#### Scenario: pilot 全部 gate 成立

- **WHEN** 使用依據、三個真實交易日、重連、來源比對、Cloudflare 用量與盤後核定證據均成立
- **THEN** operator MAY 逐步啟用受限商品 universe
- **AND** rollback MUST 能只停用 Shioaji 即時來源而不回滾既有網站功能

### Requirement: 即時傳輸不得把 Tick 寫入 D1

逐筆 Tick 與每秒微批次 MUST 只用於記憶體中的最新狀態、短期 session buffer 與瀏覽器廣播，不得逐筆寫入 D1；health MUST 提供不含秘密的 Worker、Durable Object、D1 與閘道使用量以執行 quota circuit breaker。

#### Scenario: 盤中大量成交

- **WHEN** 支援商品在盤中收到大量 Tick
- **THEN** 系統 MUST 以微批次和 latest-value 合併降低 Cloudflare event 數
- **AND** D1 rows written MUST NOT 隨 Tick 數等比例增加

#### Scenario: 免費額度接近安全線

- **WHEN** Worker、Durable Object、D1 或 gateway 指標達到設定安全線
- **THEN** 系統 MUST 依序降低非可見商品、非必要回補與更新頻率
- **AND** 到達硬上限前 MUST 停止新增即時訂閱並保留延遲備援
