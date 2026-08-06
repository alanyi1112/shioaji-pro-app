## Context

`^SOX` 的 Yahoo Chart 價格可正常使用，但日線回應中的所有 `volume` 都是 0；前端忠實繪製後看起來像成交量消失。這是指數來源本身沒有提供成交量，不應改用其他 ETF 或商品冒充。另一方面，全域 `compactSubchartMode` 現在只在 6／8 圖時覆寫為單一副圖，沒有檢查商品市場，導致美股等頁籤仍可顯示不適用的多層籌碼模式。

## Goals / Non-Goals

**Goals:**

- 保留 `^SOX` 原始 OHLC 與原始成交量語意；來源沒有量時不改用其他商品。
- 在 API 與 UI 明確揭露「此指數來源未提供成交量」。
- 只有全台股頁籤可使用多層副圖；其他頁籤及非台股 panel 強制單一副圖。
- 保留既有 `compactSubchartMode` 及台股 pane 選擇，市場切換只改變 effective mode。

**Non-Goals:**

- 不以 `SOXQ`、`SOXX`、估算、插值或其他商品替換 `^SOX` 成交量或 OHLC。
- 不新增非台股籌碼資料、不變更指標公式，也不清除既有使用者偏好。

## Decisions

### 1. 對已知不提供成交量的指數回傳明確可用性

Worker 繼續只取得 `^SOX` candles，不增加其他商品請求。當已知指數來源的所有回傳成交量均為 0 時，在 `quote.volumeAvailability` 與 `dataQuality.volumeAvailability` 回傳 `status: "unavailable"`、`reason: "source_not_provided"` 與中文說明。這個 metadata 只描述來源可用性，不改寫任何 candle。

### 2. 禁止跨商品補成交量

`^SOX` 的每一筆 volume 保持來源原值；不得為了讓量柱可見而抓取 `SOXQ`、`SOXX` 或其他代理，也不得使用價格資料推算。如此可避免在同一張商品圖混入不同金融商品而造成錯誤判讀。

### 3. UI 用固定可見標籤揭露來源限制

圖表在收到 unavailable metadata 時顯示「此指數來源未提供成交量」，tooltip／可存取名稱使用相同直接語意。標籤不得遮住 K 線或右側價格軸，匯出圖片也保留該揭露。

### 4. 頁籤政策與 panel 防線同時判定市場

全域控制在目前頁籤有商品且全部符合 `.TW`／`.TWO` 時，才依圖表數量與保存偏好決定 A／B；否則控制項 disabled 且顯示「單一副圖」。每個 panel 在套用 mode 時再依自身 symbol 判定，確保混合清單或商品切換期間不會短暫建立非台股多層 pane。切回全台股頁籤後讀回原 `compactSubchartMode`，不覆寫 localStorage。

## Risks / Trade-offs

- [使用者可能把沒有量柱誤認為載入錯誤] → 在圖表與 API 清楚顯示來源未提供，而不是靜默留白。
- [來源未來開始提供有效量] → metadata 以實際回應的全零狀態為條件；有有效量時恢復正常量柱並隱藏提示。
- [自訂混合頁籤含台股與非台股] → 整頁採最保守的單一副圖，並以 panel 層判定作第二道防線。

## Migration Plan

1. 部署 Worker 的成交量可用性 metadata。
2. 部署前端來源限制標示與市場限定的 effective mode。
3. 以 API 驗證 `^SOX` OHLC 與 volume 均維持來源值、沒有其他商品請求且 metadata 完整。
4. 以正式站驗證美股為 disabled 單一副圖、台股仍可選多層副圖及費半量柱與標示可見。
5. 若需回復，移除可用性 metadata 與前端標示；不需資料庫 migration。

## Open Questions

無。
