## Why

目前台股籌碼資料雖已能顯示法人淨買賣超、外資持股及融資融券餘額，但上游已提供的法人買進／賣出、信用交易限額與使用率尚未完整保存或呈現在圖表中，成交量也缺少 MA5／MA10 趨勢線。補齊這些來源可驗證的細項，可讓使用者在不離開多圖工作區的情況下判讀量能、法人流向與信用交易壓力，同時避免用累積淨額推算未公開持股。

## What Changes

- 新增成交量 MA5／MA10 計算、讀值與折線，與既有成交量柱共用交易日時間軸。
- 保存外資與投信每日原始買進、賣出股數，維持來源淨額或以未四捨五入原始股數計算淨額，並在 API、讀值與可選圖表 series 中提供細項。
- 保存融資、融券限額及來源使用率；來源只提供限額時，以今日餘額除以限額產生可驗證的使用率，限額為零或缺漏時回傳 `null`。
- 擴充融資與融券 pane，除既有餘額線與變化柱外，提供買進、賣出、現金／現券償還及使用率的逐日讀值與可選 series。
- 外資持股股數與比例可作為折線顯示；投信持股股數與比例在沒有可靠公開來源時維持「無資料」，不得由買賣超累積推算。
- 籌碼副圖的 series 選項只放在既有滑鼠右鍵功能表，不在副圖標題列新增按鈕；每個有可見資料的副圖保留右側數值軸。
- 所有新增欄位保留來源、單位、缺值與實際交易日語意；不得以 0、forward-fill 或顯示層四捨五入結果補造資料。

## Capabilities

### New Capabilities

- `volume-average-series`: 定義成交量 MA5／MA10 的計算、顯示、讀值與不足期數時的缺值行為。

### Modified Capabilities

- `taiwan-stock-chip-data`: 擴充法人原始買進／賣出、融資融券限額與使用率的正規化、持久化及 API 契約。
- `taiwan-stock-chip-subcharts`: 擴充外資、投信、融資與融券 pane 的細項讀值、可選 series、尺度及缺值顯示行為。

## Impact

- Worker 型別、FinMind／TWSE／TPEx adapter、D1 日資料 JSON、API response 與資料合併邏輯。
- `worker/indicators.ts` 的成交量衍生指標與主圖成交量 series。
- `public/static/chip-panes.js` 的 pane registry、series、逐日讀值、圖例與使用者選擇狀態。
- 台股籌碼與技術指標測試、來源 fixture、API schema 相容性及瀏覽器互動驗證。
- 不新增付費資料依賴，不把 runtime token 或其他秘密資料寫入前端、OpenSpec 或 repo。
