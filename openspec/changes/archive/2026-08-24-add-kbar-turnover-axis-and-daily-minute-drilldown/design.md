## 背景

主交易畫面與 MultiView 都能顯示日 K 與最近區間的分鐘 K。若只沿用一般 interval selector，會看到最近交易日而不是所選日期，因此主交易畫面與 MultiView 單一圖表都需要唯讀、精確日期、simulation-only 的獨立載入與原子提交路徑；MultiView 多圖模式則維持快速單擊與雙擊開單圖導覽。

2026-08-24 產品範圍調整後，原先成交值左軸能力完全撤回。設計、production runtime 與 evidence 不再依賴 `Amount`、`total_amount` 或 turnover metadata。

## 目標

- 以 canonical `Asia/Taipei` 日期建立單日 `1m` request，並在 Kbars read 前重新確認 simulation。
- 只接受相同 source、symbol、target date、schema 與 latest generation 的完整回應。
- 成功時一次切換所有可見資料層，失敗時維持原日 K context。
- 明確仲裁日 K 單擊、雙擊、drag 與既有工具 gesture ownership。
- 主交易畫面與 MultiView 單一圖表共用 request／response／reason contract；MultiView 多圖模式只維持導覽用途，不啟動指定日期 loader。
- MultiView 的單擊不得為等待雙擊而延遲；大戶持股等籌碼資料刷新不得先清除同 context 已驗證結果。

## 非目標

- 不提供分鐘 K 成交值左軸、turnover schema、formatter、cursor 或 gateway 傳遞。
- 不以今天、最近交易日、Yahoo 或 sample candles 替代指定日期。
- 不變更右側成交量、價格 scale、分日線、指標公式或交易行為。
- 不新增資料庫、外部依賴、production login、CA、broker authority 或委託操作。

## 決策

### 1. 指定日期使用獨立、短生命週期 request

request 綁定 canonical symbol、local simulation source identity、target date、`Asia/Taipei`、`1m`、generation、600 根上限與 single-flight key。start／end 必須等於 target date；loader 在 Kbars read 前重新讀取 `/api/v1/info`，只有 `simulation === true` 才繼續。

回應必須使用 current schema，且 symbol、source、mode、request identity、日期與 interval 完全一致。每根 candle 的 timestamp 與 `sessionDate` 都必須落在 target date，資料需非空、依時間嚴格遞增、OHLCV 合法且不超過上限。

### 2. staged load 與 atomic commit 分離

loader 先完成 request、simulation guard、Kbars read 與 response validation；projection 階段再建立 source、readout、volume、indicators、day boundaries 與 viewport。所有 layer 都存在且 current identity 未漂移後，才一次建立 immutable `1m` context。

主交易畫面在 paint 前套用 exact-date observation。任一階段錯誤、取消、舊 generation 或商品 identity 漂移都回傳原 baseline，不得留下 interval 與 candles 不一致的中間狀態。

### 3. bounded gesture arbiter 保留既有 ownership

主交易畫面日 K 觀察模式的有效 K 棒左鍵單擊最多延遲 260ms，等待是否形成同棒雙擊。單擊逾時只提交一次既有壓撐／點價行為；同棒雙擊取消 pending 單擊並啟動 drill-down。不同 K、非左鍵、非日 K、forming／非法目標、交易 mode 或 drawing owner 不觸發 drill-down。

MultiView 不使用這個 arbiter。主圖合法單擊立即執行既有壓撐、註記或固定範圍工具；多圖 panel 合法雙擊直接呼叫既有單圖導覽。單一圖表只有在日 K、左鍵、主圖 plot、有效且已完成 candle、沒有 pending annotation／固定範圍工具 ownership 時，才以命中日期啟動 target-date loader；非日 K、背景或控制項不切換。

### 4. 主交易畫面 single-flight 只去重唯讀資料讀取，不放寬 generation guard

相同 source／symbol／target date request 可共用一次 info 與 Kbars read；每個 consumer 仍以自己的 generation 與 symbol identity 驗證 commit。共用 promise 完成後必須清除 inflight entry。

### 5. 籌碼資料採同 context stale-while-refresh

籌碼 request identity 由 canonical symbol、interval、K 棒日期範圍與排序後 dataset 集合組成。manager 只有在商品或週期改變時清除既有 payload；同 identity 的重排、模式 reconciliation 與暫時空 K 棒不得重抓或清空。日期範圍更新時可背景刷新，但成功前保留上一份同商品資料；取消或短暫失敗只更新提示，不把已驗證的大戶持股 render 成空集合。回補明確 invalidation 仍以 `force` 重新讀取。

