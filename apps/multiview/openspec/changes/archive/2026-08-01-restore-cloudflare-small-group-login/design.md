## Context

Cloudflare 正式站目前同時在兩層限制為單一 owner：`worker/access-control.ts` 拒絕 `member`，`worker/app.ts` 的新增登入 API 固定回覆 `single_owner_mode`。正式 D1 先前的兩筆 active member 及直接關聯登入稽核已刪除，但 `user_tabs`、`user_instruments` 等個人資料沒有刪除，且其 `user_id` 仍是正規化登入 email。Shioaji Cloudflare 即時方案已停止並保持 feature-off；本變更只恢復原有小型私人群組登入。

## Goals / Non-Goals

**Goals:**

- 重新允許 D1 allowlist 中的 active owner 與 member 通過 Cloudflare 正式站授權。
- 恢復 owner-only 登入名單管理介面與 API，保留最後一位 owner 防鎖死、email 唯一性與私人稽核。
- 使用相同 email 重新加入成員時，直接沿用未刪除的個人頁籤與商品清單。
- 只發布 Cloudflare 正式站，並證明小型群組、延遲行情與 Free-tier 安全線仍成立。

**Non-Goals:**

- 不啟用、搬移或重新設計 Shioaji 即時行情。
- 不變更 Sites 保留站的登入、版本或部署。
- 不從 repository、日誌或規格保存、推導或輸出實際登入 email。
- 不自動合併不同 email 的個人資料，也不建立公開註冊或通用帳號系統。

## Decisions

### 1. 回復既有雙層授權，不以新的 feature flag 包住多人登入

Access JWT 繼續負責驗證 Google 身分，D1 `access_users` 繼續是應用 allowlist 權威。授權函式接受 `owner` 與 `member`，但只有 owner 可進入管理 API；這回到 `4c4a943` 前已存在且有測試的模型，避免新增另一個容易與 D1 漂移的帳號模式開關。

替代方案是只改 Cloudflare Access policy。這無法恢復 Worker 目前對 member 的伺服器端拒絕，也失去 D1 動態名單及角色管理，因此不採用。

### 2. 恢復新增 API，沿用既有 invariant 與稽核

`POST /api/admin/access-users` 重新呼叫既有 `createAccessUser`；`PATCH`、`DELETE`、email 正規化唯一、最後一位 active owner 保護與稽核結構不改。前端管理入口仍只依伺服器回傳的 `canManageAccess` 對 owner 顯示，一般 member 無法僅靠顯示控制取得管理權。

替代方案是直接以 Wrangler 寫入所有成員且不恢復 UI。這會讓後續每次名單變動都需要部署權限，違背原本由 owner 自行管理的小型群組模式，因此不採用。

### 3. 個人資料繼續以正規化 email 為鍵

登入授權成功後，應用的 `requestUserId` 仍回傳 Access JWT 中已驗證且正規化的 email；`access_users.id` 只用於角色與稽核關聯。因此重新建立相同 email 的 access row 即可重新連回保留的 `user_tabs`／`user_instruments`，不需要資料 migration。

實際成員 email 不寫入程式或 migration。發布後由 owner 在受保護管理介面重新加入；若要以 D1 操作恢復，也必須由使用者另行提供精確授權資料，不從殘留個人資料推測允許登入對象。

### 4. 即時行情能力與登入角色分離並保持 feature-off

Cloudflare 產生設定的 `SHIOAJI_REALTIME_ENABLED` 繼續固定為 `false`，不注入 Shioaji secrets。即使休眠的 realtime 程式仍在 bundle，owner 與 member 都只能走既有 Yahoo／官方資料路徑；恢復 member 不得被解讀為恢復 Shioaji 網站方案。

### 5. 以三人小型群組情境重跑免費額度 gate

預算檢查至少模擬一位 owner 加兩位 member、每人最多八圖的既有延遲行情使用情境，並保留 requests、D1 reads／writes、storage 的安全線。發布後再讀取 Cloudflare 安全統計；若 rolling window 尚包含舊尖峰，分開記錄而不以靜態模型冒充穩態。

## Risks / Trade-offs

- [Cloudflare Access 外層 policy 仍只允許 owner] → 發布前核對 policy；若目前為單一 email，改回由 Google IdP 驗證、應用 D1 精確 allowlist 授權的私人入口，再以未列名身分拒絕證明雙層邊界。
- [先前 member access row 已刪除] → 恢復 owner 管理功能後由 owner 重新加入精確 email；不從個人資料殘留自動推測授權。
- [真實 member session 不在目前瀏覽器] → 完成可自動化及 owner 驗收，但將 member 實際登入保留為明確 gate，等待使用者以該帳號驗證，不以測試 token 冒充。
- [多人同時使用增加 Free-tier 用量] → 使用既有批次快取與三人預算模型；發布後持續量測，超出安全線時先降低 refresh／cache miss，不啟用即時行情。
- [管理 UI 重新開放增加誤操作風險] → 只讓 owner 取得 capability，保留 email 驗證、唯一性、最後 owner 防護及 audit。

## Migration Plan

1. 回復 member 授權與 owner 新增 API，更新管理 UI、授權、realtime capability 及個人資料重連測試。
2. 更新 Cloudflare 部署文件與三人 Free-tier 預算情境，確認 realtime flag 仍為 `false`。
3. 完成 lint、完整測試、build、OpenSpec strict、`git diff --check` 與 Wrangler dry-run。
4. 將精準變更提交並推送至 `main`，等待 exact-commit Cloudflare production workflow 成功。
5. 以既有 owner session 驗證管理介面、主要圖表與延遲行情；由 owner 在介面重新加入原成員。
6. 以成員既有 session 驗證登入與原個人清單；缺少該 session 時保持 gate 未完成，不冒充。

回滾時先部署上一個 exact commit，恢復單一 owner fail-closed；新加入的 D1 member rows可停用或刪除，但不得刪除個人頁籤與商品清單。
