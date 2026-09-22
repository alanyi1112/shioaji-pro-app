## Why

目前收盤後選股雖已具備投信買賣超、完整日 OHLCV 與已發行普通股數，但無法直接找出「法人連續賣超後首日轉買，且同時爆量換手」的複合轉折。產品也沒有可驗證的投信實際持股比例來源，因此需要以正式可取得的法人流量、成交量與股本資料定義可稽核策略，避免把買賣超誤稱為持股存量。

## What Changes

- 在「籌碼／價量」分類新增「外資連賣後轉買＋爆量換手」及「投信連賣後轉買＋爆量換手」兩個可獨立啟用的複合條件；條件卡維持既有收合式 UI，所有數值參數皆可調整。
- 以明確的官方交易日時間軸區分 `D0` 與過去資料：前期連續賣超不得包含今日，成交量與週轉率平均不得把今日爆量納入自身基準，MA 則依標準移動平均定義包含今日。
- 外資條件預設要求前 3 個交易日天天賣超、今日淨買超大於 1,000 張、今日週轉率大於 2% 且大於前 5 日平均的 2 倍、收盤高於 MA5、成交量高於前 5 日平均，以及前 20 日平均成交量至少 1,000 張。
- 投信條件採相同價量與流動性門檻，今日淨買超預設改為大於 500 張，並加入可調整的「回補強度至少 50%」及「今日投信淨買超占今日成交量大於 1% 且小於 15%」。此比例一律稱為成交參與率，不得稱為投信持股比例。
- 擴充選股專用官方法人 canonical row，保存並驗證外資買進、賣出及淨買賣超；TWSE／TPEx 必須使用各自已核對的正式報表欄位，既有只有 payload hash 的日期需重新抓取後才能回填，不能由其他局部 cache 或追蹤清單補造全市場資料。
- 將 criteria、immutable snapshot、API、偏好設定及 evidence 升級至下一版，保留舊版讀取／遷移能力；每個複合條件需回傳逐子條件日期、數值、公式版本與 `pass`／`fail`／`unknown` 證據。
- 缺少任一必要相鄰交易日、法人欄位、成交量、已發行普通股數或來源驗證時必須 fail closed 為 `unknown`，不得補零、跳日、用日曆日替代交易日或混用尚未發布的日期。
- 保留既有「投信 N 日累計買超占已發行普通股數」為獨立進階條件，不把它包進本次投信首日反轉的預設必要條件，也不以其推算實際投信持股。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `after-market-stock-screener-chip-filters`: 新增外資與投信連賣轉買的複合籌碼／價量條件、時間窗公式、可調參數及逐子條件證據。
- `taiwan-stock-screener-chip-data`: 擴充全市場法人 canonical row、TWSE／TPEx normalizer、歷史回填與 coverage gate，以正式保存外資買進、賣出及淨買賣超。
- `taiwan-stock-screener-data`: 升級 immutable snapshot、criteria／preference migration、公式版本、缺漏理由及發布對齊規則。
- `after-market-stock-screener`: 在精簡條件面板的「籌碼／價量」分類呈現兩項新條件，保存草稿並顯示可核對的結果與 unknown 原因。

## Impact

- 前端：`src/lib/stock-screener-*`、`src/components/stock-screener-*`、偏好遷移、查詢序列化、結果 evidence 與瀏覽器測試。
- MultiView worker：`stock-screener-chip-sources.ts`、collector／repository／publisher／route，以及選股 immutable snapshot 版本。
- D1：新增 additive migration，替 `screener_chip_daily` 增加外資欄位；必須保留既有個人清單、舊 snapshot 與 publication head，失敗時不得破壞目前可用版本。
- 資料作業：重新取得必要官方歷史法人報表以建立全市場外資欄位及 receipts；不得使用需求驅動的 `taiwan_stock_chip_daily`、自選清單或單一商品 cache 宣稱完成。
- 驗收：純函式邊界測試、兩市場 fixture／schema 測試、migration／回復測試、全市場 coverage 與代表性公式重算、偏好遷移、UI 收合與可調參數測試；不觸發交易、行情訂閱或自選清單寫入。
