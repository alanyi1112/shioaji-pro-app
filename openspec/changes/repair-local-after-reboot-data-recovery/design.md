## Context

唯讀盤點見 outputs/acceptance/reboot-root-cause-readonly-20261023-235929/report.md。TDCC 原始例外 unknown，不能先假定固定 sleep 或啟動競態。日 K 68 檔僅 2 complete；v8 160 日已有 159 complete cache，10/20 pending 舊 review 卡住遍歷。

## Goals / Non-Goals

目標為確證根因、修復進度阻塞與錯誤分類，並實際驗證受控恢復。不得修改使用者休市設定、清除 blocked、放寬 hash/review/receipt 驗證或將 unknown 轉 complete。

## Decisions

診斷只記錄 allowlist code、stage、symbol、計數；不記錄原始 error message、headers 或 payload。來源快取以原 review 及取得時點契約驗證；pending 換版保持原樣並繼續其他 complete。零下載模式必須在所有網路來源入口前阻擋，受控操作保留 request 計數與前後證據。日 K 日曆整合需獨立驗證 Worker/Node 載入相依，不直接引用 Node fs 到 Worker。

## Risks / Trade-offs

實際缺日不能用程式修補冒充資料完整；需要新來源時保持 pending 並列出剩餘權限。重啟須限於確認必要的 simulation 範圍；原有自然驗收不因受控測試完成。

## Migration Plan

先封存目前 mixed tree 目標檔，再離線重現與測試；受控載入後驗收安全診斷、純重用進度與真實缺口。失敗時僅還原本 change 目標檔，不回滾無關變更或資料庫原收據。

## 實作後確認的邊界

- Worker 無法直接取得 Node loopback 的日曆；本機 Vite 入口逐次讀取現成日曆，剝除外來 proof 的 headers 與 rawHeaders 後，以既有 secret 簽署有時效的決策與日期狀態窗。Worker 驗簽；沒有來源下載。
- 既存官方 TWSE 全日公告只供上市日曆排除，不推定 OTC。快取過期／雜湊不符時不採信。
- 純重用日 K 採獨立受保護唯讀驗收入口，保留舊 SLA overdue；不將事後重驗改成準時自然完成。月來源缺件不抓來源，也不接手其他請求進行中的下載 Promise。
- 操作者單日 pending 接續須驗證完整 review chain、原列 SHA、attempts=0、無 payload、冷卻及租約已到期，並以 CAS 與原列收據保留歷史；一般排程不執行此操作。
- 10/20 來源授權有上限一筆；既有 Gate 偵測 broker_daily_usage_nonmonotonic，不能將重新啟動或較小計數當作額度重設證明，不改舊 quota identity／observations／charged。

## 盤後資料完整性與週資料分流

- 本機籌碼 discovery、預熱與 health 使用同一份已驗簽的共用日曆目標；日曆缺件即阻擋來源，不能降級成星期推算。
- 官方當日無借券成交只補尾端證據，不補零、不推定更早歷史已齊。預熱仍檢查歷史起點。
- 全市場 TDCC 週底稿與清單 68 檔分開驗證。既有排程在共用 operator／collector lease 下獨立處理公開 bulk；不受當天盤後時刻或舊歷史表單的 blocked 遮蔽，也不清除該 blocked。
- 週收集可重用三日內的原正式目錄，驗證完整列數、SQL identity、分類、來源 URL／雜湊組合、revision 與取得時間；不得重寫原目錄來源與時間。獨立恢復模式缺目錄即阻擋，不另抓目錄。
- TDCC OpenAPI 失敗時最多接一次既有官方 CSV，仍驗證市場規模、日期與完整 17 級。429 保留原 Retry-After，不切換抓取。
- 週資料發布只使用完整整批來源的實際日期；可於休市週取得週四資料，不猜週五。原日期證據不改取得時間，效期取較早者；只從既有資料發布 v2–v7，不因恢復增加日報請求。
- 來源可連線不等於契約已驗證；既有 10/20 欄位資料不以拼接方式冒充新的完整來源收據。額度用量回退仍阻擋下載。

## 原收據、載入狀態與單日待補

本機 GET 使用 request 專屬 proxy 與 WeakMap 保存已驗簽日曆決策，避免共用 D1 proxy 串用不同 request 身分。只有舊 readiness 所等待的日期在雙市場均已證明休市、目前 snapshot 對齊有效目標且雙市場完整整批收據通過時，才以唯讀投影忽略該舊等待；不回寫舊日收據為自然完成。

