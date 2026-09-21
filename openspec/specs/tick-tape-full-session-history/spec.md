# tick-tape-full-session-history Specification
## Purpose
TBD - created by archiving change full-session-tick-tape-with-configurable-large-trades. Update Purpose after archive.
## Requirements
### Requirement: 全部頁籤必須呈現開盤以來完整成交

系統 SHALL 保存與呈現目前台股商品當日一般交易時段從開盤至目前可驗證時點的全部實際整股成交，包含開盤與收盤撮合，不受 120 筆上限影響。MUST 排除試撮、零股與盤後定價；延後收盤依來源實際時間呈現，不造出或改寫成交時間。

#### Scenario: 盤中首次開啟

- **WHEN** 使用者於 11:00 首次開啟面板
- **THEN** 系統 SHALL 補齊當日開盤至交接點的歷史，再接續即時成交，最早成交可查閱。

#### Scenario: 跨越舊上限

- **WHEN** 當日成交超過 120 筆
- **THEN** 系統 MUST 保留全部資料並能捲回第一筆，不以最新 120 筆冒稱全部。

### Requirement: 歷史與即時資料必須有可驗證的交接

系統 MUST 依商品及交易日管理歷史載入、即時緩衝、已驗證範圍、交接點及缺口；查詢 MUST 有 timeout、總期限、回應量與請求預算，不以頻繁查詢代替串流。同商品多面板與獨立視窗 MUST 協調查詢，不能各自反覆抓整日。

#### Scenario: 載入期間成交

- **WHEN** 歷史尚未完成時到達即時成交
- **THEN** 系統 MUST 保存並依序合併，重疊不重算、不漏接。

#### Scenario: 來源失敗

- **WHEN** 歷史回應失敗、截斷或無法確認空資料意義
- **THEN** 系統 MUST 顯示載入失敗或不完整及可用範圍，不顯示完整或今日尚無成交。

#### Scenario: 斷線恢復

- **WHEN** 串流斷線後恢復
- **THEN** 系統 MUST 有界補齊缺口並驗證交接，完成前保留不完整標記；已驗證成交不可消失。

### Requirement: 完整資料必須與渲染及資源上限分離

系統 MUST 按商品與交易日分批保存完整資料並以虛擬列表或等效方式控制 DOM 與工作記憶體。MUST NOT 因超過可見列數而淘汰當日成交。空間或資源不足 MUST 明確回報，不能靜默截斷。

#### Scenario: 大量成交

- **WHEN** 載入 100,000 或 500,000 筆測試成交
- **THEN** 全部與篩選筆數 MUST 正確，能抵達最早列，DOM 維持有界，保存負載測試的資源與互動延遲結果。

#### Scenario: 閱讀歷史

- **WHEN** 使用者已捲離最新位置且新成交到達
- **THEN** 系統 SHALL 維持閱讀位置並提供回到最新控制。

#### Scenario: 切換與重載

- **WHEN** 使用者切換股票後返回或重新載入面板
- **THEN** 系統 SHALL 重用已驗證當日快取並補齊新資料；不能降回最近 120 筆，也不能混入其他商品。
