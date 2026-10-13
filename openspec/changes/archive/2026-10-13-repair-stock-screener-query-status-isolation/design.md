## Context

面板載入先讀 v7 status；布林失敗只設定通用 error，未清除 v7 狀態。10/13 真實 v8／v9 均 ready，但截圖把布林錯誤與 v7 mixed_session_dates 合併。當次失敗原請求未保留，不斷言原根因必為逾時；另有本機實測 v8 約 7.3 秒，代理 8 秒與前端 12 秒的期限過緊。

## Goals / Non-Goals

**Goals:** 各查詢類型的日期隔離、具體安全錯誤、可取消的有界讀取、失敗後可重新查詢。

**Non-Goals:** 不更改公式／來源／profile／使用者清單，不手動補資料、不放寬資料驗證，也不將當日 unknown 商品宣稱完整。

## Decisions

- 以查詢類型管理顯示範圍，開始新類型查詢時清除其他類型的 applied／response；同類型已驗證快照可保留，但標示失敗與舊結果不可操作。初始 v7 狀態不得顯示為已選布林／五型態日期。所有回應仍以 generation 防止過期請求覆蓋。
- 以共用錯誤分類函式處理 HTTP、逾時、來源 pending 與未知 reason；只顯示白名單或有界代碼，不顯示任意伺服器錯誤字串。
- 布林及五型態 GET 的代理期限設為 20 秒，前端 25 秒，包含 fetch 與 body 讀取；其他 API 保持原期限、回應大小、同源及目的地限制。不採無界等待或自動重試，不以快照 ID 快取跳過逐檔驗證。這是查詢期限修正，不宣稱查詢計算已加速。
- gateway 失敗區分 query_timeout／response_too_large／invalid_service_response／local_data_service_unavailable。保持下游已回傳的正常 pending／503 reason。

## Risks / Trade-offs

- 全市場查詢耗時較長 → 增加有界餘裕，不平行重複查詢；取消仍 abort，保留既有大小上限。
- 舊結果可能被誤當新條件 → 明示失敗並禁止圖表／清單操作，重新成功後才解鎖。
- 共用 gateway 修改可能觸發 Vite 載入 → 未授權前先在隔離候選驗證；獲本輪授權後才寫入正式入口，其他服務不動。

## Migration Plan

先完成隔離測試，再依授權載入 5173 並唯讀查本機當日布林與五型態。保留原錯誤證據及所有背景 owner／收據；不主動重載使用者頁面或新增商品。若未獲授權，正式載入驗收保留未完成。

## Open Questions

17:53 原始請求失敗原因無原文可追溯；只以重現與本輪 evidence 確認修正涵蓋範圍。
