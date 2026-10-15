## Context

10/15 晚間 5174 原 PID 977 與 workerd 1435 存活但 listener 已關閉。5173 選股代理無法連到固定 5174，回傳 `local_data_service_unavailable`。單獨 kickstart 原 MultiView job 後，health 與 v2–v9 status 恢復；原 8080、5173 與排程未改動。原服務 stdout／stderr 指向 `/dev/null`，無法還原最初關閉 listener 的觸發事件。

## Goals / Non-Goals

**Goals:** 修復已證實的 listener 假存活復原缺口；原 scheduler 與安全 Gate 不變；只影響 MultiView。

**Non-Goals:** 不把未確認的最初觸發者說成已修正，不改選股公式或日期、不修補資料、不改券商連線與明日動態名單驗收。

## Decisions

- 在 MultiView Vite 程序內監看自己的 `httpServer.listening`，並以單飛、最多 1 秒的固定 `127.0.0.1:5174` TCP 握手交叉確認，避免 Node handle 存在卻無法連線。握手不傳 payload、不送 HTTP、SSE、行情或帳戶請求。尚未真正開始監聽不觸發復原。
- 已監聽後連續 60 秒不再監聽才退出失效程序，以原 launchd KeepAlive 復原；5 秒取樣、timer unref，不新增 LaunchAgent 或常態排程。
- Vite 正常重載須沿用最新 server listener，取消舊檢查，避免舊 server 的 close 造成誤判；正常 SIGTERM／SIGINT 取消防護。
- 記錄只含固定故障碼、不記請求、商品、帳戶或秘密。純狀態回歸與獨立子程序測試注入關閉，不破壞正式 listener 做測試。

## Risks / Trade-offs

- 最初關閉事件無原文 → 保留 unknown，不宣稱已證實上游套件或資源根因。
- 慢重載被誤判 → 60 秒寬限、重載停止舊觀測、僅 listener 缺席才處理；查詢逾時／資料 partial 不觸發重啟。
- 程序本身 event loop 完全卡死時無法取樣 → 明示不涵蓋此故障，不擴充成跨服務 watchdog。
- 新防護載入會讓 5174 既有頁面重連 → 僅受控載入該服務、不操作商品、不重啟其他服務；完成後核明日入口與所有 plist hash。

## Migration Plan

先單服務復原，再離線測試候選，限定載入 5174。撤回時只移除該 plugin，不改資料或排程；本輪不 commit／push。

## Open Questions

原 PID 977 的 listener 最初被何事件關閉仍未知；本修正處理已證實的失效狀態與未自動復原機制，不抹除該缺口。
