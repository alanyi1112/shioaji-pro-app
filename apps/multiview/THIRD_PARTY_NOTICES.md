# 第三方軟體聲明

本檔區分 MultiChartOnCodexSite 自有程式與實際使用的第三方軟體。自有程式採 `AGPL-3.0-only`；第三方套件仍保有各自原始授權，不因收錄於本專案而改為 AGPL。

## TradingView Lightweight Charts

- 套件：`lightweight-charts`
- 固定版本：`5.0.9`
- 官方來源：<https://github.com/tradingview/lightweight-charts>
- 官方網站：<https://www.tradingview.com/>
- 授權：Apache License 2.0
- Copyright：TradingView, Inc.
- 使用方式：由 npm lockfile 固定，建置／啟動前從已安裝套件複製 standalone production bundle 至本機 public output；runtime 不從第三方 CDN 載入。
- 授權全文：[licenses/Apache-2.0.txt](licenses/Apache-2.0.txt)

其他 npm 與 Python dependencies 的名稱、精確版本與授權以各自 lockfile、套件 metadata 及安裝內容為準。發布或重新散布 bundle 前必須重新執行 dependency／license scan，並保留所有適用的授權及 NOTICE。
