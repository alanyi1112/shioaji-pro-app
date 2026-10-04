# 成交量來源百分之一容差驗證（2026-10-03）

時間採 Asia/Taipei。本輪依使用者確認實作 task 9.1，進度為 **35／42**；原本七項正式來源／預算／歷史／發布驗收仍未完成。沒有啟用策略、下載新來源、寫入正式資料庫、archive、commit 或 push。

## 已完成：規則與程式

- 新增獨立政策 `bollinger-source-comparison-volume-1pct-v1`。官方成交股數為分母，以 canonical int64／BigInt 檢查 `abs(備援量−官方量)*100 <= 官方量`，包含等號、上下方向對稱；官方量為零只接受雙零。
- OHLC、實際成交金額、日期、readiness／缺資料及來源 review／schema 不放寬。策略使用原凍結股數；來源容差不套到策略量能門檻，不校正或四捨五入原始資料。
- 官方恢復比較保留原比較值、差異股數、政策及 assessment，政策加入新 receipt hash。exact／within_volume_tolerance 均可為 matched，但完整 evidence 分開；超過容差或其他欄位不同仍 conflict。
- 新政策只追加，舊 strict conflict、原時間、失敗收據、凍結列／manifest、feature hash、head／cursor 不覆寫。相同新比較重跑 no-op。
- 唯讀 API 新增 `sourceVolumeTolerances`，保存日期／來源／hash／政策／通過檔數及最多 20 檔原值樣本；完整比較保存在帳本。decoder 重算整數容差並拒絕越界／政策／差異／日期冒改。
- 畫面明示「成交量來源差異 ≤1%，容差檢查通過」，說明策略仍用原凍結量；詳細證據可展開，舊衝突警告保持可見。

## 歷史一股樣本：數值相容性通過，不冒充重新擷取

引用前輪 `source-contract-and-budget-preflight-2026-10-03.md` 保存的 2026-02-02／2330：Shioaji **33,342,358 股**、官方 **33,342,359 股**。本輪直接呼叫正式純函式重算，得到 `absoluteDifferenceShares="1"`、`withinTolerance=true`。

沒有重新抓行情、修改兩個原值、原收據或正式 source review。這解除一股數值差異的阻礙，不證明差異根因、兩來源全部交易範圍／使用限制或 160 日逐商品相容性；前輪 strict 判定保留於原文件，由本文件記錄政策變更。

## 回歸結果

使用 Node 24.19.0。最終本輪不重複案例：

- Node 10 files **142／142**：九份 source-selection／fallback publication／daily_quotes／broker ports／provider prepare／v8 publication／prepare／retention／source-fetch 共 124 項，central ledger 另 18 項。最後程式修改後全部分組重跑通過。
- Vitest 8 files **87／87**：v8、history、query、Bollinger API、v7、v6、舊 API、chart-selection。
- Chromium 2 files **32／32**：原選股與布林面板。容差提示可見、展開 evidence 顯示原股數／政策，其他操作隔離及窄面板檢查通過。實際檢視 `src/components/bollinger-backup-source-320px-fixture.png`，窄版提示換行可讀；它是可捲動隔離 fixture，不是正式發布畫面。
- 前端 TypeScript／`pnpm build`、`pnpm typecheck:multiview` 最終通過；build 保留既有 bundle >500 kB 提示。
- 完成後 OpenSpec strict validation、`git diff --check` 及本輪新文字檔 whitespace 檢查通過。

測試包含一股、±1% 等號／超過、零量、大於安全 Number 的 int64、其他欄位／缺漏不得通過、政策與 decoder tampering、舊收據保存及快照／head no-op。所有 source review、160 日窗口與 usage／quota fixture 是隔離假設，不作正式驗收。

### 中間錯誤與修正

- 首輪 Node decoder 的新模組 extensionless import 無法解析，改為 `.ts` runtime import，重跑通過。
- 新 BigInt literal 在既有 Safari 13 build target 產生相容性警告，改用與既有整數程式一致的 `BigInt(...)` 建構，不改整數判定；最終 build 沒有這項新警告。這不是 Safari 13 實機支援證據。
- MultiView 型別檢查發現同 change 的 JS manifest policy／market 被推導為泛用 string；補明確 JSDoc 契約，無執行邏輯或來源 Gate 放寬，型別重跑通過。

## 保護範圍與未完成

本輪新外部來源／broker 請求 **0**、正式 DB 寫入 **0**；測試只使用隔離資料庫／browser fixture。18:46 左右唯讀 listener 核對 8080 PID 1273、5173 PID 933、5174 PID 938 與前輪相同；只證明 listener 未變，不宣稱此刻完整 business session 已重新驗證。未啟停服務、新增 login／subscription、改交易草稿或提交 Git。

仍未完成 **1.1、8.1、8.4、7.2、7.3、7.4、8.8**：正式來源使用／展示與雙市場歷史 review、quota epoch／其他工作承諾 producer、真實 160 日逐商品覆蓋與獨立重算、自然 watcher 發布／no-op、正式結果 API／UI 與清單驗收。容差通過不解除這些 Gate，目前不能歸檔整個 change。
