## Why

目前收盤後選股可由「＋新增面板」建立在主工作區內，但使用者也需要從「版面」下拉選單的「選股篩選」以新分頁開啟完整介面，而不是改變「＋新增面板」的原有功能。篩選結果也需要明確、可驗證且不影響既有點選安全邊界的「加入清單」操作。

## What Changes

- 在 viewport-safe「版面」下拉選單的「預設版面 Presets」區提供「選股篩選」，啟用後以同源新分頁開啟完整交易終端，套用左側選股、右側 K 線的專用版面，而不是顯示只有選股控制項的全頁介面。
- 選股與 K 線在新分頁的同一 `TradingApp` workspace 內直接連動；新頁的版面變更不得覆寫來源主頁的持久化 workspace。
- 每筆篩選結果右上方新增獨立的「加入清單」按鈕，將合法台股商品冪等加入名稱精確為「選股」的自選清單；清單不存在時自動建立，但不得切換目前作用中的自選清單。
- 保留結果內容點選的既有安全契約：點選或鍵盤啟用結果只切換指定 K 線，不加入自選清單、不改動交易商品、草稿、行情訂閱或其他圖表。
- 「＋新增面板」中的「選股」維持原有 singleton workspace block 語意；只有「版面」選單中的「選股篩選」會開新分頁。
- 加入清單流程提供加入中、成功／已存在與失敗狀態；只有後端自選清單寫入成功或確認已存在時才可顯示成功，跨分頁清單畫面必須可刷新到一致狀態。

## Capabilities

### New Capabilities

- `stock-screener-watchlist-integration`: 定義選股結果以明確按鈕建立或尋找「選股」清單、冪等加入商品、錯誤處理、作用中清單隔離與跨分頁狀態同步。

### Modified Capabilities

- `after-market-stock-screener`: 讓新分頁使用完整交易終端與專用選股／K 線 workspace，並保留既有內嵌選股面板行為。
- `workspace-layout-management`: 在 viewport-safe「版面」選單的預設版面區增加開啟完整選股交易版面的 action，隔離新頁與來源頁 workspace，同時保留「＋新增面板」建立內嵌選股 block 的原有語意。

## Impact

- 前端入口與路由：`src/App.tsx`、`src/lib/workspace.ts`、`src/components/hud-header.tsx`、`src/components/workspace-layout-menu.tsx` 及選股版面 opener。
- 選股 UI：`src/components/stock-screener-panel.tsx` 的結果卡片結構、鍵盤操作與加入狀態。
- 版面協調：新頁以 `layout=stock-screener` 載入 5／19 欄的選股／K 線 workspace，點選合約在同頁內重新驗證 chart target。
- 自選清單資料流：`src/hooks/use-watchlist.ts` 與 `src/lib/shioaji.ts` 的指定名稱清單寫入、重抓及同步；不改動交易 API，也不啟用 production 或真實下單。
- 工作區相容性：「＋新增面板」保留 `screener` block 的原有位置、singleton 與儲存語意；選股版面新頁使用 session-only workspace，不改寫來源頁的 localStorage workspace。
- 測試與驗收：涵蓋完整交易終端新頁、左選股／右 K 線版型、workspace 隔離、鍵盤與窄 viewport、清單自動建立／重複加入／失敗，以及自選清單與交易狀態無非預期副作用。
