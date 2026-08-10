## ADDED Requirements

### Requirement: Cloudflare runtime 必須使用頁面級批次更新

Cloudflare deployment MUST 將可見 panel 的即時更新合併為有界、可取消的頁面級請求；不得為每個 panel 維持無限 server loop。背景分頁、離線狀態與休市期間 MUST 降低頻率或暫停，重新可見時再安全恢復。

#### Scenario: 八圖交易時段更新
- **WHEN** 使用者在前景分頁開啟八圖
- **THEN** 前端 MUST 以單一批次或固定少量 request 更新所有可見 symbol
- **AND** MUST NOT 因八個 panel 建立八條無限 SSE 連線

#### Scenario: 分頁切到背景
- **WHEN** browser visibility 轉為 hidden 或裝置離線
- **THEN** 即時更新 MUST 暫停或切換至明確較低頻率
- **AND** 返回前景後 MUST 以一次 fresh request 恢復，不得累積重送

### Requirement: 多層副圖必須限制瀏覽器繪圖資源

多層副圖模式 MUST 只讓 viewport 內或鄰近 viewport 的籌碼副圖持有實際 chart／Canvas；螢幕外副圖仍 MUST 保留順序、標題與選取狀態，但 MUST 釋放繪圖實例，避免大量 Canvas 使主圖或技術副圖隨機空白。

#### Scenario: 四圖同時選取十二個籌碼副圖
- **WHEN** 四個 panel 各自選取十二個籌碼副圖，但畫面同時只看得到少數副圖
- **THEN** 系統 MUST 只 mount viewport 內與有限鄰近範圍的籌碼 chart
- **AND** 螢幕外 chart MUST unmount 並釋放 Canvas，KD／RSI／MACD／ATR 技術副圖仍 MUST 正常顯示

#### Scenario: 使用者捲動到尚未 mount 的籌碼副圖
- **WHEN** 籌碼副圖進入 viewport 鄰近範圍
- **THEN** 系統 MUST 使用既有 canonical payload 建立 chart 並恢復時間範圍、線圖設定與 readout
- **AND** 離開鄰近範圍後 MAY 釋放 chart，但不得遺失使用者選取與資料狀態

### Requirement: D1 query 與 write 必須有 invocation 安全預算

每個 Cloudflare Worker invocation MUST 對 D1 statements 設定低於平台硬上限的安全預算並預留必要查詢；bulk ingest MUST 採小批次 checkpoint，且只寫入新增或實際變更的 tail rows，不得每輪重寫完整歷史。

#### Scenario: ingestion 超過單次安全批次
- **WHEN** 本次 normalized rows 超過設定的安全 statement 數
- **THEN** Worker MUST 只提交當次 bounded batch 並保存 checkpoint／remaining count
- **AND** 後續 tick MUST 從 checkpoint 續跑而非重寫已完成 rows

#### Scenario: row 與既有內容相同
- **WHEN** 來源 row 的 canonical key 與資料內容和 D1 現有 row 相同
- **THEN** pipeline MUST 將其視為冪等 no-op 或避免 write
- **AND** health MUST 不把 skipped unchanged row 計入新增寫入

#### Scenario: 新掛牌商品的可用歷史短於顯示需求
- **WHEN** full-range source 已完整回傳某商品上市以來資料，但實際 K 棒少於 requested display／warmup rows
- **THEN** 系統 MUST 保存共享 `full_window_complete` 與實際 coverage，並如實顯示可用 K 棒
- **AND** MUST NOT 補造舊 K 棒或因另一帳戶載入而再次執行相同 full-range 抓取

#### Scenario: 台股來源缺少當日 close
- **WHEN** Yahoo 日 K metadata 已進入新 session，但當日 OHLC 任一必要值為空而使當日 K 棒無法成立
- **THEN** 系統 MUST 以同 session 的 TWSE／TPEx 官方盤中或收盤 OHLCV 保守補齊共享 tail，並保存來源
- **AND** 已保存的官方 K 棒 MUST 不被後續較低品質空值／延遲資料降級

