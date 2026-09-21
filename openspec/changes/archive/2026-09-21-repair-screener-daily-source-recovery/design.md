## Context
2026-09-18 本機 API 回傳 pending/invalid_source，預期日仍為 9/17，合法日 9/16；操作員政策 source_blocked 跨日保留。
## Goals / Non-Goals
恢復真實資料並避免將未發布誤列驗證失敗。不降低欄位、日期與涵蓋率驗證，不清除失敗計數。
## Decisions
恢復必須由明確 CLI 旗標觸發，持有既有 lease 且冷卻已到期，將原政策複製為獨立不可覆寫紀錄；一般排程仍尊重 blocked。只有結構合法且所有日報資料表皆空的當期報表視為尚未發布。
## Risks / Trade-offs
恢復後來源仍可能阻擋；此時重新記錄並停止，不假造篩選結果。
## Migration Plan
測試通過後執行一次既有本機更新器並驗證 API 與畫面。
## Open Questions
實際恢復結果待驗收。

## 多視窗查詢退化
實測同來源三個分頁各開行情與商品更新兩條 SSE；API 直接查詢約 0.3 秒，兩個瀏覽器頁面皆逾時。改用同來源 SharedWorker 按 URL 共用傳輸，保留原有分頁重連與訂閱邏輯，最後用戶離開才關閉。不支援 SharedWorker 或外部 API origin 時維持原傳輸。Chrome 原頁控制逾時，仍須完成原頁驗收，不能以其他瀏覽器成功取代。
