## Why

多層副圖目前把「集保戶數」列入首次使用的預設勾選，畫面資訊量過多；同時籌碼 API 曾以固定時間門檻決定是否顯示今日資料，既會延後已取得資料，也曾因無日期快照套用請求日期而把前一日融資券誤標成今日。

## What Changes

- 將「集保戶數」從多層副圖首次使用的預設勾選清單移除，但保留使用者手動勾選、既有儲存選擇與持股比群組操作。
- 移除三大法人、融資券及其他日籌碼資料的固定發布時間門檻；來源只要回傳具有可驗證實際日期的資料，API 就立即保存並顯示。
- 所有日籌碼 row、provenance、coverage 與副圖 readout 必須使用來源實際日期；來源只到 8/4 時不得建立、複製或改標 8/5 row。
- TWSE 融資券 fallback 改用含明確報表日期的日期查詢端點；無日期的 `MI_MARGN` OpenAPI 快照不得建立任何日期 row，既有未驗證 TWSE 融資券 cache 也不得直接顯示。
- 補上預設選擇、取得即顯示、實際日期驗證、舊錯誤 cache 排除與官方 fallback 的回歸測試。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 調整多層籌碼副圖首次使用的預設勾選，並讓不同籌碼資料集在取得具實際來源日期的資料後立即顯示。
- `taiwan-stock-chip-data`: 調整日籌碼 API 的來源日期驗證、官方最新資料 fallback、cache 與 coverage 契約。

## Impact

- 前端：`public/static/chip-panes.js` 的預設副圖選擇與相關測試。
- Worker：`worker/taiwan-stock-chip-service.ts` 與 `worker/taiwan-stock-chip.ts` 的來源日期驗證、cache read、官方 fallback、response rows 與 provenance。
- API：`GET /api/taiwan-stock-chip` 維持既有 schema，但同一 response 中各資料集的最新日期可不同，並忠實反映來源實際發布狀態。
- 不新增 D1 schema、不更換資料來源、不修改授權或秘密設定。