#### Scenario: 籌碼來源只更新抓取時間
- **WHEN** 籌碼日資料的數值、provider、dataset、frequency 與 source date 均未變，只有 `fetchedAt` 較新
- **THEN** pipeline MUST 將該 row 視為 canonical 內容相同而不寫入 D1
- **AND** partial dataset update MUST NOT 將其他已完成資料族群的 completeness 改為 false

#### Scenario: 當日來源尚未發布
- **WHEN** 上游成功回傳到前一個可用來源日，requested end 仍尚未發布
- **THEN** Worker MUST 保存實際 coverage／source date、`partial_data` 與最長 30 分鐘的 bounded retry time
- **AND** 冷卻期間的互動式重載 MUST 使用既有資料，不得反覆抓取並重寫完整歷史

### Requirement: 快取必須有 retention 與容量邊界

D1 candle／payload cache MUST 保存明確 expiry，排程或 maintenance tick MUST bounded 清理過期 rows；新 cache 寫入不得無限增加資料庫大小，且 cache miss／清理失敗不得阻斷個人清單功能。

#### Scenario: 過期 cache 累積
- **WHEN** maintenance 發現超過 retention 的 cache rows
- **THEN** 系統 MUST 以小批次刪除並保存 remaining count
- **AND** MUST 不在單一互動式 request 進行無界 full-table cleanup

#### Scenario: cache 暫時不可寫
- **WHEN** D1 cache write 因額度或暫時錯誤失敗
- **THEN** API MUST 回傳可用的 fresh／stale-safe 市場結果或局部失敗
- **AND** 個人頁籤與商品清單的讀寫 MUST 繼續可用

### Requirement: 自動部署必須檢查 Free-tier 靜態與動態預算

Cloudflare production deploy 前 MUST 檢查 Worker gzip bundle、單一 asset、asset count、D1 migration statement 形態及設定的 request／query／write 安全預算；超過安全門檻時 MUST 阻止自動 promotion。

#### Scenario: build 產物符合預算
- **WHEN** dry-run 回報所有 bundle／asset 指標低於設定門檻，測試也證明 D1 batch 有界
- **THEN** workflow MAY 繼續 migration 與 deploy
- **AND** MUST 保存不含秘密的 budget summary

#### Scenario: 私人小群組穩態估算
- **WHEN** 部署 gate 估算 3 位成員、每人每日前景使用 8 小時且最多 8 圖的正常日 K 工作量
- **THEN** summary MUST 分別列出 batch request、cache miss、history refresh、D1 rows read 與 D1 rows written
- **AND** request 與 D1 write 安全門檻 MUST 不高於官方 Free 日額度的 50%，D1 read 安全門檻 MUST 保留至少 30% 餘裕
- **AND** CPU MUST 明確標為需以 production observation 驗證，不得用靜態估算冒充已通過

#### Scenario: 任一預算超標
- **WHEN** bundle、asset、D1 batch 或估算日 request／write 超過安全門檻
- **THEN** workflow MUST 在部署前失敗
- **AND** MUST 保留前一個 production deployment 並指出超標類別

### Requirement: 額度壓力下必須保守降載

系統偵測 rate limit、D1 quota pressure、上游節流或 repeated timeout 時，MUST 優先降低即時更新與背景回補工作量，保留已儲存圖表／清單可讀性，不得 busy loop 或無界重試。

#### Scenario: 即時更新遭限流
- **WHEN** Cloudflare 或上游回傳可辨識的 rate-limit／retryable response
- **THEN** 前端與 Worker MUST 使用 bounded backoff／retry-after
- **AND** UI MUST 保留最後有效資料並顯示中性 stale／更新稍後重試狀態

#### Scenario: 免費額度長期不足
- **WHEN** production health 持續顯示正常 2～3 人使用仍超過安全預算
- **THEN** 系統 MUST 停止宣稱 Free 可完整支撐並提出可量測的降載或 Workers Paid 選項
- **AND** 不得以刪除個人資料或停用安全檢查降低用量
