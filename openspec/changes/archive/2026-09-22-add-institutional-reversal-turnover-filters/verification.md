# 驗證紀錄

## 已完成的程式驗證

- `pnpm exec vitest run src/lib/stock-screener-v6.test.ts src/lib/stock-screener-condition-ui.test.ts src/lib/stock-screener-gateway.test.ts`
  - v6 criteria、時間窗、嚴格邊界、回補強度、成交參與率、偏好遷移、條件 registry 與 gateway allowlist 通過。
- `node --test apps/multiview/tests/stock-screener-chip-sources.test.mjs apps/multiview/tests/stock-screener-v5-publisher-route.test.mjs apps/multiview/tests/after-hours-d1-migration.test.mjs`
  - TWSE／TPEx 外資欄位、`buy - sell = net`、表頭漂移、重複商品、非法整數、additive migration、v5 保留、v6 immutable publication、失敗保留舊 head 與 GET 零寫入通過。
- `pnpm exec vitest run --config vitest.browser.config.ts src/components/stock-screener-panel.browser.test.ts`
  - 三分類單一展開、兩項法人條件、全部取消、參數編輯、v6 query、投信流量語意與窄面板通過。
- `pnpm run build`
- `pnpm run typecheck:multiview`
- `openspec validate add-institutional-reversal-turnover-filters --strict`
- `git diff --check`

## 正式來源與版本邊界

- TWSE 使用 T86 的「外陸資（不含外資自營商）」與「外資自營商」兩組買進、賣出及淨額，逐組驗證後再合計。
- TPEx 使用指定日期三大法人歷史表的「外資及陸資合計」買進、賣出及淨額群組。
- 新驗證版本為 `official-market-institutional-v2`；既有 receipt 的 `official-market-chip-v1` 語意不會被改寫，相同 payload 另存 mapping verification。
- 投信成交參與率定義為 `D0 投信淨買超 ÷ D0 成交股數 × 100`，是流量占比，不是投信持股比例。
- 本 change 未宣稱投資績效，也未增加自動下單、行情訂閱或清單寫入副作用。

## 真實環境驗收狀態

- 回填、v6 發布、實際 UI、公式重算及 v6 停用／v5 回退演練均已完成；本 change 的實作任務已全部完成。

## 本機 D1 migration 驗收

- 2026-09-22 已在 `scripts/multiview-state status` 所指向的本機 D1 套用 `0033_screener_institutional_reversal_v6.sql`；Wrangler migration ledger 為 34 筆且 0033 只登錄一次。
- migration 前後 `PRAGMA integrity_check` 均為 `ok`，新增 5 個 `screener_chip_daily` 欄位及 `screener_institutional_mapping_verifications` table 均存在。
- 個人資料 `user_tabs`／`user_instruments` 合計 72 rows，前後 material hash 均為 `f87d3e3cba9f757d0de9411d28c2bfbe1bd9eef2bf5ce07bf7f6b2b046ed1ba6`。
- v5 publication head 前後均為 snapshot `607fe25e-9688-4c90-9bb8-b841f406c578`、`effectiveSessionDate=2026-09-22`，head material hash 均為 `db94e69d89bddaa0f1c2f927dc019980e68d095bf29e0528c44b3bcc2f273e87`。
- migration 前建立可復原備份 `multiview-20260922T133631Z.sqlite`；版本 metadata 補寫時另建立 `multiview-20260922T133715Z.sqlite`。兩次 migration wrapper 均未停止 simulation API、5173 或 5174。

## institutional v2 回填驗收

- 有界作業以 21 個官方交易日為 targets，日期為 2026-08-25 至 2026-09-22；最新 21 個 run 全部 `complete`，合計處理 84 個市場／dataset targets，`failed=0`、`overdue=0`、remaining sessions 為 0。
- 新 mapping verification 共 42 筆，TWSE／TPEx 各 21 日皆為 `verified`，`invalid=0`；舊 payload hash 相同時另存 `official-market-institutional-v2` verification，沒有改寫 v1 normalization version。
- TWSE v2 coverage：target 22,764 rows、verified 22,489、官方缺列 275、invalid 0；TPEx：target 18,697、verified 16,373、官方缺列 2,324、invalid 0。缺列保留為商品層 `unknown`，沒有補零或縮小 1,976 檔母體。
- 驗收時發現舊 receipt 與 v2 verification 的 TPEx 母體計數可能不同；publisher／health 已改為以 v2 verification 欄位產生 coverage，receipts hash 同時納入 row、target、missing、invalid 計數。

## v6 publication 與公式重算

