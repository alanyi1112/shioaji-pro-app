# Cloudflare 私有部署

這個 target 與 Codex Sites 共用 application source，但使用獨立 Worker、D1、Cloudflare Access 與 secrets。`.openai/hosting.json` 不會被 Wrangler 設定覆蓋。

## 雙 runtime 設定矩陣

| 項目 | Codex Sites | Cloudflare production | production 缺值行為 |
| --- | --- | --- | --- |
| 部署入口 | `.openai/hosting.json` | 產生的 `.wrangler.cloudflare.generated.jsonc` | 停止部署 |
| 使用者身分 | `oai-authenticated-user-email` | 已驗證 `Cf-Access-Jwt-Assertion` + D1 active 登入名單 | `401/403`，不 fallback |
| 個人資料 | Sites `DB` | Cloudflare `DB` | 不跨 target 共用或自動寫入 |
| Static Assets | Sites binding | `ASSETS` | build／dry-run 失敗 |
| Image binding | 可選 `IMAGES` | 未綁定時 optimizer 回 `404` | 不影響目前靜態圖片 |
| 即時更新 | 頁面級最多八圖 batch polling；Shioaji realtime 固定停用 | 頁面級最多八圖 batch polling；通過 gates 後可啟用一條 page-scoped realtime WebSocket | hidden／offline 暫停，realtime fail closed 回 Yahoo |
| schema | Sites release migration，相容 runtime fallback | deploy-time `drizzle/` migration | request 不執行 DDL |
| 版本 | Sites version | exact `APP_COMMIT_SHA` | health 顯示 `null` 或停止 promotion |

## 平台設定

以下值只能放在本機 shell、GitHub Environment 或 Cloudflare secrets／variables，不得提交：

- `CLOUDFLARE_D1_DATABASE_ID`
- `CLOUDFLARE_ACCESS_TEAM_DOMAIN`
- `CLOUDFLARE_ACCESS_AUD`
- `ACCESS_OWNER_EMAIL`（只以 Worker hosted secret 保存初始擁有者）
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- Access Service Token 與 TDCC／本益比 pipeline secrets

Google 登入採 Cloudflare Access。Access 負責驗證 Google 身分，Worker 仍會驗證 `Cf-Access-Jwt-Assertion`，再以私有 D1 `access_users` 決定是否允許進入，不能只依賴前端或 Access UI。owner email 只在 Cloudflare 以 `ACCESS_OWNER_EMAIL` hosted secret 設定，source、前端與文件不得硬編碼；D1 中的 active `owner` 與 active `member` 可使用一般網站功能，未列名與 inactive 身分全部回覆 `403`。GitHub Environment 繼續使用 `CLOUDFLARE_ACCESS_TEAM_DOMAIN`／`CLOUDFLARE_ACCESS_AUD` 作為部署輸入，但產生的 Worker binding 會改名為 `ACCESS_TEAM_DOMAIN`／`ACCESS_AUD`，避免 Cloudflare 平台保留前綴。

登入名單管理入口只向 active owner 顯示，可新增、修改、啟用、停用及刪除成員並保存私人稽核；一般 member 不得讀取名單或執行管理動作，系統禁止移除最後一位 active owner。個人頁籤與商品清單以正規化登入 email 為 `user_id`，刪除登入權限不會刪除個人資料；重新加入相同 email 後會沿用原資料，不同 email 不會自動移轉或合併。

## 本機 dry-run

```bash
export CLOUDFLARE_D1_DATABASE_ID='[REDACTED_SECRET]'
export CLOUDFLARE_ACCESS_TEAM_DOMAIN='https://[REDACTED_SECRET].cloudflareaccess.com'
export CLOUDFLARE_ACCESS_AUD='[REDACTED_SECRET]'
export APP_COMMIT_SHA="$(git rev-parse HEAD)"
npm run cloudflare:dry-run
```

產生的 `.wrangler.cloudflare.generated.jsonc` 權限為 `0600` 且已被 `.gitignore` 排除。

初始 owner 以互動方式直接寫入 Cloudflare，不得放進 shell history、GitHub log 或 repo：

```bash
npx wrangler secret put ACCESS_OWNER_EMAIL --config .wrangler.cloudflare.generated.jsonc
```

