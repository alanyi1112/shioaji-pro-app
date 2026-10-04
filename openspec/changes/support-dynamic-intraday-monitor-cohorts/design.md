## Context

既有 Stage-160 驗收以固定 160 檔、固定順序及對應 baseline manifest 完成容量論證；產品盤前流程卻把該次 manifest 當成日常唯一合法名單。2026-09-29 的設定與驗收名單不同時，排序位移被視為大量身分不符。已知共同 149 檔的相對順序未變，差異主要是 11 檔出入及其後的索引位移；設定儲存庫沒有足夠的歷史操作者資訊，不能推定是哪位使用者更動。此 change 另立產品運作契約，不追改 Stage-160 原始證據，也不代替仍在進行的跨日 rollover 驗收。

## Goals / Non-Goals

**Goals:**

- 160 表示已核准的同時監控容量上限；每日實際名單可由當時已儲存的最多 200 檔設定決定，且單日不可變。
- 基準以 `targetTradeDate + baselineTradeDate + canonicalSymbol` 查找並逐檔核實，不以清單陣列位置代表商品身分。
- 新加入且預定隔日啟用的商品，必須在開盤前已有可供同分鐘比較的前一適用交易日完整 1 分鐘累積量基準及驗證收據。
- 每個商品的入選、等待、缺基準、資料啟用及退化狀態可稽核；不足 160 檔不得宣稱 160 檔完整可用。
- 設定變更有明確的預定生效日、來源類型及不可覆寫的修訂紀錄，跨分頁 revision 衝突仍須拒絕。

**Non-Goals:**

- 不追認任意新組合已通過 9/16 的 exact-cohort Stage-160 驗收，也不更動既有失敗／部分成功收據。
- 不提升 160 同時監控容量或 200 設定上限，不新增 Shioaji login、行情連線或交易能力。
- 不在盤中輪替、補位或以歷史 K 線回填冒充即時可用；不自動恢復先前暫移的 11 檔。

## Decisions

### 1. 分開容量核准與每日名單

保留不可變的 Stage-160 歷史 bundle、reviewer GO、原 manifest hash；新增產品運作的 `dailyCohortPlan`，欄位至少包含目標交易日、來源設定 revision／hash、按優先順序選出的 canonical symbol、候補及排除原因、容量核准版本、產生時間與 plan hash。對最多 200 個設定商品先做合法性與 eligibility 篩選，再按穩定排序選最多 160 個；只有超過上限時順序會改變入選集合。當日 plan 一旦封存，runtime 僅可取用該 plan，不能因設定或其他頁籤變動換入候補。

替代方案是沿用 9/16 exact hash 或把 160 改成 200：前者無法正常換股，後者沒有容量證據；均不採用。歷史 Stage 驗收及未來產品每日就緒使用不同欄位與文案，不共用「GO」語意。

### 2. 逐商品配對與完整性

baseline manifest 以交易日、商品代碼、市場／合約身分及來源版本建立鍵值索引。新建逐檔 manifest 的單商品 cohort 身分只由目標交易日、前一適用交易日及商品／市場決定，不綁整份每日 plan 的 hash；plan 引用逐檔 manifest ID，故單純重排或其他商品的增刪不會使原商品已驗證基準失效。resolver 先驗官方交易日關係與商品身分，再驗 270 分鐘 coverage、單位、收盤對帳、hash／provenance，最後才把該商品綁到每日 plan。缺失只使該商品 `waiting_baseline`，其他已驗證商品可保留獨立比較能力；`baselineReadyCount`、`dataActiveCount` 與 `exact160Ready` 必須分開。不得以另一商品、任意較舊日期或無界補抓代替。

替代方案是維持陣列索引但把清單排序強制鎖死；此法仍會因合法新增／刪除造成身分錯配，故不採用。

### 3. 生效時間與有界盤前修訂

上一交易日收盤定稿後，依當時設定產生下一交易日候選 plan，並在盤後先為新入選商品建立或重用前一適用交易日的完整 1 分 K 累積量基準。其後到目標日 08:35 Gate 前，設定若有新 revision，排程必須在既有 simulation business session 內對差異執行**一次有界驗證**：重用已驗證且商品／日期完全相符的 baseline，對新入選商品依既有歷史基準規則及實測資源預算完成 bootstrap。每檔新商品的 09:01–13:30 canonical minute coverage、逐分鐘累積量、收盤總量對帳、來源及 hash 都須在 08:35 前封存驗證收據；08:45 正式 Gate 再核對同一份 plan 與收據。全部必要 Gate 通過才原子封存更新後 plan；若資源、來源或時限不足，保留已核准的既有 plan、不讓未驗證商品入選，並明示設定變更尚未生效與原因。若變更包含刪除／停用已規劃商品，不能在未告知下繼續把它宣稱為使用者新設定的名單；須顯示舊 plan 與待生效設定的差異，並要求使用者確認使用舊 plan 或讓當日該商品不啟用。08:35 之後的新修訂預設排入下一適用交易日；盤中一律不熱換。

