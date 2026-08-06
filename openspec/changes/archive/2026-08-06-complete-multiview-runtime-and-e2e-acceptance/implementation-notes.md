## 實作證據

### 2026-08-07 前置基準

- HEAD：`d7a6c61d8fde01ef4d5494810bc9e84affe5a57c`，本機 `main` 領先 `origin/main` 1 個既有 MultiView 整合 commit；遠端 `main` 為 `940a7fe39717f60a83a72a3193fb811565d34ad7`。
- 既有 dirty scope 只有先前取消的 `plan-cloudflare-private-access-shioaji-server` active 目錄刪除與對應未追蹤 archive；本 change 不修改、不 stage 該 scope。
- runtime：`runtime_mode=simulation`、`api_simulation=true`，8080／5173／5174 listener 與 2330 business snapshot 可用；`production_readonly_job=stopped`，盤後排程未啟動。
- 本機 MultiView D1：schema revision `0021`、22 個 migration、29 個 table、`PRAGMA integrity_check=ok`、schema coverage `ok`，操作前已有 1 份備份。
- 個人狀態：4 個本機頁籤、24 個商品；material hash `52cc27bba717faad5053d48b5f6f90c9cc5b51392df33c0877c2c3d540e7b6be`。hash 排除 `updated_at`，不保存頁籤或商品內容。
- 基準 DB 檔案 hash：`07936087152b245b5b1896114536a09135586b4a85059b28e7173672ff37590a`。

### Launcher 與安全 metrics

- 5173 launcher 採獨立 dynamic chunk，不初始化交易終端 hooks；只允許 loopback 5174 URL，health probe timeout 為 2.5 秒。
- 5174 CORS 只允許 5173 loopback origin 讀取 `/api/health` 與 `/local-shioaji/api/v1/info`；其他 origin／path 不加入 CORS。
- document-local metrics 使用 version 1 固定 schema，並同步到 hidden `#multiview-acceptance-metrics`；不含 symbol、quote、account、credential、token 或 secret。
- unit／contract tests 驗證未列名欄位與敏感 reason fail closed、相同商品 ref-count、cleanup、background／foreground、latest-wins full recompute 與 launcher health。

### Browser 多圖矩陣

- 實際依序切換 1／2／3／4／6／8 圖，所有狀態都維持 `sseOpenCount=1`，active demand 分別為 1／2／3／4／6／8；八圖時 heap 可讀、48,978,487 bytes，long task 3，未捕捉 console error／warning。
- 八圖第二張改成與第一張相同商品後，panelCount 仍為 8、SSE 仍為 1、active canonical demand 降為 7，證明 duplicate demand 去重。
- 第一張實際完成日→週→月→日切換；每次 full recompute 均有更新，SSE 與 demand 未增生。
- 切到美股八圖時載入 `^DJI`、`^IXIC`、`^SOX`、`^GSPC`、`^RUT`、`TSM`、`NVDA`、`GOOGL`，Shioaji SSE／demand 都降為 0；切回台股後恢復一條 SSE。
- 目前 in-app browser 不會把同一 automation session 的其他頁籤設為 hidden，因此 browser background 數值標為 unsupported；visibility lifecycle 由 coordinator contract test 驗證。
- 重新安裝 runtime 後，in-app browser 已實際由 5173 launcher 導向 5174 MultiView；交易終端仍停留在原 5173 頁籤，既有同名 MultiView 視窗則依瀏覽器規則重用。

### Runtime 生命週期與安全邊界

- repo 外 synthetic 非 simulation state 啟動結果為 exit 1，並回報 simulation gate；live simulation runtime 未受影響。adapter contract tests 證明非 simulation 會在轉送前回 `simulation_required`。
- 實際完成 D1 備份與 restore，前後 schema、row count、個人清單 material hash 與 `PRAGMA integrity_check` 一致。
- 實際完成一般 uninstall、重新 install／start；D1、備份、4 個個人頁籤與 24 個商品均保留，simulation 8080／5173／5174 與兩條盤後 pipeline 回復 loaded。
- macOS 重新登入會中斷使用者桌面工作階段，因此 5.5 依規格保留為唯一待使用者當次確認的人工驗收，不以 service restart 冒充 relogin。

### 最終品質檢查

- RealTimeStock unit tests 144/144、browser tests 18/18；MultiView build 與完整 tests 462/462 通過。
- MultiView lint、顯式 typecheck、source governance、production/full dependency audit、秘密掃描與 `git diff --check` 全部通過。
- `openspec validate complete-multiview-runtime-and-e2e-acceptance --strict` 通過。

### macOS 重新登入接續點

- 使用者已於 2026-08-07 明確確認可執行本次重新登入驗收。
- 登出前 runtime 為 simulation，production-readonly stopped；8080／5173／5174 listener、2330 business snapshot、D1 schema revision 0021、integrity 與四類盤後資料均正常。
- 登出前 D1 SHA-256 為 `7c0cddc85e6eb1fc37ad6f5841b3a04bbab6fade638f106bcf2364cc200c99c2`，大小 50,008,064 bytes，migration count 22。
- 登出前個人狀態為 4 個頁籤、24 個商品、共 28 rows；material hash 為 `42591636139e0d8c7ecdcba98199af15fad8c9b19f3cf57ef90248a88ad0d460`。
- 去識別化接續報告已保存於 Application Support 的 `reports/relogin-checkpoint.json`；登入後必須核對 loginwindow session 已更換，再比對上述 runtime 與資料狀態，通過前 5.5 維持未勾選。
- 已實際登出 GUI domain；`/dev/console` 一度切換為 `root`，重新登入後回到 `alanyi`。loginwindow PID 由 417 變更為 70645，GUI ASID 由 100027 變更為 100914，證明不是單純 restart service。
- 登入後 runtime 自動恢復為 simulation，production-readonly 維持 stopped；8080／5173／5174、MultiView health 與 2330 business snapshot 均回應成功。
- D1 大小仍為 50,008,064 bytes、migration count 22、`PRAGMA integrity_check=ok`；個人狀態仍為 4 個頁籤、24 個商品、28 rows，material hash 與登出前完全相同。
- SQLite 整體檔案 SHA 因 runtime 重新開啟與正常 metadata／WAL checkpoint 由 `7c0c...99c2` 變為 `666d...e806`，不作為邏輯資料異動判斷；個人 material hash、row count、schema、integrity 與盤後四族群 coverage 均通過。
- `reports/relogin-checkpoint.json` 已更新為 `completed`；5.5 完成。
