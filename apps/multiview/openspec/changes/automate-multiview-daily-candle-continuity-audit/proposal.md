## Why

日 K 缺口修復與逐商品 continuity 診斷已具備，但正式驗收目前仍以人工觸發及代表性商品為主；未曾載入或新加入的商品可能長時間停留在 `unknown`，直到使用者看到圖表異常才被發現。現在需要把既有稽核核心提升為每日、可續跑、雙環境隔離的營運流程，讓所有啟用台股商品都能持續取得逐商品證據，同時遵守官方來源、D1 與 GitHub Actions 的有限額度。

## What Changes

- 建立 Sites 保留站與 Cloudflare 正式站彼此獨立的每日 continuity orchestration，每個目標使用自己的 run、D1 狀態、secret、concurrency 與失敗終態。
- 每日盤後從目前啟用的內建頁籤與個人清單動態探索 `.TW`／`.TWO` 普通股及 ETF，並以相容商品目錄補充 eligibility／active metadata 後逐商品去重；不得把商品目錄中所有仍上市商品誤當成使用者已啟用目標。新加入、尚未稽核、evidence 過期或有缺口的商品優先於已完成且新鮮的商品。
- 以 durable run、cursor、有限批次、總 request budget、最大執行時間與冷卻時間續跑，不一次對全部商品發送無上限請求，也不以全域成功掩蓋單檔 `partial`／`unknown`／`failed`。
- 將逐商品 coverage、continuity、verified through、checked time、missing count 與安全 reason 保存為可查證 health；提供不含完整商品清單、上游 response 或秘密值的排程摘要與告警 gate。
- 排程完成後自動核對代表性上市、上櫃、ETF、新加入商品與既有大立光回歸案例，並分別驗證 Sites／Cloudflare 的 cache reuse、逐商品 health 與部署身分。
- 保留人工 `workflow_dispatch`、有界重試與 fail-closed 行為；官方資料尚未發布或來源失敗時維持待核對狀態，不補造 candle、不刪除合法 history。
- 不納入新行情來源、主力／分點副圖、production 交易、Shioaji production、公開站或跨環境共用 D1。

## Capabilities

### New Capabilities

- `daily-candle-continuity-automation`: 定義啟用台股商品的每日目標探索、durable run、優先序、有限額度、雙環境排程、逐商品 SLA、健康摘要與正式驗收契約。

### Modified Capabilities

無。

## Impact

- Worker：新增 continuity run／item repository、orchestrator start／tick／fail 路由、目標探索、優先序、lease／cursor 與 health 聚合；沿用既有 `candle-continuity-maintenance.ts` 及 `/api/internal/candle-continuity-audit` 稽核核心。
- D1：新增 additive migration 保存目標環境自己的 run、逐商品 item、attempt、heartbeat、cursor、SLA 與安全錯誤碼；不修改或刪除既有 candle rows。
- GitHub Actions：新增或擴充 Sites／Cloudflare 各自排程與手動 workflow，沿用目前每日資料作業的單例、timeout、protected access 與安全摘要模式。
- API／health：擴充 private health 的 aggregate 與有界逐商品證據；匿名存取結果不得作為 application health。
- 測試與驗收：涵蓋新商品優先、全量續跑、部分成功、rate limit、來源未發布、lease 回收、跨目標隔離、告警 SLA、cache reuse、正式雙環境 workflow 與實際 UI 回歸。
