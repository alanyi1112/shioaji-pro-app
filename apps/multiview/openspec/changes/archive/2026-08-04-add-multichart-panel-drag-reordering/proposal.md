## Why

多圖畫面目前只能透過「我的清單」調整商品順序，無法直接把正在比較的 chart panel 拖到想要的位置；若只重排畫面 DOM，重新整理、切換分頁或回到清單後又會恢復舊順序。需要讓多圖 panel 成為既有頁籤 canonical 商品排序的直接操作入口，使畫面、清單、分頁與商品下拉選單永久保持一致。

## What Changes

- 在 2／3／4／6／8 圖支援以滑鼠左鍵按住商品 panel 上方的商品標題／報價區非互動部分，直接拖到想要的位置；小把手只作視覺提示與鍵盤操作入口，不要求使用者精準命中。1 圖不啟用排序入口。
- 拖曳期間以 ghost、來源狀態與插入位置預覽回饋，不搬動真正 Canvas、不重建圖表、不重新抓取 K 線或籌碼資料；合法 drop 後才原子套用新順序。
- 將目前頁內的新順序合併回目前頁籤的完整 canonical 商品順序，沿用既有 `/api/instruments/reorder`、revision／latest-wins 與 D1 batch 永久保存，並同步「我的清單」、分類分頁及商品下拉選單。
- 明確處理 panel 臨時選擇商品或重複商品的身分邊界：排序以頁籤內穩定的 canonical item identity／slot 為準，不得只以目前顯示 symbol 推斷或送出重複排序項目。
- 支援 `Escape`、`pointercancel`、滑鼠按鍵提前放開、視窗失焦、文件隱藏、切換頁籤／頁數／圖數等安全取消；儲存失敗時回復拖曳前的 canonical 與 panel 順序。
- 第一版限定目前可見頁內排序，不在拖曳時自動跨分類分頁；跨頁移動仍由「我的清單」完成。
- 保留各 panel 的商品／週期、visible range、主副圖選擇、stream 與既有互動；不得破壞雙擊新分頁單圖、6／8 圖固定單一副圖或台股多層副圖資格規則。

## Capabilities

### New Capabilities

- `multichart-panel-reordering`: 定義多圖 panel 的拖曳／鍵盤排序、幾何插入位置、預覽、取消、原子套用及 chart lifecycle 保護。

### Modified Capabilities

- `watchlist-reordering`: 將多圖 panel 納入頁籤 canonical 商品順序的操作與消費端，沿用批次持久化、revision／latest-wins、失敗回復及跨畫面同步契約。
- `codex-sites-rewrite`: 在多圖功能 parity 中加入 2／3／4／6／8 圖直接排序，並要求排序過程保留分頁、副圖模式、圖表狀態與雙擊單圖行為。

## Impact

- 前端：`public/static/app.js`、`public/static/index.html`、`public/static/styles.css` 的 panel template、狀態模型、拖曳控制器、排序同步與 responsive grid 視覺。
- API／持久化：原則上沿用 `POST /api/instruments/reorder` 與現有 D1 `sort_order`，不新增 migration；需確認 request 能以完整頁籤清單保存目前頁切片的新順序。
- 測試：擴充 rendered contract、排序／分頁、chart lifecycle 與瀏覽器可見驗收，涵蓋各圖數、responsive 版面、取消／失敗回復、重載持久化及零額外資料 request。
- 部署：完成 lint、完整測試、OpenSpec strict validation 與 `git diff --check` 後，分別部署並驗收 Sites 保留站與 Cloudflare 正式站。
