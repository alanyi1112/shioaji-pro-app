## Context

既有 HMR 只涵蓋部分重掛載分支；漏接來源事件會留下舊版，完整 reload 則可能失去目前清單與圖表設定。既有 hmr-selection-continuity 已提供 canonical 身分及短效每頁交接，本案在同一機制上擴充。

## Goals / Non-Goals

**Goals:** 本機版本偵測不依賴 HMR 事件，更新前可驗明保存，更新後恢復每頁原選擇及逐圖視窗。

**Non-Goals:** 桌面安裝包／遠端靜態站升級、行情連續性或全部 broker 實體訂閱驗收、保存交易草稿／Snapshot／帳務。

## Decisions

- 磁碟 SHA-256 與 HTML meta 分別代表目前來源和實際載入版本。15 秒本機 GET 需兩次相同候選且相隔至少 2 秒，避免短時間連續修改立刻重載；不依賴 WebSocket。服務失敗或格式錯誤時保留原畫面。
- 普通 src／public HMR 回傳空模組集合，讓 checkpointed client 決定更新時機；既有 Vite full reload 與 beforeunload 另接同一交接。設定重啟仍屬 Vite 自身生命週期，不在本次另行操作。
- 先呼叫各圖視窗 callback，再保存 trading-view 並讀回 sessionStorage bytes；保存拒絕或已知指標／畫線持久化失敗不發起自動重載。
- 同版型 scope 排序查詢參數並排除 watchlist，清單由交接欄位保存；避免同頁換清單後 scope 對不上。URL 初始化 ID 固定，避免渲染時變動引起額外清單重新初始化。
- 每頁 sessionStorage 的交接只在 reload 且同 scope／60 秒內消費一次。metadata 身分全部驗真且 owner 有效才恢復原需求；新意圖或卸載取消晚回應。
- 視窗記實際 K 棒錨點、相對 logical range、價格範圍／autoScale 與分區高度；只在同商品／週期且錨點已取得時套用。歷史前補依原錨點定位，不用不穩定的純 index。
- 已完成指標／費波設定沿原持久化；對話框、listbox、輸入、拖曳及最近一秒操作期間延後一般來源更新。

## Risks / Trade-offs

- [分頁在背景或操作未結束] → 更新延後，回到前景／操作完成後繼續。
- [sessionStorage 不可用或已知保存失敗] → 版本檢查不強制 reload，原畫面保持。
- [原圖錨點尚未重新取得] → 暫不套用該視窗，不假造歷史資料。
- [既有 Node 型別三錯與 wiring 舊斷言] → 保存基線重播及功能行為測試，不宣稱全專案 build／全部測試成功。

## Migration Plan

先前已啟用且完成實際 Chrome 受控來源更新。本輪只保存結案證據與同步規格，不另造來源變更、重載頁面或重啟原生服務；日後程式回復須精確核對共享來源邊界。

## Open Questions

本案無未決實作；全專案既有檢查缺口及四個未完成大案分別保留。
