## 1. Worker Orchestrator 與 D1 狀態

- [x] 1.1 新增 orchestrator D1 migration 與 runtime 建表保護
- [x] 1.2 實作 Asia/Taipei 最近已完成交易日與日籌碼 attempt cooldown
- [x] 1.3 實作 Sites Worker orchestrator start／tick、有限批次續跑與冪等 run 狀態
- [x] 1.4 在 Worker entry 新增共用 `scheduled` handler
- [x] 1.5 將 orchestrator 安全狀態加入 `/api/health`

## 2. 薄型排程與歷史來源 Adapter

- [x] 2.1 將 GitHub workflow 改為受保護 Sites start／tick 迴圈
- [x] 2.2 為 TDCC runner 新增 `--history-only`，移除 workflow 端 latest／daily 編排
- [x] 2.3 保留歷史 queue、claim、plan、lease、ingest 與完成狀態由 Worker／D1 管理

## 3. 驗證

- [x] 3.1 新增交易日、cooldown、orchestrator 冪等續跑與 health 測試
- [x] 3.2 新增 workflow 薄型契約與 `--history-only` 測試
- [x] 3.3 執行 lint、完整 tests、OpenSpec strict 與 `git diff --check`
- [x] 3.4 以繁體中文 verification 記錄測試、正式 D1 health 與排程觸發邊界

## 4. 發布

- [x] 4.1 提交並推送完整 HEAD 至 GitHub
- [x] 4.2 推送相同完整 HEAD 至 Sites source，保存 owner-only version 並部署
- [x] 4.3 驗證正式部署狀態、owner-only health 與匿名 401

## 5. 正式排程失敗修復

- [x] 5.1 新增受保護且冪等的 orchestrator 失敗收尾，關閉 orchestrator 與 TDCC run 並保存 retry-waiting
- [x] 5.2 讓 workflow 只輸出 allowlist phase／計數／reason 摘要，並在 HTTP／schema／tick-limit 失敗時可靠呼叫收尾
- [x] 5.3 新增安全摘要、tick limit、重複收尾與 history adapter skip 契約測試
- [x] 5.4 執行 build、lint、完整 tests、OpenSpec strict、`git diff --check`，並更新 verification
- [x] 5.5 提交並推送修正版至 GitHub／Sites source，保存 owner-only version 並部署相同完整 HEAD
- [x] 5.6 部署後因未能取得新的已授權 D1 health，決定不執行 `workflow_dispatch`，不得冒充 schedule
- [x] 5.7 等待下一次真實 `event=schedule`，核對安全摘要、D1 failed／retry 或完成終態與 history adapter 邊界

## 6. 每日／每週拆分與新增商品立即回補

- [x] 6.1 為 orchestrator run 新增 scope，讓 `daily` 與 `tdcc-weekly` 各自只執行其資料責任，並在 health／安全摘要回報 scope
- [x] 6.2 拆分 Sites／Cloudflare GitHub workflows：日籌碼維持每日 22:30，TDCC 改為週末發布檢查與一次有限重試
- [x] 6.3 新增商品儲存後立即預熱日籌碼、建立 TDCC queue，並依部署目標觸發對應 workflow；dispatch 失敗時保留 queue
- [x] 6.4 新增 scope、workflow 排程、目標環境 dispatch 與立即回補測試，執行 build、lint、完整 tests、OpenSpec strict 與 `git diff --check`
- [x] 6.5 提交並推送相同完整 HEAD，發布 Sites 保留站新版，並核對 Cloudflare 正式站自動部署終態
