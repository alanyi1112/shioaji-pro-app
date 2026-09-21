## MODIFIED Requirements

### Requirement: 歷史 bootstrap 必須以市場日期批次且有界續跑

背景 operator MUST 以 `market + session` 建立 deterministic target、cursor 與 checkpoint，同一正式回應服務該市場當日全母體。planner MUST 以目前 universe、listing date、既有 canonical rows、來源 schema 與 receipt coverage 算出實際缺口，不得僅因 universe revision、商品名稱或無關市場異動就使所有已驗證 target 失效。每次 run MUST 有固定 request／時間 budget、single-flight、完整 fetch＋body timeout、冷卻、Retry-After 與有界 retry；中斷或本機休眠後 MUST 從未完成 target 續跑，不得改成逐商品無界併發。

#### Scenario: Run 達到 budget

- **WHEN** operator 尚有目標但已達 request 或時間上限
- **THEN** 系統 MUST 保存 target／processed／remaining／failed／overdue／cursor，並在下次從 cursor 續跑

#### Scenario: 同一市場日期重跑

- **WHEN** 某 market／session 已有相同或較新且完整的 verified receipt，且目前 universe 的合資格商品 rows 已涵蓋
- **THEN** operator MUST 重用完成狀態，不得再次抓取或重寫未變資料

#### Scenario: Universe revision 只移除或改名

- **WHEN** universe revision 改變但既有 symbol 集合沒有新增合資格商品，或只發生名稱／分類 metadata 更新
- **THEN** 已驗證 60 日 OHLC targets MUST 維持完成，不得重新排入 120 個全量工作

#### Scenario: 來源 rate limit

- **WHEN** 官方來源回 429 或合法 Retry-After
- **THEN** operator MUST 進入有界冷卻並保存安全 reason，不得 busy-loop 或改找未核准入口

### Requirement: 新商品必須自加入母體起納入 OHLC 準備

當 universe revision 新增合法上市／上櫃普通股時，系統 MUST 依上市日、現有 60 日 session plan 與逐商品 canonical row coverage，只建立該商品可合法取得且實際缺少的歷史資料。市場日報雖可服務整個市場，既有商品的已驗證 rows 與 receipts MUST 保留；系統 MUST NOT 將商品加入自選清單、啟動 Shioaji 訂閱、修改個人 TDCC 長歷史 target 或抓取上市前 K 棒。

#### Scenario: 新上市商品不足 21 日

- **WHEN** 新商品上市日至 D 少於 BOLL 所需交易日
- **THEN** 系統 MUST 保存可取得的官方 OHLC 並回 `insufficient_history`，不得使用上市前日期或其他商品資料補足

#### Scenario: 既有商品新進母體但歷史可取得

- **WHEN** universe revision 首次納入某商品且官方歷史批次涵蓋必要日期
- **THEN** 背景 planner MUST 只補該商品缺 row 所在市場／日期，其他市場與已有完整 coverage 的日期不得重抓

#### Scenario: 每日 window 推進一日

- **WHEN** universe symbol 集合未變且最新完整交易日由 D-1 推進至 D
- **THEN** planner MUST 只新增 D 的 TWSE／TPEx 必要 target，並重用其餘 59 日的已驗證 coverage

### Requirement: v3 發布必須以全市場批次終態為 gate

publisher MUST 先核對所有預期 market／session receipt、universe total、逐市場守恆、snapshot staging row count 與日期一致性。只有每個 target 已 collected 或為可解釋正式終態、staging rows 等於 universe total，且 `base.expectedSessionDate`、`base.anchors.daily.current`、`technicalAnchors.through` 與 `effectiveSessionDate` 完全相等，才能原子發布 v3；部分日期、部分市場、只有自選清單資料或 mixed-session 時 MUST 保留最後合法 snapshot。

#### Scenario: 個別商品有合法缺日

- **WHEN** 所有市場日期批次都已處理，但某商品因停牌或新上市缺必要 OHLC
- **THEN** 系統 MAY 發布涵蓋全母體的 v3 snapshot，該 row MUST 為明確 unknown，守恆計數仍須成立

#### Scenario: TPEx 某日期尚未處理

- **WHEN** TWSE 已完整但任一必要 TPEx session 尚未進入正式終態
- **THEN** 系統 MUST NOT 將 v3 宣告為全市場完成或發布部分 TPEx snapshot

#### Scenario: 日量已到 9 月 2 日但技術 OHLC 只到 9 月 1 日

- **WHEN** v2 `anchors.daily.current` 為 2026-09-02，而 OHLC progress 的 `through` 為 2026-09-01
- **THEN** publisher MUST 回明確 pending／mixed-session reason並拒絕發布 v3
- **AND** MUST NOT 將 2026-09-02 日量與 2026-09-01 分型／布林證據組合成同一 snapshot