Cloudflare 的 TDCC 與本益比排程使用獨立 GitHub workflow、run ID、concurrency 與 pipeline secret；既有 Codex Sites workflow 維持原設定。兩個 target 不共用 D1、Access credential 或 pipeline secret，所以任一 target 失敗不會回滾另一個 target。GitHub 僅保存 Cloudflare Access Service Token，runner 會自動使用 `CF-Access-Client-Id`／`CF-Access-Client-Secret`，並以 `X-MultiChart-Pipeline-Authorization` 傳遞應用層 secret，避免 Access 攔截一般 `Authorization` header；整條路徑不依賴任何使用者登入。

每個 Cloudflare 資料 workflow 在完成 control／ingest 後，必須以同一 Access Service Token 讀取 `/api/health`，驗證 exact commit、Cloudflare target、D1、run ID／scope／trigger、heartbeat、coverage 與安全 reason，再只輸出 allowlist 摘要。完整 health response、authorization header、token、cookie、帳戶識別或使用者資料不得寫入 GitHub log；匿名拒絕、另一個 deployment 的 health 或舊 deploy smoke 都不能代替該次排程的 fresh protected health。

本益比資料管線的 Worker runtime 固定設定為 `PE_RIVER_ACCESS_MODE=private` 與 `PE_RIVER_COMMERCIAL_USE=false`；若未明確符合私人、非商業使用邊界，控制端點會以 `license_review_required` fail closed。

## Migration 與發布

```bash
npm run cloudflare:migrate
npm run cloudflare:deploy
```

順序固定為 tests／build、dry-run 與 budget gate、migration、deploy、受保護 smoke。migration 只套用 `drizzle/`；一般 HTTP request 不應執行 DDL。

### Shioaji realtime 發布邊界

Realtime hub 使用 SQLite-backed Durable Object `RealtimeMarketHub`。gateway 只建立 outbound WebSocket，瀏覽器每頁最多八個可見台股商品共用一條 WebSocket；Tick、每秒微批次與分時 minute bucket 都不得寫入 D1。Cloudflare 產生設定永遠把 `SHIOAJI_REALTIME_ENABLED` 預設為 `false`，Sites 保留站沒有 realtime binding，也不得讀取任何 realtime secret。

Cloudflare Shioaji 即時網站方案已停止；production 產生設定固定保持 `SHIOAJI_REALTIME_ENABLED=false`，且 Cloudflare 不得取得 Shioaji API key、secret、憑證或登入資料。恢復 owner／member 小型群組只恢復既有延遲行情與官方收盤核對，不得解讀為重新啟用 realtime；休眠程式仍必須 fail closed 回到 Yahoo fallback。

Cloudflare machine trust 使用三組彼此獨立的秘密：hosted ingest secret 與 Access Service Token 的 client ID／secret。主 ingest secret 輪替時可短暫設定 `SHIOAJI_INGEST_SECRET_NEXT`，新 gateway 連線確認後立刻以新值取代主 slot 並刪除 next slot；不得長期保留雙 slot。Shioaji API key／secret 永遠只存在小馬的 `systemd-creds` encrypted store，不能進入 Cloudflare、repo、CI、瀏覽器或 D1。

自動降載順序固定為：先停止非可見商品廣播與 session backfill，再停止新增訂閱，最後暫停 ingest；既有 Yahoo batch 更新繼續運作。安全 health 只公開 enabled、gateway state、source age、subscription／drop／replay 計數、quota 與 `d1TickWrites: 0`。

本機不需正式秘密的 preview 驗證：

```bash
npm run realtime:preview-verify
npm run realtime:ui-preview-verify
```

兩個命令只在 localhost 且 `ENABLE_REALTIME_LOCAL_TEST=true` 的子程序內啟用 simulation capability；非 localhost request 仍會拒絕。第一個命令驗證 Durable Object ingest→browser stream 與 D1 zero-tick-write，第二個以 headless Chrome 驗證圖數矩陣、同商品重複 panel、分時模式、page-scoped 單一連線與雙擊單圖。

### Cache retention 與用量觀測

`0019_acoustic_swordsman.sql` 會建立 `candle_cache.expires_at` index 與 maintenance state。Cloudflare scheduled handler 每次最多刪除 40 筆已過期 rows 並保存 remaining count；清理或 cache 寫入失敗只讓市場資料走 fresh／stale-safe 局部降級，不得阻斷個人頁籤與商品清單。

`/api/health` 的 `usage` 是目前 Worker isolate 自啟動後的 request、scheduled invocation、D1 query／write 與 cache 計數，只適合快速診斷，不等同 Cloudflare 帳戶計費統計。正式 Free-tier 驗收仍須另外查看 Cloudflare dashboard 的 request、CPU、D1 reads／writes、storage 與錯誤率，且不得把 email、SQL、參數或秘密寫入 health／log。

