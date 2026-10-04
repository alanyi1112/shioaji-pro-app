# 盤後尾端復原：實作與離線驗證（2026-10-02）

本紀錄區分 2026-10-02 原始盤中擷取、當日盤後來源、後來產生的衍生結果，以及尚待下一交易日驗證的自動時序。時間均以 Asia/Taipei 解讀；不將盤後補值冒充當時的 live KBar 或正式驗收成功。

## 已通過

- 原始 2026-09-16 capture 分類為 `bounded_tail_candidate`：僅 `3026.TW` 缺 13:29、13:30。2026-10-02 capture 分類為 `correlated_tail_failure`：160 檔各缺 13:30。中段缺口及安全 Gate 不足的 fixture 會被拒絕；完整 live fixture 不需補救。
- 復原工作只讀取原始 capture 與既有 13:35 verified receipt／已發布基準，逐檔核對來源 manifest、雙抓 hash、270 個 canonical 分鐘、收盤總量及 43,040 個已接受 live 前綴分鐘。2026-10-02 比對差異為 0；新衍生檔補齊 160 檔各一筆 13:30，來源均為 `postclose_verified`，`liveDelivered=false`。
- 2026-10-02 結果檔 SHA-256：`0d9a29acab9fab1fc551d5a1fe124307dd74522185db2423126a056c63efd625`。其分類為 `correlated_tail_failure`，`originalFormalAcceptanceEvidence=false`、`boundedDerivedAcceptance=false`、`postcloseDataRecovered=true`、`nextDayBaselineUsable=true`、通知與追溯觸發權限均為 false。再執行同一 identity 回傳 `already_completed`，沒有重抓或覆寫。
- 本次自動復原路徑對行情供應端的**額外請求為 0**：整批與少量路徑均只重用已發布的雙抓基準。額度、期限與最多三次嘗試由原有 13:35／14:15／14:55 基準工作管理；未得到 verified receipt 時不啟動另一輪 KBar 擷取。
- 本機唯讀 API `GET /api/intraday-monitor/v1/postclose-recovery?tradeDate=2026-10-02` 回傳 `postclose_data_recovered`、160 檔、原始正式驗收 `false`、通知權限 `false`；前端另設獨立區塊，不併入即時結果／通知。
- 原檔 SHA-256 重查不變：9/16 capture `319290088be2091445ebb471d248c7b1262e1f5609a79f00bb1cab050935245e`；10/2 capture `30ad9cadf4c40eced87b4021d00b3f9414ff9f1d0244e6d7b1e3915b81d6ecb8`；10/2 盤後收據 `81a49cca74e7c7a10aa7388ffbb80fc448200a23da8e863ec7153d25ac929d7d`；verification `b092f617746c106bc1fca229fa850ad1cbb5ca30776917f8f5304530ecaa0215`。

## 失敗與修復（原樣保留）

- 第一次對 10/2 發布衍生結果時，新 `results` 目錄尚未建立，寫入失敗；當次 claim 已保存、結果未產生。程式已補上建立結果目錄，且只在原 claim 身分一致時接續。第二次執行成功；此失敗沒有改動原始 capture／receipt。
- 一次面板測試誤用一般 Vitest 執行器，因 Browser Mode 設定不符而在載入時失敗；改用專用 `vitest.browser.config.ts` 執行後 15/15 通過，並非面板測試案例失敗。

## 測試與限制

- Node 核心分類 6/6；盤後基準、尾段審閱、唯讀投影及 API 相關 Vitest 44/44；面板 Browser Mode 15/15；`pnpm build` 通過（既有 bundle size 警告）。
- `openspec validate automate-intraday-monitor-postclose-tail-recovery --strict`、`git diff --check` 與本 change 新增檔案的尾隨空白檢查均通過；目前 tasks 為 14/15，僅下一交易日真實自動時序項目未勾。
- fixture 已驗證 13:33 只合併為 canonical 13:30、雙抓漂移、live 前綴衝突、未知零量、來源缺漏與舊資料缺欄皆 fail closed。既有盤後基準測試涵蓋流量額度不足並保留失敗收據；本復原工作不額外請求供應端，因此不另建立流量預算。
- 9/16 沒有可供本自動工作使用的同日已發布 verified 基準，因此只證明它的分類符合受限候選形狀，**沒有**替 9/16 自動發布 derived acceptance。少量缺口共用已驗證來源的審閱程式有測試，但自動排程上的真實少量缺口仍待觀察。
- 下一適用交易日仍須以原始 simulation 收尾、既有基準 verified receipt、API／UI 時序與資源證據驗證自動工作；本次離線與 10/2 盤後操作不能勾銷該實盤項目，也不能改變原 change 的跨日 live 驗收結論。
