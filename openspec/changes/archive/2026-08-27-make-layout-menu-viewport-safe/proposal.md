## Why

主交易畫面的「版面」選單內容高度已超過部分瀏覽器 viewport，但共用 popover 沒有高度上限或內部捲動，導致「儲存目前版面」、具名版面列表與重設操作被裁到畫面外而無法正常使用。版面儲存功能雖已存在，入口不可達也讓使用者難以辨識目前版面會自動保存，以及具名儲存實際上可用來另存配置。

## What Changes

- 讓頂部 popover 依目前 viewport 限制最大高度，內容超出時可在選單內垂直捲動，不得溢出或被畫面裁切。
- 重整「版面」選單的資訊順序，將「儲存目前版面」移到長預設版面清單之前，使核心操作開啟選單後即可看見。
- 明確呈現具名版面的新增與同名更新語意，避免無提示覆寫造成誤解。
- 保留目前 workspace 自動保存、具名版面載入／刪除、預設版面與 MultiView 新分頁入口的既有行為及儲存格式。
- 增加短 viewport、不同字級與大量具名版面的鍵盤、捲動及實際瀏覽器驗收。

## Capabilities

### New Capabilities

- `workspace-layout-management`: 規範主交易畫面版面選單的 viewport-safe 可達性、目前版面自動保存、具名版面另存／更新／載入／刪除與預設重設行為。

### Modified Capabilities

無。

## Impact

- 前端元件與樣式：`src/components/hud-header.tsx`、`src/components/hud-header.css.ts`。
- 版面狀態與持久化：`src/App.tsx`、`src/lib/workspace.ts`；維持既有 `localStorage` key 與資料格式，不新增 migration。
- 測試：補充版面管理行為、popover viewport 邊界、鍵盤操作與 browser-visible 驗收。
- 不影響 Shioaji API、行情資料、帳務、委託、simulation／production 模式或 MultiView runtime。
