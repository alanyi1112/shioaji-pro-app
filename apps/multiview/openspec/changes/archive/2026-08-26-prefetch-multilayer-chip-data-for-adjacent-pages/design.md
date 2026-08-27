## Context

`app.js` 目前在 panel 成功載入後延遲排入相鄰分類頁 K 線預載，依 `currentChartCount()` 取得下一頁與上一頁商品，使用獨立 queue、最多兩個並行 request、generation cancellation 與 `panelPayloadCache`。`chip-panes.js` 則在可見 panel 取得 candles 後，依 tab／symbol 保存的多層副圖選項計算 `desiredDatasets()`，以 `symbol + interval + candle range + sorted datasets` 作 request identity，並提供完成 response cache 與 in-flight single-flight。

目前兩條流程沒有串接。若直接在相鄰頁對五個 dataset 全抓，不但可能放大來源流量，也會因現有 cache key 採 exact dataset set，導致實際 panel 只選部分 datasets 時無法命中。因此本 change 必須先取得 K 線日期範圍，再按目標商品實際保存選項建立精確 chip request。

## Goals / Non-Goals

**Goals:**

- 多層副圖切到下一頁時，主圖與已選 TDCC／籌碼副圖可優先使用預載 cache 完成首繪。
- 下一頁商品數嚴格等於目前圖表數量上限，最後一頁依實際剩餘數量縮減。
- 每檔商品只產生一個去重後的 dataset request，沿用既有 response cache 與 single-flight。
- 預載具備優先級、並行上限、timeout、generation、visibility、network 與記憶體預算。
- cache 過期或更新失敗時保留最後 verified payload，避免副圖短暫出現後消失。
- 以安全 metrics 證明切頁延遲改善，並量化未使用預載與來源成本。

**Non-Goals:**

- 不預載未選取的五種 dataset，也不變更使用者的 pane 選項。
- 不建立下一頁 offscreen Lightweight Charts、canvas、observer、crosshair 或 range listener。
- 不預先建立 SSE／Shioaji demand，不自動啟動 TDCC 歷史 backfill 或 polling。
- 不在本 change 預載 PE river、相鄰頁籤第一頁籌碼、非日 K 或非台股資料。
- 不在本 change 導入 IndexedDB／Service Worker 持久 cache 或 lazy-mount 多層 canvas；這些可依 metrics 另立 change。

## Decisions

### 1. 採兩階段 K 線後接籌碼預載

相鄰頁 K 線 request 成功並取得合法 candles 後，才依其實際日期範圍建立 chip job。這可重用既有 panel payload cache，避免用猜測日期或空 candles 建立錯誤 cache identity。

替代方案是同時發送 K 線與籌碼 request，但籌碼日期範圍只能猜測，容易造成 cache miss、過度下載或 requested range 漂移，因此不採用。

### 2. 只預載下一頁，數量由目前圖表數量決定

Chip queue 的高優先候選只取 `pageIndex + 1`，每頁大小使用 `currentChartCount()`；最後一頁自然縮減。既有 K 線上一頁預載可保留，但上一頁通常已在 panel cache，不另外主動預載籌碼。

多層副圖目前只支援 1／2／3／4 圖，因此 chip queue 單輪最多四檔。6／8 圖 effective mode 會降為單一副圖，不建立 chip prefetch jobs。

### 3. 依每檔商品保存選項建立精確 dataset 集合

`chip-panes.js` 提供不建立 manager／DOM 的純函式，讀取 tab／symbol selection、套用 mode B defaults 與 migration，再回傳去重後 datasets。每檔商品以一個合併 request 呼叫既有 `requestData`／`sharedChipRequest`。

不採全五種 dataset 預載，因為 exact dataset cache key 無法供任意 subset 直接命中，且會增加不必要的 D1／provider 成本。Superset cache reuse 可另行設計，避免本 change 同時引入 payload 拆分與 provenance 合併風險。

### 4. 使用獨立 chip prefetch queue 與共同 generation

K 線預載維持現有最多兩個並行；chip prefetch 預設最多一個並行，確認本機與正式環境負載後才可提高至二。切頁、切 tab、改圖數、改 presentation mode、改 interval 或重排 canonical symbols 時，必須使舊 generation 失效並清空未開始 jobs。

已送出的 best-effort request MAY 完成並寫入全域 cache，但不得回寫目前 panel、notice 或 chart lifecycle。Queue 必須略過完成 cache 與 in-flight identity，且不得阻塞可見頁面的前景 request。

### 5. Cache 採 dataset-aware freshness 與 stale-while-revalidate

完成 response cache 除 payload 外保存 cachedAt、實際 coverage／source date 與 dataset freshness class。日資料與 TDCC 週資料使用不同 freshness 判定；命中仍可先供切頁首繪，過期項目再背景 revalidate。只有 material payload 成功驗證後才取代 cache；timeout、HTTP failure、partial 或暫時空狀態不得清除最後 verified payload。

### 6. 資源與網路 gate 採 fail-soft

`document.visibilityState !== "visible"`、`navigator.connection.saveData === true` 或可辨識的低速 effective type 時，不啟動新的 chip prefetch；既有 cache 仍可使用。平台不支援 Network Information API 時維持 bounded 預載，不把缺少 API 當成錯誤。

所有預載只使用同源 API，不記錄 URL query 全文、使用者身分、header、cookie、token 或上游 response body。

### 7. 效益 metrics 不承載敏感資料

Debug／驗收報告記錄 aggregate `requested`、`cacheHit`、`inFlightJoin`、`usedAfterNavigation`、`evictedUnused`、`failed`、queue depth 與切頁首繪耗時。不得包含個人清單內容、完整 symbol 清單、秘密值或完整 payload。

## Risks / Trade-offs

- [預載放大 D1 或 provider 流量] → 僅下一頁、最多四檔、只抓已選 datasets、單一並行，並以 cache／single-flight／network gate 約束。
- [預載完成前使用者已切頁] → 前景 request 加入同一 in-flight identity，不重送；若 generation 已失效，background job 只可寫 cache，不得碰 UI。
- [exact dataset key 因使用者剛改 pane 選項而 miss] → 切頁時依最新 selection 重新計算；不以全五種 dataset 假裝可命中 subset。
- [cache 過期導致顯示舊資料] → 顯示實際 source date 與 partial／stale 狀態，背景 revalidate 成功後原子取代。
- [Network Information API 不一致] → API 缺席時使用保守預設；測試 visibility／saveData gate，不依賴單一瀏覽器特性。
- [metrics 本身增加主執行緒成本] → 只維護小型 aggregate counters 與 bounded timing，不保存逐 row event log。

## Migration Plan

1. 先加入 pure selection／candidate helpers、cache metadata 與 focused tests，不改預載啟用條件。
2. 接上 K 線 payload 後的 chip queue，以 feature-local gate 在本機驗證 request 數與 cache 命中。
3. 完成 1／2／3／4 圖、最後不足頁、快速切換、失敗保留與 network gate browser 驗收。
4. 確認沒有新增 SSE、backfill、secret exposure 或可見頁回歸後，才將功能視為完成。
5. 回滾時移除 chip queue 接線即可；既有 K 線預載、chip foreground load 與 request cache 仍可獨立運作。

## Open Questions

- Chip prefetch 並行由 1 提升至 2 必須以本機與正式環境 metrics 證明有收益且未增加 rate limit；第一版固定為 1。
- Lazy-mount 多層 canvas 與相鄰頁籤 chip prefetch 是否值得投入，留待本 change 的切頁 timing 與未使用預載比例決定。
