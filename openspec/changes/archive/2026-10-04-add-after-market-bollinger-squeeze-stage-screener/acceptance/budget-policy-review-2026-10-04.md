# 流量政策到期前複核（2026-10-04）

## 授權與範圍

使用者針對「10/5 14:00 政策到期」明確要求現在複核。這是本機下載預算政策的配置效期，並非 API 帳號、金鑰或來源服務到期。本輪新增操作者複核入口；原 watcher 不自行續期，不修改來源 review 或交易權限。

## 真實複核通過

11:43:48 Asia/Taipei，既有 simulation business-session、2330 Snapshot、兩份原始非重疊校準及最新盤後基準配置通過；保存原政策與複核 proof，再以 CAS 更新正式配置。原條款、不可變錨點、實測及速率不變：

- 原效期：2026-10-05 14:00；新效期：**2026-10-10 23:59:59 Asia/Taipei**。新效期未超過複核起七日或原實測三十日期限。
- 真實 `/auth/usage`：used 4,410,955／limit 524,288,000／remaining 519,877,045 bytes；保守帳本不因 counter 下降歸零，used 38,398,715／remaining 485,889,285 bytes。
- 共用保護池 314,572,800 bytes（300 MiB），盤後基準配置保留 85,667,193 bytes，合計 400,239,993 bytes。
- 原 178 筆非 released reservation 保留 65,362,668 bytes，沒有 reserved／dispatched。扣除上述配置與舊債後可用 20,286,624 bytes；實測估量每批 367,206 bytes，預算通過。
- 兩 HTTP／run、兩請求／分鐘、估量倍率 1.5、每批配置上限 1 MiB 保持原值；沒有清除 charged／quarantined 或重建 quota identity。

本機不可變收據：`broker-budget-policy-review:6889f59d3800071a5cdd22a2aca64a3347a9aa3d6f440319d8c6f101d12a62eb`。

原政策 hash `fa3a2d68ec881bbe1feed0f024673c9299c7d6266cd40e37a5de8292522bba16`，另存 `broker-budget-policy-archive:<原hash>`；新政策 hash `d5dcc842bd8770d421afafc059abdbe044c2dc36c34db23d9090d0c5b58e9e3f`。原校準 hash `fc2c7efc1e025cb3b5f7b470361ac60c5af78a2b74063356e0561ee0cb94cb37`／`cf5149bf48d4961e33dde72d235872029f418f1d70af6c30a0bad7af4482b223` 保持不變。

## 實際 admission 與保留檢查

透過原正式 ports 建立一次未 dispatch 的 reservation `b6467986-d96d-49fc-b56f-e6f3b161d788`，`allowed=true`、estimated 367,206 bytes；未呼叫 start／來源下載，隨即依既有 settlement 將本輪新 reservation 標成 released。只釋放確定未送出的本輪保留，原 179 筆 reservation 完整內容 hash `8fa6c73f08f5c6da03420c921d06080d9de2d994852caf1a57b9fbe2cb579bb8` 前後一致。

此操作逐請求白名單紀錄：GET `/api/v1/info` 3、GET `/api/v1/health` 3、POST `/api/v1/data/snapshots` 3（2330）、GET `/api/v1/auth/usage` 3。歷史來源下載、login、subscription、orders 皆 **0**；此 counts 只涵蓋本輪複核及 admission，不冒稱其他程序沒有請求。

profile revision1 保持，完整 profiles hash `af40bec55c8fc5d170c90135870a5389a3f2cfdce6e640f1134fba03167baf76` 前後一致；head 仍為 `72dd8c83-792e-4217-a8ab-398cf8513c51`、updatedAt `2026-10-04T01:11:47.246Z`，完整 head hash `60800344b7533277f3f108a03274fa440d44185e899edb79cf3c9c353ea996b6` 不變。既有 failed runs 完整 hash `5f16a815882aca4ebbd6f83ed7ef38d01363777fd31fe1f71249ae2aaa849d3e` 不變。未改清單／每日 profile，未改寫原失敗收據。

## 程式與驗證

新增 `scripts/stock-screener-broker-policy-review.mjs`，只有明確呼叫才執行複核。重驗原始校準鏈、即時用量／預算與資料庫版本；過期／未來 observation 不入 counter，commit 前 counter 必須仍對應本次實際 observation，transaction 再核對政策、counter、錨點、工作配置與全部舊債。原政策過期、limit 變動、來源破損、餘額不足、活躍 dispatch 或 CAS 競爭均拒絕。

7 項新複核測試、連同額度／保守帳本／ports／配置 writer／producer 共 **62／62** 通過。OpenSpec strict validation、`git diff --check` 及本輪新增文字 whitespace 檢查通過。本輪只有 Node script／測試及 OpenSpec 文件變更，不修改前端，不重複宣稱先前 build／Chromium 是本輪結果。

runtime status：simulation healthy、business-session／2330 available、production stopped、write master disabled、watchdog restart_count=0；8080／5173／5174 listener 保持。另有原盤後籌碼 partial／unverified，不在本輪範圍，不改稱已解決。

## 結論與限制

原本「10/5 14:00 到期阻擋下載」已由真實複核排除；既有 watcher 逐次讀正式 DB 配置，無須重啟。自然 watcher log 仍為原10/2成功快照的 `session_complete_sleeping`、nextAttemptAt 10/5 14:00，沒有手動補跑或改排程。

今天 admission 成功**不是**10/5 未來來源／排程已通過。新下載時仍重驗用量、保留配置、來源及資料；若額度不足仍停止，不能承諾所有外部消耗永遠低於保護池。10/10 新效期前仍須按當時證據再複核，不自動無限續期。未歸檔、commit、push 或重啟共用服務。