- 最終 v6 head 為 `2644de70-5431-43bc-8b43-d317c5f6496d`，`effectiveSessionDate=2026-09-22`、total 1,976、receipts hash `7a2ef4dbd6b1c9d73eaa8c118a34fdd7a4e43ee91383def385f235044162224d`。
- 由 D1 依 symbol 排序後獨立 readback 的 snapshot rows material hash 為 `4718292e050563ea612d3ce07259854b339baa3eb7fbfa96b9eeabadff2a0a25`，row count 與 metadata total 均為 1,976，`PRAGMA integrity_check=ok`。
- 規格預設外資條件：matched 1、fail 1,625、unknown 350；預設投信條件：matched 0、fail 1,626、unknown 350。零結果沒有自動放寬門檻。
- 為涵蓋代表性 pass／fail／unknown 重算，僅在只讀查詢中把日數與價量門檻調至合法低值：外資 matched 78、fail 1,639、unknown 259；投信 matched 10、fail 1,707、unknown 259。
- 外資代表列 1101.TW：今日淨買 14,828,392 股、前一日 -5,824,469 股、週轉率 0.3909787774%、量比 1.6952562692、收盤 24.55、MA2 24.35，獨立重算與 API 均為 `pass`。1102.TW 因前一日為正買超獨立重算為 `fail`；1213.TW 因 `missing_source_row` 為 `unknown`。
- 投信代表列 3044.TW：今日淨買 70,000 股、前一日 -20,000 股、回補強度 350%、成交參與率 1.6661386594%、MA2 531.5，獨立重算與 API 均為 `pass`。
- 實際驗算發現 MA evidence 曾把 canonical price scale 方向寫反；比較 verdict 原本正確，顯示值已修正並新增 `MA5=12` fixture assertion，實際 API 的 1101.TW MA2 已回傳 24.35。

## 本機 UI 與無副作用驗收

- 於 `http://127.0.0.1:5173` 實際展開「籌碼／價量」，確認兩項新條件位於正確分類、預設收合、切換條件時前一設定自動收合，且所有參數以緊湊欄位呈現。
- 外資預設顯示前 3 日、今日大於 1,000 張、週轉率 2%／2 倍、MA5、前 20 日均量 1,000 張；投信預設顯示今日大於 500 張、回補 50%、成交參與率 1%–15%，並明示「當日流量占比，不是投信持股比例」。
- 以預設外資條件實際篩選得到 3715 定穎投控；UI 顯示 `D0=2026-09-22`、前三期為 2026-09-17／18／21，今日淨買 2,457,318 股、週轉率 5.7093018604%、量比 5.0780845731、MA5 121.5，與 API／D1 日期一致。
- 預設投信條件實際查詢為零商品，UI 保留「仍有欄位缺漏」狀態，沒有自動放寬門檻或把零結果誤報為錯誤。
- 操作前後瀏覽器 console 的 error／warn 均為 0；`user_tabs`／`user_instruments` 仍為 72 rows 且 hash 維持 `f87d3e3cba9f757d0de9411d28c2bfbe1bd9eef2bf5ce07bf7f6b2b046ed1ba6`，Shioaji stream active connections 均為 40。
- 操作後 runtime 仍為 simulation，API healthy／business session available、5173／5174 listener up、smart-order obligations 0 且 write master disabled；沒有建立交易、清單寫入或額外行情訂閱。

## v6 停用與 v5 回退演練

- 以 v6 results 入口關閉 `foreignReversal`／`trustReversal`，並只啟用既有 `closeHigh` 條件後，API 實際回傳 `version=5`、snapshot `3d692a2f-e1c5-4657-9e5a-6729b7f44f4f`、`effectiveSessionDate=2026-09-22`；1,976 檔中 matched 145、unknown 163，首筆 1338.TW 的 `closeHigh` 為 `pass`。
- UI 以「全部取消」停用 v6 草稿，再啟用既有「券資比達門檻」並重新篩選；頁面顯示有效日 2026-09-22，正常列出 2221、2882、3219、3441、3717、6226、6533 等 v5 結果與證據。
- v5 與 v6 publication head 同時保持 `published`；D1 `PRAGMA integrity_check=ok`，個人清單仍為 `user_tabs=6`、`user_instruments=66`，合計 72 rows，未觸發清單寫入。
- 偏好仍由 device-local `sj-pro-stock-screener-v6` 及既有 v5／v4 migration chain 管理；回退查詢不改寫 D1 偏好來源，且 preference migration／全部取消測試持續通過。
- 演練後 runtime 仍為 simulation，API healthy／business session available、5173／5174 listener up，Shioaji stream active connections 維持 40、smart-order obligations 0 且 write master disabled。
