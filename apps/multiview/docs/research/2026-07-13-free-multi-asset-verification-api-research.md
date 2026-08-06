# 免費多資產第二報價來源研究

- 研究日期：2026-07-13
- 專案：MultiChartOnCodexSite
- 研究範圍：在 Massive 免費方案無法提供部分資料時，評估 Google Finance 與其他正式 API 是否能為指數、外匯及期貨提供第二來源核對。
- 文件性質：探索與決策紀錄，不代表已核准實作，也不包含任何 API key 或秘密資料。

## 摘要結論

目前找不到同時滿足以下全部條件的單一供應商：

1. 有公開且穩定的正式 API。
2. 永久免費，而不是限時試用或一次性抵用額。
3. 完整涵蓋本專案的指數、外匯與期貨商品。
4. 能依指定交易日取得定義清楚的日收盤價或結算價。
5. 授權允許整合進網站或多人可存取的應用程式。
6. 資料來源與 Yahoo 足夠獨立，可以合理稱為第二來源核對。

最接近技術需求的是 Financial Modeling Prep（FMP）Basic：它有正式 Stable API、免費方案每日 250 次呼叫、指數與外匯 EOD，以及 40 多個 commodities／futures。但在採用前仍必須確認兩件事：

- 是否涵蓋本專案全部期貨及 micro futures，且連續合約轉倉定義能與 Yahoo 對齊。
- 個人免費方案是否允許本專案的實際部署與使用方式；FMP 條款原則上禁止把個人方案資料整合到第三方可存取的網站或工具。

因此目前建議是：

- Google Finance 僅作人工參考，不作正式自動 verifier。
- FMP Basic 作為第一順位 capability spike 候選，但在 entitlement、symbol mapping、收盤定義、資料血緣及授權全部確認前，不得直接標示 `verified`。
- 若來源只足以交叉印證而無法證明獨立性，狀態應使用 `corroborated` 或同等語意，而不是 `verified`。
- 若要求完整且語意可靠的期貨核對，長期仍可能需要 Barchart 或 CME Group 等付費資料。

## 現有系統的核對語意

目前系統不是拿「畫面上現在看到的價格」直接比較，而是核對已完成的日 K：

```text
Yahoo 主來源
  ├─ symbol
  ├─ sessionDate
  └─ completed daily close
           │
           ▼
第二來源必須提供
  ├─ 同一商品或明確可對應的合約
  ├─ 同一交易日
  ├─ 定義清楚的 close／settlement
  └─ 可診斷的來源、日期與失敗原因
```

因此「有即時報價」不等於「能核對已完成日 K」。外匯還有日界線與收盤定義問題；期貨另外有交割月、主力合約及連續合約轉倉問題。

## Google Finance 評估

### 可以做的事

- Google Finance 網頁可人工查看部分指數、外匯與期貨。
- Google Sheets 的 `GOOGLEFINANCE()` 可取得部分即時或歷史市場資訊。
- 適合人工除錯、抽查或確認價格是否落在合理區間。

### 不適合作為正式自動 verifier 的原因

1. Google 沒有提供給 Cloudflare Worker 直接使用的公開 Google Finance 市場資料 API。
2. Google 官方說明指出，`GOOGLEFINANCE()` 的歷史資料不能透過 Sheets API 或 Apps Script 存取；這正好阻擋本專案所需的指定交易日收盤價。
3. 報價可能延遲最多 20 分鐘，且不是所有市場與期貨都支援。
4. 日期以 UTC 中午處理，部分市場可能產生交易日偏移。
5. 抓取 Google Finance 網頁屬於未公開介面，HTML 或內部資料結構可能改變，也缺乏穩定的資料契約。
6. Google 公共資料聲明不保證資料的準確性、完整性或最新程度。

結論：Google Finance 可以作為人工觀察來源，但不應因其價格相同就自動標示 `verified`，也不應因其價格不同就自動判定主來源錯誤。

