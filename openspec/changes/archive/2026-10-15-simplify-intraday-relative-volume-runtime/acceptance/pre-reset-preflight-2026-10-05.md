# 2026-10-05 盤後：跨日額度與 daily 切換預檢

本紀錄使用 Asia/Taipei；屬於真實盤後唯讀預檢，**不是** 10/6 08:00 來源重置、正式政策遷移或 daily live acceptance。原 failed／partial 收據保持原值。

## 已核對

- 21:55 本機日期仍為 2026-10-05，未到下一適用交易日 08:00。私密重置前收據以既有 `readBrokerResetObservation` 重新驗 hash：20:11:46 的來源已用 72,491,364、剩餘 451,796,636、上限 524,288,000 bytes；`admissionAuthority=false`。未輸出原始帳戶或 HMAC key。
- 既有 simulation API 真實 `/auth/usage` 已用 74,588,999、剩餘 449,699,001、上限 524,288,000 bytes；相較原錨點是**增加** 2,097,635 bytes，並無新交易日計數下降證據。`/info` 為 simulation、`/health` 為 healthy，對既有 business session 發出的唯讀 2330 Snapshot 回傳一筆、close 2575.0。`8080`／`5173`／`5174` 均有 listener；本機 runtime 命令在受限執行環境把 listener 誤顯示為 down，故以實際 listener 與安全唯讀 API 交叉核對，不據此停重啟服務。
- MultiView 本機 D1 主檔的 `immutable=1` 唯讀視圖顯示 verified v3／`local-conservative-v1` 政策、quote 保護池 314,572,800 bytes、有效期至 2026-10-10，既有工作承諾 85,667,193 bytes；178 筆 charged 估量共 65,362,668 bytes，無 `reserved`／`dispatched`。此視圖不是帶 WAL 的原子交易快照，正式切換前必須用同一持久資料庫交易與來源重新核對。另以 Node SQLite 的 `readOnly` 模式確認正式資料庫 adapter 可讀取 v3 政策；未執行遷移寫入。
- 即使先不扣舊 charged，今晚來源剩餘額度扣除不變的 300 MiB 保護池與 85,667,193 bytes 承諾，只餘 49,459,008 bytes，低於目前 160 合約＋160 KBar 的保守全窗口估量 117,505,920 bytes。不能靠重啟服務、清收據或縮小保護池取得授權。
- `daily-runtime-mode.json` 尚不存在；`direct-160-live/registry/active.lock` 不存在。10/5→10/6 已保存的 legacy v1 基準 `baseline-set.json` 標示 160 份 manifest、`baselineUsable=true`、`liveCaptureAcceptance=false`；這只證明明日有合法候選前日基準，不是明日盤中或 v2 自動發布成功。
- 現有 thread heartbeat 為 ACTIVE；排程資料庫計算的下一次觸發為 **2026-10-06 08:05:55 Asia/Taipei**。已更新可見 prompt：使用者授權在來源、官方日期、simulation、排他、完整窗口預算及 CAS 成立時正式遷移與切換，否則維持 mode-off；不以重啟冒充來源重置。

## 待真實時點

10/6 08:00 後才能取得真正新交易日來源計數，並與前錨點、相同帳戶 HMAC、同上限及官方雙市場交易日證據核對。只有完整 Gate 與新鮮工作承諾成立，才可執行雙階段政策遷移並於安全窗口建立 daily 設定；13:35 真正排程與下一適用交易日的盤中、收尾證據另行驗收。2.5、7.1–7.6 目前均不勾選。
