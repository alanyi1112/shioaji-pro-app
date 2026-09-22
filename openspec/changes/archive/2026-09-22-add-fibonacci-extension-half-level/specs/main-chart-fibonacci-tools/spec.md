## MODIFIED Requirements

### Requirement: 回撤與拓展必須使用最新版來源 repo 的固定公式及水準
系統 MUST 讓 Shioaji K 線與 MultiView 使用相同費波那契公式、錨點語意與視覺角色，並 MUST 在 root 公式 fixture 保存 `multichart-ecae7ca-fibonacci-v3` version。回撤 MUST 使用 A／B 兩點，依 `B - r × (B - A)` 計算 `-0.62、-0.27、0、0.236、0.382、0.5、0.618、0.705、0.786、1`；拓展 MUST 使用 A／B／C 三點，依 `C + r × (B - A)` 計算 `0.5、0.618、0.705、0.786、1、1.272、1.414、1.618、2`，且 MUST NOT 產生 `-0.62`、`-0.27`。每條水準 MUST 同時保留有限價格、最多三位小數比率及百分比文字，價格顯示 MUST 沿用商品格式化規則。拓展新增的 `0.5` MUST 使用固定色 `#60a5fa`，既有水準顏色 MUST NOT 因插入新水準而位移；任何參考來源 repo MUST NOT 成為安裝、build 或 runtime dependency。

#### Scenario: 上漲或下跌波段回撤
- **WHEN** A／B 是合法有限錨點，不論 A 價格高於或低於 B
- **THEN** 系統 MUST 依同一公式產生全部十條回撤水準
- **AND** 系統 MUST NOT 假設只能由低點畫到高點或省略負比率、0.705 或任何其他指定水準

#### Scenario: 完成三點拓展
- **WHEN** A／B／C 都是合法有限錨點
- **THEN** Shioaji K 線與 MultiView MUST 依 A 至 B 的波段差與 C 產生相同的九條拓展水準
- **AND** `0.5` MUST 位於 `0.618` 之前；若 A=100、B=200、C=150，`0.5` 的價格 MUST 為 200
- **AND** 結果 MUST NOT 包含 `-0.62`、`-0.27`
- **AND** 非有限結果 MUST 被拒絕，不得寫入 storage 或 renderer

#### Scenario: 舊公式資料遷移
- **WHEN** restore 讀取到合法的 `multichart-ecae7ca-fibonacci-v1` 或 `multichart-ecae7ca-fibonacci-v2` anchors
- **THEN** 系統 MUST 保留 kind、anchors 與完成 order，改以 v3 公式依 kind 重算回撤十條或拓展九條水準並安全寫回
- **AND** 系統 MUST NOT 因水準數量升級刪除合法完成圖

#### Scenario: 兩套 renderer 維持相同拓展契約
- **WHEN** Shioaji K 線與 MultiView 對相同 A／B／C 錨點完成拓展
- **THEN** 兩者 MUST 產生相同順序、比率文字、百分比與格式化前價格
- **AND** `0.5` MUST 使用 `#60a5fa`，其餘既有水準 MUST 保持升級前配色
