# 160 檔單日驗收修正與前日 1 分 K 基準

> 後續更新：使用者已明確授權換股，以 6187 萬潤替換 2926 誠品生活後，160／160 基準全部通過。當前結果與新版 artifacts 見 [替換完成紀錄](direct-160-replacement-6187-2026-09-11.md)。以下保留替換前歷史。

## 結果

驗收已改為「可信前日 1 分 K 基準＋一個完整盤中日」；第二個盤中日僅作非阻擋穩定性追蹤。直接 20 → 160、失敗保留 20 不變。

160 檔均已查詢，159 檔通過，合計 42,930 筆 09:01–13:30 分鐘基準。比較值完全沿用 20 檔算法：當日 1 分 K Volume 按時間累加，下一交易日同分鐘累積量除以前日同分鐘累積量；前日累積量為零時不可計算量比，不得假設為 1 或產生誤報。

唯一缺口：2926.TWO 誠品生活。當日兩次 KBar、一般交易時段逐筆資料皆為空；snapshot 時間停在 2026-09-10。櫃買中心 115/09/11「每日收盤行情（不含定價）」顯示 2,000 股、2 筆成交；確認流量充足後的一次針對性雙抓仍為空。因此不能標成零成交，也不能用前一日、其他股票或日總量推造分鐘分布。160 檔全量 baseline set 尚未發布，7.1／10.3 保持未完成。

基準日期為 2026-09-11，預定用於下一適用交易日 2026-09-14。TWSE／TPEx 年度行事曆均已落檔、解析並確認日期緊接；盤前仍須確認當日實際開市狀態。歷史基準不計入 live 驗收日，也不代表 live transport／DB／UI 待辦已完成。

## 可用資料與稽核

- 原始資料：`/Users/alanyi/Library/Application Support/RealTimeStock/intraday-baselines/2026-09-11-direct160-source/`。
- 有效基準目錄：`/Users/alanyi/Library/Application Support/RealTimeStock/intraday-baselines/2026-09-11-for-2026-09-14-verified-v2/`。
- 有效目錄的 `verification.json` 包含逐檔狀態、來源輸入 hash、baseline manifest ID 與檔案 SHA-256；159 份基準讀回 hash 全部相符。
- 小型摘要：`direct-160-baseline-readiness-2026-09-11.json`。
- 每檔以商品身分／日期／來源版本、雙次 1 分 K hash、270 分鐘、單位與累積量驗證。逐筆資料僅作一般交易時段成交量及分鐘完整性核對，正式比較來源仍是 1 分 K。
- 原始資料約 36 MB、有效基準與報告約 3.8 MB；精確 bytes 見摘要。維持既定 8 GiB 磁碟保留。
- 原始唯讀採集 160 檔完成，串行間隔 1 秒，未新增 login、訂閱、SSE、通知、交易或服務啟停。所有原始檔與失敗複查均保留。
- 首輪本機驗證報告因原始小數被套用整數 canonical hash，出現寫入與結果標記不一致，已修復並以新的 `verified-v2` 目錄重建。舊目錄保留歷史，不能作目前 readiness 來源。

## 程式與規格

- stage plan／execution token v3；bundle v2。新的 `direct-stage-plan-160-single-day-2026-09-11.json` 要求一個完整盤中日，鎖定前日基準政策。
- bundle 必須帶同 cohort、緊接前日的 baseline set；session.baselineHash 必須相符。缺基準、錯誤日期、hash 漂移皆拒絕審閱資格。
- `collect-direct-160-baseline.py` 負責一次性有界採集；`build-direct-160-baseline.mjs` 負責離線逐檔驗證與原子保存，部分成功不會冒充 160 全數可用。
- 修正 TPEx 行事曆 parser 對已確認的單欄債券 rowspan 名稱處理；未知單欄列仍拒絕。原始日曆未修改。
- proposal、design、spec、tasks、review template 與 plan generator 已同步。舊計畫、20 檔 dossier 及歷史 evidence 保留。

## 後續

2926 需取得可驗證的 2026-09-11 正式 1 分 K 才能補齊 exact 160 set；不得用日總量分攤補造。如果 provider 持續缺資料，維持 waiting_baseline，不能宣稱 160 已準備完整。其餘 159 檔不用重新下載。來源補齊後以新的輸出目錄重建、讀回並發布全量 set，再接入待完成的 live runner。

## 來源

- [TWSE 115 年市場開休市日期](https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=html)
- [TPEx 年度開休市資料](https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=2026)
- [TPEx 115/09/11 收盤行情（不含定價）](https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&o=json&d=115/09/11&se=EW&s=0,asc,0)
- [Shioaji 歷史資料](https://sinotrade.github.io/tutor/market_data/historical/)、[使用限制](https://sinotrade.github.io/tutor/limit/)

## 驗證

完整非 browser 測試 221 files／2,378 tests 通過；build、OpenSpec strict 與 git diff --check 通過。新增 1 分 K 基準、缺分鐘／雙抓漂移／錯日拒絕、部分成功分類與原始小數雜湊回歸。159 份有效基準逐檔讀回 SHA-256 全數相符。20 檔 dossier 仍 valid=true、readyForArchive=true，23 個引用有效。沒有執行 archive、commit、push 或服務啟停。
