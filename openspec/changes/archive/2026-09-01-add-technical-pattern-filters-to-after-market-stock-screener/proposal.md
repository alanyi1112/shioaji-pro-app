## Why

既有收盤後選股尚未支援以日 K 型態與布林通道首次穿越訊號篩選全市場，也沒有足以在本機可靠計算這些條件的全市場 OHLC 歷史。這次變更要在不依賴自選清單、逐檔行情訂閱或畫面主觀判讀的前提下，加入可稽核的分型與布林反轉 K 選股。

## What Changes

- 在「選股」面板新增「K 棒分型」條件，提供原始三 K 分型、先處理包含關係的纏論分型及任一算法；方向可選底分型、頂分型或任一方向。
- 分型只接受截至最新完整交易日已確認的型態；原始三 K 採嚴格高低價比較，纏論模式保存包含關係合併、方向與原始日期映射，未確認或方向不明不得猜測。
- 新增固定使用 canonical `BOLL(20,2)` 的「布林通道反轉 K」條件：前一交易日收盤須在通道內，最新交易日才首次跌破下軌或突破上軌，並分別搭配陽 K 下影線或陰 K 上影線。
- 讓兩個新條件與成交量、千張大戶條件共同使用既有 `all`／`any` 三態邏輯、immutable snapshot、穩定分頁、排序、結果證據與點選 K 線連動。
- 從已核對的 TWSE／TPEx 官方全市場日資料保存 OHLC 與官方交易日錨點，建立約 60 個市場交易日的本機滑動窗；停牌、新上市、缺期或來源不完整一律回傳明確 `unknown`，不得補造 K 棒。
- 建立有界、可續跑、可觀測的 OHLC 歷史 bootstrap 與新商品補資料機制；UI／GET 只讀本機 snapshot，不觸發 provider、Shioaji 訂閱、回補或交易操作。
- 以新版 criteria、formula、snapshot、cursor 與偏好遷移隔離既有 v1／v2 選股結果；保留目前 `extend-after-market-stock-screener-with-turnover-and-holder-reversal` 的 live 驗收與歸檔邊界。

## Capabilities

### New Capabilities

- `after-market-stock-screener-technical-patterns`: 定義原始三 K／纏論頂底分型、布林通道首次穿越反轉 K、條件組合、結果證據、偏好與圖表連動。
- `taiwan-stock-screener-daily-ohlcv-history`: 定義全市場官方日 OHLC 歷史、交易日錨點、背景 bootstrap、新商品補資料、完整性、保留、版本與驗收契約。

### Modified Capabilities

無；既有選股 capability 仍位於尚未歸檔的前置 changes，本 change 以新的 capability 明確承接相依性，待前置 changes 同步正式 specs 後再維持同一責任邊界。

## Impact

- 前端：`src/components/stock-screener-panel.tsx`、選股偏好、條件卡、結果列、證據明細與圖表選擇。
- 共用領域與 API：`src/lib/stock-screener-domain.ts`、`src/lib/stock-screener-api.ts`、分型／BOLL 純函式、criteria fingerprint、排序與 cursor。
- MultiView worker／D1：官方日資料 adapter、OHLC 歷史表、snapshot publisher／repository／route 與 additive migration。
- 背景工作：`scripts/stock-screener-update.mjs`、官方交易日規劃、有界歷史 bootstrap、checkpoint、限速與恢復。
- 既有 `src/lib/indicators.ts` 的 canonical `BOLL(20,2)` 公式是 parity 基準，但本 change 不改圖表指標定義、Shioaji runtime、下單功能或 hosted 路由。
