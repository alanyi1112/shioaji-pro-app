# screener-source-recovery Specification
## Purpose
TBD - created by archiving change repair-screener-daily-source-recovery. Update Purpose after archive.
## Requirements
### Requirement: 可追溯的來源恢復
系統 SHALL 只在明確操作員要求且冷卻到期時恢復封鎖來源，保留原始政策與失敗證據；一般排程不得自動解除人機驗證封鎖。

#### Scenario: 操作員補跑
- **WHEN** 操作員明確要求恢復且冷卻到期
- **THEN** 系統保留原始政策、使用正常來源與驗證，失敗時重新封鎖

### Requirement: 空報表等待發布
系統 SHALL 將格式合法但本期資料列全空的日報判為尚未發布，保留既有退避與嘗試次數。

#### Scenario: 官方尚在產製日報
- **WHEN** 本期報表日期正確且合法資料表皆空
- **THEN** 系統標為 source_not_published，不能發布空資料或永久鎖成 invalid

### Requirement: 多視窗傳輸不阻塞查詢
系統 SHALL 在支援 SharedWorker 的同來源網頁中共用行情與商品事件 SSE，避免每個視窗重複占用長連線。

#### Scenario: 關閉其中一個視窗
- **WHEN** 多個視窗訂閱相同串流且其中一個關閉
- **THEN** 其他視窗持續收到事件，最後一個視窗離開才釋放連線
