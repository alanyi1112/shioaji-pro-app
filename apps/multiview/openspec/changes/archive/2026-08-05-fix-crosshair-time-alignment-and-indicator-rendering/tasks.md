## 1. 重現與測試契約

- [x] 1.1 建立 indicator series 僅保留 canonical candle time domain 的單元測試。
- [x] 1.2 建立副圖 raw pointer screen X 回映主 K 線 candle time、plot 外拒絕及跨 pane time-range 同步契約測試。
- [x] 1.3 擴充 debug report，記錄技術 series 資料點數、各 pane visible time range 與左中右日期座標。

## 2. 圖表同步修正

- [x] 2.1 在 payload prepare 階段過濾 candles 以外的 line／histogram 時間點，保留合法值、顏色與 whitespace 語意。
- [x] 2.2 將技術與籌碼副圖 crosshair event 改為傳遞 raw screen X，並由主圖解析唯一 shared candle time。
- [x] 2.3 將主副圖互動同步改為 visible time range 優先、logical range 安全 fallback，並在 anchor 完成後重新校正小於等於 1 CSS px。
- [x] 2.4 固定技術 chart、time anchor 與已選 series 的重建／套用順序，避免有合法資料時偶發空圖。

## 3. 驗證

- [x] 3.1 執行 targeted tests、完整 `npm test`、lint、OpenSpec strict 與 `git diff --check`。
- [x] 3.2 在本機以 1／2／3／4 圖多層副圖驗收代表性商品，量測左中右 pointer 的滑鼠、共用線、K 棒與所有可見 pane 日期一致。
- [x] 3.3 驗收商品切換、快取更新、快速換頁、resize 與捲動後技術指標仍出現且跨 pane X 偏差小於等於 1 CSS px。
