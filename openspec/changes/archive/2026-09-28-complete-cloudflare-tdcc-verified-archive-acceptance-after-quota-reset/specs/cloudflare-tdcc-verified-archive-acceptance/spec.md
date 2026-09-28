## ADDED Requirements

### Requirement: Cloudflare TDCC 維護必須受 D1 額度恢復 gate 約束
系統 MUST 在任何 Cloudflare D1 migration、seed 或 workflow 寫入前，先以唯讀方式確認額度與寫入能力已恢復；限制仍存在時 MUST 停止並保留未完成狀態。

#### Scenario: D1 額度仍受限
- **WHEN** 唯讀檢查顯示 Cloudflare D1 免費額度或寫入能力尚未恢復
- **THEN** 系統不得執行 migration、seed、workflow dispatch 或資料寫入，且不得勾選後續驗收項目

#### Scenario: D1 額度已恢復
- **WHEN** 唯讀檢查證明 Cloudflare D1 可安全執行 bounded migration 與資料寫入
- **THEN** 系統才可記錄當時 exact deployment SHA 並進入後續步驟

#### Scenario: 當日額度統計尚未完成更新
- **WHEN** Cloudflare 儀表板與 D1 Insights 無法即時提供一致的當日用量
- **THEN** 系統 MUST 暫停新增 dispatch，於當日後續時段重新核對；只有用量已更新且下一批含索引成本與正常服務預留均可容納才可續補，否則等額度重置

### Requirement: Cloudflare verified archive 必須產生獨立且守恆的完成證據
Cloudflare 正式站 MUST 以當時 exact release 執行 additive migration、verified manifest seed 與 fresh workflow，並獨立回報 manifest、validator、immutable archive commit、逐 period receipts 與 target／processed／remaining／failed／overdue。

#### Scenario: Fresh archive workflow 完成
- **WHEN** Cloudflare fresh workflow 完成固定 18 期 verified archive bootstrap
- **THEN** target 與 processed MUST 均為 18，remaining、failed、overdue MUST 均為 0，且每一期 receipt MUST 通過 hash、schema、欄位與官方錨點驗證

#### Scenario: 任一守恆或驗證失敗
- **WHEN** period hash、schema、官方錨點、target 守恆或 readback 任一項不一致
- **THEN** 系統 MUST fail closed、保留既有 verified rows，並不得宣告 Cloudflare bootstrap 完成

#### Scenario: 免費額度下的逐日續跑
- **WHEN** 18 期 bootstrap 無法在單一 D1 免費額度日內安全完成
- **THEN** workflow MUST 以逐期原子 finalize 續跑、不得重寫已完成 period，且每批前後 MUST 核對全帳戶實際餘額及索引成本；餘額充足可於同一 UTC 額度日串行執行多批，不得並行或重寫已完成 period

### Requirement: Archive 完成與 official 51 週完整度必須分列
Cloudflare health 與驗收證據 MUST 分別揭露快速 archive coverage 與 official 51 週補缺狀態，不得將 archive complete 解讀為 official history complete。

#### Scenario: Archive 完成但 official history 尚有缺口
- **WHEN** 18 期 archive receipts 全部完成但 official plan 仍有 missing dates
- **THEN** UI 與 API MUST 顯示可用的 verified archive 資料及實際 remaining weeks，並由 bounded official lane 在背景補缺

#### Scenario: Archive 與 official history 都完整
- **WHEN** archive receipts 與 official 51 週計畫各自達成完成條件
- **THEN** health MUST 分別回報兩條 lane 的 all-zero remaining／failed／overdue 證據

### Requirement: Cloudflare 新增商品 warm path 必須只讀取 D1
當新增商品已有至少兩期 verified D1 shareholder-distribution rows 時，互動 API MUST 直接回傳 `cache.mode=d1_hit`，不得等待或呼叫 TDCC、archive mirror 或 official provider。

#### Scenario: 新增商品已有多期 D1 資料
- **WHEN** owner 將先前不在個人清單的支援商品加入 Cloudflare 正式站，且 D1 已有至少兩期 verified rows
- **THEN** fresh protected request MUST 回 `d1_hit` 並立即提供可比較的大戶與散戶歷史

#### Scenario: D1 資料仍不足
- **WHEN** 新增商品只有零期或一期 verified D1 rows
- **THEN** 系統 MUST 誠實顯示 partial／準備中狀態並交由 bounded 背景 lane 補足，不得以假歷史或錯誤週變化填補

### Requirement: Cloudflare owner UI 驗收必須逐商品取得實際證據
完成驗收 MUST 在已登入 Cloudflare Access 的 owner 身分瀏覽器，核對 8103、代表性 `.TW`、`.TWO` 與 ETF 的商品選擇、持股副圖 DOM、可見 canvas、日期、週變化、狀態文案、console 與 network。

#### Scenario: 代表商品 UI 通過
- **WHEN** owner 新增或開啟代表商品並重整圖表
- **THEN** 大戶與散戶副圖 MUST 顯示實際 verified dates 與數值、canvas MUST 可見、console MUST 無相關 error，network MUST 無非預期外部資料 request

#### Scenario: Access 人機驗證尚未完成
- **WHEN** Cloudflare Access 仍停留在 passkey 或其他人機驗證頁
- **THEN** 驗收 MUST 保持未完成，且不得使用 machine bypass、其他環境畫面或 `SAMPLE` 資料冒充 owner UI 證據

### Requirement: Cloudflare 證據不得由其他環境替代
Cloudflare migration、D1、workflow、health、API 與 UI 證據 MUST 來自同一個已核對的正式站 release；本機、Sites、舊 run、舊 deployment 或 source inspection 不得替代。

#### Scenario: 只有 Sites 或本機已通過
- **WHEN** Sites 或本機已有完整驗收但 Cloudflare 尚未取得 fresh 證據
- **THEN** Cloudflare tasks MUST 保持未勾選，且 change 不得宣告 Cloudflare 驗收完成

#### Scenario: Cloudflare fresh evidence 完整
- **WHEN** exact SHA、獨立 receipts、protected API、DB-only warm path 與 owner UI 均取得同一 release 的實際證據
- **THEN** 系統才可勾選 Cloudflare 完成項目並進入完整測試與歸檔評估
