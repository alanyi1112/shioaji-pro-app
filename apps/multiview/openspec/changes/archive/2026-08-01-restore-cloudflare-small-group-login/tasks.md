## 1. 伺服器端多人授權

- [x] 1.1 調整 Cloudflare D1 allowlist 授權，允許有效 Access JWT 對應的 active `owner` 與 active `member`，其餘身分及 D1 失敗維持 fail closed
- [x] 1.2 恢復 owner-only `POST /api/admin/access-users`，沿用 email 正規化、唯一性、角色／狀態驗證與私人稽核
- [x] 1.3 確認最後一位 active owner 防鎖死、member 無管理權與 Service Token 機器路徑不受影響

## 2. 管理介面與個人資料

- [x] 2.1 恢復只有 owner 可見的登入名單入口及新增、修改、停用、刪除介面，member 不得取得完整名單
- [x] 2.2 驗證應用個人資料鍵仍為正規化登入 email，而非新產生的 `access_users.id`
- [x] 2.3 新增相同 email 重新加入後沿用既有個人頁籤／商品清單、不同 email 不自動合併的回歸測試

## 3. Feature-off、安全與免費額度

- [x] 3.1 保持 Cloudflare `SHIOAJI_REALTIME_ENABLED=false`，確認 owner／member 都只使用既有延遲行情且 member 無 realtime capability
- [x] 3.2 將 Cloudflare budget checker 恢復為至少一位 owner 加兩位 member、每人八圖的小型群組情境並通過安全線
- [x] 3.3 更新 Cloudflare 部署文件，說明 Access 驗證、D1 動態 allowlist、owner 管理、個人資料重連與 realtime feature-off 邊界
- [x] 3.4 建立不含 email、token、cookie、帳戶或資料庫識別的 `verification.md` 證據格式

## 4. 本機與規格驗證

- [x] 4.1 通過針對性授權、管理 UI、個人資料及 realtime fallback 測試
- [x] 4.2 通過 `npm run lint`、完整 `npm test`、production build 與 Cloudflare budget checker
- [x] 4.3 通過 `openspec validate restore-cloudflare-small-group-login --strict`、全專案 OpenSpec strict 及 `git diff --check`
- [x] 4.4 以 Wrangler dry-run／產生設定確認 Cloudflare bundle、D1 binding、Access 設定與 realtime feature-off，不輸出秘密值
- [x] 4.5 修正正式 Worker 新增名單路由遺漏 `createAccessUser` import 的 runtime regression，並加入 import wiring 防回歸測試

## 5. Cloudflare 正式站發布與驗收

- [x] 5.1 精準排除其他 active change 與既有未提交證據，提交本 change 並推送 `main`
- [x] 5.2 等待 exact-commit Cloudflare production workflow 完成 migration、deploy、匿名 Access boundary 與 Service Token protected smoke
- [x] 5.3 以安全統計核對正式 D1 的 active owner／member 計數、個人資料保留與 Free-tier 用量，不輸出實際 email 或秘密
- [x] 5.4 以既有已登入 owner session 驗證登入名單管理、主要圖表、延遲行情與 `SHIOAJI_REALTIME_ENABLED=false`
- [x] 5.5 由 owner 透過受保護管理介面重新加入原成員；若缺少精確 email，不得從殘留資料推測授權對象
- [x] 5.6 以既有 member session 驗證可登入、無管理權且相同 email 可讀取原個人頁籤／商品清單；缺少該 session 時保持未完成，不得以模擬冒充
