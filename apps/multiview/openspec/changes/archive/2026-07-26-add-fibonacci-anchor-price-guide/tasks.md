## 1. 價格導引渲染

- [x] 1.1 在主圖註記渲染流程從費波那契 `pending.preview` 取得唯一的待選時間與價格，依已固定錨點數判定下一點為 A、B 或 C，且不新增第二套座標轉換或持久狀態。
- [x] 1.2 在既有 SVG 註記層繪製由 plot 左緣延伸至價格軸安全邊界的水平導引實線，將真實 preview price 轉成 Y 座標，並在無效或超出 plot 的位置安全略過。
- [x] 1.3 在導引線右端加入 `待選 A／B／C｜格式化價格` 標籤，沿用商品既有價格 formatter，限制標籤於圖頂、圖底及右側價格軸前的可見範圍，但不得移動真實價位水平線。
- [x] 1.4 新增與收盤價灰白虛線及費波那契水準可辨識的高對比實線、halo、標籤背景與等寬數字樣式，維持 `pointer-events: none`，且不得把 A／B／C 寫回空心錨點圓內。

## 2. 生命週期與既有互動隔離

- [x] 2.1 讓滑鼠離開、Escape、完成最後錨點、重啟其他工具、商品／週期切換、panel reset 與銷毀沿用既有 pending preview 清理流程移除價格導引，不留下額外 listener 或 DOM。
- [x] 2.2 保留 `setCrosshairPosition(candle.close, time, candleSeries)`、K 棒日期垂直十字線、收盤價水平虛線、主副圖及籌碼 pane 的日期同步與逐日讀值，不將錨點價格廣播至其他 pane。
- [x] 2.3 將暫態導引群組標記為 `data-export-exclude`，確認它不寫入 `localStorage`、完成註記、API 或 D1，且完整 panel PNG 仍保留既有完成費波那契註記。

## 3. 自動化測試

- [x] 3.1 擴充費波那契註記測試，覆蓋 A、B、C 待選階段、導引群組與文字、實線樣式、價格軸安全邊界、`pointer-events: none` 及 PNG 排除標記。
- [x] 3.2 驗證點選前導引價格與點選後保存錨點經相同 formatter 顯示一致，並覆蓋不同商品價格格式、無效座標、滑鼠離開、Escape、完成及身份切換清理。
- [x] 3.3 補上共用十字線回歸測試，確認收盤價水平虛線仍以 candle close 定位，日期垂直線與可見副圖同步不受新增主圖導引影響。
- [x] 3.4 擴充 panel image exporter 測試，確認 `data-export-exclude` 會移除暫態導引，同時保留完成費波那契線、色帶、錨點與標籤。

## 4. 實際驗收與發布

- [x] 4.1 在本機實際操作費波那契回撤與拓展，逐一驗證待選 A、B、C 的水平實線、格式化價位與點下後錨點價格一致，且游標價位不同於收盤價時兩條水平線仍可清楚辨認。
- [x] 4.2 驗證快速移動、縮放、平移、resize、單圖與密集多圖、滑鼠離開、Escape、完成、工具／商品／週期切換及 PNG 匯出，確認沒有殘線、裁切、手勢阻擋或明顯延遲。
- [x] 4.3 執行完整測試、`openspec validate add-fibonacci-anchor-price-guide --strict` 與 `git diff --check`，記錄通過結果及任何既有非本變更警告。
- [x] 4.4 依既有 Sites 發布流程部署後，在已登入正式站重驗 A／B／C 價格導引、既有收盤價十字線、跨 pane 日期同步與 PNG 排除，並記錄正式版本及可見終態。

## 5. 選點標記與拓展尺度修正

- [x] 5.1 依使用者截圖補充規格與設計：費波那契選點期間移除主圖折線的大型實心 crosshair marker、preview 改為小型十字、固定錨點縮為小空心圓，且 pending 拓展不得驅動 autoscale。
- [x] 5.2 實作費波那契 pending 生命週期與主圖 LineSeries marker 可見性同步，新建／重建 series 也須沿用當下狀態，完成、取消、清除與身份切換後恢復。
- [x] 5.3 將 pending preview 錨點改繪小型十字並把固定錨點半徑限制為 4 CSS px；維持真實座標、`pointer-events: none` 與 PNG 暫態排除契約。
- [x] 5.4 調整拓展 autoscale 只採完成註記，確認移動待選 C 不會更新隱形價格界線或反覆壓縮 K 線，完成 C 後仍可顯示全部正式拓展水準。
- [x] 5.5 補齊 marker 生命週期、十字／空心圓渲染與 pending autoscale 隔離測試，執行完整測試、lint、OpenSpec strict 與 `git diff --check`。
- [x] 5.6 在本機與已登入正式站實際驗收回撤／拓展 A、B、C、取消／完成恢復、C 點快速移動價格尺度穩定及可見終態，更新驗證紀錄後發布 Sites。

## 6. 單圖初始化與十字細線回歸修正

- [x] 6.1 重現多圖雙擊正式站單圖空白，核對新分頁 URL、panel 數量與 Worker request 時序，將原因、1px 十字與既有 parity 邊界補入 proposal、design、spec 及 tasks。
- [x] 6.2 調整首頁初始化，讓 `/api/instruments` 與 `/api/config` 在第一次網路等待前啟動；並依 version 140 正式站二次診斷，在開啟新分頁前短暫暫停原多圖 panel 的 `EventSource`、3 秒後恢復，以免同源長連線阻擋單圖必要請求，且不改變原分頁或共用圖數偏好。
- [x] 6.3 將費波那契 preview 十字前景與 halo 的可見粗細都改為 1 CSS px，保留 10px 十字尺寸、真實座標、PNG 排除及固定錨點 4px 空心圓。
- [x] 6.4 補齊初始化順序、原頁串流暫停／恢復與 1px 樣式 contract，執行完整測試、lint、OpenSpec strict 與 `git diff --check`。
- [x] 6.5 在本機與正式站從至少四圖雙擊開啟正確商品單圖，確認首次載入即建立 1 個 panel 且 K 線可見；另重驗費波那契待選十字、完成／取消與測試圖形清理後發布 Sites。
