# 交易日曆視窗 UI／UX 修正驗證

2026-10-23，Asia/Taipei。本輪依使用者截圖要求修改視窗尺寸、說明字級與文案，只改前端排版及本案文件，不更動資料／日曆契約、正式runtime、排程、observer或雲端站台。

## 原問題與修改

原`hud-header`以15rem共用選單包入36rem表單，外層與內層各有捲動，且h3／p使用瀏覽器預設大小與段落留白。結果為內容超出窄容器、水平裁切與操作被大量說明推離。

- 改為專用非模態`MarketCalendarMenu`，寬度上限720px、四周至少16px，最大高度依100vh／100dvh限制。只有內容區垂直捲動，標題、關閉鈕與頁籤固定可達；不加會吞點的透明遮罩。
- 「特殊休市」與「資料檢查」分頁；窄於520px表單單欄。標題1.125rem、表單0.875rem、說明0.8125rem，沿用使用者字級與主題。說明精簡為短句，詳細影響可展開；移除預設段落大留白。
- 保留人工來源、日期／市場預覽、原因必填、再次確認、不補抓／不補跑／不恢復排程提醒。今日撤銷單獨顯示即時工作仍阻擋；長清單選擇撤銷後捲回表單，避免操作位置不明。
- 檢查結果先顯示中文狀態與數量，未提供的數量以「—」呈現，不把unknown當零缺漏；代碼／版本／明細收進展開區。partial、complete的資料範圍限制仍保留。
- 具名關閉鈕與Escape返回觸發鈕，頁籤支援左右鍵／Home／End；外側點擊只關閉，原目標仍一次執行。開啟／切頁不自動讀取，檢查與保存仍由明確按鈕觸發。
- 內嵌的`SpecialMarketClosuresSettings`共用同一排版；API及backend程式未修改。表單busy期間停用欄位，保存仍用原expectedRevision與市場確認。

## 實際驗證

使用既有Node24.19與依賴，沒有安裝套件。下列browser測試採Vitest自己的隔離伺服器與fixture／fetch stub，未開啟或刷新現有5173頁、未發正式HTTP／行情請求或寫入真實休市設定。

```sh
/opt/homebrew/Cellar/node@24/24.19.0/bin/node node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts src/components/market-calendar-menu.browser.test.ts src/components/special-market-closures-settings.browser.test.ts src/components/nonblocking-popovers.browser.test.ts src/components/hud-header.browser.test.ts
/opt/homebrew/Cellar/node@24/24.19.0/bin/node node_modules/typescript/bin/tsc -b --pretty false
/opt/homebrew/Cellar/node@24/24.19.0/bin/node node_modules/vite/bin/vite.js build
OPENSPEC_TELEMETRY=0 openspec validate add-manual-special-market-closures --strict
git diff --check
```

- 17:45最終行為回歸：4檔 **28／28 Chromium測試通過**。涵蓋專用視窗9項、原設定新增／撤銷／讀取失敗／明確檢查4項、原外點直通7項與既有header選單8項；最後一輪包含unknown數量仍為「—」的斷言。
- 尺寸：1280×800標準、900×600特大、856×1128特大、390×640特大、320×480特大、1024×360特大；特大為root20.8px（1.3）。正常表單另驗1280×900深／淺色。DOM幾何與scrollWidth實測無橫向溢出，僅一個可捲內容區，長清單／說明末端可達且關閉鈕實際命中。
- 長原因12列、長日曆版本與20個缺漏日期明細；展開、捲至底、選擇撤銷返回表單、切頁與結果失效均有檢查。開啟與切頁fetch stub計數0，明確讀取／檢查各1；不代表真實服務流量計量。
- 主專案完整TypeScript檢查通過；Vite build exit0。build仍輸出既有target／BigInt及bundle提示，未變更build target或金融運算，也未將本輪當作無警告build。
- 此change OpenSpec strict及全工作樹diff check通過。只改文件與前端，未重跑後端、MultiView全套或自然排程驗收；8.x完成後為21／22，原4.3仍未完成。

## 視覺原件與原失敗

已檢視隔離Chromium的深色初始、深色表單、淺色表單、長清單與窄畫面特大字級截圖。原件保留於Git忽略的`outputs/acceptance/calendar-ui-20261023/`，檔名含`calendar-ui-initial.png`、`calendar-ui-desktop.png`、`calendar-ui-light.png`、`calendar-ui-desktop-form.png`、`calendar-ui-narrow-large.png`及`calendar-ui-dark-panel.png`。內容是隔離fixture，不是使用者真實設定或正式頁載入證書。

同目錄`verification-summary.json`保存最後測試結果與截圖SHA；`build.log`保存最終build完整輸出及警告，未納入Git提交。

首輪19項中4項因截圖輸出到repo外而被Vitest的Vite fs存取限制拒絕，其餘15項通過；原失敗截圖保留在`src/components/__screenshots__/market-calendar-menu.browser.test.ts/`。改將產物寫入repo內已忽略的outputs，沒有放寬fs安全設定；19／19及最後28／28均通過。此為驗證產物路徑問題，沒有以改UI斷言隱藏排版失敗。

## 服務與範圍

本輪純lsof核對8080／5173／5174仍為PID1200／934／940，與本輪開始前一致；沒有執行runtime/status/watchdog/collector入口、重啟或signal服務。修改原始碼可能由既有Vite正常HMR提供；本輪未操作使用者已開頁，不能以隔離截圖宣稱該頁已完成HMR驗收。

保留前輪日誌驗收與全部mixed dirty work，未stage／commit／push／archive／部署，也未將UI修正勾成共用日曆自然分支或名單完整週期通過。

## 後續實機驗收

後續使用者另授權在既有交易終端驗收，結果見`verification-calendar-ui-live.md`：既有盤中選股頁已載入新版，特大字級／縮小／真滾輪及關閉通過，原偏好與viewport已復原；主分頁仍是舊版，沒有為此重新整理或新增行情請求。此追加不覆寫上方當時僅隔離驗證的界線，也不將單頁通過擴張到所有既有頁面。

再後續使用者明確允許主分頁單次重整及恢復原行情，主頁新版亦已完成實機驗收；最新見`verification-calendar-ui-main-live.md`。只重整主頁1次，原清單／IX0001、字級與尺寸均保留或復原；其他頁未操作，未修改休市設定或重啟服務。原4.3自然分支仍分開接續。
