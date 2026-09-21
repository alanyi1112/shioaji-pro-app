# 2026-09-18 真實資料驗證

## 問題與修正
- 原 Chrome 兩個選股頁顯示查詢逾時；本機 API 是 pending/invalid_source，不是合法的零檔結果。
- 日報 readiness 停在預期 9/17、合法 9/16；TPEx 錯誤 invalid_source_payload。operator-policy 自 9/17 source_blocked 持續保留。
- 新增 --recover-blocked-source：明確操作員要求、冷卻到期、持有 lease 才恢復，原政策與 hash 保留為獨立 receipt。一般排程仍不解除人機驗證封鎖。
- 日期與格式合法但整份當日日報為空，改為 source_not_published，沿用既有退避與計數；格式錯誤仍拒絕。
- 每頁兩條 SSE 在多視窗下占用 HTTP 連線；新增同來源 SharedWorker 按 URL 共用傳輸，分頁保留原訂閱與重連邏輯，離頁釋放 port，最後使用者離開才關閉 SSE。開發熱更新清理舊 listener、timer 與 transport，避免額外殘留。

## 實際執行
20:14 補跑一次既有 stock-screener-update，取得並發布 9/17 → 9/18 真實比較資料。原始 blocked receipt 保留，未清除計數器或以其他資料庫替換。
- v2 snapshot: e81e3a34-07f1-438b-ac54-0e37d4bc3c02
- 母體 1976；上市 1084、上櫃 892。
- 條件：成交量至少前日 2 倍、成交值至少 1000 萬，其他條件均關閉。
- 符合 292、不符合 1674、無法判定 10；可判定 1966。
- API 六頁 50/50/50/50/50/42，同一 snapshot；每頁 0.247–0.372 秒。292 個代碼不重複，逐筆以整數驗證當日量 >= 前日量*2、當日成交值 >= 10000000。
- 10 檔 missing_current：1441、1589、2321、3356、3591、3710、4804、6550、8059、8277。未造資料或當成不符合。
- 完整結果：outputs/screener-recovery-20260918/verified-results.json。

## UI 證據
20:22 Codex 驗收頁成功顯示 292 檔，9/17 → 9/18。
原 Chrome 控制指令連續逾時，改用原生 Chrome AX 操作：重建卡住的重複選股頁，保留其他原頁、MultiView 與共用服務。20:26 原 Chrome 按「開始篩選」成功顯示同樣 292 檔，嘉泥、環泥等真實列；條件仍為 2 倍與 1000 萬。
未因換瀏覽器而宣稱原 Chrome 已修復；原 Chrome 成功後才記錄通過。

## 檢查
- Node operator 16/16；Vitest 4 檔 29/29（共用傳輸、既有串流世代、domain、API）。最後生命周期修改後串流 4/4 再測通過。
- TypeScript 與 pnpm build 通過；build 保留既有大 chunk 提示。
- 根目錄未安裝 eslint，未宣稱 lint 通過。
- OpenSpec strict 與指定 diff check 通過。
- runtime simulation、watchdog healthy；5173/5174 與 daily/TDCC jobs loaded，write master disabled。未停止服務、未啟用 production 或下單。

## 邊界
本次截圖條件已完成。進階 v4 技術窗尚餘 TPEx 9/16 一期，v5 尚待同一期發布；未宣稱其他未啟用條件全數就緒。來源封鎖仍須明確人工恢復，不能繞過驗證碼。SharedWorker 不支援或跨來源 API 時維持原 EventSource。
