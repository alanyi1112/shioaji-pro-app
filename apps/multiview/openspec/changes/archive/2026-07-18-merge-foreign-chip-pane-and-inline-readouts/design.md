## 背景

籌碼副圖目前每個 pane 都會建立浮動 tooltip，部分 series 也啟用右側 last-value／title 標籤。兩者同時存在時會遮住折線與柱狀圖，TDCC 的「持股比例」與「週增減」尤其會在右側重疊。外資買賣超與外資持股又使用兩張獨立 pane，增加方式 B 的頁面高度。這次變更只調整前端呈現與選取狀態，不修改既有市場資料 API 或 D1 schema。

## 目標與非目標

### 目標

- 將外資買賣超柱狀圖與外資持股比折線合併在同一 pane，兩種數值使用獨立尺度。
- 將游標日期的籌碼讀值移到 pane 標題同一列；沒有游標時顯示最新可用讀值。
- 移除籌碼 pane 的浮動 tooltip 與遮住圖形的 series title／last-value 標籤。
- 以 `+`／`-` 及紅／綠顏色清楚表達正負方向，融資融券不再使用模糊的「增減」字樣。
- 相容已保存的 `foreign-flow`、`foreign-holding` 選取狀態，避免升級後遺失使用者偏好。

### 非目標

- 不變更籌碼 API response、FinMind／TDCC 資料取得或背景回補流程。
- 不把投信或自營商持股比加入合併 pane。
- 不改動主圖與技術副圖既有 legend；本次 inline readout 只套用籌碼 pane。

## 決策

### 1. 外資 pane 使用單一穩定 ID 與多 dataset 定義

registry 新增 `foreign-flow-holding`，同時宣告 `institutional-flow` 與 `foreign-holding`。render pipeline 先彙整所有作用 pane 所需 dataset，再維持每個 dataset 只請求一次。合併 pane 以買賣超 histogram 與持股比 line 共用時間軸；兩者使用彼此獨立的 price scale，持股比保留右側百分比刻度，買賣超使用不額外占用左右寬度的隱藏尺度，避免張數與百分比互相壓縮，亦維持共用垂直線的 X 軸對齊。

選取預設版本升級，載入舊狀態時把 `foreign-flow` 或 `foreign-holding` 都映射成 `foreign-flow-holding`，去除重複並保留第一個出現位置。這比保留兩個隱藏 alias 更容易確保選單與 pane 數量一致。

### 2. 標題列是籌碼 pane 唯一的文字讀值表面

每個 pane header 包含標題、inline readout、狀態、適用控制項與移除按鈕。readout 以多個具語意的 segment 顯示日期、主要值與必要明細；segment 可在窄寬度換行，但不建立額外固定詳細列，也不允許水平溢位。

共用十字線移動時，以 `sessionDate` 更新所有可見籌碼 header；游標離開或日期無效時恢復各 pane 最新可用資料。籌碼 pane 不再建立 tooltip DOM，也不再依游標 X 座標計算浮動位置。

### 3. 所有 chart 內文字標籤關閉

籌碼 series 一律關閉 `lastValueVisible`、`priceLineVisible`，且不設定會出現在價格軸旁的 `title`。Y 軸刻度仍保留，實際值統一由 header readout 負責，因此 TDCC 的「持股比例」與「週增減」不會再蓋住資料。

### 4. 正負方向使用台股顏色語意

方向性數值由共用 formatter 產生：正值顯示 `+` 並套紅色、負值顯示 `-` 並套綠色、零值使用中性色。formatter 以原始數值判斷方向，不從已格式化文字反推。融資與融券的餘額是存量，使用一般文字；相對前日變化才套方向色及明確正負號。買進、賣出、償還等欄位保留名稱，不把所有數字誤判為漲跌方向。

### 5. TDCC 缺值維持實際發布日語意

游標落在沒有 TDCC 週資料的交易日時，header 顯示游標日期、「當日無資料」，以及最近一筆早於該日的真實資料日期與比例；不得 forward-fill 成當日值。游標落在實際發布日才顯示該週的比例與週增減。

## 風險與取捨

- 標題列在窄 panel 可能換行：以可換行 segment、縮短次要文字及固定控制項優先順序降低高度；可讀性優先於強制塞在單行。
- 雙尺度可能讓使用者混淆：外資買賣超與持股比使用不同顏色、線型及清楚文字 label，左右 Y 軸保留單位。
- 舊 localStorage 可能同時選了兩個外資 pane：migration 去重後只保留一張合併 pane，屬於預期收斂。

## 遷移計畫

1. 先升級 pane selection version 與 legacy ID migration。
2. 更新選單與 registry，加入多 dataset 聚合及合併 render。
3. 將 tooltip 讀值邏輯改成 header inline readout，移除 tooltip DOM／CSS／定位 API。
4. 關閉籌碼 series 的 title／last-value 標籤並加入方向 formatter。
5. 以 contract、unit、OpenSpec strict 與正式站瀏覽器互動驗收確認；若失敗可回退至前一個 Sites deployment version。

## 待確認事項

無。
