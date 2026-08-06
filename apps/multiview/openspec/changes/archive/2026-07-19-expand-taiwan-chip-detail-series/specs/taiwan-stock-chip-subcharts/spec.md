## ADDED Requirements

### Requirement: 法人買賣細項讀值與 series

外資與投信 pane MUST 在逐日讀值中分列買進、賣出及淨買賣超，並 MUST 讓使用者在 pane 內選擇可見 series；淨買賣超、買進與賣出屬於每日流量，MUST 使用柱狀 series，外資持股股數與持股比例屬於存量，MUST 使用折線及各自相容的尺度。

#### Scenario: 顯示外資完整細項
- **WHEN** 某交易日具有外資買進、賣出、淨買賣超、持股股數與持股比例
- **THEN** 外資 pane 讀值 MUST 分列五個欄位及來源
- **AND** 預設 MUST 維持淨買賣超柱與持股比例線，使用者 MUST 可另行啟用買進柱、賣出柱及持股股數線

#### Scenario: 顯示投信完整細項
- **WHEN** 某交易日具有投信買進、賣出與淨買賣超
- **THEN** 投信 pane 讀值 MUST 分列三個欄位及來源
- **AND** 預設 MUST 維持淨買賣超柱，使用者 MUST 可另行啟用買進柱與賣出柱

#### Scenario: 投信沒有持股來源
- **WHEN** 系統沒有可靠來源發布投信持股股數或比例
- **THEN** 投信 pane MUST NOT 建立投信持股折線
- **AND** 若介面列出參考畫面的對應欄位，MUST 顯示「無資料」且不得由買賣超累積推算

#### Scenario: 法人 gross 部分缺漏
- **WHEN** 某交易日只有淨買賣超而買進或賣出為 `null`
- **THEN** pane MUST 繪製可用的淨額並逐項標示缺少的 gross 欄位為「無資料」
- **AND** MUST NOT 以 0 補出買進柱或賣出柱

### Requirement: 融資融券詳細 series 與使用率

融資與融券 pane MUST 分別提供餘額、日變化、買進、賣出、現金／現券償還、使用率與資券互抵逐日讀值；餘額與使用率 MUST 使用折線，日變化、買進、賣出與償還 MUST 使用柱狀 series，張數存量、張數流量與百分比 MUST 使用不互相壓縮的尺度。

#### Scenario: 顯示融資詳細資料
- **WHEN** 某交易日具有完整融資餘額、變化、買進、賣出、現金償還與使用率
- **THEN** 融資 pane 讀值 MUST 分列所有可用欄位及資券互抵
- **AND** 預設 MUST 維持餘額線與日變化柱，使用者 MUST 可啟用買進柱、賣出柱、現金償還柱與使用率線

#### Scenario: 顯示融券詳細資料
- **WHEN** 某交易日具有完整融券餘額、變化、買進、賣出、現券償還與使用率
- **THEN** 融券 pane 讀值 MUST 分列所有可用欄位及資券互抵
- **AND** 預設 MUST 維持餘額線與日變化柱，使用者 MUST 可啟用買進柱、賣出柱、現券償還柱與使用率線

#### Scenario: 使用率缺漏
- **WHEN** 某交易日餘額有效但限額或使用率為 `null`
- **THEN** pane MUST 維持餘額及其他可用 series，並將使用率標示為「無資料」
- **AND** MUST NOT 畫出 0% 折線或沿用前一日使用率

### Requirement: 細項方向、選擇狀態與缺值

系統 MUST 對成交量與籌碼逐日讀值中的各欄位，以該欄位前一筆實際非 `null` 資料判定增加、減少或持平；新增 series 的可見選擇 MUST 以 panel 所屬 tab、symbol 與 pane 區隔保存，格式失效時 MUST 回復精簡預設而不影響既有 pane 選擇。

#### Scenario: 比較前一筆實際資料
- **WHEN** 目前日期某欄位有效，但前一交易日該欄位缺漏且更早日期存在有效值
- **THEN** 方向 MUST 與該欄位更早的前一筆有效值比較
- **AND** MUST NOT 將中間缺漏視為 0 或比較同日其他欄位

#### Scenario: 保存不同商品的 series 選擇
- **WHEN** 使用者為某 tab 內的 `2330.TW` 融資 pane 啟用使用率線，之後切換其他 symbol 再返回
- **THEN** 系統 MUST 恢復該 tab、symbol 與 pane 的 series 選擇
- **AND** MUST NOT 把選擇套用到其他 symbol 或覆寫 A／B 模式的 pane 清單

#### Scenario: 舊偏好沒有 series 設定
- **WHEN** 使用者的本機偏好只含既有 pane 選擇或新版 payload 無法解析
- **THEN** 系統 MUST 使用各 pane 的既有主要 series 預設
- **AND** MUST NOT 因偏好 migration 失敗而隱藏 pane、清除其他選擇或重新請求 candles

### Requirement: 副圖 series 右鍵選單與右側數值軸

系統 MUST 將籌碼副圖的 series 選項整合至該副圖既有的滑鼠右鍵功能表，MUST NOT 在副圖標題列新增「項目」按鈕或其他 series 控制鈕；每個具有可見資料的 pane MUST 顯示對應目前主要可見資料群組的右側數值軸。

#### Scenario: 從滑鼠右鍵功能表切換 series
- **WHEN** 使用者在具有可選 series 的籌碼副圖按滑鼠右鍵
- **THEN** 同一功能表 MUST 顯示具可存取名稱、勾選狀態與色彩提示的線圖項目
- **AND** 功能表 MUST 同時保留既有「移除副圖」，副圖標題列 MUST NOT 顯示「項目」按鈕

#### Scenario: 以鍵盤開啟 series 功能表
- **WHEN** 焦點位於副圖且使用者按 Context Menu 鍵或 `Shift+F10`
- **THEN** 系統 MUST 開啟與滑鼠右鍵相同的功能表並將焦點移入第一個可操作項目
- **AND** Escape MUST 關閉功能表並將焦點還給原副圖

#### Scenario: 顯示主要 series 的右側數值軸
- **WHEN** pane 至少有一個目前選取且具有實際資料的 series
- **THEN** 系統 MUST 在右側顯示該 pane 目前主要可見資料群組的數值刻度與單位 formatter
- **AND** 其他不同單位的 series MUST 維持獨立尺度，不得因共用右軸而壓縮主要 series

#### Scenario: 取消預設主要 series
- **WHEN** 使用者取消預設主要 series 並只保留另一個具有資料的群組
- **THEN** 右側數值軸 MUST 改為該剩餘群組的尺度並維持可見
- **AND** MUST NOT 留下無資料的空白右軸或讓數值軸消失
