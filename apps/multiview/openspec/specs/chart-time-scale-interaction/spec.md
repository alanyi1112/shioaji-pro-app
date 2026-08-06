# chart-time-scale-interaction Specification

## Purpose
定義 K 線圖縮放、平移、版面更新與歷史補載時的可視時間範圍控制規則，避免使用者操作後遭非同步更新重設。
## Requirements
### Requirement: 使用者縮放與平移必須持續保有控制權

系統 MUST 在使用者於主 K 線圖以滑鼠滾輪縮放或按住滑鼠左鍵平移後，持續保留其可視時間範圍。任何已排程但尚未執行的初始 refit、非同步資料完成、指標重繪、價格軸量測或副圖版面更新 MUST NOT 把範圍重設成顯示全部 K 棒。

#### Scenario: 滾輪放大後非同步版面更新

- **WHEN** 使用者在主 K 線圖以滾輪放大至只顯示部分 K 棒
- **AND** 稍後發生 ResizeObserver、副圖資料完成或價格軸寬度更新
- **THEN** 主圖 MUST 保留使用者放大後的可視邏輯範圍
- **AND** MUST NOT 突然縮小成顯示全部 K 棒

#### Scenario: 左鍵平移後延遲 refit 到期

- **WHEN** 使用者按住主圖滑鼠左鍵並水平平移
- **AND** 初始資料載入曾排程延遲 refit
- **THEN** 系統 MUST 取消或忽略該 refit
- **AND** 主圖 MUST 保留使用者平移後的位置與縮放跨度

#### Scenario: 使用者操作後切換技術指標

- **WHEN** 使用者已調整主圖可視範圍
- **AND** 同一商品與週期因技術指標選取而重繪 series
- **THEN** 系統 MUST 保留重繪前的主圖可視邏輯範圍
- **AND** 可見的技術副圖與籌碼副圖 MUST 同步相同範圍

### Requirement: 新圖表與歷史補載必須使用正確的範圍策略

系統 MUST 僅在新商品或週期建立且尚未由使用者接管時套用預設完整資料範圍。向左瀏覽觸發歷史補載時，系統 MUST 依新增舊 K 棒數量平移原邏輯範圍，使畫面仍停留在使用者原本查看的時間位置。

#### Scenario: 新商品初次載入

- **WHEN** panel 建立新 chart 並首次取得商品 K 棒
- **AND** 使用者尚未進行縮放或平移
- **THEN** 系統 MUST 顯示預設完整 K 棒範圍與既有右側留白

#### Scenario: 向左平移觸發歷史補載

- **WHEN** 使用者向左瀏覽超過歷史補載門檻
- **AND** API 回傳更早的 K 棒
- **THEN** 系統 MUST 保留補載前的可見時間位置與跨度
- **AND** MUST NOT 因 candle 總數增加而改成顯示全部資料