實際新週來源可接續已保存的歷史日期事實。新 period 的取得時間使用本次真正取得的新官方週收據，另持久化舊 period 原取得時間、效期與完整 body／雜湊，不能將舊來源重新標成剛下載。公開 source 完成與每檔缺件分開；CSV bulk 可明列少量 source missing，完整 17 級、整批門檻、日期及嚴格清單模式驗證不變。

10/20 的單日授權以不可變 hash 記錄綁 cache/date、原列與原 review，最多一次來源嘗試。既有背景程序僅在授權存在且 attempts=0／無 payload、完整 verified review chain／CAS 條件通過時接續 review；每次來源前仍通過原安全與集中額度 admission。來源嘗試失敗也消耗這一次，之後不沿原十八次上限重抓。缺件、破損、擴張上限、到期皆阻擋；純重用模式優先維持零下載且不換綁。沒有新增排程或修改配額、用量高水位、charged 或 quota epoch。

本輪補資料授權允許必要官方來源讀取；主監控 baseline 的 reuse_existing_only、零下載、休市設定與未完成自然驗收不變。來源年度快取到期後，以兩個既有官方來源更新相同 10/27→10/28 日曆身分，無需重綁核准或重載 5173；唯讀 Gate 實際通過。

## 10/24 用量銜接修復

確證的阻擋根因是將沒有 quota epoch 的 API 原始用量，直接與持久額度身分內的高水位比較。10/22 高水位 40,156,072 bytes、身分 local-daily:2026-10-22；重開機後同帳戶、同上限的原始計數降至約 0.34 MB。原實作既拒絕回退又沒有不清帳的跨程序接續方式，因此一直卡在 nonmonotonic。沒有跨回退瞬間的完整觀察，不能進一步宣稱是券商按日重設或程序初始化所致；既有大量 network_unreachable／business_session_failed 是另列的歷史服務異常，非已證實的計數下降原因。

原始計數與保守扣帳分開保存於具雜湊的 counter，沿用原 quota epoch 及帳戶 HMAC。首次跨程序須找到與舊高水位、generation、時間與帳戶完全一致的原始收據；原政策與 simulation／業務連線／穩定 generation 仍由既有 port 驗證。跨程序保守值為前段全額加新段全額，同程序只加原始增量；不以 generation、日期或較小計數發放新額度。正常消費者可自動接續後續重開機；新正式 quota identity 仍須原本的合法 reset witness 與遷移流程。

CAS 在同 transaction 核對 counter 原 body、原觀察及目前正式 head，依序更新 counter、單調觀察及 append-only 收據。帳戶／上限不符、缺件、破損、舊 generation 重播、同程序回退、時間倒退、超額、並行輸家皆 fail closed。原 reservations、政策承諾、quote reserve、估量倍率、rate limit 與單日一次來源限制完全不改。跨程序可能重複計入部分用量，選擇保守拒絕而不發放退款。

本次沿原身分啟用後，集中 Gate 通過，10/20 來源實際取得一次並記 charged；v8／v9 發布至 10/22。沒有重啟 API、watchdog、5173、5174 或修改凍結 bundle，未完成自然驗收仍保留。

回復僅還原本輪來源檔；counter、原觀察、charged 與已取得的正式資料不得清除。舊版在較小原始計數下會重新 fail closed，不能為了回復而降低高水位。保留新舊收據及正式發布；本輪前的逐檔備份與驗證見 outputs/acceptance/broker-reboot-continuity-20261024/。

## 版本相依與離線提交邊界

A 保留跨程序額度帳本，B 在其上保留原快取收據、pending 接續及單日一次限制；C 再接上 Node／Worker 日曆簽署、驗簽、日 K 純重用與籌碼完成交易日；D 最後加入 TDCC 安全診斷、目錄重用與週資料發布。`app.ts` 依 C／D 分別提交日曆與診斷差異，避免把不同批次混入同一提交。

隔離驗證以實際 Git index 匯出的完整 tree 執行，只連結本機既有依賴，不安裝套件；預載守門拒絕 fetch、HTTP(S)、socket、TLS 與 DNS。C／D 均使用已提交的 ES2017 設定通過完整 MultiView 型別檢查，不依賴工作區未提交的 ES2020 改動。既有 current-session cooldown 差異及其來源／測試保留工作區，D 不包含這項功能。提交 blob 必須與已測 index 完全相同；原自然載入與休市設定保護檔不得改變。
