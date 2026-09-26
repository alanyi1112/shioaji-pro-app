## Why

從「版面 → 盤中選股」開啟新分頁時，來源看盤頁會跳出「瀏覽器已阻擋」警告，即使新分頁已開啟。現有程式把 `window.open(..., 'noopener')` 的 `null` 回傳當成阻擋；但 `noopener` 成功開頁時也會回傳 `null`，因此這是打斷看盤的誤報。

## What Changes

- 保留盤中選股新分頁的 `noopener` 安全隔離與來源 workspace 不變的既有行為。
- 移除根據 `window.open` 空回傳顯示的自製阻擋 alert；真正被阻擋時，讓瀏覽器原生阻擋指示與可重試入口處理，不宣稱監控已啟動。
- 更新測試，覆蓋 `noopener` 回傳 `null` 但已提出開頁要求時不顯示誤報，並確認來源版面、自選與商品不變。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `intraday-stock-selection-workspace`：明確規範 `noopener` 空回傳不是 popup 阻擋證據，成功開頁不得顯示錯誤警告；阻擋時保留可操作的瀏覽器原生提示或等效非誤報指引。

## Impact

- 前端：`src/components/workspace-layout-menu.tsx` 的盤中選股入口；`src/lib/intraday-stock-selection-window.ts` 的安全開頁呼叫維持不變。
- 測試：`src/components/hud-header.browser.test.ts` 與必要的開頁單元測試。
- 無 API、行情訂閱、交易權限、runtime 生命週期或資料儲存變更。
