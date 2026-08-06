## Why

「我的清單」左側頁籤列同時放置拖曳把手、上移、下移與文字版隱藏按鈕，會壓縮頁籤名稱寬度，長名稱只能顯示少量字元。既然頁籤已支援拖曳排序，應精簡重複控制，將有限空間優先留給名稱，同時用一致且可辨識的可見性圖示取代文字按鈕。

## What Changes

- 移除顯示中頁籤列的可見上移／下移按鈕，只保留拖曳把手作為主要排序操作。
- 保留拖曳把手的鍵盤排序能力與包含頁籤名稱、位置的 accessible name，避免移除可見按鈕後失去鍵盤操作。
- 將「隱藏」與「取消隱藏」文字按鈕改為眼睛關閉／眼睛開啟圖示；圖示按鈕仍提供 `aria-label`、`title` 與可見焦點狀態。
- 重新配置頁籤列欄寬，使頁籤名稱取得剩餘可用空間並以單行省略號處理極端長名稱。
- 更新前端契約測試與本機 browser-visible 驗證，確認拖曳、鍵盤排序、隱藏及取消隱藏仍正常。
- 移除台股頁籤在 6／8 圖時強制鎖定「單一副圖」的限制，讓「單一副圖／多層副圖」選單在所有支援圖數皆可操作；非台股或混合頁籤仍維持安全限制。
- 修正多圖雙擊開啟的 `view=single` 判斷：單一商品頁只依目標商品決定 A／B 可用性，台股可切換、非台股固定 A，不再被來源頁籤的其他商品錯誤連帶停用。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `personal-tab-management`：頁籤排序介面改為以拖曳把手為唯一可見排序控制，鍵盤排序整合到把手；visibility 操作改用具無障礙名稱的眼睛圖示，並要求頁籤名稱優先取得列寬。
- `taiwan-stock-chip-subcharts`：全台股頁籤的 6／8 圖不再強制方式 A，可選擇並保存方式 A／B；`view=single` 改以目標商品判斷；一般非台股與混合頁籤限制不變。
- `codex-sites-rewrite`：正式站籌碼驗收矩陣改為涵蓋 6／8 圖 A／B，不再把強制 A 當成成功條件。

## Impact

- 前端：`public/static/app.js`、`public/static/styles.css`，以及 6／8 圖多層副圖頁面高度與捲動狀態。
- 測試：`tests/rendered-html.test.mjs` 與相關頁籤互動契約。
- OpenSpec：修改 `personal-tab-management` 的排序與隱藏操作需求。
- API、D1 schema、排序與 visibility endpoint contract 均不變。
