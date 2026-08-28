## MODIFIED Requirements

### Requirement: D1-first 流程必須只補不足或需更新資料

系統 MUST 先以 D1 或已載入 history 判斷 requested display window、warmup、台股 raw buffer、最新已完成交易日與範圍內 session continuity 是否足夠，再決定是否呼叫上游；provider 無法精準指定缺口時，系統 MUST 使用其支援且足以涵蓋最早缺口的最小合理範圍並保存合併結果。總根數足夠、coverage end 已到齊或曾完成 full fetch，均 MUST NOT 單獨證明台股日 K history 完整。

#### Scenario: D1 已有足夠且連續的歷史
- **WHEN** D1 已保存足以支援 requested display window、warmup 與必要 raw buffer 的資料
- **AND** 該 requested scope 的 continuity 為 complete、最新已完成交易日已到齊且該 key 尚未到 interval refresh 時點
- **THEN** API MUST 直接使用 D1 history 產生 payload
- **AND** API MUST NOT 重新下載相同資料窗

#### Scenario: D1 根數足夠但中間缺少交易日
- **WHEN** D1 rows 已達 required rows
- **AND** requested scope 內仍有未排除的 missing session 或 continuity 為 partial／unknown
- **THEN** 系統 MUST 以既有 rows 為合併基礎啟動 continuity repair
- **AND** MUST NOT 只因 row count、coverage end 或 `full_window_complete` 使用 hit／tail-only 路徑

#### Scenario: D1 只有部分歷史
- **WHEN** D1 rows 不足以支援 requested display window 與 warmup
- **THEN** 系統 MUST 以既有 rows 為合併基礎
- **AND** 系統 MUST 向上游取得缺漏區間或 provider 可提供的最小合理歷史範圍
- **AND** 成功結果 MUST 寫回 D1 後再裁切回應

#### Scenario: 已到達 provider 最早邊界
- **WHEN** D1 與上游合併後仍無法增加更早 candle
- **THEN** `dataWindow.hasMoreBefore` MUST 表示沒有更多更早資料
- **AND** 前端 MUST 能停止在相同邊界重複補載
- **AND** 台股日 K MUST 將 provider earliest boundary 與 session continuity 分開回報，不得以沒有更早資料冒充 gap-free

#### Scenario: Full-window 狀態必須可重新計算
- **WHEN** requested range 擴大、expected completed session 前進、偵測到新缺口或既有 continuity evidence 過期
- **THEN** `full_window_complete` MUST 可由完成回復為未完成
- **AND** 系統 MUST 依新 requested scope 重新稽核，不得永久沿用過去 full fetch 的完成狀態

### Requirement: 快取刷新與失敗必須保守標示

系統 MUST 依 interval 使用不同 freshness／refresh 規則；持久化資料足夠不得永久阻止最新尾端刷新，D1 hit 也不得自動等同報價 fresh、verified 或 session-continuous。台股日 K 的 refresh 決策 MUST 同時考慮最早缺口、最新已完成交易日與 continuity evidence。

#### Scenario: History 仍新鮮、足夠且連續
- **WHEN** history 在該 interval 的有效期限內、rows 足夠、requested scope continuity complete 且最新已完成交易日已到齊
- **THEN** 系統 MUST 可直接使用快取產生回應
- **AND** cache metadata MUST 表示 `hit` 或等效狀態

#### Scenario: History 已過期但尾端刷新成功
- **WHEN** 持久化 rows 與 continuity 足夠但已到刷新時點
- **THEN** 系統 MUST 取得至少能更新最新尾端的上游資料
- **AND** 合併、upsert 與 continuity 重算完成後 metadata MUST 表示 `refreshed` 或等效狀態

#### Scenario: 舊缺口超出固定 tail
- **WHEN** 台股日 K 的最早 missing session 早於固定 tail 可涵蓋範圍
- **THEN** 系統 MUST 動態擴大 provider range 或執行 full／官方定點修復
- **AND** metadata MUST 反映實際 repair mode，不得只刷新尾端後標示 complete

#### Scenario: 上游失敗但仍有舊 history
- **WHEN** refresh、backfill 或 continuity repair 失敗且 D1 或既有 history 仍有可顯示資料
- **THEN** API MUST 保留既有 candle 與 indicators
- **AND** quote freshness、cache metadata 與 continuity metadata MUST 明確標示 stale、partial 或 unknown
- **AND** response MUST NOT 包含秘密或完整上游錯誤

#### Scenario: Yahoo-backed 商品完全沒有可用資料
- **WHEN** Yahoo-backed 商品的 D1、記憶體與上游都無法提供合法 candle
- **THEN** API MUST 維持既有安全錯誤 response 與 HTTP status
- **AND** 系統 MUST NOT 以 sample candle 冒充該 Yahoo-backed 商品的真實市場資料
- **AND** Hyperliquid 既有 sample fallback 不在本變更範圍內

### Requirement: K 線歷史 parity 必須通過自動與正式站驗收

系統 MUST 在 migration、unit、Worker integration、concurrency、台股 session continuity、cache invalidation、strict OpenSpec、build 與 browser history acceptance 通過後才部署，並以正式 Sites 驗證較大 display window、D1 重用、缺口修復與可視範圍保持。

#### Scenario: 自動測試涵蓋核心資料契約
- **WHEN** 本變更完成實作
- **THEN** 測試 MUST 涵蓋 migration schema、merge 去重、尾端覆蓋、D1 hit／miss／backfill、interval policy、single-flight、stale fallback、warmup、台股占位正規化、內部交易日缺口、休市／停牌排除、dynamic range、官方定點修復與 payload cache invalidation
- **AND** MUST 包含「row count 足夠但 2026-07-31 至 2026-08-17 中間缺少十個大立光交易日」的 fixture
- **AND** `npm run lint`、`npm test` 與 `openspec validate --all --strict` MUST 通過

#### Scenario: Browser 歷史縮放驗收
- **WHEN** browser runner 在一圖模式向左縮放或平移至資料邊界
- **THEN** candle 數 MUST 增加或 API 明確表示沒有更多歷史
- **AND** 成功補載時原 visible logical range MUST 依新增 candle 數平移並保持同一批可視 K 棒
- **AND** 主副圖對齊、已選 indicators、overlay 與 console MUST 無回歸

#### Scenario: Browser 台股缺口驗收
- **WHEN** 實際 MultiView 載入曾含內部缺口的 `3008.TW` 日 K
- **THEN** 2026-07-31 至 2026-08-17 之間 MUST 顯示官方證明有成交的十根日 K
- **AND** panel loaded state、canvas 尺寸、日期讀值、主副圖對齊與 console MUST 通過驗收

#### Scenario: 正式 Sites D1 重用驗收
- **WHEN** 正式站先請求預設 display window，再請求相同 key 的較大 window，並重複相同請求
- **THEN** API MUST 回傳相容 payload、continuity metadata 與可診斷的 cache lifecycle
- **AND** 重複請求 MUST 使用 D1 或已合併 history，避免重新下載相同完整資料窗
- **AND** 已知內部缺口 MUST 觸發 repair 而非因 D1 hit 被掩蓋
