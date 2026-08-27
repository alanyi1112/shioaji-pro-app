## Context

MultiView 的籌碼副圖會先使用完成 cache 首繪，再由前景或背景 request 更新。現行 `sharedChipRequest` 在 HTTP 200 後立即寫入 request cache，manager 隨後無條件以新 payload 取代目前 payload；pane render 只要 material signature 改變就先移除舊 series。這可正確處理完整的新資料，但無法區分「成功且更完整」與「成功但某個 dataset 暫時為空、較舊或 coverage 倒退」。

台股開盤時，日 K 範圍可能加入新的交易日，stale-while-revalidate、相鄰頁預載、不同 panel 與 TDCC／日資料發布節奏也會讓相同商品收到不同時間完成的回應。影片顯示四個 panel 的大戶／散戶線圖依 request 完成順序逐欄消失，符合逐商品弱回應覆寫最後有效資料的行為。

本變更橫跨前端 request cache、逐 dataset payload 合併、pane render、Worker D1-first 回應及多圖瀏覽器驗收。資料必須維持實際來源日期，不得為了留線而 forward-fill、插值或補零。

## Goals / Non-Goals

**Goals:**

- 讓 HTTP 成功但資料品質退化的回應與 request error 一樣，不得清除最後有效籌碼 series。
- 以逐 dataset 而非整包 payload 作為接受、保留與合併單位，允許一個資料族群更新時保留其他暫時退化的資料族群。
- 讓開盤新 K 棒、cache revalidate、前景載入、背景預載、強制更新與手動回補使用同一套非退化提交規則。
- 保留實際 `sessionDate`／`dataDate`、coverage、provenance 與來源狀態，並向使用者清楚標示最後有效日期及暫時未發布原因。
- 以單元、Worker 整合與四圖實際瀏覽器驗收證明所有籌碼副圖不會先出現再消失。

**Non-Goals:**

- 不改變 TDCC、TWSE、TPEx 或 FinMind 的資料定義、授權與發布時間。
- 不以舊資料冒充當日資料，也不新增 forward-fill、插值、零值補齊或投資人身分推論。
- 不把技術副圖併入籌碼 cache；技術副圖只做同場景壓力驗證，除非驗證能獨立重現其資料退化。
- 不變更 Shioaji production、交易或智慧下單 runtime。
- 不新增 D1 schema 或外部 dependency。

## Decisions

### 1. 建立逐 dataset 的資料切片與品質摘要

每個 payload 先正規化為五個 dataset slice：`institutional-flow`、`foreign-holding`、`margin-short`、`securities-lending` 與 `shareholder-distribution`。日資料 slice 只包含該 dataset 的欄位與相符 provenance；TDCC slice 包含通過級距完整度檢查的 `distributionRows`。

每個 slice 產生不含秘密與完整 payload 的品質摘要：有效資料日期集合、有效點數、最早／最晚實際日期、coverage、availability reason、provenance 合法性及是否存在可繪製 series。相同日期且仍合法的來源修正版可以取代舊值；較新回應不以 row 數單一指標判斷。

替代方案是只檢查 top-level `rows.length` 或 `distributionRows.length`。這無法處理混合 payload，也會把某個 dataset 的缺值誤當整包成功，因此不採用。

### 2. 候選回應先 reconcile，再提交 cache 與 UI

網路回應的處理順序固定為：

1. 驗證 response 與逐 dataset slice。
2. 將候選 slice 投影到目前 request 日期範圍。
3. 與相同 `symbol + interval + dataset` 的最後已驗證 slice 合併。
4. 對新日期或相同日期的合法修正版採用候選資料；候選缺少的既有合法日期仍保留。
5. 產生 reconciled payload 後，才寫入完成 cache、更新 manager payload 及重繪 pane。

若候選 slice 為空、最後日期倒退、有效點數減少或 coverage 不合理縮小，且已有同 identity 的有效 slice，系統保留舊 slice並附加 retained-stale 狀態；沒有舊資料時仍誠實呈現無資料。

替代方案是在 `render()` 發現空資料時跳過 `clearSeries()`。這只能保住畫面，卻會讓 cache、readout、coverage 與詳細資料彼此不一致，因此不採用。

### 3. 最後已驗證資料採穩定 identity，request cache 仍採精確 identity

完成 request cache 繼續使用 `symbol + interval + candle range + sorted datasets`，維持 single-flight 與相鄰頁預載的精確性。另以 bounded 的 `symbol + interval + dataset` verified-slice store 保存最後有效切片及其實際 coverage；讀取時必須裁切到目前 candle range。

切換 symbol 或 interval 不得沿用其他 identity；tab 只影響 pane 偏好，不得使不同 symbol 共享資料。dataset 取消選取後 MAY 保留 bounded cache，但不得繼續顯示或觸發前景更新。

替代方案是放寬 request cache key、不再包含 candle range。這會使不同 viewport／歷史範圍誤用完整 response，並破壞既有 prefetch identity，因此不採用。

### 4. 混合 payload 逐 dataset 合併，metadata 不得說謊

日頻 `rows` 以 `sessionDate` 聯集後只替換已接受 dataset 的欄位與 provenance；未接受 dataset 保留既有欄位。TDCC `distributionRows` 以 `dataDate` 聯集。coverage、sources 與 availability 也依 dataset 合併，不能因另一 dataset 更新而抬高日期。

