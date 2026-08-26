## Context

MultiView 的 PE latest 與 history 由盤後 daily pipeline 經官方 provider、既有 fallback、canonical row 正規化與 D1 changed-only 寫入組成。2026-08-26 驗收時，TPEx latest provider 回報 `schema_mismatch`，但 health 仍可從既有 verified row 顯示 `tpexSourceDate: 2026-08-25`；這會混淆「最後成功資料仍可使用」與「本次來源解析已失敗」。目前 PE health 另有 12 個 pending、history 15 個 missing，必須先分辨來源未發布、歷史不足與程式缺陷，不能一律以回補寫入處理。

## Goals / Non-Goals

**Goals:**

- 以不含機密的實際 TPEx 回應 fixture 固定目前合法 schema 與欄位語意。
- 在 provider 邊界支援已知合法 schema 變體，正規化後仍沿用既有 canonical PE row 與 source date 契約。
- 將本次 provider 嘗試狀態、最後 verified 資料日期及 UI display date 分開呈現。
- 讓 `official_not_published`、合法空資料、`schema_mismatch` 與暫時失敗可被 pipeline、health、retry 分別處理。
- 逐商品分類 PE gap，並以 `.TW`、`.TWO` 的 API、D1 與瀏覽器線圖證據完成驗收。

**Non-Goals:**

- 不以猜測欄位、零值、forward-fill 或 requested end date 產生 PE 資料。
- 不變更 TDCC shareholder-distribution、大戶／散戶級距公式或其他 daily-chip dataset。
- 不新增外部資料供應商，不啟用 Shioaji production 或任何交易能力。
- 不為來源確實未發布或上市歷史不足的商品製造假 coverage。

## Decisions

### 1. 在 TPEx provider adapter 邊界處理 schema 變體

parser 先辨識回應 envelope 與必要欄位，再把已知合法欄名映射到既有 canonical 欄位；每一列仍必須通過商品代碼、實際資料日期、PE 數值範圍與來源市場驗證。相較於在 pipeline 下游加入寬鬆 fallback，此作法可避免未知欄位被誤當成合法資料，也不會污染 TWSE 或既有 D1 schema。

fixture 必須由實際 provider 回應去識別化產生，只保留解析所需欄位、合法範例列、未發布範例與 schema 錯誤範例，不得包含 token、cookie、帳戶或 request header。

### 2. 未知 schema 一律 fail closed，並保存可診斷摘要

若必要欄位不存在、型別不符或來源日期無法驗證，adapter 回傳 `schema_mismatch`，不得寫入 D1。診斷只保存 provider、缺少或未知欄位名稱、回應型別／版本摘要與時間，不保存完整原始 payload。已知未發布訊號則回傳 `official_not_published`，不進入 schema retry 風暴。

### 3. health 分離 attempt freshness 與 verified freshness

health 對 TPEx latest 同時呈現最近一次嘗試時間／結果、最後 verified source date、display date 與 pending reason。當本次嘗試為 `schema_mismatch` 時，最後 verified row仍可供 UI 使用，但整體狀態不得僅因舊資料存在而宣稱本次 provider 更新成功。

### 4. PE gap 採逐商品分類，不做無條件回填

盤點 12 個 pending 與 history 15 個 missing／3 個 insufficient，依 `official_not_published`、上市歷史不足、provider 不涵蓋、schema mismatch、排程未執行及真正缺週／缺日分類。只有後三類進入修正與 bounded retry；來源本身不足者保留 partial／pending 與證據。

### 5. 驗收以 parser、pipeline、D1、health 與實際 UI 串接完成

回歸至少包含一檔 `.TW` 與一檔 `.TWO`。測試必須證明：合法 schema 可解析、未知 schema 不寫入、未發布不誤報、相同資料不重寫、daily pipeline 不再對已知合法 TPEx schema 回報 `schema_mismatch`、health 可見 attempt／verified 差異，且瀏覽器 PE 線圖保留最後 verified 資料與正確 source date。

## Risks / Trade-offs

- [TPEx 再次調整欄位] -> fixture 與必要欄位 allowlist 讓錯誤立即可見；未知 schema 維持 fail closed，不自動猜測。
- [嚴格驗證增加 pending 數量] -> 以最後 verified row 維持 UI 可用，同時在 health 顯示本次失敗原因，不以假資料降低 pending。
- [完整回應含敏感或過量資料] -> fixture 與診斷只保留解析所需且去識別化的最小欄位，不保存 header 或完整 payload。
- [把來源歷史不足誤列成程式缺陷] -> gap report 必須逐商品附上上市日、provider coverage 與 reason code，再決定是否建立 backfill task。

## Migration Plan

1. 先加入 fixture 與 parser 單元測試，重現目前 `schema_mismatch`。
2. 更新 adapter 正規化與 reason code，保持既有 D1 schema 不變。
3. 更新 pipeline／health attempt metadata，以 changed-only transaction 寫入。
4. 在 simulation runtime 執行 bounded daily pipeline，核對 `.TW`、`.TWO`、D1 integrity 與 material hash。
5. 以瀏覽器驗收 PE 線圖與 source date；若任何 gate 失敗，回復程式版本並保留既有 verified D1，不執行資料清空或重建。

## Open Questions

- 實作時需以當次實際 TPEx response 確認變動的是 envelope、欄名、日期格式或資料列型別；在取得證據前不預設特定欄位。
- 目前 12 個 pending 與 15 個 history missing 中，哪些屬於 provider 不涵蓋或上市歷史不足，需由逐商品 gap report 決定。
