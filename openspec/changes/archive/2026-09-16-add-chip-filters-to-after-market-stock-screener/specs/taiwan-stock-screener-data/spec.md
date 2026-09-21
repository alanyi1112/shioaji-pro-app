## ADDED Requirements

### Requirement: 普通股母體必須保存已發行普通股數及生效證據

TWSE／TPEx ordinary-stock universe row MUST 保存 canonical `issuedCommonShares`、官方 source date、source URL、payload hash 與 normalization version。`issuedCommonShares` MUST 來自同一官方公司基本資料 row 中的已發行普通股數，為大於零的十進位整數；不能驗證時商品仍 MAY 留在母體，但所有需要股本分母的條件 MUST 為 `unknown`。

#### Scenario: 上市普通股股數有效

- **WHEN** TWSE 公司基本資料的普通股商品具有合法「已發行普通股數或 TDR 原股發行股數」，且商品分類已排除 TDR
- **THEN** universe row MUST 保存該 ordinary-share count、source date 與 provenance，不得只驗證後丟棄數值

#### Scenario: 上櫃普通股股數有效

- **WHEN** TPEx 公司基本資料的普通股商品具有合法 `IssueShares`
- **THEN** universe row MUST 以相同 canonical shares 語意保存，且市場轉換時由最新有效 listing evidence 決定 current row

#### Scenario: 股數缺漏但商品仍是普通股

- **WHEN** 商品分類可驗證為普通股，但 issued shares 缺漏、為零或格式非法
- **THEN** 商品 MUST 不因分母缺漏被靜默排除，universe MUST 保存 `issued_shares_invalid` 或對應原因，投信占股本條件 MUST 為 unknown

### Requirement: 股本分母必須綁定 immutable universe revision

每個 screener snapshot MUST 綁定一個含 issued shares 的 universe revision。投信占股本 evidence MUST 使用該 revision 中不晚於 `effectiveSessionDate` 生效的分母；snapshot 發布後即使公司股本更新，舊結果 MUST 保持原分母、原百分比與原 evidence hash。

#### Scenario: 公司在新交易日變更股本

- **WHEN** 新官方 universe row 顯示已發行普通股數改變
- **THEN** publisher MUST 建立新 universe revision 並只在新 snapshot 通過所有 gates 後使用，既有 snapshot 不得被就地重算

### Requirement: 全市場股本 coverage 必須納入籌碼發布 gate

啟用投信占股本條件的 snapshot readiness MUST 分市場回報普通股母體總數、有效分母數、缺漏數與 source date。API MUST 允許缺分母商品以 unknown 出現在全母體，不得縮小分母到有資料商品後宣稱 100% 可判定，也不得以 watchlist coverage 代表全市場。

#### Scenario: 少數商品缺少股本分母

- **WHEN** 全市場母體完整，但少數普通股的 issued shares 無法驗證
- **THEN** snapshot MAY 發布為 partial，counts MUST 保留完整母體並精確列出 `issued_shares_missing`，受影響商品不得被判為 fail
