## Context

同一 panel 目前以 logical range 在多個 Lightweight Charts instance 間同步，但各 instance 的 time scale 會納入其所有 series 時間點。若技術指標 payload 含主圖顯示 candles 以外的時間，或 series／time anchor 在 layout 期間以不同順序重建，相同 logical index 就不再代表同一交易日。副圖的 `crosshairMove.param.time` 因而可能對應另一根 K 棒；父層再用這個 time 畫共用垂直線，便會出現滑鼠、虛線、K 棒及副圖資料點互相偏移。技術 series 若在無效資料或重建期間失敗，也會因先移除舊 series 而留下空圖。

## Goals / Non-Goals

**Goals:**

- 讓每個可繪製 indicator series 僅使用目前 candle time domain。
- 讓副圖滑鼠事件先以絕對螢幕 X 映射回主圖 candle，再以該 candle time 更新所有讀值與 crosshair。
- 讓可視範圍優先使用真實 time range 同步，logical range 只作尚未建立 time anchor 時的安全 fallback。
- 讓技術指標重建具備有效資料檢查、固定建立順序及可觀測 series 數量／資料點數。

**Non-Goals:**

- 不變更 RSI、KD、MACD、ATR 的公式、參數或顏色。
- 不把 TDCC 週資料補成每日資料，也不改變「當日無資料」語意。
- 不變更行情或籌碼 API、D1 schema、登入與部署設定。

## Decisions

1. **以 candle time domain 過濾所有可視 indicator series。** `preparePayload` 在 candles 正規化後建立 canonical time set，line／histogram 只保留 time 存在於 candles 的資料點。這可讓主圖、技術副圖及 time anchor 擁有相同 logical index 語意，也避免圖表接收游離時間點。替代方案是讓每張圖保留不同 time domain 並持續以像素校正；這會在縮放、resize 與資料更新後反覆漂移，因此不採用。

2. **副圖 pointer 以 screen X 回映主圖 candle。** 技術與籌碼 pane 的 crosshair event 傳遞 `point.x` 對應的絕對螢幕 X，panel 只透過主圖 `coordinateToTime` 決定 shared hover time。來源 pane 回傳的 `param.time` 只在無 point 的鍵盤／程式事件作 fallback，避免以已漂移副圖的 time 反向污染主圖。

3. **time range 優先、logical range fallback。** 主圖有可用 `getVisibleRange()` 時，技術與籌碼副圖使用 `setVisibleRange()`；只有 time anchor 尚未可解析或 Lightweight Charts 暫時拒絕時，才使用目前 logical range，並在下一個 layout frame 再做 time range 與座標驗證。所有例外均限制在目前 panel generation，不得清除既有 series。

4. **技術 series 重建先準備再提交可見狀態。** payload 正規化完成後才進入 `renderIndicatorChart`；time anchor 先建立，合法 series 後建立，完成後再同步 range 與 shared crosshair。debug report 額外記錄各技術 series 的資料點數，讓「已選取但沒有合法資料」與「生命週期漏畫」可區分。

## Risks / Trade-offs

- [過濾 candle domain 可能移除 warmup 期指標點] → warmup 只用於計算，不屬於目前顯示 candles；驗證首根可顯示 candle 仍保留合法計算值。
- [`setVisibleRange` 在 time anchor 重建瞬間可能拋錯] → 先確認 anchor 與 range，捕捉例外並以 logical range fallback，下一個 layout frame 重試。
- [副圖 pointer 位於價格軸區域] → 只接受主圖 plot 寬度內的 screen X，超出時清除 shared crosshair，不讀取錯誤日期。

## Migration Plan

1. 先加入 payload time-domain 與 pointer 映射單元／source contract 測試。
2. 修改主圖與籌碼 pane 的同步事件及 debug report。
3. 本機以 1／2／3／4 圖、多層副圖、代表性台股／ETF 與左中右 pointer 位置驗收。
4. 若回歸失敗，可回退本變更；API 與資料庫不需 migration。

## Open Questions

無。