## 正式 API 候選比較

| 候選 | 指數 | 外匯 | 期貨 | 免費條件 | 主要限制 | 判斷 |
|---|---:|---:|---:|---|---|---|
| FMP Basic | 是 | 是 | 部分／待確認 | 250 calls/day，EOD | 個人用途授權；期貨與轉倉定義待驗證 | 第一順位 capability spike |
| Twelve Data Basic | 免費版不足 | 是 | 免費版不含 commodities | 8 calls/min、800/day | internal non-display；免費市場範圍有限 | 外匯候選 |
| Alpha Vantage | 歷史指數多為 Premium | 是 | 否 | 25 calls/day | 額度低、無完整期貨 | 不適合完整需求 |
| FRED API | 部分主要指數 | 官方參考匯率 | 否 | 免費正式 REST API | 匯率更新時點及定義不同；個別系列有著作權限制 | 官方子集合候選 |
| Barchart OnDemand | 是 | 是 | 是 | 只有免費試用 | 正式使用需洽購；授權依方案 | 技術上最完整 |
| CME Group API／DataMine | 不適用 | 部分 | 是，且為官方來源 | 非永久免費 | API、資料及 entitlement 需付費或購買 | 期貨語意最可靠 |
| Databento | 部分 | 部分 | 是 | 新用戶一次性抵用額 | 歷史資料按量計費，並非永久免費 | 不符合免費條件 |
| Nasdaq Data Link | 部分 | 付費產品 | 期貨價格未見可用免費產品 | 部分資料免費 | 免費期貨多為 CFTC 報告，不是價格 | 不符合需求 |
| EODHD | 指數與外匯可用 | 是 | 未見完整交易所期貨 | 20 calls/day | 個人使用與不得展示／轉傳限制 | 不優先 |

## FMP Basic 詳細評估

### 為什麼值得先測

FMP 官方 Stable API 提供一致的 EOD 介面：

```text
指數：/stable/historical-price-eod/full?symbol=^GSPC
外匯：/stable/historical-price-eod/full?symbol=USDJPY
商品／期貨：/stable/historical-price-eod/full?symbol=GCUSD
```

官方文件宣稱涵蓋 190 多個指數、1,540 多個外匯組合，以及 40 多個 commodities／futures。免費 Basic 方案提供 EOD 歷史資料與每日 250 次呼叫。

若 D1 以 `provider + symbol + sessionDate` 快取結果，現有商品每天理論上只需約 29 次唯一核對請求，因此額度表面上足夠。

### 尚未確認的關鍵問題

#### 1. Symbol coverage

FMP 必須實際涵蓋本專案的全部目標，而不是只涵蓋同類商品：

- 指數：`^DJI`、`^IXIC`、`^SOX`、`^GSPC`、`^RUT`
- 外匯：`JPY=X`、`EURJPY=X`、`GBPJPY=X`、`AUDJPY=X`
- 指數期貨：`ES=F`、`NQ=F`、`YM=F`、`RTY=F`
- Micro futures：`MES=F`、`MNQ=F`、`MYM=F`、`M2K=F`
- 其他期貨：`EMD=F`、`CL=F`、`GC=F`、`HE=F`、`HG=F`、`LE=F`、`NG=F`、`SI=F`、`ZB=F`、`ZC=F`、`ZN=F`、`ZS=F`、`ZW=F`

#### 2. Continuous contract semantics

需要確認 FMP 的 `GCUSD`、`ZMUSD` 等代號究竟代表：

- 特定交割月；
- 近月合約；
- 依成交量／未平倉量選出的主力合約；或
- 經回溯調整的連續合約。

若 FMP 與 Yahoo 使用不同轉倉日或 back-adjustment，兩者數值不同不代表任一來源錯誤。

#### 3. Close versus settlement

期貨 `close`、最後成交價及官方 `settlement` 不是必然相同。若 FMP 只提供最後成交價，而 Yahoo 使用另一種 session close，系統不能把差異直接標示為 `mismatch`。

