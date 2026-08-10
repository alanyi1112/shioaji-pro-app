# main-chart-fibonacci-tools Specification

## Purpose

定義主圖費波那契回撤與拓展工具的錨點吸附、雙類型共存、線條樣式、本機保存及完整 panel PNG 匯出行為。
## Requirements
### Requirement: 主圖必須提供費波那契繪圖工具入口

系統 MUST 在每個 chart panel 的「主圖」選單提供獨立的「繪圖工具」入口，至少可啟動「費波那契回撤」與「費波那契拓展」，並清楚顯示目前等待的錨點數。工具入口不得改變均線、布林、成交量、FVG、Volume Profile、本益比河流圖或副圖的既有選取狀態。

#### Scenario: 啟動回撤工具
- **WHEN** 使用者在主圖選單選擇「費波那契回撤」
- **THEN** 系統 MUST 進入等待兩個錨點的回撤選取狀態
- **AND** 主 K 線、十字線與既有主圖指標 MUST 維持可見

#### Scenario: 啟動拓展工具
- **WHEN** 使用者在主圖選單選擇「費波那契拓展」
- **THEN** 系統 MUST 進入等待三個錨點的拓展選取狀態
- **AND** UI MUST 說明目前尚需選取的錨點數

### Requirement: 費波那契回撤必須以兩個波段錨點計算並標示價格

系統 MUST 以使用者依序選取的 A（波段起點）與 B（波段終點）建立回撤，並依序繪製 `-0.62、-0.27、0、0.236、0.382、0.5、0.618、0.705、0.786、1` 十條水準。每條水準線的價格 MUST 依 `B - r × (B - A)` 計算，且每一條線 MUST 以「比率（價格）」格式同時顯示最多三位小數比率與使用該商品既有價格格式化規則計算的對應價格。

#### Scenario: 上漲波段回撤
- **WHEN** 使用者先選較低的 A 價格再選較高的 B 價格並完成回撤
- **THEN** 系統 MUST 以指定公式產生全部十條回撤線
- **AND** 每條線的可見標籤 MUST 同時包含比率與對應價格

#### Scenario: 下跌波段回撤
- **WHEN** 使用者先選較高的 A 價格再選較低的 B 價格並完成回撤
- **THEN** 系統 MUST 依同一公式正確反映下跌波段方向
- **AND** 系統 MUST NOT 假設 A 必須低於 B 或省略負比率、0.705 或任何其他指定水準價格

### Requirement: 費波那契拓展必須以三個錨點計算並標示價格

系統 MUST 以使用者依序選取的 A、B、C 建立拓展，並依序繪製 `0.618、0.705、0.786、1、1.272、1.414、1.618、2` 八條水準，且 MUST NOT 繪製 `-0.62`、`-0.27`。每條水準線的價格 MUST 依 `C + r × (B - A)` 計算，且每一條線 MUST 以「比率（價格）」格式同時顯示最多三位小數比率與使用該商品既有價格格式化規則計算的對應價格。

#### Scenario: 完成三點拓展
- **WHEN** 使用者完成 A、B、C 三個有效錨點
- **THEN** 系統 MUST 繪製全部八條拓展水準線與各自的比率、對應價格標籤
- **AND** 結果 MUST NOT 包含 `-0.62`、`-0.27`
- **AND** 拓展價格 MUST 由 A 至 B 的波段差與 C 共同決定

#### Scenario: 滑鼠移動預覽下一個錨點
- **WHEN** 使用者已啟動費波那契工具，並將滑鼠移到下一個有效主圖位置但尚未點選
- **THEN** 系統 MUST 預覽下一個錨點、暫態導引線與目前可計算的回撤十條或拓展八條水準
- **AND** 暫態預覽 MUST NOT 寫入本機儲存，滑鼠離開主圖或按 Escape 後 MUST 消失

### Requirement: 費波那契錨點必須依 K 棒與組合鍵吸附

系統 MUST 讓費波那契 preview 與完成點選共用同一錨點解析規則。未按 macOS Option 或 Windows Alt 時，A MUST 吸附所點 K 棒的 `low`，B MUST 吸附所點 K 棒的 `high`；拓展 C 在所點位置有 K 棒時 MUST 吸附該 K 棒的 `low`，在尚無 K 棒的未來區域 MUST 使用游標自由價位。回撤按住 Option／Alt 時，A MUST 改吸附所點 K 棒的 `high`，B MUST 改吸附所點 K 棒的 `low`，且兩點仍必須位於合法 K 棒；拓展按住 Option／Alt 時 MUST 維持既有自由價位。這裡的最低價與最高價只指所點單根 K 棒，不得自動搜尋整段區間極值。

