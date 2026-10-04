# 來源帳本與不可變選擇驗證（2026-10-03）

## 結論與邊界

完成 **8.3**，總進度 **31／41**。新增 `scripts/stock-screener-source-selection.mjs`、0038 additive migration、schema／journal 及 21 項隔離測試。這是後續 8.5／8.6 可使用的來源 repository 與 mapping 契約，不是正式 fallback、v8 publisher／decoder 接線或 160 日 ready。8.2 的獨立 provider/date attempts／receipt 沒有修改；本輪未安裝 0037／0038 到本機資料庫、建立正式 verified review 或發出來源 HTTP。

## 已完成

- provider review 分列官方 TWSE／TPEx 與 Shioaji；pending／invalid／verified 不互相解除。review 本文 hash 與 `(provider,evidenceHash)` 唯一性防止同證據被重解釋；換 review 要新 evidence，不更新舊列。只准固定欄位／endpoint、白名單原因與本機使用契約，不保存 token／任意錯誤訊息。verified 還需相容未還原價格／交易範圍及本機展示確認。
- 對來源原始 response 重驗 parser，必須與持久化完整 cache／來源 receipt 的日期、review、hash、bytes 等相符才准投影。不是傳入一個宣稱 verified 的報告物件就能寫成功。全域官方日曆、普通股母體另行驗證；回應沒有市場時按合法母體投影，不猜代碼。
- 第一個合法 market/date 選擇凍結勝出；先 staging、每批最多 50 列保存，完整 count／rows hash 成立才 complete。中斷留下部分列，讀者不能當完整成功；同一 manifest 可用原 cache 續補，不能換來源或覆寫已保存列。同一 universe revision 的 identity 以唯一列原子保存，跨市場並行不能凍結成不同母體。
- 逐列 provenance 保存 provider、requested／actual date、review ID／evidence hash、mapping、exact URL、fetchedAt、payload hash、cache key 及 source receipt ID／hash。market/date manifest 另保存官方失敗收據 ID／hash、切換原因、authority／universe hash 及 rows hash；原 official invalid／failed 完全保留。
- 全窗口 mapping 包含所有日期及兩市場已完成的 manifest hash，使用 `bollinger-source-selection-v1:<hash>`，不沿用 `official-daily-ohlcv-turnover-v1`；任一市場／日期未完整即 pending。實際 publisher／cursor／API decoder 對新 mapping 的支援仍屬 **8.6**，目前尚未接入，不把 repository 定義當正式發布。
- 官方恢復時驗證新來源 review／原始 response／持久收據，只 append matched／conflict；價格以 canonical units 比較，`100`／`100.00` 不誤報。Volume／Amount 不同保存逐商品差異，不更新凍結選擇、價量列、舊 publication head 或 cursor。

## 隔離測試與修復

所有 review／authority／raw response／simulation safety 均是隔離 fixture；全部使用記憶體 SQLite，沒有來源網路、正式 permission 或 watcher 自動發布。

- 新 repository **21／21**：不可變 review、任意秘密／URL／訊息拒絕、pending／過期、兩市場共享同 fetch、並行 no-op、母體 revision 並行衝突、原官方失敗保留、失敗收據市場／日期錯誤、cache／receipt 損毀、日曆 Gate、凍結後換來源拒絕、staging 中止續跑、最後批次後中止／authority 到期、列／manifest 損毀、全窗口 mapping、雙市場官方恢復 matched／conflict 與舊 schema。
- Node 24.19.0：本檔、daily_quotes core、官方準備器／transport／retention、v8 publication 共 **92／92** 通過。Vitest：v8、history／query／API、v7 共 **60／60**；合計 focused **152／152**。
- `pnpm exec tsc -b --pretty false`、`pnpm build` 通過。既有 trading chunk 933.80 kB／>500 kB 提示保留。
- 首輪新測試 **16／17**：損毀 manifest 在重跑時被錯分成 `invalid_universe_revision`。已先核對 manifest 本文 hash，再判母體漂移，修正為 `invalid_source_manifest`；保留本紀錄，不放寬損毀測試。後續增加四項故障／並行測試，21／21 通過。
- 此 change strict validation、tracked diff 與本輪新檔 whitespace 檢查通過；未跑 repo-wide 或宣稱其他 dirty work 皆成功。

## 未完成與下一步

**1.1／8.1**：正式來源價格／交易範圍、雙市場歷史樣本與使用／展示權仍未核實；不得複製 fixture 的 verified／hash 到 live。

**8.4**：現行 `baseline-bandwidth-budget.mjs` 與 `dynamic-baseline-delta-budget.mjs` 以 usage／樣本推估工作額度；`postclose-daily-baseline.mjs` 保存個別 budget evidence。尚無全部工作共用的 durable reservation repository，不能辨認所有已承諾工作的實際保留額度。下一步須建立集中持續 reservation、可設定行情／日額度、broker usage 與 HTTP bytes 分帳、實測估量及 crash 回收，並有界接入既有 safety／loader；不能寫死剩餘 bytes 啟動門檻或把個別 forecast 冒稱中央 admission。

**8.5–8.8／7.2–7.4**：provider 自動選擇、集中 run budget、publisher／API／UI 新 mapping、真實 160 日與至少一次自動發布仍未完成。策略維持停用，不能歸檔。

## 執行環境保護

本輪唯讀 `lsof` 確認 8080／5173／5174 listener 仍為 PID 1273／933／938；這僅是 listener／未重啟觀察，不是 broker business session、今日行情或完整 runtime 健康驗收。本輪沒有新的 `/daily_quotes`、login、subscription、production、CA、真實下單、服務重啟、排程安裝、archive、commit 或 push。其他既有 dirty edits 保留。
