# 三組前端功能本機提交（2026-11-04）

## 提交範圍

使用者於三案歸檔後另行授權 commit；先前結案文件中的「沒有 commit／push」描述歸檔當時狀態，原歷史敘述保留。本輪建立功能與規格兩個本機提交，不 push，不重啟服務或操作行情。

功能提交：`85035904c7b44b328291330450c5cccebfe47465`。納入 K 線傳輸分流、SMA240 與展示日線、三行資訊隱藏、自選清單左鍵單雙擊、每頁自動更新與狀態交接，以及必要的原 HMR／canonical 選取依賴，共 50 個來源／測試／設定檔案。

## 混合變更的邊界

六個共享路徑以 Git blob 精準建立 index 內容，沒有覆寫工作桌：

- `src/App.tsx`：只取清單 URL、原商品／圖表交接，保留未提交的訊號欄位與響應版面工作。
- `src/lib/workspace.ts` 及其測試：只取 saved-profile 的載入與不覆寫預設版面邊界，不納入 signal-chart／欄位。
- `scripts/stock-screener-gateway.mjs`：只取展示日線 middleware，不納入機構篩選狀態或 drain observer。
- `vite.config.ts`：只取版本 plugin，不納入名單 consumer、量比 gateway、drain 或其他 runtime 接線。
- `vitest.kbar-loading.config.ts`：只新增本次 transport 測試，保留 HEAD 既有其他測試集合。

四個未完成大案的 51 檔、其他監控／預算／資料恢復程式、AGENTS、fixture PNG、outputs、私人設定／憑證、建置產物均未納入這兩筆提交。工作桌仍有原未完成變更，不宣稱乾淨。

## 實際 index 隔離驗證

由準備好的 Git index 匯出隔離候選，使用既有依賴但分開 cache／建置產物；逐一核對被測 bytes 與實際 index blob 完全相同：

| 檢查 | 結果 |
| --- | --- |
| K 線 transport／既有 HEAD 回歸 | 54／54 |
| 日線／指標／設定 | 111／111 |
| 版本／交接／URL／workspace | 35／35 |
| Chromium hook／圖表／清單 | 76／76 |
| 日線 gateway／版本 plugin Node | 7／7 |
| App 與 Node 型別檢查 | 通過 |
| Vite build | 通過；保留既有 BigInt target／chunk 警告 |
| OpenSpec strict（實際 index 候選） | 77／77 |
| staged diff check／秘密掃描 | 通過 |

本輪候選只含 HEAD 加本次精確提交集合，未納入原工作桌其他未提交規格／change，因此 strict 77／77 與前次工作桌 86／86 分列。本輪候選測試集合與前次混合工作桌不同，數量不能拿來宣稱未納入的功能已驗收。前次工作桌的 3 個 Node 型別問題來自未提交的另一條 runtime 接線；隔離候選未納入該段，因此兩份型別檢查通過。未修改那條未完成接線或其原失敗紀錄，也未將 fixture 或 build 冒充新的實際行情／自然排程驗收。

規格提交只納入三案歸檔的 20 檔、五份正式規格、四份原驗收文件及本紀錄；既有其他 change 的刪除／搬移與未完成任務保持未暫存。完整本機 bytes、測試 log、partial path 清單、秘密掃描與 commit receipts 位於 `outputs/ui-commit-20261104`，不提交該證據目錄或原始行情。
