## 1. 建立版面與捲動 contract

- [x] 1.1 擴充 `tests/rendered-html.test.mjs` 與前端 contract，先固定方式 B 必須啟用可辨識的 page-scroll state、方式 A 不得啟用，以及 4／6／8 圖與聚焦模式仍固定 A。
- [x] 1.2 加入 CSS contract，確認方式 B 的 `.chip-pane-region`／`.subchart-slot` 不再使用 `overflow-y: auto` 或 `overscroll-behavior: contain`，document 為唯一垂直捲動容器，且保留 pane 最低高度。
- [x] 1.3 加入狀態切換 contract，確認 B → A／4／6／8／focus 會移除長頁面 class，返回 B 後恢復技術副圖與完整籌碼勾選組合。

## 2. 實作方式 B 的瀏覽器整頁捲動

- [x] 2.1 在 `public/static/app.js` 依 effective mode 管理 `body`／`#chart-grid` 的 page-scroll class，並納入初始 render、A／B 切換、圖數切換、聚焦與離開聚焦流程。
- [x] 2.2 在 `public/static/styles.css` 將 1／2／3 圖方式 B 改為自然高度與 auto row，為主圖、技術副圖及籌碼 pane 設定 responsive 可讀高度，讓 panel 與 document 高度隨 pane 數量增減。
- [x] 2.3 移除方式 B 的 panel 內垂直 overflow 與 overscroll containment，限制非預期水平 overflow；保留方式 A、4／6／8 圖及聚焦模式的固定 `100vh` 版型。
- [x] 2.4 調整 2／3 圖寬螢幕並排與既有 breakpoint 單欄規則，讓所有 panel 共用一個瀏覽器頁面捲軸，且各 panel 可依自己的 pane 數量自然增高。
- [x] 2.5 以真實瀏覽器確認 Lightweight Charts 是否攔截垂直 wheel／touch；若會，只在方式 B 調整 `handleScroll`／touch options，使頁面可垂直捲動並保留水平拖曳、時間軸縮放與 crosshair。

## 3. 維持圖表生命週期與同步

- [x] 3.1 讓 page-scroll class、pane 增減與 breakpoint 變化沿用既有多階段 layout refresh，正確 resize 主圖、技術副圖、籌碼 pane、價格軸與 overlay，不因純高度變化重建 chart 或重抓資料。
- [x] 3.2 驗證取消中間 pane 後其後項目依固定順序補位、document 高度縮短，且其他 pane 的資料、尺度、listener、observer 與勾選狀態不變。
- [x] 3.3 驗證 A／B、圖數與聚焦切換前後 visible logical range、crosshair、向左載入、日期軸及 debug alignment report 保持同步，超出新頁面範圍的 scroll position 只由瀏覽器自然 clamp。

## 4. 驗證、發布與正式站驗收

- [x] 4.1 執行 `node --check`、`npm test`、`git diff --check` 與 `openspec validate --all --strict`，並確認沒有新增秘密值、API、D1 migration 或不相關變更。
- [x] 4.2 以桌面瀏覽器實測 1／2／3 圖方式 B 勾選 5～10 個 pane，確認全部同時向下展開、`document.scrollHeight` 隨內容增加、內層沒有垂直捲軸且頁面沒有水平捲軸。
- [x] 4.3 以窄螢幕與觸控／wheel 實測從主圖、技術副圖及籌碼 canvas 上皆可捲動整個 document，並確認水平圖表操作、hover、crosshair 與時間軸仍可用。
- [x] 4.4 回歸方式 A、4／6／8 圖與聚焦模式，確認仍維持單一副圖、固定視窗、多圖工具列與既有偏好恢復行為。
- [x] 4.5 提交並推送通過驗證的 exact source，建立及部署新的 Codex Sites version；以已登入正式站確認 B 模式瀏覽器捲軸、pane 順序、資料讀值、A 模式回歸與 console 無錯誤後再回報完成。
