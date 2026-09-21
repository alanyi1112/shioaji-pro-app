## 1. Session 與 publication 狀態模型

- [x] 1.1 建立可注入 clock 的 `Asia/Taipei` 盤前／盤後候選交易日純函式，依官方 TWSE／TPEx 共同交易日曆產生 `expectedSessionDate`，並以測試涵蓋 13:59、14:00、週末、國定假日、臨時休市與跨年日曆缺口。
- [x] 1.2 建立兩市場 publication readiness 純函式與版本化 checkpoint schema，區分 `pre-close`、`source_not_published`、單市場完成、雙市場完成、invalid、blocked、rate-limited、effective 落後及同日已發布 noop。
- [x] 1.3 為 readiness checkpoint 加入 single-flight、至少 20 分鐘 `nextAttemptAt`、每候選日最多 18 次 publication probe、官方 `Retry-After` 優先及隔日候選日重置測試。

## 2. 本機收集與發布流程

- [x] 2.1 移除 operator 與 daily collector 兩處台北時間 18:00 硬門檻；14:00 前維持零當日報表請求，14:00 起才允許探測候選日，collector 只接受來源實際回傳且不在未來的日期。
- [x] 2.2 使用 date-specific TWSE `MI_INDEX` 與 TPEx `dailyQuotes` 對候選日進行有界並行探測，驗證 exact date、既定 schema、完整列數、母體 market coverage、hash 與 provenance；舊日期／查無今日資料不得寫成今日 receipt。
- [x] 2.3 將每市場 readiness、attempt、`nextAttemptAt`、`expectedSessionDate` 與最後共同 `effectiveSessionDate` 寫入既有 `screener_runs`，重用已完成 receipt，且不得保存秘密或未受控原始 payload。
- [x] 2.4 只有 D／P 兩期的 TWSE、TPEx receipt 都完整時，才以既有 `resolveEffectiveSessionPair` 與 CAS 流程發布 v2；維持 v3／v4 OHLCV 與 D 對齊，禁止單市場較新、跨日期或跨公式 snapshot 成為最新版本。
- [x] 2.5 確認既有每 5 分鐘 runtime 喚醒只在 readiness 到期時實際請求，同日完成後 noop；不得新增 LaunchAgent、broker 訂閱、TDCC 長歷史工作、交易寫入或服務重啟。

## 3. API freshness 與選股介面

- [x] 3.1 讓 v2／v3／v4 status／results route 從 maintenance readiness 提供目前 `expectedSessionDate`，從 immutable snapshot 提供 `effectiveSessionDate`、P／D 與 createdAt；GET 必須保持 DB-only 且不得 dispatch 背景工作。
- [x] 3.2 expected 晚於 effective、單市場未就緒或技術資料未追上時，回傳可區分的 pending／stale reason、逐市場狀態與最後合法日期，並確保 rows 不可點選、不可加入清單也不被描述成當期符合。
- [x] 3.3 更新選股面板顯示「成交量比較：P → D」及「有效資料日：D」；僅在落後時另顯示「預期資料日」、逐市場等待原因與最後快照時間，移除會混淆 expected／effective 的單一「有效交易日」標籤。
- [x] 3.4 維持歷史快照、cursor、條件指紋與 selection generation 隔離；UI 重整或瀏覽器時間變化不得改寫日期、重新詮釋舊 rows 或觸發 provider 請求。

## 4. 自動化回歸驗證

- [x] 4.1 更新 operator／collector 測試，證明 14:00 前零當日報表請求、14:00 起不受 18:00 阻擋、官方尚未發布時 20 分鐘冷卻、429／CAPTCHA fail closed、單市場完成不發布及雙市場完成原子推進。
- [x] 4.2 增加 2026-09-03 fixture：舊快照為 P=9/1、D=9/2，兩市場 9/3 正式日報完成後 MUST 推進為 P=9/2、D=9/3；不得再回傳舊倍數或把 9/1 稱為上一交易日。
- [x] 4.3 更新 publisher／repository／route／API 測試，涵蓋 expected 與 effective 分離、v2 可用而 v3／v4 preparation pending、同日重複喚醒 noop、cursor 固定及 mixed-session 拒絕。
- [x] 4.4 更新 browser 測試與 screenshot，驗證 ready、awaiting TWSE、awaiting TPEx、雙市場 pending、offline 及 stale 歷史 rows 不可操作；檢查 600 CSS px 高度、鍵盤操作及無 console error。

## 5. 本機 live 驗收與收尾

- [x] 5.1 在不停止或重啟 simulation API、watchdog、5173、5174、盤後 pipeline 與行情連線的前提下，執行一次本機盤後 maintenance，保存非敏感的官方回應日期／hash、兩市場 receipt、readiness checkpoint 與發布 snapshot evidence。
- [x] 5.2 核對本機 D1、status／results API 與實際選股 DOM：當兩市場今日報表完整時，P MUST 是前一官方交易日、D／effective MUST 是今日；若來源實際未齊，僅勾選已驗證的 pending 行為且不得虛報 ready。
- [x] 5.3 實際篩選代表性上市、上櫃及未加入清單商品，核對全市場守恆、日期／成交量重算、stale 操作鎖定、指定 K 線連動與 console，確認未改寫自選清單、TDCC 佇列或交易狀態。
- [x] 5.4 將非敏感 live evidence、未完成阻礙與回復方式寫入 `verification.md`，只勾選實際通過的 tasks。
- [x] 5.5 執行完整 `npm test`、`npm run lint:multiview`、`openspec validate --all --strict` 與 `git diff --check`，確認沒有未解釋失敗後才可宣告 change 完成。
