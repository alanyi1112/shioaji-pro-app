## MODIFIED Requirements

### Requirement: 五年缺口與最新資料必須由耐久背景工作補齊

系統 MUST 提供不依賴 chart panel 流量的耐久背景流程，從目前 deployment 的 D1 actual coverage 規劃五年缺口與最新交易日更新。工作 MUST 保存 durable job、checkpoint、lease、attempt、last success、next retry、deployment target 與安全 reason code，並可在 Worker、workflow 或程序中斷後從未完成 checkpoint 續跑。Codex Sites 與 Cloudflare 使用獨立 D1 時，兩者 MUST 使用 target-specific run／credential／concurrency，且不得互相冒用完成狀態。

#### Scenario: 首次使用建立五年回補工作
- **WHEN** 合資格商品 D1 沒有至少 252 筆有效估值資料或五年 coverage 有缺口
- **THEN** API MUST 立即回傳目前 coverage 並建立或重用單一背景 job
- **AND** panel request MUST NOT 同步等待完整五年下載與 D1 寫入才回應

#### Scenario: 沒有使用者開啟圖表仍補最新資料
- **WHEN** 已追蹤商品進入新的台灣交易日且官方資料已發布
- **THEN** 該 deployment 的排程工作 MUST 主動取得並保存最新官方 P/E／收盤資料
- **AND** 更新 MUST NOT 依賴任何 panel request、browser session 或使用者登入中狀態

#### Scenario: 工作中斷後續跑
- **WHEN** workflow、Worker 或 ingest 在部分月份完成後中斷
- **THEN** 下一次相同 target runner MUST 從未完成 checkpoint 繼續
- **AND** completed checkpoint 與既有有效 row MUST NOT 被重抓、刪除或降級

#### Scenario: 每日最新資料暫未發布
- **WHEN** 排程執行時 TWSE／TPEx 尚未發布當日資料
- **THEN** job MUST 保存實際 source date 與 bounded next retry
- **AND** MUST NOT 以日曆日期、K 線日期或 requested end 偽造 coverage end

#### Scenario: 同商品多個觸發來源
- **WHEN** 首次勾選、每日排程與重複 panel request 同時要求相同商品
- **THEN** 系統 MUST 在相同 deployment 內以 symbol job dedupe／single-flight 只保留一個有效 owner／lease
- **AND** 其他請求 MUST 共用同一進度，不得重複消耗免費 API 額度

#### Scenario: 兩個 deployment 都需要相同歷史來源
- **WHEN** Codex Sites 與 Cloudflare 的獨立 D1 都缺少相同 symbol／month
- **THEN** source adapter MAY 重用一次合法下載後的 bounded normalized payload 依序 ingest 至兩個 target
- **AND** 每個 target MUST 各自驗證、冪等寫入與保存完成狀態

### Requirement: 免費來源的授權、顯名與存取邊界必須可見且可驗證

系統 MUST 標示原資料提供機關、FinMind 作為歷史 API intermediary，以及政府資料開放授權條款第 1 版。FinMind 免費資料 MUST 只用於 Codex Sites owner-only 或 Cloudflare 擁有者控管之小規模 private／custom、非商業且不提供原始資料再散布的河流圖服務；API 與 UI MUST 只揭示必要的單日 readout、衍生 percentile 與來源 metadata，不得提供五年原始 P/E／價格資料 dump 或建立等同 FinMind 的鏡像服務。

#### Scenario: 顯示上市資料來源
- **WHEN** 河流圖使用 FinMind seed 與 TWSE 官方最新快照
- **THEN** readout／說明 MUST 標示「原資料提供機關：臺灣證券交易所」與「歷史資料介接：FinMind」
- **AND** MUST 揭示政府資料開放授權或等價 attribution 連結

#### Scenario: 顯示上櫃資料來源
- **WHEN** 河流圖使用 FinMind seed 與 TPEx 官方最新快照
- **THEN** readout／說明 MUST 標示「原資料提供機關：證券櫃檯買賣中心」與「歷史資料介接：FinMind」
- **AND** MUST NOT 把 FinMind 描述成交易所或官方授權代理機構

#### Scenario: 嘗試取得五年原始資料
- **WHEN** 前端或未授權呼叫者要求逐日原始 P/E／收盤完整 dump
- **THEN** 公開 API MUST 拒絕或不提供該資料形態
- **AND** 只允許既有河流圖所需的衍生 points、倍率、coverage 與單日 readout

#### Scenario: 私人小群組以 Google 登入
- **WHEN** Cloudflare deployment 只允許 Access 驗證且存在於 owner 管理之 D1 active 登入名單的少數 Google email
- **THEN** 系統 MAY 維持私人、非商業的免費來源管線
- **AND** response MUST 不提供可重建五年原始資料集的 bulk export

#### Scenario: 存取模式不再是私人小群組
- **WHEN** 任一正式站準備改為 public、workspace-wide、顯著擴大為非私人小群組或商業用途
- **THEN** 發布流程 MUST 將 FinMind 免費歷史管線標示為需要重新授權審查
- **AND** 在取得相應許可前 MUST NOT 宣稱該免費來源可供公開或商業再利用
