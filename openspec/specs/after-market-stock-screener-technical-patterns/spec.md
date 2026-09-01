# after-market-stock-screener-technical-patterns Specification

## Purpose
TBD - created by archiving change add-technical-pattern-filters-to-after-market-stock-screener. Update Purpose after archive.
## Requirements
### Requirement: 選股面板必須提供兩種分型算法與方向
系統 MUST 在收盤後「選股」面板提供可獨立啟用的「K 棒分型」條件。算法 MUST 包含「原始三 K」、「纏論包含處理」與「任一算法」；方向 MUST 包含「底分型」、「頂分型」與「任一方向」。選擇任一時 MUST 採三態 OR，不得把子條件 unknown 當成 fail，也不得要求互斥頂／底同時成立。

#### Scenario: 選擇原始三 K 底分型
- **WHEN** 使用者啟用分型條件並選擇「原始三 K」與「底分型」
- **THEN** 系統只以原始三 K 底分型判定該分支，且不要求纏論算法也成立

#### Scenario: 選擇任一算法及任一方向
- **WHEN** 任一算法／方向組合中至少一個子判定 pass
- **THEN** 分型分支 MUST 為 pass；只有全部 fail 才為 fail，沒有 pass 且至少一個 unknown 時 MUST 為 unknown

### Requirement: 原始三 K 分型必須嚴格且已確認
系統 MUST 只使用最新三個相鄰、完整、已驗證的官方市場交易日 A、B、C 判定原始三 K，C 為最新完整交易日及確認日。頂分型 MUST 要求 B 的 high 嚴格高於 A／C high 且 B 的 low 嚴格高於 A／C low；底分型 MUST 要求 B 的 low 嚴格低於 A／C low 且 B 的 high 嚴格低於 A／C high。相等、缺日或非法 OHLC MUST NOT pass。

#### Scenario: 最新交易日確認底分型
- **WHEN** A／B／C 日期相鄰且 B.low 低於 A.low、C.low，B.high 也低於 A.high、C.high
- **THEN** 系統 MUST 回傳已確認底分型，並顯示 B 為中心日、C 為確認日

#### Scenario: 高低價相等
- **WHEN** B 任一必要 high／low 與相鄰 K 棒相等
- **THEN** 系統 MUST 將該方向判為 fail，不得以包含、四捨五入或視覺近似判為分型

#### Scenario: 右側 K 棒尚未完成
- **WHEN** 只有左棒與中心棒，或 C 尚非完整交易日
- **THEN** 系統 MUST 回 unknown，且不得顯示為已確認分型

### Requirement: 纏論分型必須可重現包含關係處理
系統 MUST 依已驗證 OHLC 的包含區間、明確上／下方向與固定合併公式建立標準化 K 棒。向上合併 MUST 各取較高 high／low，向下合併 MUST 各取較低 high／low；方向無法由前兩根無包含有效 K 棒唯一決定時 MUST 回 `containment_direction_unknown`。每根標準化 K 棒 MUST 保存原始日期範圍，最後再以相同嚴格三 K 規則判定頂／底分型。

#### Scenario: 向上包含合併後確認頂分型
- **WHEN** 相鄰 K 棒具有包含關係、既有有效高低點同步上移，且合併後最後三根標準化 K 棒符合嚴格頂分型
- **THEN** 系統 MUST 回傳纏論頂分型及每根標準化 K 棒的原始日期範圍

#### Scenario: 包含方向不明
- **WHEN** 初始或中間包含關係無法由前兩根無包含有效 K 棒唯一判定向上或向下
- **THEN** 系統 MUST 回 unknown／`containment_direction_unknown`，不得以收盤漲跌或資料順序猜測

#### Scenario: 合併後沒有獨立右棒
- **WHEN** 最新交易日被合併進候選中心棒且其後尚無獨立標準化 K 棒
- **THEN** 系統 MUST 視為尚未確認，不得 pass

### Requirement: 布林反轉 K 必須要求首次穿越與指定 K 棒結構
系統 MUST 固定使用 canonical BOLL(20,2)。前一官方市場交易日 P 的收盤 MUST 位於含邊界的通道內；最新完整交易日 D 才能以嚴格不等號首次穿越。下軌模式 MUST 同時滿足 `closeD < lowerD`、陽 K 與下影線；上軌模式 MUST 同時滿足 `closeD > upperD`、陰 K 與上影線。模式 MUST 提供下軌、上軌與任一型態。

