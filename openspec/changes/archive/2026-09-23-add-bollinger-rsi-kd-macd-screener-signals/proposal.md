## Why

目前收盤後選股雖已具備布林反轉、均線與背離，但缺少常用且可直接組合的布林位置、RSI／KD 極值區交叉及 MACD 零軸訊號，使用者仍需人工逐檔核對。新增版本化、可調門檻且具價量確認的訊號，可在不犧牲日期、來源與全市場完整性責任的前提下，把這些判讀納入既有三態選股流程。

## What Changes

- 新增可獨立啟用的布林位置條件：收盤價在上軌外、下軌外，以及中軌附近；中軌附近容許範圍由使用者調整，預設為通道寬度的 10%。
- 新增 RSI5／RSI10 與 KD(9,3,3) 的高檔死亡交叉、低檔黃金交叉；高低檔門檻可調，預設各為 80／20。
- 新增 MACD(12,26,9) 的零軸接近、零軸穿越，以及零軸上／下黃金與死亡交叉模式；「即將突破」採價格正規化距離與連續靠近規則，門檻可調。
- 每個新技術條件提供可選的條件內成交量確認，預設關閉；啟用時以當日量相對「不含當日」的 20 日平均量判定，預設至少 1.2 倍，並可另設 20 日均量流動性下限。
- 將 criteria、偏好、immutable snapshot、API、結果 evidence 與全市場發布責任升級為新版本；所有判定使用未四捨五入的官方未還原日 OHLCV，缺資料或交易日不相鄰時 fail closed 為 unknown。
- 保留既有「布林反轉 K」公式與舊版 snapshot 投影，不以新布林位置條件重解釋舊結果，也不新增外部資料來源、行情訂閱或交易副作用。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `after-market-stock-screener`：新增精簡且可鍵盤操作的布林、RSI、KD、MACD 條件控制、偏好遷移與結果證據呈現。
- `after-market-stock-screener-technical-patterns`：新增各訊號的精確公式、極值區／零軸語意、可選成交量確認與三態判定。
- `taiwan-stock-screener-daily-ohlcv-history`：從既有 130 個交易日 canonical OHLCV deterministic 建立新指標底稿，並納入全市場 coverage、日期與發布 gate。
- `taiwan-stock-screener-data`：新增版本化 criteria／snapshot／API 契約、相容投影、守恆計數與正式驗收責任。

## Impact

- 影響收盤後選股面板、criteria schema／偏好儲存、gateway allowlist、選股 publisher／query、D1 snapshot payload、結果 evidence 與測試 fixture。
- 沿用現有 TWSE／TPEx 官方未還原日 OHLCV、既有 130-session 歷史與本機 D1；不新增第三方依賴或來源授權範圍。
- 需執行全市場重算、雙市場 coverage／守恆驗證、代表商品公式重算、viewport／鍵盤驗收及無交易／清單／runtime 副作用測試。
