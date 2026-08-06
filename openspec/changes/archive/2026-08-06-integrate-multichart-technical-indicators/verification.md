# 驗證紀錄

## 階段一

- Formula version：`multichart-ecae7ca-v1`
- 參考來源：`MultiChartOnCodexSite` commit `ecae7cac837f06085801c96f3da0c570051d66e7`
- Volume MA20：RealTimeStock extension，沿用相同 zero-inclusive SMA 契約。
- 閘門：公式、definition、migration、build、Chromium smoke test、OpenSpec strict validation 與 `git diff --check` 均通過。

## 階段二

- Canonical store：module-level immutable snapshot、functional update、memory-first persistence、v3 revision／updatedAt／writerId LWW。
- Renderer：主圖以 `instanceId + outputKey` 維持 stable series；資料 refresh 不重建 pane。回測另提供 stable renderer handle。
- Current bar：每張圖獨立 latest-wins scheduler，120ms 合併窗口，最多一個 pending job；symbol／timeframe／history generation 變更會取消舊 job。
- Checkpoint：EMA、MACD、Wilder RSI 與 ATR 使用完整 prefix checkpoint；current-bar 結果逐點比對 full recompute，history prepend 會重建。
- Chromium 固定資料集 profile（2026-08-06，本機 headless Chromium，40 次資料 refresh）：1 圖 9ms、2 圖 8ms、4 圖 10ms、8 圖 13ms；各組均維持 pane identity 並完成 cleanup。

## 階段三

- FVG：bullish／bearish 三根 K 棒公式、最新 20 markers、最新 12 個未完全填補 zones；部分穿越不縮邊界。
- K 線固定區間 Volume Profile：chart-local anchors、24 bins、typical price、POC 與 70% VAH／VAL；未設定時不猜測區間。
- Primitive：不提供 hit-test 或 autoscale，交易／警示模式優先；1／2／4／8 圖 resize 與 cleanup 通過。

## 階段四

- Pivot version：`traditional-pivot-tw-v1`。
- 僅支援 STK／IND／WRT 與 1m／5m／15m／60m／1D；FUT／OPT picker 明確停用。
- Reference：只讀本機 Shioaji canonical raw 1m rows，依 `Asia/Taipei` 日期分組；有下一實際交易日期才 completed，最新日保持 provisional。
- Primitive：七條右向水平線、readout、標籤避碰、autoscale、歷史固定／回到最新與 generation 隔離；1／2／4／8 圖 cleanup 通過。

## 本機 simulation 可見驗收

- 環境標頭顯示「模擬環境」，本輪未切換 production、未操作點價買賣／停損／停利、未送出委託。
- Volume MA modal 可見 Vol MA5／Vol MA10／Vol MA20，按取消後未加入。
- FVG 可新增、顯示 legend、開啟設定及移除；實際 UI 驗收發現並修正 primitive 被舊 series-only legend filter 排除的整合缺口。
- K 線固定區間 Volume Profile 新增後顯示「請設定固定區間」，未猜測 viewport；驗收後已移除。
- IND Pivot 顯示 `2026-08-05 → 2026-08-06 completed` 與 P／R1 等格式化值，可開啟「固定歷史」；驗收後已移除。
- 瀏覽器 console 無 error／warning，測試用 indicator instances 均已移除並還原原設定。
