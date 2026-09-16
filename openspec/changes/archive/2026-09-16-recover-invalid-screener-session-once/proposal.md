## Why

選股 publication readiness 遇到 invalid 後會停止同日探測，即使官方回應後來恢復也無法前進。需要可稽核的單次 operator 恢復，保留失敗紀錄而不放寬資料驗證。

## What Changes

- 新增指定交易日的單次本機恢復參數；與排程分離，沿用 lease 與預算。
- 寫入不可覆蓋的原 readiness 證據後才消耗一次恢復機會；結果不明亦不得重試。
- 雙市場 exact date、schema、universe coverage 仍全部通過才允許發布。

## Capabilities

### New Capabilities

- `screener-invalid-session-recovery`: 有日期範圍、一次性證據與失敗保留的恢復流程。

### Modified Capabilities

無。

## Impact

僅本機 screener operator、測試與操作文件；不啟停服務、不修改 broker、不變更 Cloudflare。後續提交準備使用隔離索引驗證，不直接 stage／commit／push。
