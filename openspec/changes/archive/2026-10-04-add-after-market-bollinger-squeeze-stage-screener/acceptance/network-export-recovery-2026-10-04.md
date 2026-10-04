# 網路紀錄匯出恢復（2026-10-04，45／47）

時間使用 Asia/Taipei。本輪依使用者要求繼續處理 7.4／8.8，沒有重複點選商品、加入清單、增加訂閱或重啟服務。

## 新的實際證據

- 使用 Chrome「顯示方式 → 開發人員選項 → 開發人員工具」可開啟 Network；原快捷鍵未造成可見狀態變化，不將快捷鍵嘗試當成成功。
- 重新開啟時，Network 只有新近請求，無法取回原 2408 圖表／雙清單操作的完整紀錄。不能用這輪紀錄追認前輪操作。
- 使用實際原生儲存面板，在 `/tmp` 指定新的基本檔名後按「儲存」，匯出成功：`/tmp/bollinger-network-export-preflight-20261004-1048.har`，821,889 bytes，63 筆，權限調整為 600。檔案包含私人帳務回應，僅留本機，不提交原始內容。
- HAR 的第一／最後請求為 10:47:15.942／10:48:03.011，並非原 10:11 的股票操作。去識別化方法／路徑計數：runtime-mode GET 11、snapshots POST 9、health GET 7、monitor status GET 5、position_unit POST 12、order/trades POST 14、account_balance POST 2、margin POST 3，合計 63。帳務／成交紀錄查詢不等同下單，這個觀測窗口也不能證明先前股票操作的零交易副作用。
- 本機 `simulation-api.jsonl` 僅保存事件分類、時間、原訊息 hash 與 bytes，`rawMessageSaved=false`。缺少逐請求方法／路徑，無法由這份日誌重建原操作的完整網路計數；不以 hash 推論具體請求。

## 保留與後續條件

原 prequery HAR、0 bytes 的失敗匯出、公告、7/10 十八次失敗及其他 failed／partial 原件全部保留。沒有改程式或放寬 task 的實證要求，因此本輪不重跑相同完整回歸，7.4／8.8 仍未勾。

已向使用者提出一次追加的有界 2408 驗收方案：操作前保存 usage 錨點、持續保留 Network，最多新增兩筆 Tick／BidAsk 及日 K 查詢，測指定圖表與雙清單後精準復原，實際匯出完整 HAR 並核對逐請求計數。原兩筆授權已用完，取得這次明確同意前不開始新的商品／清單操作。不得建立新 login／行情連線、重啟服務、production／CA／下單或覆寫使用者設定。