#### 4. Data lineage

另一個 API 網域不代表另一條獨立資料鏈。必須確認 FMP 報價的上游來源是否與 Yahoo 足夠獨立；若無法確認，只能稱為交叉印證。

#### 5. License

FMP 個人方案條款禁止把資料整合至第三方可存取的工具或網站，也禁止未經授權的資料展示與轉傳。即使本專案只回傳核對狀態而不公開原始 FMP 報價，仍應向 FMP 取得書面確認，尤其在 Sites 日後可能分享給其他使用者時。

## 可分拆的免費來源

### 指數：FRED API

FRED 有正式 REST API，並提供以下明確定義為每日市場收盤的系列：

- `SP500`：S&P 500
- `DJIA`：Dow Jones Industrial Average
- `NASDAQCOM`：NASDAQ Composite

這些系列適合核對 `^GSPC`、`^DJI`、`^IXIC`。目前未找到能完整替代 `^SOX` 與 `^RUT` 的同等 FRED 系列。

FRED 只是傳輸管道，部分系列仍屬 S&P Dow Jones Indices 或 Nasdaq 的著作權資料。能透過 API 讀取不等於可以任意重新發布；比較安全的做法是不回傳原始參考價格，只回傳保守的核對狀態與來源名稱，但正式採用前仍應確認授權。

### 外匯：Twelve Data Basic

Twelve Data 免費方案提供正式外匯 API，額度為每分鐘 8 credits、每日 800 次，足以支援目前四個 JPY 組合的每日核對。

限制是免費 Basic 只允許 internal non-display，禁止商業用途、外部展示與重新散布。即使技術上可行，仍須先確認本專案的 private Sites 使用方式是否符合其授權。

此外，外匯沒有單一交易所收盤。任何外匯來源都必須公開自己的日界線與 timezone；若與 Yahoo 不同，價格差異應保留為 `unverified` 或 `close_definition_mismatch`，而不是直接判定錯誤。

### 期貨：永久免費方案的主要缺口

Barchart 的正式 API 在技術上最接近需求：它支援指數、外匯與期貨，能依指定日期取得 EOD，並明確支援 nearby、continuous、依到期日或成交量／未平倉量轉倉等語意。但 Barchart 免費層只是測試期，不是永久免費方案。

CME Group 是期貨最可靠的官方來源。其 API 可提供交易、top of book 與 settlement；DataMine 可提供已購買的歷史資料。然而這些都需要付費、資料 entitlement 或購買歷史檔案。

因此，如果 FMP 不能覆蓋完整期貨或無法說明合約語意，現實選項只剩：

1. 期貨繼續維持 `unverified`；或
2. 改採 Barchart、CME Group 或其他正式付費資料。

## 建議的 capability spike

這一節只記錄未來研究方法，不代表已授權實作。

### 前置條件

- 由使用者自行申請 FMP Basic API key。
- API key 只放在本機或 Sites runtime secret，不得寫入 repo、OpenSpec、Obsidian、測試輸出或 log。
- 先在本機做唯讀測試，不先部署正式 verifier。

### 測試矩陣

每個商品至少測試：

- 最近一個已完成交易日；
- 一般交易週中的五個連續交易日；
- 一個假日前後交易日；
- 期貨接近轉倉期間至少十個交易日。

每筆記錄以下欄位：

| 欄位 | 驗證目的 |
|---|---|
| Yahoo symbol | 現有商品識別 |
| candidate symbol | FMP 或其他來源的對應代號 |
| provider | 實際第二來源 |
| source session date | 第二來源日期 |
| Yahoo session date | 主來源日期 |
| source close type | close、settlement 或未知 |
| numeric comparison | 相同、容許誤差、不同 |
| contract identity | 特定月、近月、主力或 continuous |
| roll rule | expiration、volume、open interest 或未知 |
| entitlement | 免費方案是否實際可呼叫 |
| license result | 是否允許目前部署方式 |

