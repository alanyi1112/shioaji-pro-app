## Context

主圖左上角的 K 棒價量與 indicator legend 共用 `CandleChart` 的顯示數值區。K 棒價量由 `src/lib/kbar-readout.ts` 建立欄位與方向 tone；一般 series indicator 由 `src/lib/indicator-defs.ts` 宣告 outputs，`src/components/candle-chart.tsx` 再建立 legend metadata。現況只把 output label 放在 tooltip，畫面本身只渲染數值，因此截圖中的 BOLL、VolMA 與 MA組無法直接辨識每個數值的角色。

實際行情資料流如下：

```text
Shioaji /api/v1/data/kbars
        │  datetime + OHLCV，沒有歷史 reference
        ▼
kbarsToCandles()
        │
        ├─ rawRef：已載入的 canonical 1 分 K，歷史 prepend 後合併
        └─ aggregate() → barsRef：目前時框 candle → crosshair readout

contract.reference / index.reference：只代表目前有效 reference
```

因此歷史 K 棒不能等待不存在的 payload 欄位，也不能套用目前 reference。另一方面，`rawRef` 已保留跨交易日的 1 分 K，既有 Pivot 功能也已用相同資料依日期分組並取得前一交易日 close；本 change 可在不新增 API 的前提下建立歷史昨收索引。

## Goals / Non-Goals

**Goals:**

- 讓 BOLL、均量與均線 readout 直接帶有可讀標籤、穩定順序與原 series 顏色。
- 讓 STK、IND、WRT 的開、高、低、收／最新依 candle 所屬交易日的可靠基準判色：當日使用目前有效 reference，歷史日使用已載入前一個 completed session 的最後收盤價。
- 歷史 prepend 後重新建立索引，讓原本位於載入邊界、無昨收的交易日在前一日資料到齊後可正確判色。
- 保持成交量、指標線、K 棒本體、訂單 UI 與其他非價格語意的既有顏色。

**Non-Goals:**

- 不改變 BOLL、SMA 或 volume SMA 的計算公式、參數、output key 或繪圖資料。
- 不新增 Kbars API 欄位、外部資料來源、無界歷史請求、交易寫入、production session 或真實下單能力。
- 不用日曆日期推測 FUT／OPT 夜盤交易日，本階段維持既有保守判色。
- 不改變 indicator picker 的完整名稱或使用者偏好儲存 schema。

## Decisions

### 1. 從 raw 1 分 K 建立歷史昨收索引

新增純函式，將 `rawRef` 依現有 UTC-shaped 台灣 wall-clock 日期鍵分組並按時間排序。對每一個後續交易日，以前一個不同交易日最後一根有效 candle 的 close 建立：

```text
2026-08-05 最後 close 950  ──▶ referenceByDate[2026-08-06] = 950
2026-08-06 最後 close 911  ──▶ referenceByDate[2026-08-07] = 911
```

只有「後續交易日已存在」時，前一日才可視為 completed reference session；週末與休市日不需要補日期，索引直接連結相鄰的實際交易日。第一個已載入交易日因沒有前一日資料而維持 unavailable。歷史 prepend 或商品／時框 generation 改變時重新建立圖表內索引，並重算目前 readout。

此索引只適用 STK、IND、WRT。當 candle 日期等於目前市場日期且 current reference 有效時，仍優先使用 current reference；在週末或休市日，最新 candle 屬於歷史 completed session，改由索引取得昨收。FUT／OPT 沿用現有 forming-only reference 規則。

替代方案是使用 `barsRef` 或游標前一根 candle。`barsRef` 會依時框聚合，而前一根 candle 通常只是同一交易日上一個 bucket，兩者都不足以表達「前一交易日收盤」，因此不採用。

### 2. 使用獨立的 legend readout metadata

在 series indicator definition 增加可選的 readout metadata，明確描述 row label 與可見 output 順序／prefix。BOLL 指定 upper「上」、mid「中軌」、lower「下」；volume-ma 指定 row「均量」與 `5MA/10MA/20MA`；reference-ma-pack 指定 row「均線」與 `5MA/10MA/20MA/60MA/120MA`。

renderer 依 readout metadata 組合可見項目；缺少 metadata 的其他 indicators 保持既有 declaration order 與只顯示數值的行為。series 建立仍依原本 outputs 執行，避免 UI 排序改變線條建立順序、z-order、style key 或持久化資料。

### 3. 標籤與數值使用同一 output 顏色

每組 prefix 與數值視為同一不可拆語意單位，使用該 output 的既有顏色，例如 `上 952.9` 全組使用 upper series color。BOLL row label 保留 `BOLL(20,2)`；只有 VolMA 與 MA組的 readout row label 分別改成「均量」與「均線」。picker 的完整 label 不變。

### 4. 明確處理窄版與缺值

`legendVals` 必須允許在 output 單位之間換行，單一「prefix + value」不得拆開；父層繼續受圖表寬度限制。尚未暖機或無有限值時保留 prefix 並顯示 `—`，避免後續數值位移。tooltip／accessible name 必須同時包含 prefix 與目前值，且不新增高頻 assertive live region。

### 5. 保留單一方向判斷與多圖隔離

所有 OHLC／最新欄位繼續呼叫 `priceDirection`；volume 固定 neutral。歷史昨收索引、selected candle 與 readout state 維持在各自 `CandleChart`，並受既有 generation guard 與 latest-wins 排程保護，不寫入全域 indicator instance。

## Risks / Trade-offs

- [載入範圍第一個交易日沒有前一日資料] → 維持 flat；prepend 到前一交易日後重新建立索引並刷新 readout。
- [歷史最後一根資料不完整] → 只有已存在下一個交易日、能證明前一 session 已結束時才使用其最後 close；否則維持 unavailable。
- [除權息日的前收與交易所當日參考價可能不同] → 當日仍使用 contract／index reference；歷史依使用者指定的「前一交易日收盤價」顯示，規格與 tooltip 不宣稱它是交易所調整後參考價。
- [讀值標籤增加後造成窄版溢位] → 以 output 單位換行、max-width 與 browser 驗收確保不裁切、不覆蓋圖表右軸。
- [metadata 影響其他 indicators] → readout metadata 採 optional，沒有宣告者完全沿用現況；series outputs 與 persistence schema 不變。
