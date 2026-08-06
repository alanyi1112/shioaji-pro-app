## 1. TDCC 佇列狀態修正

- [x] 1.1 以最低 51 週與 missing dates 修正 `tdccContinuousTargetSyncState`，保留覆蓋不足商品的 queued／partial 狀態
- [x] 1.2 新增少量既有週資料、人工 queued、target refresh 與 claim 的狀態轉換測試
- [x] 1.3 驗證「我的清單」新增台股會建立可由 durable runner claim 的 TDCC 目標，且日資料 ready 不會掩蓋歷史不足

## 2. 安全的立即 workflow dispatch

- [x] 2.1 新增 D1 dispatch 紀錄與 migration，保存 symbol、狀態、冷卻時間及 allowlist 錯誤碼
- [x] 2.2 實作伺服器端 GitHub Actions workflow dispatch，固定 repo／workflow／ref 並保護 runtime secret
- [x] 2.3 將 `POST /api/taiwan-stock-chip/backfill` 回應擴充為 queued、started、already-running、cooldown、unavailable 與 failed 狀態
- [x] 2.4 新增登入、eligibility、dispatch 去重、未設定、上游失敗與秘密不外洩測試

## 3. 前端進度與線圖更新

- [x] 3.1 將右鍵文字與狀態改為「立即回補歷史資料」、啟動中、完成週數、降級或受阻的明確訊息
- [x] 3.2 實作個別 symbol 的有限輪詢、coverage 比較、request cache 清除與新資料重畫
- [x] 3.3 在切換商品、移除副圖、銷毀 controller、完成或錯誤時取消 timer，並加入前端行為測試

## 4. 驗證與正式環境

- [x] 4.1 執行完整 Node 測試、`npm run lint`、`npm run build` 與 OpenSpec strict validation
- [x] 4.2 確認 Sites runtime 已以秘密方式設定 workflow dispatch 憑證；未設定時驗證 fail-closed 降級訊息
- [x] 4.3 以原本只有少量 TDCC 週資料的清單台股觸發立即回補，核對 GitHub run 的 `week-complete`、API coverage 增加與線圖點數即時增加
- [x] 4.4 重新檢查背景 scheduler heartbeat、清單 target／ready／pending 與 TDCC queued／running／completed 計數
