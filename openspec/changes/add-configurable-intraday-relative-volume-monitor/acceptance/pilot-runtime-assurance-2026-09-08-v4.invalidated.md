# 2026-09-08 runtime assurance v4 失效紀錄

## 結論

`pilot-runtime-assurance-2026-09-08-v4.json` 不得作為正式 20 檔試辦驗收、evidence bundle 或歸檔依據。

## 原因

v4 由 Playwright 新開 `http://127.0.0.1:5173/` 後量測 K 線 canvas。後續在相同執行路徑加入 browser request 觀測，確認頁面初始化不只使用 GET，還會送出 POST，並呼叫 `/api/v1/stream/subscribe`。因此 v4 內自動填入的下列宣告不符合實際執行：

- `operations.methods = ["GET"]`
- `operations.subscriptionMutations = 0`

v4 檔案 SHA-256 為 `c5f5c0832baf64b1c50492e0d22b934c42025a26579de9f9a3ea8e869f593df2`。原始 JSON 與圖檔保留以維持失敗 evidence 的稽核鏈，不刪除、不覆寫，也不加入正式 bundle。

## 修正

runtime assurance builder 不再替呼叫端補造 GET-only operations。Playwright probe 會記錄實際 HTTP methods 與 subscribe／unsubscribe request 數；只要不是純 GET 或有任何 subscription mutation，validator 必須維持 `ready=false`。

正式盤中驗收改用不重載、不新增頁面、不改變既有訂閱的觀測方式；在尚未取得可持久化且不含敏感帳戶資料的證據前，本日 chart freshness 欄位不得標記通過。
