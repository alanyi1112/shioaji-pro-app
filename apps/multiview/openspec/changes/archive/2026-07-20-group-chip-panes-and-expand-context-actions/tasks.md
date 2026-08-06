## 1. 群組與詳細資料純函式契約

- [x] 1.1 為三個資料群組 registry、canonical child order、pane-to-group lookup 與所有十個 pane 完整覆蓋新增 focused tests。
- [x] 1.2 為群組 checked／unchecked／indeterminate 推導與大項目全選／全取消行為新增測試，涵蓋部分選取與空群組。
- [x] 1.3 為 `modeBGroupOrder` normalization 與舊 `modeBPaneOrder` migration 新增測試，涵蓋交錯群組、重複／未知 IDs、部分選取與每個 `tabId + canonical symbol` 隔離。
- [x] 1.4 建立十個籌碼 panes 共用的 canonical detail／series metadata 測試，確認圖形、標題讀值、右鍵項目與詳細資料標題共用色票。
- [x] 1.5 為 daily 前一筆有效資料、TDCC 前一期 snapshot、欄序與 `指向值 - 前一筆值` 新增測試，涵蓋首筆、缺值、正／負／零與非發布交易日。

## 2. 籌碼選單群組化與偏好遷移

- [x] 2.1 在 `public/static/chip-panes.js` 加入群組 registry 與群組順序 helper，保留既有 pane registry、dataset mapping 與 request cache。
- [x] 2.2 將 `public/static/index.html` 的籌碼選單改為三個可存取的階層群組，大項目支援三態，子項目保留完整名稱與獨立控制。
- [x] 2.3 在方式 B 串接大項目全選／全取消與子項目部分選取；在方式 A、4／6／8 圖及聚焦模式停用大項目整組操作並保留單一子項目選取。
- [x] 2.4 提升 selection defaults version、保存 `modeBGroupOrder`，並相容遷移既有 `modeBSelectedPaneIds`／`modeBPaneOrder`，不得自動開啟原本未選的全部十個 panes。
- [x] 2.5 更新群組 CSS、焦點、aria checked／mixed、disabled 提示與窄寬度換行，確認選單內可連續複選且外部左鍵收合行為不回歸。

## 3. 流暢的整組拖曳與排序

- [x] 3.1 讓方式 B 以 group wrapper 包住同群組目前可見 panes，依 `modeBGroupOrder` 與 canonical child order 建立 DOM，群組最後一個 pane 移除後才清理 wrapper。
- [x] 3.2 以單一群組拖曳把手取代單 pane 排序把手，建立涵蓋整組的選取外框、群組名稱／pane 數 ghost 與等高 placeholder。
- [x] 3.3 將 `pointermove` 改為 snapshot rect 加單一 `requestAnimationFrame` 的 preview 更新，合法 drop 前不得搬動實際 Canvas DOM、resize、axis measurement、偏好寫入或資料 load。
- [x] 3.4 在 `pointerup` 一次提交 group order、DOM、偏好與 layout refresh；Escape、`pointercancel`、buttons released、blur、visibility change、resize、切換商品／模式與 destroy 必須取消並完整清理。
- [x] 3.5 將籌碼 pane 右鍵排序改為「上移資料群組／下移資料群組」，與拖曳共用 reorder primitive，並正確處理首尾 disabled 與鍵盤操作。
- [x] 3.6 擴充測試確認部分選取群組整組移動、內部 panes 不拆散、成功只保存一次、取消零寫入、request cache 不失效且共用十字線 controller 順序同步。

## 4. 全籌碼副圖指向日期詳細資料

- [x] 4.1 將 holder-only 詳細資料 DOM 重構為所有籌碼 pane 可共用的 dialog／table controller，保留焦點、Escape、外部點擊與 lifecycle cleanup。
- [x] 4.2 在滑鼠右鍵時以 pane X 座標解析並固定 candle 日期；鍵盤功能表使用共用游標日期，沒有游標時才回退最新合法日期。
- [x] 4.3 為外資、投信、自營商、三大法人、融資、融券、借券與券資比建立 daily comparison rows，固定顯示前一筆、指向值及變化，缺值不得補 0。
- [x] 4.4 將大戶／散戶詳細資料改為前一期、指向日期對應當期與變化，明列實際 TDCC `dataDate`、官方級距、來源、頻率與提醒，不 forward-fill 成日資料。
- [x] 4.5 更新詳細資料表 CSS，項目標題沿用 series 色、增加紅／減少綠／持平中性，並驗證窄 panel、長資料與表格捲動不遮住圖表。
- [x] 4.6 確認全部十個籌碼 pane 的右鍵與 `ContextMenu`／`Shift+F10` 都有「詳細資料」，RSI、KD、MACD、ATR 不出現詳細資料且技術副圖既有互動不變。

