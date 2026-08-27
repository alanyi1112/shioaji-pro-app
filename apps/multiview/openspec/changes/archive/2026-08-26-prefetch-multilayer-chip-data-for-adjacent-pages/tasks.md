## 1. 候選商品與 dataset identity

- [x] 1.1 建立 pure helper，依 active tab canonical ordering、目前 page 與 `currentChartCount()` 回傳下一頁實際商品，涵蓋 1／2／3／4 圖與最後不足頁
- [x] 1.2 在 `chip-panes.js` 提供不建立 manager／DOM 的 mode B selection 讀取與 migration helper，依 tab／symbol 回傳已選 pane 所需去重 datasets
- [x] 1.3 讓 chip prefetch 與 foreground load 共用 `symbol + interval + candle range + sorted datasets` request identity、完成 cache 與 in-flight single-flight
- [x] 1.4 為完成 cache 增加 bounded metadata、dataset-aware freshness、使用狀態與 stale-while-revalidate 判定，不保存個人清單或秘密資料

## 2. 下一頁籌碼預載排程

- [x] 2.1 在下一頁 K 線預載取得合法 candles 後，以實際起訖日期接續建立 chip prefetch job；空或無效 candles 必須安全略過
- [x] 2.2 只在有效多層副圖、日 K、合格 `.TW`／`.TWO` 與 1／2／3／4 圖 context 啟用，6／8 圖、單一副圖、主圖與非台股不得排入
- [x] 2.3 建立獨立 chip priority queue，第一版並行上限 1，支援 timeout、cache／in-flight 去重與可見頁 foreground 優先
- [x] 2.4 將切頁、切 tab、改圖數、改模式、改週期與 canonical ordering 變更接到 generation cancellation，失效 callback 不得操作目前 UI
- [x] 2.5 加入 `document.visibilityState`、`navigator.connection.saveData` 與受支援低速網路 gate；缺少 Network Information API 時維持 bounded fallback
- [x] 2.6 確保 offscreen 預載不建立 chart／canvas／observer／SSE／Shioaji demand，不呼叫 backfill endpoint 或啟動 TDCC polling

## 3. 快取首繪、更新與可觀測性

- [x] 3.1 切頁時以最後 verified chip cache 完成首繪，foreground revalidate 成功後才依 material signature 原子取代
- [x] 3.2 timeout、HTTP error、rate limit、partial 與暫時空資料時保留最後 verified payload、series、source date 與 coverage，並顯示安全狀態
- [x] 3.3 新增 aggregate `requested`、`cacheHit`、`inFlightJoin`、`usedAfterNavigation`、`evictedUnused`、`failed`、queue depth 與切頁首繪 timing metrics
- [x] 3.4 將 metrics 納入既有 debug report，確認不輸出頁籤名稱、完整商品清單、URL query、header、cookie、token 或完整 payload

## 4. 回歸測試與實際驗收

- [x] 4.1 加入 1／2／3／4 圖、最後不足頁、canonical ordering、mode B defaults／migration 與 dataset 去重的 focused tests
- [x] 4.2 加入 cache hit、in-flight join、stale-while-revalidate、generation cancellation、visibility／saveData gate 與失敗保留測試
- [x] 4.3 加入負向測試，證明單一副圖、主圖、6／8 圖、非日 K、非台股及無效 candles 不產生 chip prefetch、SSE 或 backfill
- [x] 4.4 在本機實際瀏覽器以至少四圖兩頁驗收 Network 請求：下一頁最多四個合併 chip requests，切頁後命中 cache，沒有逐 pane 重送或 console error
- [x] 4.5 驗收快速往返頁面／頁籤／模式、預載失敗與來源 partial 時，最後頁商品正確、已選副圖不消失、最後 verified 日期與資料仍保留
- [x] 4.6 比較變更前後切頁至 K 線首繪及全部已選副圖首繪時間，記錄預載使用率與未使用淘汰率，確認收益後才考慮提高並行或擴張相鄰頁籤
- [x] 4.7 執行 nested OpenSpec strict validation、相關前端／Worker tests 與既有 MultiView browser regression；不得以 source inspection 取代實際 Network／canvas 驗收