#### Scenario: 首次跌破下軌並形成陽 K 下影
- **WHEN** P 收盤介於 P 的 lower／upper，且 D 的 close 低於 lower、close 高於 open、low 低於 open
- **THEN** 下軌陽 K 下影分支 MUST pass，並回傳 P／D OHLC、bands 與影線證據

#### Scenario: 首次突破上軌並形成陰 K 上影
- **WHEN** P 收盤介於 P 的 lower／upper，且 D 的 close 高於 upper、close 低於 open、high 高於 open
- **THEN** 上軌陰 K 上影分支 MUST pass，並回傳 P／D OHLC、bands 與影線證據

#### Scenario: 前一日已在通道外
- **WHEN** P 的收盤低於 lower 或高於 upper
- **THEN** 即使 D 仍位於相同通道外且 K 棒結構符合，系統 MUST NOT 判為首次穿越

#### Scenario: 碰軌或十字線
- **WHEN** D 收盤等於 band、open 等於 close，或指定方向的影線長度為零
- **THEN** 對應反轉 K MUST 為 fail，不得以顯示四捨五入判為通過

### Requirement: 技術型態必須加入既有全條件三態邏輯
系統 MUST 讓分型與布林反轉 K 分支和成交量、千張大戶分支共同使用既有 `all`／`any`。停用的分支 MUST 不參與判定；啟用分支的資料缺漏 MUST 保存逐分支 unknown reason。系統 MUST 維持 `符合 + 不符合 + 無法判定 = 全市場母體`。

#### Scenario: all 模式包含技術與籌碼條件
- **WHEN** 使用者啟用成交量、分型與大戶條件並選擇 all
- **THEN** 只有三個分支皆 pass 才能列為符合，任一 fail 即不符合，沒有 fail 且至少一個 unknown 才列為無法判定

#### Scenario: any 模式已有一個技術條件通過
- **WHEN** 分型 pass、布林 unknown 且其他啟用條件皆未 pass
- **THEN** 外層 any MUST 為 pass，並仍在 evidence 顯示布林 unknown

### Requirement: API 與結果必須提供可稽核型態證據
v3 API MUST 回傳 snapshot／formula／criteria version、分型算法與方向、中心／確認日期、標準化 K 棒原始日期映射、P／D OHLC、P／D BOLL bands、影線判定、逐分支 verdict 與 unknown reason。排序與 cursor MUST 綁定同一 snapshot 與 criteria fingerprint，且所有並列 MUST 以股票代碼穩定排序。

#### Scenario: 檢視纏論分型結果
- **WHEN** 使用者展開一筆纏論分型符合結果
- **THEN** 系統 MUST 顯示確認日、方向、合併後三 K 及各自原始日期範圍，不得只顯示「符合」

#### Scenario: 跨 snapshot 翻頁
- **WHEN** 使用者使用舊 snapshot／criteria 的 cursor，而最新 snapshot 已切換
- **THEN** 系統 MUST 固定原 snapshot 或明確回 snapshot expired，不得混合兩版結果

### Requirement: 偏好與舊版結果必須安全遷移
系統 MUST 將合法 v2 偏好一次性遷移至 v3，兩個新技術條件預設關閉，既有條件、成交值、組合及排序保持不變。v1／v2 snapshot、cursor 或未知偏好版本 MUST NOT 由 v3 公式重新解釋。

#### Scenario: 首次讀取 v2 偏好
- **WHEN** 使用者已有合法 v2 選股偏好且尚無 v3 偏好
- **THEN** 系統 MUST 建立新技術條件皆關閉的 v3 偏好，並保留其餘合法設定

#### Scenario: 最新 snapshot 尚為 v2
- **WHEN** v3 UI 只讀到合法 v2 snapshot
- **THEN** 系統 MUST 顯示 v3 preparation pending 或安全 v2 行為，不得用 v3 條件重算 v2 rows

### Requirement: 點選技術型態結果不得產生其他產品副作用
點選分型或布林結果 MUST 只更新使用者指定的未鎖定 K 線圖商品，沿用既有圖表選擇政策。系統 MUST NOT 加入自選清單、改動其他圖表、下單／智慧下單商品、草稿、行情訂閱或交易狀態。

#### Scenario: 點選未加入清單的分型股票
- **WHEN** 使用者點選一檔不在自選清單的分型結果且已有指定未鎖定圖表
- **THEN** 只有該圖表 MUST 切換到該商品，自選清單與所有交易狀態 MUST 保持不變

#### Scenario: 所有圖表皆鎖定
- **WHEN** 使用者點選結果但沒有可用未鎖定圖表
- **THEN** 系統 MUST 要求解鎖或明確新增日 K 圖，不得擅自覆寫任一圖表