#### Scenario: 一般操作依序吸附 A 與 B
- **WHEN** 使用者未按 Option／Alt，並在有 K 棒的位置選取 A 與 B
- **THEN** A MUST 使用所點 K 棒的 `low`，B MUST 使用所點 K 棒的 `high`
- **AND** preview、待選價格導引與完成保存 MUST 使用相同時間及價格

#### Scenario: A 或 B 點在無 K 棒區域
- **WHEN** 使用者未按 Option／Alt，並嘗試在沒有 K 棒的未來區域選取 A 或 B
- **THEN** 系統 MUST 將該點視為無效且不得增加 pending 錨點
- **AND** 既有已選錨點與完成註記 MUST 維持不變

#### Scenario: C 依位置決定吸附或自由價位
- **WHEN** 使用者未按 Option／Alt 選取拓展 C
- **THEN** 有 K 棒的位置 MUST 使用該 K 棒 `low`
- **AND** 沒有 K 棒的未來區域 MUST 保留游標換算的時間與自由價位

#### Scenario: 回撤 Option 或 Alt 反轉 A／B 吸附方向
- **WHEN** 使用者按住 macOS Option 或 Windows Alt 選取回撤 A 與 B
- **THEN** A MUST 使用所點 K 棒的 `high`，B MUST 使用所點 K 棒的 `low`
- **AND** A／B 位於無 K 棒區域時 MUST 視為無效，不得建立自由價位錨點

#### Scenario: 拓展 Option 或 Alt 保留自由價位
- **WHEN** 使用者按住 macOS Option 或 Windows Alt 選取拓展 A、B 或 C
- **THEN** 系統 MUST 維持既有游標自由價位行為
- **AND** 本變更 MUST NOT 改變拓展公式、保存或清除契約

### Requirement: 回撤與拓展必須各保留一張並依完成順序分色

系統 MUST 對同一 canonical symbol 與 interval 最多保留一張費波那契回撤及一張費波那契拓展。完成新圖時 MUST 只取代相同種類的舊圖，不得清除另一種類；只有一種圖時 MUST 使用分級彩色，同時存在兩種圖時較早完成者 MUST 維持分級彩色，較晚完成者 MUST 以一致單色呈現。

#### Scenario: 先畫回撤再畫拓展
- **WHEN** 使用者先完成回撤，再完成拓展
- **THEN** 兩張圖 MUST 同時存在，回撤 MUST 使用分級彩色，拓展 MUST 使用單色
- **AND** 拓展完成不得清除或改寫回撤錨點

#### Scenario: 先畫拓展再畫回撤
- **WHEN** 使用者先完成拓展，再完成回撤
- **THEN** 兩張圖 MUST 同時存在，拓展 MUST 使用分級彩色，回撤 MUST 使用單色

#### Scenario: 重畫相同種類
- **WHEN** 回撤與拓展都存在，使用者重新完成其中一種類型
- **THEN** 系統 MUST 只取代該種類舊圖並把新完成圖視為較晚完成的單色圖
- **AND** 未重畫的另一種類 MUST 保留並成為較早完成的彩色圖

#### Scenario: 還原既有單張本機資料
- **WHEN** 系統讀取舊版有效的單張費波那契本機註記
- **THEN** 系統 MUST 將其安全遷移成對應種類的第一張彩色圖
- **AND** MUST NOT 影響相同身份的價格範圍註記或發出後端寫入

### Requirement: 費波那契必須以細實線、分區色帶與左側標籤呈現

