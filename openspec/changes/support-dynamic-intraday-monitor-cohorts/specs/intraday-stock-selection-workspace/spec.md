## ADDED Requirements

### Requirement: 盤中選股面板必須清楚區分設定、當日名單與待生效變更

盤中選股 workspace MUST 同時呈現已儲存設定 revision、當日封存 plan 的交易日／revision／入選數、候補數、逐檔基準狀態、data-active 數及待生效設定的預定交易日和失敗原因。排序僅在超過容量時表示入選優先順序；介面 MUST NOT 將 configured、planned、baseline-ready、subscription-requested 或 data-active 混為同一數字。匯入草稿及「儲存設定」仍 MUST 分離；保存後也不得暗示已在盤中立即換入。

#### Scenario: 盤中新增一檔商品

- **WHEN** 使用者在已封存 cohort 的交易日儲存新增商品
- **THEN** 面板 MUST 顯示設定已保存但當日名單未變，以及下一適用交易日或尚待盤前驗證的狀態
- **AND** MUST NOT 宣稱該商品已被訂閱、已建立基準或正在監控

#### Scenario: 超過容量與部分基準缺漏

- **WHEN** configured 為 200、planned 為 160、baseline-ready 為 159
- **THEN** 面板 MUST 分開顯示三個數量與其逐檔原因，且不得顯示「160 檔全部正常」

### Requirement: 舊名單暫移商品的恢復必須由使用者確認

系統 MUST 保留 2026-09-29 驗收前後的設定與備份之來源區別，提供唯讀差異供使用者核對。先前為容量調整暫移的 11 檔 MUST NOT 在 migration 時自動覆蓋目前設定或加入當日 plan；只有使用者明確確認且通過 200 設定上限、revision 衝突及每日 plan Gate，才可作為新設定保存。

#### Scenario: 顯示舊備份中的 11 檔

- **WHEN** 使用者檢視舊備份與現行設定差異
- **THEN** 系統 MUST 只顯示可證實的商品與修訂差異，MUST NOT 自動變更已儲存名單
- **AND** 未有操作者證據的歷史變更 MUST 顯示來源未知
