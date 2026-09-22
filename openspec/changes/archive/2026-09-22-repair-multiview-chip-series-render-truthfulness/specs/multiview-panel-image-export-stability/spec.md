## MODIFIED Requirements

### Requirement: 匯出前必須確認 Canvas 與 series 已確定就緒
MultiView MUST 以 panel generation、symbol、interval、context identity、chart mounted 狀態、Canvas 有效尺寸、有效 series 選取與各 pane 實際提交的可繪點數判斷匯出就緒。系統 MUST 有界等待 layout 與 paint 完成；只等待固定時間、只檢查一般 DOM、只確認 series 物件存在，或只確認整張輸出非空白 MUST NOT 視為完整性證據。具有合法 material data 與有效選取的 pane 若沒有任何可繪點，readiness MUST fail closed。

#### Scenario: 離屏 pane 使用保留 payload 重新掛載
- **WHEN** 具有合法 material data 與已選 series 的 pane 為匯出重新掛載
- **THEN** 系統 MUST 在擷取前建立對應 series、至少一個實際可繪點、非零尺寸 Canvas、目前價格軸與主圖 accepted viewport
- **AND** export readiness MUST 明確列出 expected、selected、rendered 及 drawable point 狀態

#### Scenario: Canvas 或可繪點在期限內未完成
- **WHEN** 任一具有合法資料的 expected pane 在有界期限內仍缺少 chart、有效選取、series、可繪點或有效 Canvas
- **THEN** 系統 MUST 取消本次匯出並顯示可理解的失敗訊息
- **AND** MUST NOT 呼叫下載或產生只有標題／readout 而缺少線圖的 PNG

#### Scenario: 選定欄位確實沒有 material data
- **WHEN** pane 的 payload rows 存在，但已選欄位在日期範圍內全部為 `null` 或沒有合法日期映射
- **THEN** 系統 MUST 依真實 availability 與欄位狀態標示無資料，不得以零值補造可繪點
- **AND** readiness MUST 區分真實無資料與原本應有可繪點但渲染失敗

#### Scenario: 匯出期間商品或 generation 改變
- **WHEN** 使用者切換商品、週期、版型或銷毀 panel，使匯出租約的 identity 失效
- **THEN** 系統 MUST 取消舊匯出並禁止混合新舊商品 DOM／Canvas
- **AND** MUST 執行與其他失敗路徑相同的資源清理
