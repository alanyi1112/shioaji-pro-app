## MODIFIED Requirements

### Requirement: MultiView 全商品可選擇分鐘與日週月 K
本機 MultiView 的 UI、config、URL parser、localStorage migration、prefetch、batch 與 candle API MUST 共用 `1m`、`5m`、`15m`、`1h`、`1d`、`1wk`、`1mo` allowlist，預設 MUST 為 `1d`，且 UI MUST 將 canonical `1h` 顯示為 `60m`、`1wk` 顯示為週、`1mo` 顯示為月。本機選單 MUST 依序顯示 1m、5m、15m、60m、日、週、月七項；`intraday`、3m、30m、4h 與其他 interval MUST 不得出現在本機選單。Cloudflare／Sites MUST 維持既有 feature-off interval 與發布狀態，不得因本 change 自動開放分鐘 K、realtime 或觸發部署。

#### Scenario: 新開本機 MultiView
- **WHEN** URL 與已保存設定沒有合法本機 interval
- **THEN** 每個 panel MUST 預設選擇日 K
- **AND** 選單 MUST 依序只顯示 1m、5m、15m、60m、日、週、月

#### Scenario: 舊設定保存週月或分時
- **WHEN** 本機 localStorage 或分享 URL 含 `1wk`、`1mo`、`intraday` 或其他不在新 allowlist 的 interval
- **THEN** 系統 MUST 保留合法的 `1wk`、`1mo`，並只將 `intraday` 或其他非法 interval 正規化為 `1d`
- **AND** 商品、panel 數量、panel 順序、指標、註記與其他個人設定 MUST 保持不變

#### Scenario: UI 的 60m 使用 canonical 1h
- **WHEN** 使用者選擇畫面上的 `60m`
- **THEN** URL、cache key、batch、stream 與 candle API MUST 使用 canonical `1h`
- **AND** readout、狀態文字及匯出 MUST 顯示使用者可辨識的 `60m`

#### Scenario: 所有圖表數量顯示目前時間週期
- **WHEN** 使用者選擇 1、2、3、4、6 或 8 個圖表
- **THEN** 每個 panel 的時間週期下拉選單 MUST 完整顯示目前選取的 1m、5m、15m、60m、日、週或月標籤
- **AND** 緊湊工具列 MUST NOT 以空白欄位、只有箭頭或裁切文字取代目前週期

#### Scenario: 手動呼叫停用 interval
- **WHEN** client 直接請求本機 `/api/candles`、batch 或 stream 並指定 `intraday` 或其他停用 interval
- **THEN** API MUST 回明確 `unsupported_interval`，不得取得或顯示該週期資料

#### Scenario: 遠端部署維持 feature-off
- **WHEN** Cloudflare／Sites build 或 runtime 讀取 interval config
- **THEN** 系統 MUST NOT 因本機 allowlist 回傳已啟用分鐘 K 或 Shioaji realtime capability
- **AND** 本 change MUST NOT 要求遠端部署、多帳戶或正式站驗收

## RENAMED Requirements

- FROM: `### Requirement: MultiView 全商品只能選擇日週月 K`
- TO: `### Requirement: MultiView 全商品可選擇分鐘與日週月 K`
