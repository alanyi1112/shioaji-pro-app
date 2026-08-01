## Context

目前 `useWatchlist` 將 `initialLoading` 綁定整個工作區 boot gate，並對初次 `fetchWatchlists()` 進行十次退避重試。Shioaji simulation 在 paper session 未建立時仍可讓 `/health` 與 SSE 本機連線看似正常，但 `/watchlist` 會快速回傳 `SessionNotEstablished`，使介面長時間停留在載入畫面且頂部仍顯示 `LIVE`。

## Goals / Non-Goals

**Goals:**

- 辨識 `SessionNotEstablished` 並立即結束阻塞式 boot gate。
- 保留工作區版面操作，清楚揭露行情、自選及交易功能不可用。
- 讓使用者可在同一頁重新檢查並於服務恢復後載入自選清單。

**Non-Goals:**

- 不以本機假行情或快取行情冒充正式資料。
- 不切換 production，也不繞過 Shioaji 的服務時間或 session 限制。
- 不重構所有面板的個別錯誤顯示。

## Decisions

1. `useWatchlist` 回傳結構化 `serviceIssue` 與 `retryService`，由 App 統一決定提示與 header 狀態。這能讓啟動資料流保持單一來源，避免 `HudHeader` 另打一套 watchlist 探測。
2. 以錯誤訊息是否包含 `SessionNotEstablished` 做快速降級分類。這是目前 Shioaji HTTP API 對 paper session 不可用的穩定訊號；其他錯誤仍沿用有限度重試。
3. 降級時不建立本機假 watchlist，只保留空清單與既有 workspace 設定。使用者可以操作版面，但不會誤認資料為即時行情。
4. 手動重試不重新開啟全畫面 boot gate，而是在提示列顯示檢查中，避免服務仍離線時再次鎖住介面。

## Risks / Trade-offs

- [Shioaji 未來修改錯誤文字] → 非特定錯誤最後仍會在有限重試後降級，只是無法立即判斷為非服務時間。
- [部分面板仍會各自呼叫不可用 API] → 本次以全域提示與交易狀態為主，面板個別錯誤仍由既有 poll 容錯處理。
- [本機 SSE 可能顯示 live] → 降級期間由全域 serviceIssue 覆蓋 header 顯示，避免誤導。

## Migration Plan

純前端相容性修改，無資料遷移。若需回復，只要移除 serviceIssue 降級與提示相關變更，即回到原本阻塞式啟動流程。

## Open Questions

無。
