# 盤中監控分級容量人工審查表

> 此表主路徑供直接 Stage 160 的 reviewer 決策；50／100 只在另行選擇診斷時適用。validator 僅能輸出 `readyForHumanReview`，不得代替 reviewer 核准、啟動下一級、重試或修改產品設定。

## 識別資料

- Stage：`50 / 100 / 160`
- cohort manifest SHA-256：
- stage plan SHA-256：
- evidence bundle SHA-256：
- 完整交易日：
- simulation process／connection generation：
- reviewer：
- reviewedAt：

## 必查項目

- [ ] exact cohort 與 manifest 順序全日不變，沒有輪替或補位。
- [ ] Stage 160 具有 exact cohort 的可信前日 1 分 K baseline＋一個完整盤中日；第二日僅為非阻擋穩定性追蹤，不用等待 50／100。
- [ ] 每檔 09:01–13:30 共 270 個 minute slots，unknown、零成交與 partial 沒有混用。
- [ ] deterministic replay 至少兩次，input／output hash 與 trigger count 一致。
- [ ] CPU、RSS、DB growth、磁碟、event-to-seal latency 與 chart freshness 未超過執行前 plan。
- [ ] reconnect 成功，K 線、watchlist、alert、smart-order 與 MultiView 無退化。
- [ ] notification、broker write、production transition、service lifecycle mutation 與未授權 active-limit mutation 全為 0。
- [ ] provider physical usage、global ownership、release 與 headroom 仍為 `unknown/null`，沒有由 request、SSE 或 receipt 推算。
- [ ] rollback 可在不重用舊 simulation process／session 的情況下執行。

## 決策

- 決策：`GO / NO_GO`
- 主路徑核准 active limit：`20 / 160`；未核准或 NO-GO 保留 20。
- reviewerSignoff：`true / false`
- 理由與未解風險：

未完整填寫、未簽署或 evidence hash 漂移一律視為 `NO_GO`，維持最近一次人工核准的 active limit。