這個方案兼顧隔夜換股與盤前時限；不採用盤中自動補位，也不允許因新名單驗證失敗而回退到 20 卻宣稱 160 ready。盤中只消費已於盤前封存的基準，不為新商品臨時取得或計算基準後追認就緒。若有界驗證延誤開盤，當日變更保持待生效，不能補造 08:35／08:45 收據。

### 4. 容量與失效隔離

所有產品每日 plan 使用已核准容量設定、同一既有 session 的單一 bounded cohort 訂閱與共用觀測流；同一 session 不因商品無資料而替換訂閱或重用推定 physical headroom。盤前 control-plane、盤中逐檔 data-plane、基準與結果各自報告。某檔缺基準時不得比較或通知，但不必取消其他已合法商品的觀測。現有 `direct-160-product-runtime.mjs` 的 state schema、sink 與 Stage 驗收計數都硬性要求歷史 exact160；新產品路徑須用版號獨立的每日 runtime／adapter 接入既有共用 stream 與 evidence repository，不能把 Stage sink 的 160 檔檢查直接改成寬鬆模式。小於 160 檔的單一 bounded 訂閱與逐檔 Gate 必須先有獨立測試，才能開放。

### 5. 修訂稽核與舊設定處置

設定 mutation 以原子 revision compare-and-swap 保存，另以 append-only 紀錄提交時間、來源類型（`ui`／`local_api`／`maintenance`／`unknown`）、前後 revision/hash、增刪／啟停／排序差異、結果與去敏 correlation id。這是來源類型而非經認證的自然人身分；若呼叫者沒有可信識別，記 `unknown`。舊 revision 無法補造操作者。2026-09-29 前為驗收暫移的 11 檔及 rev8 備份均保留，透過唯讀比較與明確確認處置，不自動覆蓋 rev9 或放回名單。

## Risks / Trade-offs

- [盤前換股補建超過時間或資源預算] → 有界差異驗證，未完成則標示待生效，不隱藏失敗；維持已核准 plan 的使用須顯示差異並遵守刪除／停用意圖。
- [部分商品可用被誤讀成 160 檔全部可用] → API/UI 分列計數，`exact160Ready` 僅在 160 檔逐一具備合法基準及必要資料證據時成立。
- [變更稽核被誤當成使用者身分證明] → 只記可信來源類型，不回填無證據的舊操作人。
- [與 rollover change 的新 manifest／收據格式衝突] → 先對照其有效規格與測試，在向後相容的 schema 版本內延伸，不改寫既有 evidence；跨日 live acceptance 分開記錄。
- [回復舊程式把新 plan 誤當合法] → schema/version Gate fail closed；回復時保留所有 plan、稽核與設定，僅停止新 plan admission，不刪資料。

## Migration Plan

1. 先加入讀取與稽核 schema、符號鍵值 baseline resolver 與相容測試；舊 manifest 保持唯讀。
2. 加入每日 plan 建立／封存、資源 Gate 與狀態 API，feature-off 比對既有流程，不改動現行盤中 session。
3. 在 simulation、跨交易日真實證據及明確核准後啟用動態 admission；先驗排序不變性，再驗成員變更、部分缺基準與設定修訂時間邊界。
4. 對 rev8 備份與目前 rev9 顯示差異供使用者確認；只有新 revision 正式保存後才套用，不覆寫原備份或舊失敗證據。
5. 若新流程失效，關閉動態 admission 並保留資料／稽核供診斷；不得自動回寫舊設定、重啟 session 或宣稱歷史 Stage 驗收被撤銷。

## Open Questions

- 盤前 plan 與待生效設定衝突時，刪除／停用已規劃商品的確認介面如何呈現，需在實作前與既有 workspace 操作流程對齊。
- 差異 bootstrap 的單日查詢上限應由既有實測用量與當日剩餘額度計算，不在本規格寫死固定 byte 門檻；啟用前須取得可重現的容量證據。
