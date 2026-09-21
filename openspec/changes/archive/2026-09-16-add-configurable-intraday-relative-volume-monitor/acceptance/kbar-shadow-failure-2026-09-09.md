# 2026-09-09 固定 20 檔完整日 Capture 失敗證據

## 結論

2026-09-09 capture 自 08:52:12（Asia/Taipei）啟動，盤中唯讀檢查至少持續至 10:36，期間為同一個 capture process、單一 generation，既有 simulation API、business-session watchdog、5173、5174、Shioaji 行情連線與 SSE 均未因本次開發而重啟。

13:34:30 收盤定稿後，capture 在組裝 `session.evidence` 時拋出 `canonical JSON exceeds its byte limit`，因此正式輸出 `acceptance/kbar-shadow-2026-09-09.json` 與暫存檔皆未建立。今日資料不得宣稱為完整交易日 live capture、不得成為 baseline，也不得以歷史回補升格或補發通知。

原本以 `launchctl submit` 建立的工作被推斷為 `keepalive`，失敗後又重複啟動；每次因已超過 09:00:30 而以 `REFUSED: full_session_start_missed` fail closed。2026-09-09 15:45:48 後已只移除該 capture label，沒有停止或重啟 simulation API、watchdog、5173、5174 或 Shioaji 行情連線。

## 保存證據

| 項目 | 實測 |
| --- | --- |
| capture job | `com.alanyi.realtimestock.intraday-kbar-shadow-20260909` |
| 原始啟動時間 | 2026-09-09 08:52:12 +08:00 |
| 原始 process 盤中連續觀察 | 至少至 2026-09-09 10:36 +08:00 |
| 最終化錯誤 | `canonical JSON exceeds its byte limit` |
| launchd 失敗後累積 runs | 移除前觀察為 162 |
| main evidence | 未建立 |
| temporary evidence | 未建立 |
| log path | `/tmp/realtimestock-kbar-shadow-2026-09-09.log` |
| log size | 5,708 bytes |
| log mtime | 2026-09-09T15:45:54+0800 |
| log SHA-256 | `63986f6493a195e756db1f732f9d0071b0b7222a006005774526f85cada9ad7f` |
| `liveCaptureAcceptance` | `false` |
| `baselineUsable` | `false` |

## Root cause

`kbar-shadow-session-recorder.mjs` 對完整 evidence 執行 SHA-256 時呼叫 `canonicalJson(value)`，沿用預設 1 MiB 上限。固定 20 檔、每檔 270 個 completed minute 的完整 evidence 大於 1 MiB，因此 hashing 在正式輸出採用 exclusive create 前先失敗。

失敗不是行情中斷或 parser rejection；它發生在 transport 已停止、session 已 seal、準備序列化最終 evidence 的階段。但因當時 CLI 沒有獨立失敗 sidecar，未留下可驗證的 per-symbol rows、payload hash 或 live overlap manifest，故不得事後以歷史資料重建今日的 live acceptance。

## 修正邊界

1. 為 KBar shadow evidence 定義高於完整 20 × 270 session、仍有明確上限的 canonical hashing byte budget，並以完整 cohort fixture 驗證。
2. capture 最終化失敗時只建立獨立、不可覆寫的 `.failure.json` sidecar；主 evidence 仍只在完整成功時建立。
3. failure sidecar 固定標示 `liveCaptureAcceptance=false`、`baselineUsable=false`，不得保存未受控原始行情 payload。
4. 後續 capture 必須使用明確 `KeepAlive=false` 的 one-shot launch 設定；不得以失敗後無限重啟替代監控。
5. 2026-09-09 永久保留為 capture tooling failure，仍需另一個實際完整交易日建立第一日 live baseline。
