## MODIFIED Requirements

### Requirement: preview 與完成點選必須共用錨點吸附規則
主交易畫面與 MultiView MUST 以 kind-aware modifier policy 解析費波那契錨點，且 preview 與 click commit MUST 使用同一 resolver 與相同 time／price。回撤未按 Option／Alt 時，A MUST 吸附所點單根 K 棒 low、B MUST 吸附 high；按住 macOS Option 或 Windows Alt 時，A MUST 改吸附 high、B MUST 改吸附 low，且 A／B 仍須位於合法 K 棒。拓展未按 Option／Alt 時，A MUST 吸附 low、B MUST 吸附 high、C 在 K 棒區域 MUST 吸附 low，在未來空白區 MUST 使用游標自由價位；拓展按住 Option／Alt 時，A／B／C MUST 維持使用經 tick-size 正規化的游標自由價位並 MAY 位於空白區。吸附的 high／low 只指所點單根 K 棒，不得搜尋整段區間極值。

#### Scenario: 回撤一般 K 棒吸附
- **WHEN** 使用者未按 Option／Alt，並在合法 K 棒位置依序選取回撤 A 與 B
- **THEN** A MUST 使用第一根所點 K 棒 low，B MUST 使用第二根所點 K 棒 high
- **AND** preview 顯示價格 MUST 與完成保存價格相同

#### Scenario: 回撤 Option／Alt 反向吸附
- **WHEN** 使用者按住 macOS Option 或 Windows Alt，並在合法 K 棒位置依序選取回撤 A 與 B
- **THEN** A MUST 使用第一根所點 K 棒 high，B MUST 使用第二根所點 K 棒 low
- **AND** 系統 MUST NOT 使用游標自由價位、搜尋區間極值或改寫 K 棒資料

#### Scenario: 回撤 Option／Alt 不接受空白區
- **WHEN** 使用者按住 Option／Alt，並嘗試在沒有 K 棒的未來空白區選取回撤 A 或 B
- **THEN** 系統 MUST 保留目前 pending 錨點數並顯示該點無效
- **AND** 既有完成圖與 storage MUST 維持不變

#### Scenario: 拓展維持既有吸附與自由價位
- **WHEN** 使用者建立拓展，未按 Option／Alt 選取 A／B／C，或按住 Option／Alt 選取任一錨點
- **THEN** 未按 modifier 時 A／B／C MUST 分別使用 low／high／low，未來 C MUST 可使用游標自由價位
- **AND** 按住 Option／Alt 時 A／B／C MUST 使用經商品 tick-size 正規化的游標自由價位
- **AND** 系統 MUST NOT 建立假 candle、寫入 candle series 或觸發 history loader

#### Scenario: 兩個畫面使用相同 modifier fixture
- **WHEN** 主交易畫面與 MultiView 對相同 K 棒、raw pointer、kind、anchor index 與 `altKey` 執行 resolver fixture
- **THEN** 兩邊 MUST 產生相同 time／price 或相同無效結果
- **AND** tooltip 與 pending notice MUST 正確區分回撤反向吸附及拓展自由價位
