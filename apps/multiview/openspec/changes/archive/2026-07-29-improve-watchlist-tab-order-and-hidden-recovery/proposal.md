## Why

「我的清單」目前以手動輸入數字調整頁籤順序，後端又允許多個頁籤保存相同 `sortOrder`，造成畫面出現重複編號、重新載入後順序不穩定，且系統頁籤與自訂頁籤可能產生重複的有效項目。頁籤隱藏後也缺少可發現的管理與恢復入口，使用者難以理解頁籤是否仍存在，以及如何取消隱藏。

## What Changes

- 將頁籤排序改為與商品清單一致的拖曳把手及上移／下移操作，不再讓使用者直接編輯排序數字。
- 新增頁籤批次排序契約，驗證完整順序後以單次 D1 batch 將可見頁籤正規化為唯一的 `1..N`，並採用 latest-wins 協調快速連續操作。
- 建立單一有效頁籤模型，合併系統預設、使用者對系統頁籤的 override 與自訂頁籤，避免同一邏輯頁籤重複出現。
- 將管理介面分成「顯示中的頁籤」與「已隱藏頁籤」，提供明確的隱藏、取消隱藏、隱藏數量及恢復結果提示。
- 取消隱藏時將頁籤加入可見清單最後並重新正規化順序；隱藏目前或預設頁籤時採用可預期的 fallback 規則。
- 限制系統頁籤只能隱藏或恢復系統預設，自訂頁籤才可永久刪除；不得隱藏最後一個可見頁籤。
- 讓導覽列、管理視窗、目前頁籤 fallback 與相鄰預載流程共同使用後端回傳的 canonical order。

## Capabilities

### New Capabilities

- `personal-tab-management`: 定義系統與自訂頁籤的有效身分、可存取排序、批次持久化、隱藏與取消隱藏、刪除限制、fallback 及各消費端一致性。

### Modified Capabilities

無。

## Impact

- 前端：`public/static/index.html`、`public/static/app.js` 與相關樣式、頁籤排序狀態協調及管理視窗互動。
- Worker/API：`worker/app.ts` 的有效頁籤組合、頁籤 CRUD／visibility 路由，以及新增的 `/api/tabs/reorder` 批次排序路由。
- D1：沿用既有頁籤與 override 資料，讀取時相容歷史重複 `sort_order`，首次排序後正規化；除非實作驗證顯示必要，預期不新增 schema migration。
- 測試與驗收：補齊 Worker、前端單元／整合測試，並在 Codex Sites 正式站完成頁籤排序、隱藏與恢復的 browser-visible 驗收。
