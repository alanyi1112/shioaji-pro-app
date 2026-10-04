## Why

現有收盤後選股已支援布林位置與反轉 K，但缺少能區分「正在壓縮」、「準備突破」、「今日正式突破」的完整價量策略。使用者需要每天收盤後自動產生可追溯的三類名單，並在既有「選股篩選」面板查閱；不能因籌碼公布較晚、瀏覽器未開啟或晚開機而漏跑。

## What Changes

- 新增向上突破為主的布林三階段策略，採 BOLL(20,2)、個股前 120 日帶寬第 20 百分位、持續收縮、多頭結構、70 日動能與量能判定；所有可調門檻保存設定版本。
- 壓縮與準備階段要求量縮；正式突破要求前 5 日內曾壓縮、相鄰交易日首次收盤突破上軌，以及今日量大於前 20 日均量的 1.3 倍。突破日不要求仍縮量或縮帶寬，三類以明確優先順序互斥。
- 新增獨立價量資料能力與版本化快照；預設準備 160 個官方交易日，依參數計算實際所需歷史，補入官方實際成交金額。不得把收盤價乘成交量當成成交金額，不改寫 v1–v7 的公式或底稿。
- 接入本機盤後流程：官方交易日 14:00 後等待兩市場同日、已驗證的正式日資料，以有界重試、單一執行鎖、晚開機補跑與冪等發布達成每交易日成功發布一次；不依賴 Codex 排程、畫面可見性或法人／TDCC ready。
- 官方 TWSE／TPEx 日報為優先來源；來源失敗、冷卻或契約尚未成立時，允許使用獨立驗證的 Shioaji `daily_quotes` 備援。沿用既有 simulation API／business session，依日期取得全市場 OHLC、實際 Volume／Amount，不逐檔下載分鐘 K。切換須保存來源、失敗原因與版本，不取代官方交易日 authority、不覆寫失敗收據，也不把兩日期探測成功當作 160 日已齊。
- 依使用者確認加入成交量來源比對容差：同商品／日期／單位的 `abs(備援量−官方量)／官方量 <= 1%` 可通過，零官方量只能接受雙方皆零；價格、金額、日期、readiness 與缺漏檢查不放寬。新比較政策版本保存原股數與差異，策略使用原凍結數值，不修正原值、不重解釋舊收據或快照。
- 在「技術型態」加入可收合的「布林壓縮與突破」條件，結果可切換三類；延續既有 AND／OR、全部取消、指定 K 線圖與明確「加入清單」操作。
- 保存逐條件證據、資料日期、分類計數、缺漏原因及執行收據；缺資料不補造值，舊資料不得標成今日結果，不宣稱勝率或報酬保證。
- 年度開休市表之外加入官方臨時全市場全日休市公告優先規則，涵蓋颱風及其他緊急原因；對已確認休市重新規劃固定交易日窗口、僅補新增依賴日，不重設來源嘗試或刪除原失敗。個股停牌／部分時段停止、公告不明及來源錯誤不可當成全日休市。第一版以已驗證 TWSE 公告修正兩市場共同日；TPEx-only 公告來源未驗證時保持限制與資料 Gate，不猜測其休市。
- 第一版不包含向下突破、自動交易、報酬回測、參數最佳化、市場廣度風控、NATR 排名、全市場前 300 名／動能前 30%及新增 KY／處置／全額交割排除來源。這些選配保留後續獨立擴充邊界，既有普通股排除規則不變。

## Capabilities

### New Capabilities

- `after-market-bollinger-squeeze-stages`：可調、決定性且互斥的三階段訊號、內部 AND、三態 verdict 與逐商品 evidence。
- `taiwan-stock-screener-bollinger-history`：較長的已驗證價量／實際成交金額歷史、官方交易日連續性、官方優先／Shioaji 備援來源契約與跨能力保留政策。
- `bollinger-screener-daily-publication`：獨立純價量快照、本機盤後有界排程、冪等發布、晚開機補跑與版本隔離的唯讀 API。

### Modified Capabilities

- `after-market-stock-screener`：加入精簡的布林三階段條件設定、分類切換與證據呈現，維持現有篩選及清單／圖表操作。

## Impact

- 前端：`src/lib/stock-screener-*`、`src/components/stock-screener-panel.tsx`、條件 accordion 與分類註冊、API decoder／偏好／gateway。
- 後端：`apps/multiview/worker/stock-screener-*`、canonical 日資料 schema／migration／repository、新版 publisher／route 與來源驗證。
- 本機流程：`scripts/stock-screener-update.mjs`、OHLCV 準備器與清理、`scripts/screener-idle-gate.mjs`、`scripts/realtimestock-runtime` 的盤後入口及測試。
- 資料：沿用官方 TWSE／TPEx 日報與已驗證交易日 authority；新增獨立的 Shioaji `daily_quotes` 備援 mapping／review、來源選擇 manifest 與持續保留的共用流量預算。首次啟用須有界補齊、驗證權利、單位及來源限制；未驗證的官方入口不阻止已獨立驗證的備援，但日曆／母體缺口不能靠備援行情解除。
- 安全：不增加 Shioaji login／subscription、不修改下單商品／交易草稿，不啟用 production；本 change 建立階段不安裝排程、不啟停服務、不提交 Git。
