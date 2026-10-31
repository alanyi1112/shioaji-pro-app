# key-price-previous-close-percent-labels Specification

## Purpose
定義主交易畫面關鍵價位百分比的資料身分、計算格式與視窗保護；壓撐採所屬參考K收盤，日K費波採圖表最後一根K棒收盤。

## Requirements

### Requirement: 百分比基準必須依工具綁定正確資料身分

系統 SHALL 使用同商品、同價格基準且已由既有流程接受的資料。CDP／三關價／Pivot Point的分母 SHALL 為實際繪製這組價位的reference.close；日K費波 SHALL 為目前日K圖表資料序列最後一根close。基準 MUST 有商品、來源日期、正數有限close及可用狀態，不以市場contract.reference、另一工具的分母或其他商品替代。兩種基準 MUST 分列顯示。

#### Scenario: 自動與固定歷史壓撐
- **WHEN** 三套壓撐使用自動或固定歷史reference
- **THEN** 百分比 MUST 使用同組reference.close，分K鏡像與1D一致，歷史reference不改用當前行情前日close

#### Scenario: 日K費波最後收盤
- **WHEN** 日K圖最後close為103、前日close為100，而費波價位105
- **THEN** 費波百分比 MUST 為+1.94%，並顯示最後日K日期與103
- **AND** 移動游標或觀看歷史不能改用其他分母，最後日K自然更新時必須重算

#### Scenario: 快速換股與遲到回覆
- **WHEN** 商品A切到B，A的舊回覆稍後到達
- **THEN** B MUST 不得短暫沿用A的基準或百分比，原身分／取消／generation守門保持不變

#### Scenario: 切換取消舊歷史請求
- **WHEN** 已接受同商品資料仍合法，快速切週期取消舊載入
- **THEN** 取消 MUST 不得被當成既有來源失敗；未取消的真正來源失敗仍依原契約處理，不放寬Gate

### Requirement: 真實價位計算與兩位小數格式

系統 SHALL 以未格式化價位計算 `(levelPrice / baselineClose - 1) * 100`，只在顯示時保留兩位小數。正值 MUST 有+、負值 MUST 有可讀負號，四捨五入為零時 MUST 為中性0.00%，不顯示正負零。大於正負10%的合法結果 MUST NOT 被夾限。百分比漲跌色與原線／價格色分離。

#### Scenario: 正負與零
- **WHEN** 分母100，價位105／97／100或99.9999
- **THEN** MUST 分別顯示+5.00%／−3.00%／0.00%／0.00%，底層數值保留

#### Scenario: 費波比率與百分比
- **WHEN** 費波比率0.618、價位102.50、最後日Kclose100
- **THEN** MUST 保留比率及價格，另顯示+2.50%，不用61.8%替代
- **AND** 費波及三套壓撐價位標籤均不顯示「較昨收」三字，保留百分比本身

### Requirement: 基準不足保留未知

缺少對應reference或最後日K、錯商品／時框、無法確認資料、分母0／負值／NaN／Infinity時，系統 MUST 顯示破折號與常駐原因，不補0、不製造資料或為分母新增下載。原合法線價依原規則保留，不把非法reference送入公式以繞過原OHLC驗證。

#### Scenario: 未確認的最後日K
- **WHEN** 換股或載入尚未確認目前圖表尾端
- **THEN** 費波 MUST 顯示無前綴的—，不得使用上一商品、費波錨點或任意舊close

### Requirement: 百分比不得改變原圖表視窗

百分比 SHALL 只參與文字、量測及避碰，不新增價格series或autoscale bounds，不呼叫fitContent、不修改visible range、bar spacing、價格軸寬、面板或scale margins。既有工具原本的autoscale語意保持不變。

#### Scenario: 密集與窄面板
- **WHEN** 多條價位接近或面板變窄
- **THEN** MUST 按實際字寬避碰，位移以connector指向真實線價；費波優先置於線段左端外側，空間不足時靠原plot左緣
- **AND** 不得裁掉百分比、以縮小K棒／擴大Y軸／tooltip替代常駐數字

#### Scenario: 同資料比較
- **WHEN** 固定資料、圖形及原手動視窗，只新增或更新百分比
- **THEN** K棒及固定價位CSS座標、bar spacing、logical range及Y範圍 MUST 維持不變，像素誤差最多1 CSS px

### Requirement: 隔離其他consumer與資料副作用

百分比 MUST 不寫回K棒或圖形storage，不新增來源下載、訂閱、DB寫入、排程或交易操作，不修改來源、預算或資格Gate。日線MA／BOLL及MultiView維持原行為；分鐘費波仍維持原標籤範圍。

#### Scenario: 僅重算顯示
- **WHEN** 百分比隨所屬基準更新
- **THEN** 驗證 MUST 證明本功能額外資料需求及交易副作用為0，並保留原件與合法未知狀態
