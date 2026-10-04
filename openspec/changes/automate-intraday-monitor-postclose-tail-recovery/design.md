## Context

固定 Stage 160 正式擷取在 13:34:30 後才封存一般 13:30 或延後 13:33 收盤 KBar。現有 `direct-160-tail-gap-review.mjs` 可由人工對最多 4 檔、各自連續至多 5 分鐘的尾端缺口執行盤後雙抓，並建立不具通知權限的衍生審閱；目前沒有自動接到日常收尾。另一條 13:35 盤後基準流程已能驗證同日 160 檔資料並供下一交易日使用，但不能倒填當日 live capture。2026-10-02 原始 capture 保留 160 檔各 269 筆 live observation；當日盤後基準另於 13:48 驗證 160／160。這兩種證據具有不同來源時間與驗收資格。

本 change 應依賴既有 simulation business session、固定 cohort、官方交易日與 immutable capture／baseline artifact，不新增行情訂閱，也不改寫原始失敗檔或 SQLite live observation。

## Goals / Non-Goals

**Goals:**

- 在收盤定稿後自動分類尾端缺口，對符合既有 Stage 160 受限政策的少量缺口執行可稽核的衍生審閱。
- 對多檔同時缺尾盤等超出例外政策的情況，仍可在已驗證來源到齊後提供獨立、具 provenance 的盤後資料復原結果。
- 將「盤中收到」、「盤後補齊」、「正式 live 驗收」三者分開儲存、投影與顯示；保留原始失敗與當日警示。
- 重用同日已驗證的盤後資料與既有有界重試收據，避免為 160 檔再建立重複、無界的來源流量。

**Non-Goals:**

- 不放寬既有最多 4 檔、各最多 5 個連續尾端分鐘的 Stage 160 衍生 GO 政策；整批復原不取得該資格。
- 不把補值寫入原始 live observation、改稱 `liveDelivered=true`、追補盤中結果／通知，或以此取代跨交易日真實 live acceptance。
- 不提供盤中歷史 polling、第二個 broker login／訂閱、production／CA 或交易寫入。

## Decisions

### 1. 先保存原始收尾，再以獨立工作分類

只有同日原始 capture 已結束、13:34:30 已過，且可驗證 capture hash、trade date、cohort、generation、09:01 canary 與安全 Gate 時，才建立以 `tradeDate + sourceCaptureHash` 識別的復原工作。分類結果至少區分 `complete_live`、`bounded_tail_candidate`、`correlated_tail_failure`、`non_tail_or_ineligible`、`source_pending`。前者不需補救；缺少開盤或中段分鐘時不得套用尾端政策。多檔同時缺口只描述為「相關尾端失敗」，除非安全的 sink reason 證據足夠，不猜測均為 freshness 問題。

復原 claim、嘗試、來源等待與結果採 append-only、同一 capture hash 冪等；原 capture、產品 failed phase、08:50／13:40 排程與通知收據均唯讀保留。選擇獨立工作而非在原始 capture 寫回，是為了保存事發當時的 live 真相。

### 2. 少量缺口沿用既有衍生審閱，整批缺口只做資料復原

`bounded_tail_candidate` 必須完全符合現有政策：最多 4 檔、每檔只缺 13:26–13:30 內連續至最後的至多 5 分鐘；所有前綴分鐘仍為 live、同一商品與 cohort。驗證通過後可呼叫既有審閱與 replay，另存 `bounded_post_close_tail_repair` 衍生 artifact。這只取得現行 Stage 160 政策既已允許的 derived acceptance，不改變原始 live capture 的失敗判定。

`correlated_tail_failure`（例如 160 檔皆缺 13:30）即使逐檔可由可信盤後資料補齊，也只能產生 `postclose_data_recovered` artifact；原 `formalAcceptanceEvidence=false`、當日 live 完整性與跨日驗收 task 不升格。非尾端缺口、前綴衝突、未證實 zero、收盤編碼未知或來源不可用則保持 partial／failed。

