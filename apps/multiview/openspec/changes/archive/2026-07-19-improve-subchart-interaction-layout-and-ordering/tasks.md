## 1. 規格同步與回歸基線

- [x] 1.1 先同步並歸檔會修改相同 `taiwan-stock-chip-subcharts` requirements 的已完成 changes，重新以最新主規格核對本 change 保留標題換行、欄位名稱色票、TDCC 詳細資料與立即回補行為
- [x] 1.2 補充目前主圖／副圖選單、空技術副圖、共用十字線與固定 registry 排序的回歸測試基線

## 2. 主圖與副圖選單收合

- [x] 2.1 將 `wireIndicatorMenus` 改為可清理的 panel-scoped 控制器，支援同 panel 選單互斥與外部滑鼠左鍵收合
- [x] 2.2 保留選單內連續複選與 `Escape` 鍵行為，並在 panel `destroy()` 移除 document listener
- [x] 2.3 新增外部點擊、內部複選、另一選單展開及 panel 重建不重複處理的 DOM 測試

## 3. K 線橫軸游標日期

- [x] 3.1 在 panel template 與樣式加入唯一 `.panel-crosshair-date`，使用 `YYYY-MM-DD` 且不顯示「日期」前綴
- [x] 3.2 由共用 crosshair 的 candle time 定位日期標籤，依主圖 plot 與價格軸安全寬度限制左右邊界
- [x] 3.3 在游標離開、無 candle、切換商品、resize／focus 與 panel 銷毀時更新或清除標籤，加入日期一致及邊界測試

## 4. 技術副圖版面與法人標題

- [x] 4.1 以實際已選技術指標決定 indicator chart 可見性，方式 B 無指標時移除 technical row，方式 A 無作用副圖時收合整個 slot
- [x] 4.2 重新選取技術指標時恢復 resize、visible range、crosshair、wheel routing 與緊湊高度，隱藏期間停止不可見更新
- [x] 4.3 將法人選單完整名稱與 pane 短標題分離，header 顯示「外資」、「投信」、「自營商」及「三大法人」
- [x] 4.4 從所有籌碼 pane header／inline readout 移除資料來源 segment，但保留 payload、availability、診斷及右鍵詳細資料的來源資訊
- [x] 4.5 新增 A／B 模式無技術指標高度、重新勾選同步、短標題與 header 無來源文字的測試

## 5. 多層籌碼副圖排序

- [x] 5.1 將 selection schema 升版並加入 `modeBPaneOrder`，正規化舊偏好、重複／未知 ID 與 registry 新增 pane 的向後相容順序
- [x] 5.2 讓 `desiredPaneIds()`、controller 建立、DOM reconcile、plot rect 與 report 全部依目前保存順序運作
- [x] 5.3 在方式 B pane header 加入具 accessible name 的專用拖曳把手、拖曳項目與插入位置視覺狀態，方式 A 不顯示把手
- [x] 5.4 實作 pointer drag 的單次持久化及 `Escape`、`pointercancel`、滑鼠放開、視窗失焦與文件隱藏清理，避免與圖表平移及頁面捲動衝突
- [x] 5.5 在既有右鍵功能表加入「上移」與「下移」，處理首尾 disabled、鍵盤操作及 pane 銷毀清理，不新增常駐排序按鈕
- [x] 5.6 新增拖曳成功／取消、右鍵排序、切換商品恢復、舊偏好 migration、移除中間 pane 及不重抓資料的測試

## 6. 整合驗收

- [x] 6.1 執行完整 Node 測試、`npm run lint`、`npm run build` 與 `openspec validate --all --strict`
- [x] 6.2 在本機瀏覽器驗證主圖／副圖選單外部收合、橫軸日期、技術副圖零高度與重新選取，並確認 console 無錯誤
- [x] 6.3 在 1／2／3 圖方式 B 驗證至少五個籌碼 pane 的拖曳、右鍵排序、重新整理持久化、1px 日期對齊與唯一 document 捲軸
- [x] 6.4 在 4／6／8 圖及聚焦方式 A 驗證至多一個副圖槽位、右側數值軸、短標題、無來源文字，以及既有回補與詳細資料功能無回歸
