# 2026-09-16 非交易時段維運 rehearsal

## 結論

盤前 scheduler、simulation cold／warm path、single-owner、磁碟容量與 log rotation 均通過；全程維持 simulation-only，未連 production、未執行 broker write，也沒有停止目前運作中的服務。

## Scheduler 與 single-owner

- LaunchAgent `com.alanyi.realtimestock.intraday-premarket` 讀回為 loaded。
- 08:20、08:35、08:45、08:50 四份 schedule receipt 的 `timeZone=Asia/Taipei`、computed local time 與 requested local time 完全相符，`consistency.status=ready`。
- 2026-09-16 實際四個 durable claim 與四個 `premarket_step_complete` 均存在；08:50 capture exit code 為 0。
- 8 個入口同時競爭相同 claim 的測試只有 1 個成功、7 個收到 `premarket_step_already_claimed`，證明 heartbeat、備援與人工入口不能建立第二個 owner。

## Simulation warm／cold path

- 實際 warm path：08:20 在既有健康 generation `simulation:cdedb98d-cff2-4979-8211-d35abb1b2911` 上完成，08:35、08:45 延續同一 generation，沒有不必要的 lifecycle mutation。
- 隔離 cold path：使用本機暫存 fake runtime 執行真正的子程序 spawn；第一次 Gate 回報 business session 未就緒時，只呼叫一次 `simulation` lifecycle，第二次 Gate 通過後才寫入 generation anchor。
- warm path rehearsal 確認 Gate 已就緒時 runtime 呼叫數為 0；cold path runtime 呼叫數為 1。隔離 rehearsal 沒有碰觸現行 simulation API 或行情連線。

## 磁碟與 log rotation

- 實際資料磁碟可用空間為 354,255,472 KiB，高於 8 GiB Gate；2026-09-16 正式 capture 期間最低可用空間為 363,043,794,944 bytes。
- operational event log 與 simulation service log 權限均為 0600。
- log rotation 測試以 5 MiB 邊界建立隔離檔案，驗證舊檔移至 `.1`、新事件寫入新檔、權限恢復為 0600；保留上限為 5 代。
- operational event 全數保存 `brokerWriteAuthority=false` 與 `productionAuthority=false`。

## 驗證

- rehearsal focused tests：4 個 test files、16 tests 通過。
- 盤中監控完整測試：44 個 test files、282 tests 通過；新增 rehearsal 後重新執行結果另見最終驗證紀錄。
- OpenSpec strict validation、TypeScript build、Vite build 與 whitespace check 通過。