費波那契水準線 MUST 以專屬範圍、1 CSS px 實線與左側標籤呈現。第一張分級彩色圖為回撤時 MUST 顯示十條水準線及九個半透明色帶，為拓展時 MUST 顯示八條水準線及七個半透明色帶；既有七個比率 MUST 依各種類原有順序保留既有色彩，回撤新增的 `-0.62`、`-0.27` 與兩種類皆新增的 `0.705` MUST 分別使用 `#a78bfa`、`#e879f9`、`#f472b6`。回撤與拓展同時存在時，較晚完成的第二張單色圖 MUST NOT 顯示任何區間填色。回撤水平線由 A、B 較左的 X 座標開始，拓展水平線由 B、C 較左的 X 座標開始，兩者均向右延伸至價格縱軸前的 plot 安全邊界。A–B／A–B–C 波段導引線 MUST 維持虛線並使用 1 CSS px；暫態導引線也 MUST 使用 1 CSS px 虛線，另以較低透明度表示尚未完成。標籤 MUST 優先位於水平線起點左側，採「比率（價格）」格式；分級彩色圖沿用各水準色，第二張單色圖的水平線、標籤與波段導引線 MUST 使用同一單色。空間不足時標籤可移入水平線內側。辨識方式不得只依靠顏色，並且 MUST 與 K 線、均線、價格網格、本益比河流圖及價格範圍保持可辨識差異。

#### Scenario: 回撤與拓展線條辨識
- **WHEN** 費波那契與既有主圖指標同時顯示
- **THEN** 使用者 MUST 可由局部延伸範圍、依種類產生的十條或八條 1 CSS px 水平實線、第一張圖的九個或七個相鄰色帶、左側文字及 1 CSS px 波段虛線辨認費波那契水準
- **AND** 水平實線與波段虛線 MUST 維持不同角色，不得以粗 halo 遮住水準價位

#### Scenario: 第二張圖只使用一致單色線條
- **WHEN** 回撤與拓展同時存在
- **THEN** 較晚完成圖依種類產生的十條或八條水平線、標籤及波段虛線 MUST 使用一致單色
- **AND** 較晚完成圖 MUST NOT 建立或顯示任何相鄰水準區間填色
- **AND** 較早完成圖 MUST 維持各水準分級彩色與依種類產生的九個或七個半透明色帶，兩張圖不得因重繪交換先後順序

#### Scenario: 第二種圖選點預覽不顯示區間填色
- **WHEN** 已有一種完成的費波那契圖，使用者正在選取另一種圖的錨點
- **THEN** pending preview MUST 使用第二張圖的單色水平線、標籤與波段虛線
- **AND** pending preview MUST NOT 建立或顯示任何區間填色

#### Scenario: 水平線延伸至價格縱軸附近
- **WHEN** 使用者預覽或完成回撤與拓展
- **THEN** 回撤水準 MUST 由 A、B 較左的 X 座標延伸到價格縱軸前，拓展水準 MUST 由 B、C 較左的 X 座標延伸到價格縱軸前
- **AND** 水準線及第一張圖依種類產生的九個或七個色帶 MUST 停在 plot 安全邊界，不得蓋住右側價格刻度或標籤

#### Scenario: 深色與密集主圖
- **WHEN** 主圖同時具有多根 K 線、均線、河流線或價格網格
- **THEN** 三個透明空心圓錨點 MUST 以約 1.25 CSS px 的細框準確置中於所選時間／價格座標，圓內 K 棒與價位 MUST 保持可見
- **AND** 錨點圓內 MUST NOT 顯示 A／B／C 或其他字元，也不得以填色遮住 K 棒
- **AND** 新樣式 MUST 維持 `pointer-events: none`，不得攔截縮放、平移、十字線或右鍵操作

#### Scenario: 拓展全部水準位於價格軸內
- **WHEN** completed extension 的任一水準超出目前 K 線高低範圍
- **THEN** 主圖價格軸 MUST 納入八條完成拓展的有限最低與最高水準，使全部水準與標籤可見
- **AND** pending MUST NOT 改變價格尺度；清除拓展或切換商品／週期後 MUST 清除相應價格軸輔助範圍

### Requirement: 費波那契註記必須安全重繪、保存及匯出

完成的回撤與拓展註記 MUST 依 canonical symbol 與 interval 保存於瀏覽器本機，且每種類型最多一張；暫態選點不得保存。切換 symbol 或 interval MUST 取消舊 pending，但不得刪除舊 identity 的合法完成圖；切回原 K 線 interval 時 MUST 還原 kind、anchors、order、依種類重算的回撤十條或拓展八條水準及彩色／單色角色。`intraday` 分時模式 MUST 暫停費波那契顯示與建立，但不得刪除其他 interval 的保存資料。覆蓋層 MUST 隨縮放、平移、resize 與圖表重建重新對齊並保持不攔截 K 線手勢；每個價格標籤 MUST 位於 panel 可見範圍，實際水準線價格位置不得改寫。完整 panel PNG MUST 包含目前可見的回撤十條線、拓展八條線與標籤，以及第一張圖依種類產生的九個或七個色帶，且第二張單色圖不得出現區間填色。