若來源目前尚未發布或暫時不可用但 UI 正保留最後有效資料，標題與 notice 必須同時表達：

- 線圖與讀值屬於哪一個實際資料日。
- 目前請求為何沒有更新。
- 畫面正在保留最後一次已驗證資料，而不是宣稱當日已有資料。

游標停在未發布日的既有「當日無資料」語意維持不變；本變更只禁止整個歷史 series 被弱回應清除。

### 5. Worker 與前端形成雙層保護

Worker 在 D1 可用時必須以 D1 rows 為基底，逐 dataset 合併新資料後重新讀取並回傳；上游空回應、timeout 或 rate limit 不得刪除 D1 已驗證資料。前端仍必須執行非退化 reconcile，因為 local runtime、cache 首繪、部署版本差異及未啟用 D1 的測試情境都可能收到合法但較弱的 payload。

雙層保護避免把資料安全完全依賴單一 runtime，同時保留 API 的真實 availability 與 warning。

### 6. 驗收以實際開盤序列與逐 pane 證據為準

測試除函式契約外，必須模擬「cache 有完整資料 → HTTP 200 空／較舊／部分回應 → 較新合法回應」序列。瀏覽器驗收使用 4 圖、多層副圖、至少一檔普通股與一檔 ETF，等待超過背景 revalidate 完成時間，逐 panel 檢查 pane DOM、canvas、最後有效日期、network completion 與 console。

技術副圖在相同開盤 K 棒更新期間必須保持資料點與 canvas；若它失敗，另以該獨立 root cause 修正，不得共用籌碼 verified store。

### 7. 持股副圖的價格尺度必須保持可見且接受同日行情通知

大戶／散戶／集保戶數 pane 高度有限，價格軸手動縮放會讓主要持股 series 被移出可視範圍，看起來如同資料消失。持股 pane 因此停用 price-axis pressed-move，但保留時間軸手勢；每次 render、mount 及行情 candle 通知都重新啟用持股相關 price scale 的 autoscale。

Yahoo 日 K 與 Shioaji 日 K 可能用不同盤中時間表示同一台北交易日；尤其 Shioaji 台北午夜在 UTC 仍是前一天。籌碼 request range、cache identity 與 `candleTimeByDate` 因此一律用 `Asia/Taipei` 交易日正規化，不能用 UTC `toISOString()` 截日，否則新價位切換 candle timestamp 後會讓 TDCC `dataDate` 找不到時間錨點。

`chipPaneManager.updateCandles()` 即使 candle 起訖日期未變，也必須把新 candle 陣列通知既有 controller。controller 可在相同日期範圍快速返回，不重建 series、不重新抓籌碼資料，但在返回前必須恢復持股 pane autoscale。只有日期範圍實際改變時才更新時間錨點與 readout reservation。

替代方案是讓使用者雙擊縱軸自行復原。這不能保證新價位後自動恢復，也無法防止四圖窄 pane 中再次把持股線移出畫面，因此不採用。

## Risks / Trade-offs

- [最後有效資料可能比來源當期資料舊] → UI 永遠顯示實際日期與 retained-stale 原因，並在合法較新資料到達後立即替換。
- [合法來源修正可能被誤判為退化] → 相同日期且 provenance／有限值合法的候選修正版可覆寫；比較日期集合與有效欄位，不只比較筆數。
- [verified-slice store 增加記憶體] → 採 bounded LRU／TTL，沿用完成 cache 的淘汰上限思想，metrics 只輸出 aggregate count。
- [不同 candle range 合併可能帶入範圍外資料] → 每次比較與重建 payload 都先裁切到目前 request range。
- [保留舊 slice 造成 availability 與畫面誤解] → 區分 source availability 與 displayed retained data，notice 同時揭露兩者，不改標實際日期。
- [多 panel request 完成順序造成競態] → 仍受 generation、symbol、interval 與 request identity gate 約束；reconcile 完成後才原子提交。

## Migration Plan

1. 先加入逐 dataset 摘要／合併函式與 deterministic tests，不改 UI 接線。
2. 將 `sharedChipRequest` 改為回傳原始候選結果，由 manager reconcile 後再寫完成 cache；背景預載也使用相同合併器。
3. 補強 Worker D1-first 局部合併與回應測試。
4. 更新 retained-stale 文案、aggregate metrics 及靜態資源 cache-buster。
5. 通過 lint、完整測試、build、migration 檢查、OpenSpec strict validation，再執行本機 4 圖長時間瀏覽器驗收。

此變更沒有 D1 schema migration。若發布後需 rollback，可回退前端 reconcile 接線與 cache-buster；既有 D1 rows 不需轉換或刪除。

## Open Questions

- 實作時需以可重現 fixture 確認影片中的弱回應主要來自 TDCC 最新快照、local D1 狀態或 request range 變更；無論來源為何，前端非退化契約與 Worker D1 保留契約都必須成立。
- 本機 5174 若因 Shioaji business session 不可用而無法完成開盤驗收，應先保留 deterministic browser fixture 驗收，待既有 simulation session 可用時再補真實開盤長時間證據；不得為本 change 自動啟停交易相關 runtime。
