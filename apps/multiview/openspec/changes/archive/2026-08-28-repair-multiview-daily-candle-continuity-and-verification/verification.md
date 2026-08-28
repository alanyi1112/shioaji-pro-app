# 驗證與發布邊界

驗證日期：2026-08-28（Asia/Taipei）

## 精準變更範圍

- D1：新增 `0023_gorgeous_sleeper.sql`，只擴充 `candle_history_state` 的 continuity 欄位，保留既有 `candle_history` rows，並撤銷沒有連續性證據的舊 `full_window_complete`。
- Worker：加入台股官方月資料 parser／cache／single-flight、requested-scope continuity audit、Yahoo 動態補抓、官方 OHLCV 定點修復、payload cache 精準失效、逐商品 health 與有界批次維護端點。
- API／前端：公開有界 continuity metadata；核對文案依 scope 分成「收盤已核對」與「OHLCV 已核對」，不公開內部 repair rows 或官方原始 response。
- 測試／文件：固定大立光十日缺口 fixture、TWSE／TPEx 官方來源契約、migration、history、cache、維護流程、UI 與 runtime integration 測試。

本變更不包含 production 交易、Shioaji production、帳密／token、commit、push、部署、正式 D1 migration 套用或服務啟停。

## Migration 順序

1. 在現有 `0022` 之後套用 `0023_gorgeous_sleeper.sql`。
2. migration 保留 candle rows，將既有 continuity 設為 `unknown`、`full_window_complete=0`，等待 on-demand 或受控批次重新建立證據。
3. 部署使用新的 `quote-state-v24-daily-continuity-v1` payload cache contract，避免舊 payload 被新程式誤用。
4. 本機非 migration-managed runtime 由 compatibility helper 只補缺少欄位；Sites／Cloudflare migration-managed runtime 不走此 helper 的 schema mutation。

## Request budget 與錯誤邊界

- 每檔每次 on-demand 最多新增 6 個未快取官方月請求；已成功快取月份不占新請求額度，後續稽核從未核對月份續跑。
- 官方 GET timeout 8 秒；HTTP 429、5xx 或 timeout 每個 key 最多重試一次；錯誤維持 `unknown`，不得補造 candle。
- 批次每輪最多 8 檔、concurrency 2、使用 cursor 續跑；單檔失敗不遮蔽其他商品結果。
- 成功月 cache 6 小時、尚未發布 5 分鐘、provider failure 60 秒；相同 symbol／month 共用 single-flight。

## 自動化驗證

- `npm run lint -- --quiet`：通過。
- `npm run build`：通過；只有既有 Vite native config loader 與 Node deprecation warning。
- canonical repo `npm test`：597／597 通過；發布 repo `npm test`：595／595 通過。
- focused continuity／history／UI tests：101／101 通過。
- `git diff --check`：通過。
- `npx openspec validate --all --strict`：37／37 通過。

## 本機實際證據

- `3008.TW`、`1d`、`display_count=320`：continuity `complete`，checked range `2024-11-01`～`2026-08-28`，verified through `2026-08-28`，missing count `0`，D1 history hit，`fullWindowComplete=true`。
- 大立光問題日期依序存在：`2026-07-31`、`08-03`、`08-04`、`08-05`、`08-06`、`08-07`、`08-10`、`08-11`、`08-12`、`08-13`、`08-14`、`08-17`。
- 最新報價同日 close 相符、volume 不符，因此 API `scope=close`，畫面顯示「08/28 收盤已核對」，沒有誇大成 OHLCV 已核對。
- health：D1 available、schema current，實際列出 51 檔啟用台股；目前只有已開啟／按需稽核的 3 檔取得 complete，其餘 48 檔保守維持 unknown／notAudited。另以 `sqlite3` immutable、`PRAGMA query_only=ON` 對 live D1 做逐檔唯讀 SQL 快照，保存於 `local-d1-continuity-audit-2026-08-28.csv`。受控批次 secret 未設定，未擅自配置或執行 48 檔上游稽核。
- Browser：3008／2454／4768 日 K panel loaded；console error／warn 為 0。3008 主圖、技術副圖、籌碼副圖 plot canvas 均為 `x=9,width=232`，價格軸均為 `x=241,width=72`；backing store 為 CSS 尺寸 2 倍，沒有 0 尺寸的可見 canvas。
- 較大 display window 使用既有 D1 history；自動化 viewport contract 證明縮放、平移、history 擴張與延遲 refit 不會重設使用者 accepted logical range。

## Rollback

- 程式可回退到上一版；新增 D1 欄位與官方來源 rows 保留，舊程式可忽略，不執行破壞性 schema 降版。
- 若官方來源異常，停用新程式路徑或回退程式即可；continuity 維持 `unknown`，不刪除 history、不補假資料。
- payload cache 使用版本化 key；回退後舊版會使用自己的 key，無須大量刪除其他商品／interval cache。

## 正式發布與雙環境驗收

- 使用者於 2026-08-28 明確授權完成剩餘 commit／push、Sites 保留站、Cloudflare 正式站、正式驗收與 archive。
- 發布 repo 以 `8033515fef52a140fa39747eb04c207285d0eaaa` 部署 Cloudflare；GitHub Actions run `33167246404` 成功，包含 lint、完整測試、strict OpenSpec、migration、精確 Worker 部署及保護存取 smoke。
- Sites 保留站來源以保留既有 `a341ecf` 歷史的整合提交 `04f4179ec4a3fbacd9788a41a21d66756b6120a2` 發布；該提交 tree 與 `8033515` 完全相同。Sites version 189、deployment `appgdep_6a9171f917148191b889b817a645cb66`、environment revision 14 均成功，正式 URL 為 `https://quote-chart-multiview.alanyi1112.chatgpt.site`。
- 雙環境 protected acceptance workflow run `33167625607` 成功；Sites 與 Cloudflare 皆回報 `3008.TW`：audit `complete`、missing `0`、verified through `2026-08-28`、指定 12 個日期完整、160／320 根重讀皆為 D1 hit、核對 scope `close`、逐商品 health `complete`。
- 驗收 route 只輸出有界日期、根數、continuity、cache 與 verification scope；測試確認不含 candles 或 OHLCV 明細。Sites 使用其保護存取與獨立 audit secret，Cloudflare 使用既有 Access service principal 與獨立 audit secret；秘密值不進 repo、log 或驗證文件。
- Sites 實際 DOM：`3008.TW / 日 已載入`、`data-continuity-status=complete`、顯示「08/28 收盤已核對」，沒有「日 K 資料不完整」提示。頁面共有 77 個 canvas、56 個可見 canvas，0 個可見 canvas 尺寸無效；console error 為 0。

## 保留邊界

- 本機其餘未按需開啟商品仍保守維持既有 continuity 狀態，不以大立光成功冒充所有商品皆已核對；正式環境可透過有界批次與逐商品 health 持續建立證據。
- 本次未啟用 production 交易、未停止 simulation API、watchdog、5173／5174、盤後 pipeline 或行情連線。
- `add-mainforce-chip-subcharts` 為獨立 deferred change，沒有納入、修改或歸檔。
