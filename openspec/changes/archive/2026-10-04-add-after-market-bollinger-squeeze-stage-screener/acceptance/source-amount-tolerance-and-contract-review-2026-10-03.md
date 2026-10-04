# 金額一元容差與真實來源契約驗證（2026-10-03）

時間均為 Asia/Taipei。本輪完成 tasks 1.1／8.1／9.2，進度 38／43；不是全 change 已完成。正式 profile／publication 仍為零，沒有把校準診斷當成正式歷史下載或發布。

## 使用者確認的新政策

新增 `bollinger-source-comparison-volume-1pct-turnover-1ntd-v2`：保留官方成交股數分母、≤1%、官方零量雙零規則，成交金額只允許絕對差 ≤1 元。canonical int64／BigInt 精確比較；日期、價格、readiness、schema、缺資料及策略門檻不放寬。舊 v1 仍要求金額一致，沒有覆寫或重解釋舊衝突／收據時間／凍結值／manifest／快照／head。正式比較呼叫端明確指定新政策；API／UI 分列原股數／金額及差異，未知政策、2 元或偽差異均拒絕。

## 實際兩日期逐股對照

同一 verified 普通股母體 revision `dc3ad8d13d8f6e6ed45c2ada2703799b46e9ae16c21197514ecb4e5ea9fe44ca`：TWSE 1,085、TPEx 892，共 1,977。SQL 的 ScreenerInput envelope 與股別、review、revision、sourceDate、provenance hash 核對後才投影；修正原先把 envelope 誤當裸 stock 的排程解析。

| 日期 | 市場 | 完全一致 | 新容差內 | 衝突 | unknown | 母體 |
|---|---|---:|---:|---:|---:|---:|
| 2026-10-02 | TWSE | 1,064 | 18 | 0 | 3 | 1,085 |
| 2026-10-02 | TPEx | 847 | 21 | 0 | 24 | 892 |
| 2026-02-02 | TWSE | 1,039 | 23 | 0 | 23 | 1,085 |
| 2026-02-02 | TPEx | 840 | 13 | 0 | 39 | 892 |

合計 3,954 筆投影：3,865 筆可核對、89 筆 unknown。原 volume-only 核對的 30 筆 conflict 全部為 Shioaji 金額少 1 元，逐筆確認新政策通過；原四份 conflict 的內容 hash 未變。22:36 新核對只重用已保存 raw，新增來源 HTTP=0。

新版診斷 evidence（本機私密 SQLite `screener_runs`，scope=`bollinger-contract-comparison-v2`）：

- `bollinger-contract-comparison-v2:fd364588a467f09e3af4d5a6c8234096b2a3b3dd11819f1fc6fec17fd69abf1d`
- `bollinger-contract-comparison-v2:6d306305028a40bf2561cef6de1b7e45aa66b7ca6a3a02aa4558f9ea350cf71e`
- `bollinger-contract-comparison-v2:6dab9372941c5ad2e4ec4459b73f703b2ab5afe65a1c1f9c3d5a8838ce9e43dc`
- `bollinger-contract-comparison-v2:da827ee92db6322544a32a46291c4c71267da8f3e0cb4630fd44eb721055b6bc`

原件 `bollinger-contract-comparison` 四份 conflict 保留，含兩來源原值與 raw ID；沒有用新判定刪除舊失敗。

## 真實來源／parser 邊界

22:10 首次校準因真實 12 筆正量／金額／筆數但四項 OHLC null 而 partial，原始 raw 與失敗保留。新增 `shioaji-daily-quotes-shares-twd-v2`，這類列逐股 `missing_ohlcv`、bar=null，保留統計，不推測停牌／零股原因或造價。部分 null、非法 OHLC、正量零金額／筆數仍拒絕。v1 mapping 保留原規則；22:14 continuation 重用原 10/2 raw，只補未發的 2/2，兩次實際 broker source requests 合計二次。

- 10/2：121,855 response bytes、1,982 raw rows，payload hash `733541ad3e15486cf98180b8dff5fbebfa283b37a343b4c798f260b52a47a293`。
- 2/2：120,412 response bytes、1,955 raw rows，payload hash `7d233e78ba53c881d639840c455c28615e3fbeaeb1d6ccc9235af8b4a0a4ff01`。
- 10/2 TWSE ready=1,082／source_missing=3；TPEx ready=868／no_trade=8／source_missing=4／missing_ohlcv=12。
- 2/2 TWSE ready=1,062／no_trade=1／before_listing=21／missing_ohlcv=1；TPEx ready=853／before_listing=20／missing_ohlcv=12／source_missing=2／no_trade=5。

Volume 已由全部可核對股票證實股數單位，Amount 為實際 TWD 整數；價格以官方原始日報未還原 OHLC 核對，不用 close×volume 或 KBars 張數替代。日期、九欄等長 arrays、代碼唯一、int64 無損解析皆檢查。樣本包含最新日與 2/2 歷史、兩市場，不能據此宣稱 160 日全部可取得。

