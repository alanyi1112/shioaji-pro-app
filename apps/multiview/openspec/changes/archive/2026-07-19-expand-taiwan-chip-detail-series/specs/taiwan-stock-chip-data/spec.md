## ADDED Requirements

### Requirement: 外資與投信原始買進賣出

系統 MUST 以整數股數保存外資與投信每日原始買進、賣出及淨買賣超，外資 gross 與 net MUST 使用相同來源分類集合；股數轉張只可發生在顯示層，MUST NOT 以已四捨五入張數重新計算淨額。

#### Scenario: 正規化外資分類
- **WHEN** 來源將外資拆成 `Foreign_Investor` 與可相加的 `Foreign_Dealer_Self`
- **THEN** `foreignBuyShares` 與 `foreignSellShares` MUST 分別加總相同分類的原始買進與賣出股數
- **AND** `foreignNetShares` MUST 使用相同分類集合的未四捨五入股數計算或採用可驗證的來源淨額

#### Scenario: 正規化投信買進賣出
- **WHEN** 來源回傳 `Investment_Trust` 的買進與賣出股數
- **THEN** 系統 MUST 保存 `investmentTrustBuyShares` 與 `investmentTrustSellShares`
- **AND** `investmentTrustNetShares` MUST 等於未四捨五入買進股數減賣出股數，或等於通過驗證的來源淨額

#### Scenario: 只有淨額沒有買進賣出
- **WHEN** 合法 fallback 來源只提供某法人淨買賣超而沒有 gross buy／sell
- **THEN** 系統 MUST 保留可用淨額並將缺少的買進、賣出設為 `null`
- **AND** MUST NOT 由淨額任意拆分買進與賣出

#### Scenario: 顯示張數後出現四捨五入差
- **WHEN** 原始買進與賣出股數換算張數後的個別顯示值無法精確重現來源淨額張數
- **THEN** API 與 D1 MUST 保留原始股數與來源淨額語意
- **AND** MUST NOT 為了讓顯示張數相減吻合而修改任一原始欄位

### Requirement: 融資融券限額與使用率

系統 MUST 保存融資、融券今日餘額、限額及使用率；來源發布使用率時 MUST 優先保存來源值，只有來源未發布而今日餘額與正數限額皆有效時，才 MUST 以 `今日餘額 / 限額 * 100` 計算使用率。

#### Scenario: 來源直接發布使用率
- **WHEN** TPEx 或其他合法來源同時回傳今日餘額、quota 與使用率
- **THEN** 系統 MUST 保存來源使用率、限額與 provenance
- **AND** 計算值只可用於合理精度內的交叉驗證，不得覆蓋來源值

#### Scenario: 來源只提供餘額與限額
- **WHEN** TWSE 或歷史 API 回傳有效今日餘額與大於 0 的限額但沒有使用率
- **THEN** 系統 MUST 計算並保存對應的 `marginUtilizationPercent` 或 `shortUtilizationPercent`
- **AND** 計算 MUST 使用同來源、同證券、同日期且已正規化為相同張數單位的餘額與限額

#### Scenario: 限額缺漏或為零
- **WHEN** 限額缺漏、非有限值、為 0 或與餘額單位無法確認
- **THEN** 對應使用率 MUST 為 `null`
- **AND** MUST NOT 改以發行股數、融資餘額或其他不相同分母推算

#### Scenario: 來源值與計算值明顯不一致
- **WHEN** 來源發布使用率與同列餘額／限額計算值超出顯示精度容許範圍
- **THEN** 系統 MUST 保留來源值與 provenance 並產生不含秘密的安全 warning
- **AND** MUST NOT 靜默以計算值覆蓋來源發布值

### Requirement: 新增籌碼欄位向後相容

系統 MUST 將新增法人 gross 與信用交易限額／使用率保存於既有資料族群 JSON，並維持既有 `GET /api/taiwan-stock-chip` response、D1 rows 與局部合併相容；舊資料缺少新增鍵時 MUST 視為 `null`，不得使整筆資料失效。

#### Scenario: 讀取舊 D1 row
- **WHEN** D1 既有 row 只有法人淨額或融資融券原有欄位
- **THEN** API MUST 正常回傳既有欄位並將新增欄位視為 `null`
- **AND** MUST NOT 因缺少新增鍵刪除或拒絕該 row

#### Scenario: 局部更新新欄位
- **WHEN** refresh 取得同一日期的法人 gross 或信用交易限額／使用率
- **THEN** D1 upsert MUST 更新對應資料族群 JSON 與 provenance
- **AND** MUST NOT 清空同日外資持股、借券或其他未參與更新的資料族群