日／週／月 K 線到期刷新只能寫入上游實際新增或變動的 tail；若 tail 完全未變，只允許更新最新一筆作 freshness marker。禁止把已存在的完整 history window 反覆 upsert，否則少量使用者也可能超過 D1 Free 的每日 rows-written 額度。首次匯入、migration 或歷史回補造成的尖峰必須與穩態用量分開記錄，至少跨過 history TTL 與下一次真實 schedule 後再量測。

`0021_bumpy_bruce_banner.sql` 會建立不含使用者身分的 `candle_history_state`。日／週／月 K 線仍以 `provider + symbol + interval` 作為全站共用 canonical identity；個人帳戶只隔離頁籤與商品清單，不另存行情副本。full window 已查完但因新上市而少於一般 warm-up 筆數時，狀態表會記錄真實 coverage，後續帳戶只做必要 tail refresh，不再重抓完整歷史。若 Yahoo 已有較新的 session metadata、卻因當日 `close=null` 漏掉台股日 K，Worker 只補該日 TWSE／TPEx 官方 OHLCV（盤中可暫用 MIS）；來源優先序為官方收盤、MIS、Yahoo，低順位資料不得覆蓋已保存的官方 K 棒。

目前依 Cloudflare 官方 Free 限額設定驗收門檻：Workers requests 不超過每日 `100,000`、每次一般 invocation CPU 不超過 `10 ms`、D1 rows read 不超過每日 `5,000,000`、rows written 不超過每日 `100,000`、總 storage 不超過 `5 GB`。任何單項接近 80% 時先停止擴大名單並重新量測；超過上限時 task 不得標為完成，應先修正寫入／輪詢策略或提出 Workers Paid 決策。

`npm run cloudflare:budget` 的穩態模型以 3 位成員、每人每日前景使用 8 小時、最多 8 圖且以日 K 為正常工作量；部署安全門檻為每日 requests `50,000`、D1 rows read `3,500,000`、D1 rows written `50,000`。籌碼日資料只有數值或 material provenance 改變才寫入，單純 `fetchedAt` 較新視為 no-op；當日來源尚未發布時保存真實 source date 並冷卻 30 分鐘。這個靜態模型不能取代 CPU 與真實帳務統計，長時間密集使用分鐘 K、成員數增加或背景回補量放大時，都必須重新量測。

Sites 保留站的舊 D1 曾由 runtime 先補齊本益比欄位，但 Sites migration journal 未必包含 Cloudflare 專用的 `0018`。使用 Sites plugin 標準 helper 建立 archive 後，必須再執行 `npm run sites:prepare-archive -- /absolute/path/site.tar`，將該 migration 轉為可稽核的 Sites baseline marker；不得直接刪除 migration 或手動改 archive。Cloudflare workflow 不執行此步驟，仍使用原始 additive migration。

### 一次性個人資料遷移

來源 snapshot 與 mapping 都是本機敏感資料，不得提交。未取得每個來源 user 到目標 Google email 的逐一確認時，只能 dry-run：

```bash
npm run personal-data:migrate -- --snapshot '[REDACTED_SECRET]' --mapping '[REDACTED_SECRET]'
```

dry-run 只輸出 row count、SHA-256 與去識別 sample key hash。只有 mapping 已授權且已先保存可恢復備份時，才可在不留下 shell history 秘密的環境加上 `--apply`；工具從 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_API_TOKEN` 讀取 target 設定，寫入後逐列回讀核對 hash。任何缺漏 mapping 或 target 設定都會停止且不寫入。

## 回滾

應先停止 GitHub Environment promotion，再以 Cloudflare deployment history 回滾 Worker code。D1 migration 採 additive／backward-compatible，不能用 code rollback 反向刪除資料。Codex Sites 是獨立 target，不受 Cloudflare 回滾影響。

Realtime 事故的第一步是關閉 `SHIOAJI_REALTIME_ENABLED`，再停止小馬 gateway；瀏覽器會回復既有 Yahoo batch 路徑，不能刪除 `candle_history`、Durable Object migration 或 Sites 資料。程式回滾以 `baseline-pre-shioaji-realtime-2026-07-31` 為已保存基線，仍須從該基線建立 recovery branch、通過完整 gates 後才部署。
