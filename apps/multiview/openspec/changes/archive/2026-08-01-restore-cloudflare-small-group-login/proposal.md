## Why

Cloudflare 正式站先前為配合未啟用的 Shioaji 即時行情方案改成單一 owner，導致原有的小型私人群組無法登入；即時方案已停止且維持 feature-off，因此沒有必要繼續限制為單一帳號。現在應恢復受控的多人登入，同時保留 Cloudflare Access、D1 allowlist、owner 管理與個人資料隔離邊界。

## What Changes

- Cloudflare 正式站重新允許 D1 中 `active member` 與 `active owner` 通過伺服器端授權；未列名、inactive 或無有效 Access JWT 的身分仍 fail closed。
- 恢復只有 owner 可見及可操作的登入名單管理功能，包含新增、修改、停用與刪除成員；最後一位 active owner 仍不可移除或降級。
- 以相同登入信箱重新建立先前刪除的成員 allowlist 後，沿用仍保留、以正規化信箱為 `user_id` 的個人頁籤與商品清單，不把信箱或其他個資寫入 repository、OpenSpec、日誌或發布證據。
- Shioaji 即時行情及相關 Cloudflare capability 維持關閉；所有 owner／member 繼續使用既有延遲行情與官方收盤核對。
- 重新核對小型私人群組的 Cloudflare Free-tier 安全線、完整測試、Access 邊界、正式 D1 安全摘要及已登入瀏覽器驗收後才發布。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `codex-sites-rewrite`: 將 Cloudflare 正式站的人員授權由單一 owner 恢復為 D1 allowlist 管理的小型私人群組，並明確規範 owner 管理、member 權限、個人資料重連及即時行情 feature-off 邊界。

## Impact

- 受影響程式：`worker/access-control.ts`、`worker/app.ts`、登入名單前端與相關測試。
- 受影響資料：Cloudflare 正式 D1 的 `access_users` 與 `access_audit_log`；不刪除或重寫 `user_tabs`、`user_instruments` 等個人資料。
- 受影響部署：僅 Cloudflare 正式站；Sites 保留站的身分與部署不變。
- 安全與秘密：沿用 Cloudflare Access JWT、hosted `ACCESS_OWNER_EMAIL` 與 D1 allowlist；不新增前端秘密、不保存實際信箱於版本控制。
