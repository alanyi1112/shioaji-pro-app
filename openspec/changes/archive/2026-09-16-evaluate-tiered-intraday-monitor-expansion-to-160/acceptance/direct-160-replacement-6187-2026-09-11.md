# 160 檔基準替換完成：誠品生活 → 萬潤

使用者於 2026-09-11 明確授權「換一檔股票」。尚未啟動 160 live stage，因此建立新版名單，以原設定清單的 **6187.TWO 萬潤**替換第 27 檔 **2926.TWO 誠品生活**，其餘 159 檔與順序保持一致。未修改正式 active limit 或發出訂閱。

**160／160 檔基準已完成，共 43,200 筆分鐘資料。** 來源日期 2026-09-11，目標交易日 2026-09-14；比較值為 1 分 K Volume 逐分鐘累加，沿用 20 檔算法。萬潤兩次抓取均為 270 分鐘，當日累積 1,567 張，完整性核對通過。

目前應使用下列新版 artifacts，舊 159 檔缺口報告與舊計畫只作歷史：

- 名單：`tiered-cohort-stage-160-replaced-6187-2026-09-11.json`。
- 計畫：`direct-stage-plan-160-single-day-replaced-6187-2026-09-11.json`。
- 準備完成摘要：`direct-160-replacement-6187-readiness-2026-09-11.json`。
- 完整基準：`/Users/alanyi/Library/Application Support/RealTimeStock/intraday-baselines/2026-09-11-for-2026-09-14-replaced-6187-verified/baseline-set.json`。
- 逐檔驗證：`/Users/alanyi/Library/Application Support/RealTimeStock/intraday-baselines/2026-09-11-for-2026-09-14-replaced-6187-verified/verification.json`。
- 原始資料重用紀錄：`/Users/alanyi/Library/Application Support/RealTimeStock/intraday-baselines/2026-09-11-direct160-replaced-6187-source/reuse-ledger.json`。其餘 159 檔重用原始資料並以新 cohort 重新驗證，不重新下載、不冒充新的抓取時間。

驗證：160 份逐檔檔案 SHA-256 讀回一致；完整 baseline set validator 與 stage plan validator 均通過，舊 cohort 被新版 baseline 拒絕；名單差異恰好一檔。OpenSpec strict 與 git diff --check 通過。本次僅產出資料與規格更新，沒有修改執行程式，不重跑上一輪已通過的 2,378 項測試。

歷史基準準備已完成；160 live transport、DB／UI 負載與一個完整盤中日驗收仍依 tasks.md 接續，不能將 baselineUsable=true 當作 live 驗收完成。
