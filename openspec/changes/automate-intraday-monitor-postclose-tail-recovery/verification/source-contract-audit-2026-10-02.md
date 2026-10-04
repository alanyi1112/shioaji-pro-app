# 尾端復原來源契約稽核（2026-10-02）

本稽核唯讀檢查既有本機 artifact；不修改原始 capture、receipt、baseline、SQLite observation 或當日驗收結果。時間以 Asia/Taipei 解讀。

## 原始 capture

| 交易日 | 原始 capture SHA-256 | 已觀察尾端缺口 | 判定 |
| --- | --- | --- | --- |
| 2026-09-16 | `319290088be2091445ebb471d248c7b1262e1f5609a79f00bb1cab050935245e` | `3026.TW` 缺 13:29、13:30，其餘 159 檔完整 | 符合現有最多 4 檔、每檔至多 5 分鐘的候選形狀；原始 live 仍為不完整 |
| 2026-10-02 | `30ad9cadf4c40eced87b4021d00b3f9414ff9f1d0244e6d7b1e3915b81d6ecb8` | 160 檔皆缺 13:30，各有 269 筆已接受 observation | 超出受限例外；只可考慮獨立盤後資料復原 |

兩份 capture 均有 `tradeDate`、`connectionGeneration`、`manifestHash`、`planHash`、`baselineHash`、`session.cohortHash`、09:01 canary、transport 收訂閱收據及 `operations` 安全計數；不能只憑檔案存在就推定所有 Gate 通過。2026-10-02 capture 於台北 13:34:30 結束，原始 `formalAcceptanceEvidence=false`。

## 2026-10-02 已發布盤後基準

- 13:35 工作 receipt SHA-256：`81a49cca74e7c7a10aa7388ffbb80fc448200a23da8e863ec7153d25ac929d7d`。
- verified `verification.json` SHA-256：`b092f617746c106bc1fca229fa850ad1cbb5ca30776917f8f5304530ecaa0215`；記錄 `previousTradeDate=2026-10-02`、`targetTradeDate=2026-10-05`、`verifiedCount=160`、`minuteCount=43200` 與 `baselineUsable=true`。
- `baseline-set.json` 的逐檔 manifest 含商品、市場、cohort hash、交易日、270 筆 `cumulativeSeries`、`payloadHash` 與 `refetchPayloadHash`、`finalVolumeReconciliation`、`minuteCoverage`、`closeMode`、零量分鐘與來源版本；`verification.results` 另含逐檔 manifest ID 與檔案 SHA-256。
- 唯讀比較 160 檔各 269 個已接受 live 前綴，共 43,040 個相同分鐘的累積量，差異為 0。這只證明 10/2 盤後資料與已收到的 live 前綴相符，不證明缺少的 13:30 曾由 live 送達。

## 復原時仍須逐次核實

- 必須從實際 receipt 取得 `outcome=verified` 或可信的 `already_verified`，重讀 baseline／verification 並重驗檔案 hash、官方日曆版本、固定 cohort、來源日期及逐檔證據；不得僅沿用本次人工稽核結論。
- `payloadHash` 與 `refetchPayloadHash` 可證明雙抓欄位存在，但仍須驗證兩者格式及相等；`finalVolumeReconciliation.matched` 與可信 tick 來源須逐檔驗證。任一欄位不足即 `source_unverified`。
- 2026-09-16 目前未查到同日已發布的 `2026-09-16-for-*-verified` 基準；既有人工尾端雙抓審閱可作舊政策回歸，不能把不存在的同日基準當作自動來源。
- 現有 Stage 160 受限例外維持最多 4 檔、每檔僅缺 13:26–13:30 內連續至最後的至多 5 分鐘。此 change 不更改原始 live acceptance、通知 Gate、追溯觸發或交易權限。
