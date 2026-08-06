# 驗證紀錄

## 安全邊界

- 實際登入 email、Access JWT、cookie、Service Token、Cloudflare 帳戶／資料庫識別與其他秘密不得寫入本檔、log、commit 或測試 fixture。
- 只記錄 `owner`／`member`／inactive 的筆數、安全 reason code、exact commit、workflow 結果、資料筆數與用量統計。
- Shioaji production feature flag 必須為 `false`；Cloudflare／D1／瀏覽器不得取得 Shioaji API key、secret、憑證或登入資料。

## 本機證據

- 2026-07-31：針對性 `request-principal`、`access-admin-ui`、`realtime-hub` 測試 `25/25` 通過。證明 active owner／member 可通過 D1 allowlist、未列名／inactive fail closed、owner-only 管理、最後 owner 防鎖死、Service Token 路徑不受影響、相同正規化 email 重新建立 access row 後仍讀取原個人資料鍵，以及 member 無 realtime capability。
- 2026-07-31：production build 與 lint 通過。三位使用者（1 owner＋2 member）、每人八圖、每日可見八小時的靜態模型為 requests `6,746 / 50,000`、D1 reads `622,690 / 3,500,000`、D1 writes `26,720 / 50,000`；bundle、asset、D1 batch、Durable Object 與 D1 zero-tick-write gates 全數通過。realtime 模型仍只保留單一 owner 且 production feature flag 固定關閉，不代表啟用即時行情。
- 2026-07-31：完整 `npm test` 為 `373/373`，`npm run lint`、production build、change strict、全專案 OpenSpec strict `38/38` 與 `git diff --check` 通過。
- 2026-07-31：重新產生的本機 Cloudflare 設定權限為 `0600`，以安全布林摘要確認 D1／assets／Access／Durable Object bindings 齊全、target 為 Cloudflare、`SHIOAJI_REALTIME_ENABLED=false`，Wrangler dry-run 通過；未輸出設定值或識別資料。
- 2026-07-31：首次發布後，owner 在受保護管理介面送出新增名單時收到 `access_write_failed`，正式 D1 仍為 `1` 位 active owner、`0` 位 member。以可回復的 `.invalid` 合成資料驗證 `access_users` 與 `access_audit_log` 寫入後立即清理，確認 D1 schema、唯一索引與稽核寫入正常；根因為 `worker/app.ts` 的 POST 路由呼叫 `createAccessUser`，卻遺漏對應 import，打包未做型別檢查而只在 runtime 失敗。修正 import 並新增 wiring 防回歸測試後，針對性測試 `14/14`、完整 `npm test` `373/373`、lint、change strict、全專案 OpenSpec strict `38/38` 與 `git diff --check` 通過。本機重新執行 Cloudflare dry-run 時因當前 shell 未提供三項 hosted deployment 設定而在安全 preflight 停止，必須由 GitHub production environment 的 exact-commit workflow 完成 dry-run 與發布，不把本機缺少秘密誤記為 bundle 驗證成功。

## Cloudflare 正式站發布

- 2026-07-31 runtime regression 修正版 exact commit `38fc7ec3633530574a1b30372bfee0c05feef6e2` 的 `event=push` Cloudflare production workflow run `30643712637` 成功；lint、完整測試、全專案 OpenSpec strict、diff check、三人 Free-tier budget、migration、exact deploy、匿名 Access boundary 與 Service Token protected health 全部通過，未執行 rollback。修正版發布後正式 D1 一度仍為 `1` 位 active owner、`0` 位 member，證明失敗嘗試與合成診斷均未殘留授權 row；owner 其後重新整理受保護管理頁並成功新增精確成員。
- 2026-07-31 exact commit `76afe4323235b2c6b3d5c4303de8d56f02eb51a2` 的 `event=push` Cloudflare production workflow run `30641892047` 成功；再次通過三人 Free-tier budget、migration、exact deploy、匿名 Access `302` 邊界與第 2 次嘗試成功的 Service Token protected health，health 的 commit 與 deployment target 相符。未觸發 `workflow_dispatch` 或 rollback。
- 正式 D1 安全摘要：`1` 位 active owner、`1` 位 active member；登入稽核包含 `1` 筆 `create_user/success`。重新加入後先確認個人頁籤共有 `2` 個已列名 user profile／`8` rows，owner 與 member 各 `1` 個 profile／`4` rows，商品清單為 `0` rows；member 真實登入驗收後再核對為 member `1` 個 profile／`5` rows、owner `1` 個 profile／`4` rows。這證明相同正規化 member 身分不只連回原頁籤，亦以自己的個人資料鍵持續使用，未另建空白身分；全程只保存筆數，不查詢或輸出實際 email。
- 正式 D1 近 24 小時安全統計：read queries `3,171`、write queries `1,369`、rows read `644,411`、rows written `2,473`、tables `25`，低於本專案安全線；該 rolling window 是當下觀測，與三人靜態穩態模型分開保留。
- owner 已登入 Chrome 驗收：個人清單同步成功，「登入名單」入口可見；管理 dialog 可載入 `1` 筆 active owner，並具備新增 email／角色、儲存、刪除及 audit UI。台股首頁 `8/8` 日 K panel 全部載入，畫面可見的八檔最新標籤皆為 `07/31 已核對`；週期選單沒有「分時」，與 production realtime feature-off 相符。瀏覽器畫面與本檔均未保存 email。
- 重新加入原成員：owner 已於受保護介面輸入精確 email 並新增成功；D1 安全摘要確認 active member 與成功稽核各增加 `1` 筆，且原 member 的 `4` 筆個人頁籤已重新連回。未從殘留資料推測 email。
- member 已登入驗收：2026-08-01 使用者依指定條件，以既有 member session 實際確認可進入 Cloudflare 正式站、原個人頁籤可見且沒有「登入名單」管理入口；不是模擬 JWT。驗收後 D1 安全摘要顯示 member profile 的頁籤由原 `4` rows 增為 `5` rows，獨立佐證該 active member 身分確實使用自己的個人資料。Codex 可控制的三個正式站 Chrome 分頁當時仍全是 owner session，均未冒充 member 瀏覽器證據，也未讀取 email、cookie 或 token。

## 結論

- 本 change 已完成全部 `21/21` tasks、exact-commit 部署、owner／member 真實 session 驗收、原成員重新加入與個人資料重連，可在主規格同步後歸檔。