### 通過條件

只有同時符合以下條件，候選來源才能考慮回傳 `verified`：

1. API endpoint 正式公開且穩定。
2. 免費方案可實際呼叫目標 endpoint，不是文件存在但回傳 `not_entitled`。
3. 商品與合約對應明確。
4. `sessionDate` 可以可靠對齊。
5. close 或 settlement 定義明確且與比較目的相容。
6. 資料血緣足夠獨立。
7. 授權允許目前及預期的 Sites 使用方式。
8. 不向前端回傳秘密、完整上游錯誤或未授權的原始資料。

若只符合部分條件，應採用較保守狀態：

```text
verified       日期、商品、價格定義、來源獨立性與授權全部成立
corroborated   有第二 API 支持相近結果，但獨立性或語意未完全證明
unverified     無資料、無 entitlement、日期不符或定義不相容
mismatch       僅在雙方定義一致時，才能表示價格真正不一致
```

## 建議決策順序

```text
第一步：FMP Basic capability spike
   │
   ├─ 完整涵蓋且授權允許
   │      └─ 建立 OpenSpec proposal，先採 corroborated，再決定 verified
   │
   ├─ 只涵蓋指數／外匯／部分期貨
   │      └─ 評估 FRED + Twelve Data + FMP 分拆架構
   │
   └─ 期貨或授權不符合
          └─ 維持 unverified，或另評估 Barchart／CME 付費方案
```

目前 OpenSpec 沒有 active change。本文件只是保存研究結果；若未來決定進行 capability spike 或產品變更，應另建立新的繁體中文 OpenSpec proposal。

## 參考來源

### Google

- [GOOGLEFINANCE 官方說明](https://support.google.com/docs/answer/3093281?hl=en-en)
- [Google 公共資料免責聲明](https://www.google.com/help/public_data_disclaimer.html)
- [Google Terms of Service](https://policies.google.com/terms?hl=en-US)

### Financial Modeling Prep

- [FMP Stable API 文件](https://site.financialmodelingprep.com/developer/docs/stable)
- [FMP pricing plans](https://site.financialmodelingprep.com/pricing-plans)
- [FMP commodities／futures 說明](https://site.financialmodelingprep.com/developer/docs/excel-add-on)
- [FMP Terms of Service](https://site.financialmodelingprep.com/terms-of-service)

### Twelve Data

- [Twelve Data API 文件](https://twelvedata.com/docs)
- [Twelve Data 個人方案](https://twelvedata.com/pricing)
- [Twelve Data Terms of Use](https://twelvedata.com/terms)
- [Commercial and personal usage](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage)

### FRED

- [FRED API overview](https://fred.stlouisfed.org/docs/api/fred/overview.html)
- [S&P 500 series](https://fred.stlouisfed.org/series/SP500)
- [Dow Jones Industrial Average series](https://fred.stlouisfed.org/series/DJIA)
- [NASDAQ Composite series](https://fred.stlouisfed.org/series/NASDAQCOM)
- [H.10 Foreign Exchange Rates](https://fred.stlouisfed.org/release?rid=17)

### Barchart、CME Group 與其他候選

- [Barchart Historical Data API](https://www.barchart.com/ondemand/api/getHistory)
- [Barchart OnDemand free trial 說明](https://www.barchart.com/solutions/services/ondemand)
- [CME Group Market Data APIs](https://www.cmegroup.com/market-data/market-data-api.html)
- [CME Group DataMine API](https://www.cmegroup.com/datamine/datamine-api.html)
- [Nasdaq Data Link data organization](https://docs.data.nasdaq.com/docs/data-organization)
- [Databento pricing](https://databento.com/pricing/)
- [EODHD pricing](https://eodhd.com/pricing-special-10)
- [EODHD Terms and Conditions](https://eodhd.com/financial-apis/terms-conditions)