#### Scenario: 切換 interval 後切回
- **WHEN** 使用者在某個 K 線 interval 完成費波那契，切換至另一 interval 後再切回
- **THEN** 系統 MUST 還原原 symbol／interval 的合法完成回撤與拓展
- **AND** 其他 interval 的錨點、overlay、helper 或 pending MUST NOT 混入

#### Scenario: 切換商品或進入分時模式
- **WHEN** 使用者切換至另一 symbol 或切換至 `intraday`
- **THEN** 系統 MUST 取消舊 pending，且只依新模式顯示合法內容；`intraday` MUST 不顯示或建立費波那契
- **AND** 原 symbol／interval 的合法保存資料 MUST 保留，舊 overlay 與 helper MUST NOT 殘留

#### Scenario: 損毀或重複種類的本機註記
- **WHEN** 瀏覽器本機保存的費波那契資料無法解析、版本不相容、含非有限錨點或同種類超過一張
- **THEN** 系統 MUST 安全忽略、正規化或移除無效費波那契資料，並保留同 identity 的合法價格範圍
- **AND** 主圖 MUST 繼續載入且不得發出 API 或 D1 寫入

#### Scenario: 匯出同時含回撤與拓展的完整 panel
- **WHEN** 使用者在彩色與單色費波那契註記都可見時執行「儲存圖片」
- **THEN** PNG MUST 包含與畫面相同的回撤十條、拓展八條水準線、波段虛線、比率／價格標籤及第一張圖依種類產生的九個或七個色帶
- **AND** PNG 內第二張單色圖 MUST NOT 出現區間填色
- **AND** 匯出不得遺失或交換彩色／單色角色，也不得遺失既有 K 線、主圖指標或副圖

### Requirement: 費波那契工具必須可取消與清除

系統 MUST 支援使用 Escape 取消未完成的費波那契選點，並提供「清除回撤」、「清除拓展」及「全部清除」操作。「清除回撤」與「清除拓展」MUST 只清除目前 canonical symbol、目前 interval 的指定完成種類；「全部清除」MUST 清除目前 canonical symbol 所有 interval 的回撤與拓展。取消或清除後 MUST 移除符合 scope 的暫態覆蓋層、listener、autoscale helper 與本機保存資料；不得影響其他 symbol、價格範圍、Pivot、Volume Profile、技術指標或個人資料。同頁顯示相同 symbol 的其他 panel MUST 即時反映「全部清除」，顯示不同 symbol 的 panel MUST 維持不變。

#### Scenario: Escape 取消未完成選點
- **WHEN** 使用者在尚未選滿回撤或拓展錨點時按 Escape
- **THEN** 系統 MUST 退出該工具的選取狀態並移除暫態提示
- **AND** MUST NOT 建立或保存不完整註記

#### Scenario: 只清除目前 interval 的一種類型
- **WHEN** 目前 symbol／interval 同時有回撤與拓展，使用者選擇「清除回撤」或「清除拓展」
- **THEN** 系統 MUST 只移除目前 identity 的指定種類與保存資料
- **AND** 留下的一張 MUST 成為彩色有色帶的第一張圖，其他 interval 的同種類 MUST 保留

#### Scenario: 清除目前商品所有時間級別
- **WHEN** 使用者在任一 K 線 interval 選擇「全部清除」
- **THEN** 系統 MUST 只清除目前 canonical symbol 在所有 interval 保存及已掛載的回撤與拓展
- **AND** 切換至該 symbol 其他 interval 時 MUST 不再還原已清除圖形

#### Scenario: 全部清除保留其他繪圖與商品
- **WHEN** 同一 identity 尚有價格範圍，且其他 symbol 也有費波那契或其他註記
- **THEN** 系統 MUST 保留價格範圍、其他 symbol 的全部資料及價格範圍的獨立清除能力
- **AND** Pivot、Volume Profile、技術指標、個人偏好及完整 panel 其他內容 MUST 維持不變