### 6. 副圖 lifecycle 分離 topology、anchor 與 material render

技術副圖初次 time range 尚未成立時，只能在既有 chart 上 resize 並重新套用主圖 logical range，不得以 `remove()` 加遞迴 `renderIndicatorChart()` 重建相同 series。籌碼 manager 的日期範圍更新只更新 neutral time anchor 並啟動一次必要 request，不經 topology `reconcile()` 先全量重畫舊 payload。

籌碼 response 以排除 `fetchedAt`、cache mode、requested range 等非可見欄位的 material signature 判斷；每個 pane 再合併自身 series／threshold control signature。只有 material data 或該 pane 控制值改變才可清除並重建 series；相同內容、純重排、layout refresh 與 metadata-only refresh 必須 reuse。

### 7. 游標熱路徑只提交每 frame 最新 candle

Lightweight Charts 的 `subscribeCrosshairMove` 是主圖、技術副圖與籌碼副圖的游標時間來源。原生 `pointermove` 只保留繪圖工具 preview，不再建立第二條 crosshair 同步來源；一般 pointer move 不得排程主圖全部 overlay 重建。

同一 panel 的高頻事件以 animation frame 合併，只 render 該 frame 最後一個合法 candle。已提交的 `payload render signature + candle time` 若未改變，後續事件不得再次更新主／技術／籌碼 readout、呼叫所有 pane 的 `setCrosshairPosition` 或量測 panel geometry。籌碼 readout 另以內容 signature 去重 DOM；annotation preview 也透過單一 frame gate latest-wins，不在每個原始 pointer event 同步 `replaceChildren()`。

### 8. MultiView 單圖 target-date commit 不得混入目前行情

MultiView page-scoped local Shioaji coordinator 必須先即時重驗 `/api/v1/info` 的 `simulation === true`，再以同一 target date 作為 Kbars `start`／`end`，並以 source／symbol／date single-flight 共用整個 info＋Kbars read。response 必須通過共用 schema、日期、排序、數量與 generation guard。

載入及 projection 期間原日 K 保持可見；只有 current chart count、panel、symbol、interval、load token 與 drill-down generation 全部未漂移時，才停止目前 stream、把 interval 控制與所有 chart layers 一次提交為同日 `1m`。指定日期畫面不得立刻重新接 realtime stream；使用者改選其他週期時才回到一般 loader。

## 風險與緩解

- 快速切 symbol／interval 讓舊資料覆蓋新 context：latest generation、symbol 與 panel identity 三重檢查。
- 單擊壓撐與雙擊 drill-down 同時發生：bounded arbiter 取消同棒 pending single。
- 部分 layer 已套用後才失敗：所有 projection 在 baseline 外完成，完整後才 atomic commit。
- Yahoo／非 simulation 被誤當正式指定日期來源：request source allowlist 與 Kbars 前 simulation recheck。
- 籌碼舊資料跨商品洩漏：商品或週期 identity 改變時同步 abort、清除 payload 與 request key，再 render 新 context。
- 背景刷新失敗造成大戶線消失：只在沒有任何有效 payload 時 render 空狀態，否則保留最後一份已驗證資料並顯示錯誤提示。
- 初次副圖 layout 尚未穩定造成重建閃爍：recovery 只 resize／sync viewport，不移除 chart、不遞迴 render。
- context refresh 先畫舊資料再畫新資料：日期 anchor 與 material render 分流，per-pane signature 拒絕相同內容的第二次 render。
- 游標移動造成主執行緒尖峰：移除 pointer move 的全 overlay render，crosshair／annotation 分別採 latest-wins frame gate，相同 candle 與相同 readout DOM signature 直接 reuse。

## 遷移與 rollback

1. 保留共用 request／response／gesture／commit contract 與 fixture。
2. 接入主交易畫面 production runtime 並完成 focused／browser 驗收。
3. MultiView 維持雙擊開單圖，移除 target-date script、coordinator 與 panel routing，並驗證單擊不再等待 260ms。
4. 修正籌碼 payload lifecycle，完成大戶持股刷新／取消／錯誤與重排驗收。
5. 文件區分主交易畫面指定日期 drill-down與 MultiView 單圖導覽。

rollback 不得重新接回 MultiView bounded arbiter。主交易畫面可獨立移除 drill-down handler；籌碼 lifecycle 若回退仍必須避免跨商品沿用 payload，且不得清除使用者 indicator、註記、panel、壓撐或交易設定。
