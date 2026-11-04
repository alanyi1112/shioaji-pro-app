## Context

原生 select 的 option 事件不適合可靠區分單擊／雙擊。使用者最終指定左鍵；先前右鍵方案已被取代，不納入本案操作契約。

## Goals / Non-Goals

**Goals:** 單擊切換原分頁，雙擊僅另開相同 URL 版面入口與所選清單，提供鍵盤操作與取消。

**Non-Goals:** 替清單新增伺服器端版面關聯、複製未儲存工作區、修改清單內容或新增交易權限。

## Decisions

- 用 button／portaled listbox 取代原生 select，避免面板 overflow 裁切並能自行處理事件。
- 單擊延後 500ms；同一 option 在窗口內第二次左鍵取消待執行選取，同步呼叫 window.open，保留使用者手勢。雙擊不先執行 onSelect。
- URL 只新增／更新 watchlist，沿用原 pathname、layout、profile；`_blank` 加 `noopener`。
- URL 指定清單啟動時優先於全域偏好，但不覆寫該偏好；初始化 ID 固定，重試仍以目前已選清單優先。
- Enter／空白鍵不等待雙擊；方向鍵移動焦點，Escape 關閉且停止傳給交易快捷鍵；外點、焦點離開、捲動／resize 或卸載取消待執行單擊。

## Risks / Trade-offs

- [單擊回饋延後] → 提示使用者單／雙擊用途，鍵盤選取仍立即。
- [瀏覽器封鎖新分頁] → 僅在第二次真實點擊同步開啟，不延至計時器中。
- [指定清單已刪除] → 沿既有安全 fallback，不創建或修改服務端名單。
- [看盤版面有未儲存改動] → 本案只沿用目前 URL 的版面入口，不承諾複製所有暫態 layout。

## Migration Plan

實作與真實 Chrome 驗證已完成。本輪只補正式規格、任務及結案文件，不重新操作正式清單或重新啟動服務。

## Open Questions

本案無未決項目；原生右鍵選單及其他清單 CRUD 不變。
