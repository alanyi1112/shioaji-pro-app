## Context

Shioaji K 線與 `apps/multiview` 各自維護一份費波那契水準常數、顏色映射及 renderer。兩邊目前拓展皆為八條水準，完成圖只保存種類、錨點與順序，實際水準由目前公式重算。root 實作另以 `multichart-ecae7ca-fibonacci-v2` 保護公式 fixture，restore 只接受 v1、v2；若只改常數而未升版與遷移，既有資料的可追溯性會失真。

## Goals / Non-Goals

**Goals:**

- 兩個畫面都以相同順序繪製包含 `0.5` 的九條拓展線。
- 維持既有錨點、公式、價格格式、色帶、autoscale、pending preview 與清除語意。
- 既有 v1／v2 完成圖安全升級，不刪除合法繪圖或改變商品／時框身份。
- 以自動化 fixture 證明 Shioaji 與 MultiView 的 ratio、價格及顏色一致。

**Non-Goals:**

- 不改費波那契回撤水準、錨點吸附方式或交易互斥行為。
- 不新增使用者自訂水準、線型或顏色設定。
- 不改 K 線資料、行情 API、訂單流程或部署架構。

## Decisions

### 1. 0.5 放在拓展序列最前方

拓展水準固定為 `0.5、0.618、0.705、0.786、1、1.272、1.414、1.618、2`，價格仍為 `C + r × (B - A)`。這保留數值由小到大的可讀性，也讓 band renderer 自然形成八個相鄰色帶。替代方案是把 0.5 插在任意視覺位置，但會破壞水準排序與區間填色語意。

### 2. 新增水準使用獨立固定色且既有顏色不位移

`0.5` 使用新增水準色 `#60a5fa`。既有八個拓展水準保留目前顏色，不因陣列索引改變；root 與 MultiView 必須共用相同 fixture。替代方案是沿用陣列索引重新分配顏色，但會讓使用者既有圖形在升級後出現無意義的配色漂移。

### 3. root 公式版本升為 v3，保存格式版本維持不變

root 將公式 fixture 升為 `multichart-ecae7ca-fibonacci-v3`，restore 接受合法 v1、v2、v3。v1／v2 只取 canonical kind、anchors、order，以 v3 重算並安全寫回。storage schema 仍只保存錨點與順序，因此 `FIBONACCI_STORAGE_VERSION` 不需升級。無法解析或含非有限錨點的資料仍依既有 fail-closed 行為處理。

MultiView 的 localStorage 同樣保存 canonical anchors 而非展開水準，讀取後直接套用新常數；現有 storage version 不需因衍生線增加而改變。

### 4. 同一 change 同步維護 root 與 nested MultiView 契約

root delta spec 為本 change 的 apply contract；實作同時更新 `apps/multiview/openspec/specs/main-chart-fibonacci-tools/spec.md`。測試除了各自 fixture，還要有跨實作 parity assertion，避免日後兩份常數再次分歧。

## Risks / Trade-offs

- [新增一條線使小高度圖表更擁擠] → 保持既有 1 CSS px、標籤避讓與 plot 安全邊界，不增加額外說明文字。
- [舊資料被新版公式拒絕] → restore 明確接受 v1、v2、v3，並以 anchors 重算後寫回 v3。
- [新增色與既有主題對比不足] → 固定色納入 dark theme renderer／截圖測試，且不得只靠顏色辨識水準。
- [只更新其中一套 renderer] → 任務與驗收同時要求 root、MultiView fixture 及正式規格通過。

## Migration Plan

1. 先加入 v3 常數、顏色與 v1／v2 restore 支援，再更新 renderer 與測試。
2. 更新 MultiView 常數、顏色與測試，核對兩邊相同 anchors 的九個結果。
3. 以既有 v1、v2 localStorage fixture 驗證 kind、anchors、order 不變且寫回 v3。
4. 若需回滾程式，v3 payload 仍只含既有 anchors 結構；回滾版本不認得 v3，因此回滾前應保留新版並修正，而不是將使用者 storage 降版或刪除。

## Open Questions

無。新增水準順序、公式、配色與遷移策略已在本設計固定。
