## Why

目前上市融資券空報表會中止同輪其他報表，且共用選股冷卻時間，延誤已公布資料入庫。

## What Changes

- 四種市場報表獨立失敗、下載窗口與耐久重試。
- 法人 16:00、融資券 21:00 起檢查（Asia/Taipei）；時間為本機採集策略，上櫃窗口待實測校準。
- 重用已驗證報表；歷史回補維持有界；v5 完整性與原子發布維持既有契約。

## Capabilities

### New Capabilities
- classified-chip-downloads: 分類採集與獨立重試。

### Modified Capabilities

## Impact

影響本機選股維護與籌碼 collector，使用既有 screener_runs 保存策略，不變更外部接口或啟停服務。