## 5. 商品 panel 本機 PNG 匯出

- [x] 5.1 建立可單獨測試的 client-side panel image exporter，定義完整 panel 尺寸、Canvas 置換、控制值／computed style 同步、排除元素、解析度與最大像素限制。
- [x] 5.2 在每個 panel 建立單一右鍵功能表，讓主圖、toolbar、技術副圖與 panel 其他位置可選擇「儲存此商品所有線圖為圖片」，並加入鍵盤與外部關閉 lifecycle。
- [x] 5.3 將相同匯出 callback 整合至每個籌碼 pane 既有右鍵功能表，阻止雙選單冒泡並保留詳細資料、series、回補、排序與移除操作。
- [x] 5.4 匯出前固定右鍵指向日期與主副圖讀值、關閉選單並等待版面穩定；輸出包含完整長 panel 的主圖、可見技術副圖、全部可見籌碼副圖、overlay 與數值軸。
- [x] 5.5 以 canonical symbol、interval 與時間產生安全 PNG 檔名，成功或失敗後 revoke object URL、移除離屏 DOM 並解除匯出狀態；不得傳送任何影像或行情資料請求。
- [x] 5.6 新增 exporter 測試，涵蓋 MIME／檔名、完整 scroll height、Canvas replacement、排除 context menu／其他 panel、零上傳、尺寸超限、序列化失敗與 panel destroy cancellation。

## 6. 完整驗證、正式站驗收與發布

- [x] 6.1 執行 focused tests、`npm run lint`、完整 `npm test`／build、`git diff --check` 與 `npx openspec validate --all --strict`，修正本變更新增的失敗或 warning。
- [x] 6.2 以本機瀏覽器驗收三態選單、部分選取、A／B 與 1／2／3／4／6／8 圖政策、整組拖曳／右鍵排序、取消、切換商品後持久化及無 console error。
- [x] 6.3 以本機瀏覽器逐一抽驗十個籌碼 pane 的滑鼠／鍵盤詳細資料，確認指向日期、前一筆在左、指向日在右、變化計算、色票及 TDCC 週資料語意正確，且技術副圖沒有詳細資料。
- [x] 6.4 實際下載單一、部分與完整多層 panel PNG，檢查像素尺寸超過 viewport 時仍完整、內容／Canvas／讀值／軸線可見、其他 panel 與選單未混入，並確認匯出期間沒有上傳請求。
- [x] 6.5 提交並推送 exact validated source，使用完整 HEAD 建立及部署 owner-only Sites version；以控制面確認 source commit、deployment succeeded、站點 active 與 access mode 未改變。
- [x] 6.6 使用已登入正式站 session 重做群組拖曳、持久化、十個籌碼詳細資料與 PNG 下載 smoke，記錄實際可見終態後再準備 OpenSpec 歸檔與收工同步。

## 7. 匯出完整高度與技術副圖移除補強

- [x] 7.1 為 `overflow: visible` 後代超出 panel `scrollHeight` 的情境新增匯出尺寸測試，確認完整涵蓋大戶／散戶持股比且超限時只等比例縮放、不裁切內容。
- [x] 7.2 修改 panel image exporter，以未排除可見後代的實際繪製邊界計算完整寬高，並讓 html2canvas clone 使用相同展開尺寸。
- [x] 7.3 在技術副圖右鍵功能表加入「移除副圖」，一次取消該 panel 所有技術指標並更新版面；主圖／空白區不顯示此操作，且技術副圖仍無詳細資料。
- [x] 7.4 執行 focused tests、lint、完整測試／build、OpenSpec strict validation，並以本機寬／窄 panel 實際下載 PNG 與驗證技術副圖移除；通過後提交、推送及部署 owner-only Sites version 再做正式站 smoke。