## 獨立來源 review

以官方 [daily_quotes 文件](https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/MARKET_DATA.md#daily-quotes-每日行情)、[用量限制](https://sinotrade.github.io/tutor/limit/)、使用者已開通並確認簽署 API 的個人本機用途，以及以上 raw／逐列核對建立技術來源 review。範圍只限本機歷史選股，不公開散布；不另要求文件未規定的個人分析特別書面許可。歷史詢價放盤後、沿用同一連線、快取共用、失敗不反覆 login 或無界 retry。

- Shioaji verified review：`437583be332586e7da5a050993cd72ec3001ead43ae1415a0baf0d105e531b93`。
- 契約證據：`bollinger-source-contract:d0e0123468cee985d14be9a56830d6e8cf4d125a91bcb591270d97790d710d07`。明列兩日期、raw／比較 hash、未知處理與 fullWindowVerified=false。
- TWSE 未採用網站歷史入口 pending review：`2dcf72c071f08653135360761284521ec2536b2934a75181cab2e260ea0c97c7`。
- TPEx 未採用網站歷史入口 pending review：`93ffa8c53aae7d444da389c2bcc5934ad82b5b596eab48d56ce5b03ad7501d8d`。
- 後兩者技術 JSON 可解析，但各指定日期網站入口自動化／展示契約尚待確認，理由 `official_contract_pending`；不借用券商 API 使用權冒充網站使用權。
- 本次 review 有效至 10/5 14:00，與目前 authority 維護邊界一致；不是來源未來歷史供應保證，也不自動延長 review。

review 已由正式 append-only repository 保存；未啟用 profile、來源選擇政策或正式 history/cache/head。

## 流量實測與尚未解決的預算 Gate

即時 usage counter 在 HTTP 回應後尚未更新，原始 delta=0 保留。22:23 追加實際 counter 觀察，兩段互不重疊的共享用量上界：244,804 bytes、215,846 bytes；不是精確獨占歸因。用量 8,684,188／524,288,000、剩餘 515,603,812 bytes，是該觀察時間的數值，不代表往後不變。

原始校準明確保留行情 128 MiB、其他用途 300 MiB、每次預估上限 4 MiB；這只是有界兩次診斷安全邊界，**不是各工作正式承諾或已啟用的集中下載政策**。實測證據：

- `bollinger-calibration-measurement:fc2c7efc1e025cb3b5f7b470361ac60c5af78a2b74063356e0561ee0cb94cb37`
- `bollinger-calibration-measurement:cf5149bf48d4961e33dde72d235872029f418f1d70af6c30a0bad7af4482b223`

8.4 仍未完成：現有 usage response 沒有可信 quota epoch ID；不能拿 API generation、新日期或臨時字串冒充 quota reset／免除舊債。其他工作雖有 append-only writer，正式 collector／bootstrap／chart/tape 等 consumer 的真實承諾接線與完整 roster 尚未完成，不能虛填零或把診斷的 300 MiB 說成已完成盤點。

因此 7.2 的 160 日逐股重算、7.3 真正 watcher 自動發布／no-op、7.4 真實 ready API／UI／兩套清單、8.8 真實全窗口 fallback 尚未成立，全部保持未勾。不能為趕結案繞過共同日曆／來源／流量 Gate。

## 回歸與安全

- Node 13 files：182／182；Vitest 6 files：66／66；Chromium panel：8／8，合計 256 項 focused tests。隔離 fixture 與上述真實資料明確分開。
- root／MultiView 型別檢查及 root build 通過；chunk >500 kB 原提示保留。首次新 browser test 型別寫法導致 tsc／build 失敗，修正 optional indexing 與可變測試型別後重跑成功，沒有掩蓋失敗。
- OpenSpec strict validation、git diff --check 及本 change 67 個新增文字檔 whitespace／conflict marker 檢查通過。
- 新 UI fixture 驗 320 CSS px／32px 字級的量金額警告、原值、捲動寬度，零下載、零每日設定寫入、零自動跳商品；fixture 畫面不能算真實 ready 畫面。
- 22:44 既有 8080／5173／5174 listener PID 分別 1273／933／938；simulation、business session／2330 Snapshot healthy，watchdog restart count=0，production stopped，write master disabled，無交易 obligation。其他功能的 partial／verification_required 原狀態保留。
- 未重啟 API／watchdog／Web／MultiView，未新增 login／subscription、未下單、未 archive／commit／push；原始資料留在本機 SQLite，未提交 repo。

## 下一階段需確認的預算設計

來源沒有提供 quota epoch ID，現行契約不可憑空填 verified。建議調整為本機持久保守帳本，以真實共享 usage 計數及穩定 scope 保存預留；日期改變、API 重啟、計數下降都不能自動清帳或免除舊債。另將其他工作真實承諾接線後才可正式下載。已向使用者提出此設計選項，尚未假稱已實作或取得同意，8.4 保持未勾。
