## Why

5174 MultiView 曾出現 HTTP listener 已關閉、Node／workerd 程序仍存活的狀態，原 launchd KeepAlive 無法察覺，造成選股代理持續回傳 `local_data_service_unavailable`。需要修復這個假存活的復原缺口；最初關閉 listener 的觸發者尚未取得直接證據，不將推測寫成根因。

## What Changes

- 在 MultiView 本機開發服務加入僅觀察自身 HTTP listener 的有界存活防護。
- 真正開始監聽後若持續失去 listener，寬限期間未恢復才結束失效程序，交給原 launchd KeepAlive 復原。
- 正常監聽、啟動中、短暫 Vite 重載與正常關閉不得造成錯誤復原。
- 驗證 5174 health 與 5173 選股代理／實際結果；保留原故障與資料完整性限制。

## Capabilities

### New Capabilities

- `multiview-local-listener-liveness`: MultiView listener 假存活的單服務有界復原。

### Modified Capabilities

無。

## Impact

僅修改 MultiView 的本機 Vite 防護與測試，不改套件依賴、資料表、選股公式、資料日期、盤前動態名單入口、LaunchAgent、Codex 回報或任何排程；不重啟 8080、watchdog、5173，不新增券商登入、行情訂閱或下單。