### 3. 優先核對已發布的同日歷史基準，不為整批再次雙抓

工作在原 capture 結束後等待既有 13:35／14:15／14:55 有界基準流程的 append-only verified receipt；不能以 claim、HTTP 200 或正在寫入的 staging 檔代替發布成功。讀取時重驗來源交易日、下一適用日、TWSE／TPEx 商品身分、固定 cohort、來源版本、兩次獨立擷取 hash、270 分鐘 canonical coverage、可信收盤總量與逐筆核對證據。若目前 manifest 未保存某項必要欄位，該商品保持 `source_unverified`，不得由推測補齊。

對每檔以歷史累積量逐分鐘精確比對原 capture 已接受的完整 live 前綴，僅複製確定缺失的連續尾端到**獨立衍生檔**，標記 `liveDelivered=false`、原始 capture hash、來源 manifest hash、每個缺口與收盤模式。合法 13:33 只併入 canonical 13:30，不產生 13:31–13:33 的額外分鐘。沒有 verified 基準時只等待既有受限重試完成；不自行對 160 檔發起第二輪完整採集。少量缺口若使用既有雙抓路徑，也必須受共享流量預算與同一 session 限制，避免與基準工作競爭來源額度。

### 4. 資料可用性與驗收資格分別投影

新增獨立 recovery 狀態與查詢，不修改 `intraday_monitor_observations` 或既有 live trigger ledger。API 對每一列明示 `source=live` 或 `source=postclose_verified`、`liveDelivered`、source trade date、verifiedAt 及原始／衍生 artifact hash；若沒有衍生檔則只顯示原始缺口。UI 顯示「盤中至 13:29；13:30 已盤後核實」與「正式 live 驗收未通過」等不同狀態，不把盤後補值列入即時結果或今日通知 Gate。

正常當日 complete live、既有受限 derived acceptance、整批 postclose data recovery 與下一日 baseline usable 使用不同欄位；任一欄位為 true 不推論其他欄位為 true。這使使用者能利用已驗證的資料，也保留何時收到資料的真實性。

### 5. 回歸與真實驗收分層

以保存的 2026-09-16 單檔兩分鐘缺口、2026-10-02 整批一分鐘缺口與中段缺口作唯讀測試輸入；原檔 SHA-256 必須不變。測試雙抓漂移、live 前綴不符、13:33、零量證明、來源待發布、重試耗盡與冪等。離線測試可驗證分類及衍生規則，但自動化排程、發布後時序及 UI 狀態仍須下一適用交易日以真實 simulation 收據驗證；不倒填 2026-10-02 的 live acceptance。

## Risks / Trade-offs

- [盤後來源比 13:35 更晚才穩定] → 顯示 `source_pending`，只隨既有有界嘗試推進；資料真正 verified 後才發布，不能承諾固定秒數內完成。
- [整批 160 檔重抓消耗額度] → 優先重用已驗證基準及其原始雙抓證據，不另開第二條完整採集。
- [來源雖完整卻與 live 前綴衝突] → 逐檔拒絕並保留兩份證據，不由單一來源覆蓋另一來源。
- [將盤後補值誤當盤中觸發] → 分離 repository／欄位與 UI，強制通知、retroactive trigger、broker write 權限為 false。
- [既有基準 manifest 不足以證明雙抓或零量] → 保持 unknown 並補強未來來源契約，不用單一成功旗標代替逐檔驗證。

## Migration Plan

先以唯讀方式對 9/16、10/2 原始 capture 做分類與衍生規則回歸，再於未來交易日把復原工作接在正式 capture 收尾與盤後基準 verified receipt 之後。新狀態採附加欄位；舊 UI／API 缺欄時維持「未驗證」，不得預設已復原。停用此功能只停止新復原工作，既有原始與衍生檔仍可唯讀稽核，不回滾或刪除證據。
