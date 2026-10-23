# 交易日曆 UI 獨立本機提交範圍

2026-10-23，Asia/Taipei。依使用者授權，只整理交易日曆 UI 為另一筆本機 commit；不歸檔、不 push、不重啟服務，不操作既有交易頁或新增正式 HTTP／行情請求。

## 相依與精準暫存

- 專用 `MarketCalendarMenu`、休市／資料檢查雙頁籤及獨立 CSS：720px 上限、視窗邊距、單一內容捲動、字級與簡短說明、鍵盤與焦點操作。
- `DismissiblePopover` 是必要的非模態關閉相依；僅加入元件，不納入其他選單或市場訊號的未提交改動。
- `hud-header.tsx` 只新增 import 與入口兩行。混合變更的 `intraday-monitor-panel.tsx` 只暫存 import 與內嵌入口兩行；不包含名單同步、動態監控或捲動結果等改動。
- `intraday-monitor-api.ts` 只暫存日曆 DTO、三個日曆呼叫函式與可指定 prefix 的既有 JSON transport。其餘監控 API 仍使用原 prefix，名單／確認／daily-status 變動不在本筆內。
- `market-calendar.ts` **只暫存既有的 `LocalCalendarCheck` 型別一行**，供 UI 請求契約引用；純日曆運算、驗證器與整合實作完整保留未提交。這是刻意的部分暫存，不是刪除工作檔內容。
- 加入兩份日曆 browser 測試、三份既有 UI 驗收報告及本文件。不納入圖片、outputs、建置產物、套件／測試設定變更或其他 active／archive change。

此筆前端可以獨立編譯及以 fixture 驗證；**不包含提供 `/api/market-calendar/v1` 的後端與本機資料整合**，實際讀取／保存仍依賴具備這些路由的既有執行環境。若路由不可用，UI 保留讀取失敗且禁止修改的行為。本筆不代表整個共用日曆功能已可從乾淨 checkout 完整啟用。

## 暫存候選驗證

將 HEAD 加上精確 index 匯出至隔離暫存目錄，只連結已安裝的依賴；沒有安裝套件或把其他 dirty 檔案複製進去。執行環境為既有 Node 24.19.0。

- `tsc -p tsconfig.app.json` 與 `tsc -p tsconfig.node.json` 均通過，build info 寫在隔離目錄。
- `vite build` 通過；此候選仍有既有的大型 chunk 提示。型別檢查與 build 使用網路拒絕 preload，未啟動正式服務或開發 gateway。
- 隔離 Chromium：`market-calendar-menu.browser.test.ts` 9 項、`special-market-closures-settings.browser.test.ts` 4 項、HEAD 既有 `hud-header.browser.test.ts` 8 項，合計 **21／21 通過**。只使用 Vitest 隔離伺服器與 fetch stub；臨時設定僅補 `@modules` stub alias，沒有載入正式 gateway、修改或暫存專案測試設定。
- 含特大字級、窄／矮視窗、長內容、無橫溢、單一捲動、末端／關閉可達、頁籤／Escape／焦點、外點直通與保存確認等驗證。fixture 保存不會寫入真實休市設定。
- 暫存 diff check、相依與檔案範圍檢查通過。原有 dirty 工作檔與受保護設定以前後 SHA-256 核對，不用還原／覆蓋混合檔案來拆 commit。

本輪不重做實機 reload／API 讀回／自然觸發驗收；先前真實盤中選股頁與主交易分頁證據隨本筆保留於 active change 的 `verification-calendar-ui*.md`。歷史報告內的測試數、當時未 commit 及請求授權，只描述各次驗收當時狀態。

## 明確保留的未完成事項

`add-manual-special-market-closures` 工作檔仍是 **21／22**，原 **4.3 未勾選**；使用者操作說明、正式設定讀回與原生自然收據／未發生分支仍按原任務接續，不以 UI 通過替代。原名單同步 6.3／6.4 與晚登入自然驗收也未變更。

未暫存／同步主規格、完整 proposal／design／tasks、後端／consumer／runtime／安裝工具或其他 change；沒有移動／歸檔 active change。本輪也沒有修改休市設定、正式 bundle、LaunchAgent、automation 或既有頁面。8080／5173／5174 純 listener 核對仍為 PID 1200／934／940，未執行 status／watchdog／collector 或任何重新整理操作。
