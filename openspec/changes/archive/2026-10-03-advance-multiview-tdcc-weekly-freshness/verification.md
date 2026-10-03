# 來源實測與驗證

2026-10-03（Asia/Taipei）以官方端點實際 GET（非 HEAD）核對：

- `https://opendata.tdcc.com.tw/getOD.ashx?id=1-5`：HTTP 200、`text/csv; charset=UTF-8`、2,375,462 bytes、69,326 筆資料列（另 1 列標頭）；標頭為「資料日期、證券代號、持股分級、人數、股數、占集保庫存數比例%」；資料日 2026-10-02；2449 有 17 個級距。
- `https://openapi.tdcc.com.tw/v1/opendata/1-5`：HTTP 200、`application/json`、9,770,015 bytes、69,156 筆資料列；首筆來源日期 2026-09-24；2449 有 17 個級距。故 HTTP 200 不代表已更新至最新週次。
- 來源說明頁 `https://www.tdcc.com.tw/portal/zh/smWeb/qryStock` 表示資料取自每週最後一個營業日營業結束後的持有餘額，並提供多檔 CSV 下載方向；未載明固定上架時刻。

本檔只保存安全的資料契約摘要，不保存完整公開原始檔或任何本機機密。後續離線測試與本機實際排程啟用須分別記錄，不能以程式模板變更冒充已載入排程。

## 2026-10-03 本機實跑（Asia/Taipei）

- 09:04 以現有 simulation MultiView 執行一次 `latest-only`：CSV 2026-10-02 優先於 JSON 2026-09-24，正式回應 59 個商品；D1 有 59 筆 10/2 持股列，2449 的來源 URL 為官方 CSV。個股 API 回傳 2449 最新 2026-10-02、查詢區間內 5 週 rows、`officialVerifiedWeeks=5`、`conflictWeeks=0`。
- 09:07 第二次執行回報 `latest-unchanged`／`noOp=true`，未啟動歷史補建。
- 首次安裝早期 LaunchAgent 的 `RunAtLoad` 原始結果為 **失敗** `invalid_response`；原 `tdcc-early.log` 與 watcher 失敗記錄保留。根因是 0050、0056 的既有 ledger 在新週插入後成為 61 期，舊投影上限 60 期拋錯；同步程序先把所有 user/setup 目標設為 inactive，導致 active 暫時降為 0。
- 修正後投影只使用最近 60 期，並將停用未列入目標的作業移到所有目標成功更新之後。09:15 手動再跑 `latest-only` 成功 noop，active 恢復 59；09:16 重新載入早期 LaunchAgent 後 `RunAtLoad` 真實執行完成、exit code 0，原失敗 log 未刪。
- `launchctl print` 顯示 7 個已載入的 `calendarinterval` descriptor：週五 19／22 時、週六 06／08／09／10／12 時。09:16 時下一個適用時槽為當日 10:00；這是排程觸發時刻，並非 TDCC 保證上架時刻。
- 前後 runtime 保持 simulation、8080／5173／5174 已載入且健康、production stopped、write master disabled；未重啟共用服務或新增 broker session。

## 最終核對

- 09:20 再查 `pnpm local-runtime status`：simulation、API／watchdog／Web／MultiView 健康、production stopped、write master disabled，TDCC source date 為 2026-10-02；整體 TDCC health 仍是 `available_not_verified`，不把最新週匯入說成全部歷史資料已完成驗證。
- 2449.TW 籌碼 API 的 `distributionRows` 最後一期為 2026-10-02，查詢區間內共 5 期；`officialVerifiedWeeks=5`、`conflictWeeks=0`，來源 transport 同時可辨識 `official-csv` 與 `official-openapi`。本次未以畫面截圖驗證線圖渲染，僅確認正式 API 回應。
- 修復後的 LaunchAgent `launchctl print` 顯示 `runs=1`、`last exit code=0` 與 7 個已載入時槽；原失敗紀錄仍保留。
- 聚焦測試 68/68 通過；`pnpm typecheck:multiview`、`openspec validate advance-multiview-tdcc-weekly-freshness --strict`、`zsh -n scripts/realtimestock-runtime`、`git diff --check` 與新增檔案行尾空白檢查通過。離線回歸與上述真實來源／排程觀測分開判定。

## 2026-10-03 09:30 本機畫面驗證（Asia/Taipei）

- 在 Chrome 獨立分頁實際開啟 `http://127.0.0.1:5174/?view=single&symbol=2449.TW&interval=1d`，確認商品為 2449.TW 京元電子、日 K，持股比群組標示 `TDCC（週）至 2026-10-02`。
- 實際捲至持股比區塊目視檢查：大戶持股藍線及散戶持股橘線均有連續可見的多期資料點，不是只有 readout 數字或空白 canvas；最新 readout 分別為 2026-10-02 大戶 57.10%、160 人，散戶 19.44%、249,866 人。
- 同時讀取該商品正式籌碼 API，最新 `distributionRows` 為 2026-10-02；1,000 張以上級距為 57.10%、160 人，10 張以下為 19.44%、249,866 人，與畫面一致。API `officialVerifiedWeeks=5`、`conflictWeeks=0`；畫面另誠實提示歷史中有 1 個非相鄰週缺口，未跨缺口計算單週變化。本次僅驗證最新週畫面與資料一致，不宣稱全部歷史週次完整。
- 該獨立分頁驗證時的 console error 清單為空；不影響原有使用者分頁、服務或行情連線。
