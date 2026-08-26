## Context

主交易畫面的 K 棒價量 readout 目前從 `Candle` 取得 OHLCV；`KBars` 型別雖已宣告 `Amount[]`，`kbarsToCandles()`、多時框聚合、形成中 Tick 累加與指定日期 drill-down 都沒有保留成交值。2026-08-24 曾撤回「成交值左側縱軸」並完整移除兩套圖表的 turnover schema；本次產品決策只重新加入主交易畫面 readout 的文字欄位，不能沿用或恢復舊軸線能力。

Shioaji 整股 STK 的歷史 Kbars `Amount` 是該分鐘的實際新台幣成交值，SSE Tick 另提供可選的 `amount`／`total_amount`。成交量已由 `common_lot` cursor 防止bootstrap重複、sequence重放、跨session與generation污染；成交值必須沿用同一事件邊界，但其缺漏不得阻止合法價格與成交量繼續更新。

## Goals / Non-Goals

**Goals:**

- 讓主交易畫面每根台股整股 STK K 棒具有可驗證、可聚合且可標示不可用的精確成交值。
- 在既有 readout 的「量」之後固定顯示「值」，畫面為`值 9,355萬`，tooltip／accessible name為`成交值 9,355萬元`。
- 讓歷史、形成中、歷史補載、商品／時框切換及指定日期1分K使用相同generation-safe資料生命週期。
- 缺少可信成交值時只讓「值」降級為`—`，不得估算，也不得破壞OHLCV或其他指標。

**Non-Goals:**

- 不恢復左側成交值軸、成交值series、autoscale、圖例、設定開關或任何成交值視覺化。
- 不修改MultiView、gateway／Worker payload、cache fingerprint、D1或遠端資料來源。
- 不把成交值提供給技術指標、Volume Profile、下單、智慧單、broker adapter或風控。
- 不啟用production、CA、broker write、真實委託、部署或服務操作。

## Decisions

### 1. 成交值以主圖canonical candle的可選精確欄位承載

主交易畫面的`Candle`新增明確命名的`turnoverTwd: number | null`；只有經schema驗證的Shioaji `KBars.Amount`或Tick增量可填入非負safe integer。`null`代表不可用，不允許由OHLC、volume、average price或其他欄位推導。額外欄位隨candle一起排序、copy、generation commit與聚合，可避免另建time-keyed map後與crosshair candle漂移；除readout與聚合外，其他series／indicator不得消費此欄位。

替代方案是建立獨立turnover index，但歷史prepend、live tail reattach與target-date atomic commit都必須額外維持time join，較容易出現舊generation的值搭配新candle，因此不採用。

### 2. 歷史與高時框只加總原始精確Amount

`kbarsToCandles()`逐列驗證`datetime／OHLCV／Amount`對齊；合法`Amount`以新台幣元保存。`aggregate()`只有在bucket內每根來源candle的`turnoverTwd`都可用時才加總，任一缺漏或溢位即將該bucket標為`null`，不得只加總已知子集合。歷史補載與live tail reattach沿用相同candle欄位，避免價格、量、值來自不同snapshot。

### 3. 形成中成交值與成交量共用事件接受邊界

既有`CommonLotVolumeCursor`提升為可同時追蹤`total_volume`與`total_amount`的STK累計cursor；identity、台北交易日、source time、sequence與generation只判定一次。合法`total_amount`以相鄰累計值差額更新forming candle；只有每筆`amount`可用時，可在相同已接受sequence上作精確fallback。兩者同時存在卻互相矛盾、累計倒退、重放、跨session、舊generation或數值不安全時，成交值chain維持unavailable直到下一次可信Kbars bootstrap或新session，但合法OHLCV／volume仍可繼續。

這個設計不允許以`close × volume × 1,000`補值，也不因成交值缺漏而丟棄真實價格更新。

### 4. 顯示採萬元縮寫且可存取語意一致

readout欄位順序固定為時間、開、高、低、收／最新、量、值。台股整股成交量顯示`量 910張`；成交值顯示標籤`值`與萬元值。100萬元以上取最接近的整數萬元並加千分位；0.1萬元以上且未滿100萬元保留一位小數；正值未滿0.1萬元顯示`<0.1萬`，零值顯示`0萬`。tooltip與accessible name使用相同精度及單位，只把標籤展開為`成交值 …萬元`，不另顯示元。

單一`標籤 + 數值 + 單位`保持不可拆分，整組readout可在欄位邊界換行；高頻crosshair更新不得新增assertive live region。

### 5. 指定日期drill-down把成交值當成同snapshot的availability layer

主交易畫面target-date loader從同一次Shioaji Kbars response驗證`Amount`，並將`turnoverTwd`隨每根1分candle納入不可變response、build layers與atomic commit。Amount缺漏只把該candle／bucket標為不可用，不得讓合法OHLCV drill-down失敗，也不得在commit後另行補接其他日期或最新行情。返回日K後依一般source重新載入。

MultiView的target-date contract與payload維持不變；共用規格只記錄主交易畫面的新增availability layer。

### 6. 新change明確取代舊「readout也不得保留turnover」敘述的局部範圍

2026-08-24 archive仍是撤回左軸、series、MultiView與gateway turnover的權威歷史。這個change只以新版本主規格重新允許主交易畫面readout資料鏈；不得把舊turnover tests、fixtures或已撤回evidence當成目前驗收證據。

## Risks / Trade-offs

- [Tick `amount／total_amount`可選或格式漂移] → 嚴格parser、safe-integer上限與獨立availability狀態；不可信時顯示`值 —`且不估算。
- [成交量已接受但成交值chain失效] → 共用事件identity／sequence判定，分開保存value availability；成交值只在下一次可信bootstrap恢復。
- [歷史補載或live tail造成Amount重複] → turnover隨canonical candle及generation一同merge，針對same-bucket replacement、prepend與重放加入integration tests。
- [萬元四捨五入隱藏元級差異] → 畫面與accessible name刻意使用相同萬元精度，避免兩處讀值矛盾；domain仍保留精確TWD供後續readout更新，不提供其他功能使用。
- [新增欄位擴散至已撤回能力] → production residual tests明確禁止left scale／series／MultiView／gateway turnover接線，code review只允許主圖readout consumer。
- [窄版新增欄位造成遮蔽] → 保留既有field-level flex wrap並補實際browser寬度、字級及鍵盤／tooltip驗收。

## Migration Plan

1. 先建立成交值parser、formatter、canonical candle及聚合的純domain測試。
2. 接入歷史Kbars、歷史補載、forming Tick cursor及target-date atomic snapshot，驗證缺漏與重放均fail unavailable。
3. 最後接入主交易畫面readout與browser-visible驗收；確認MultiView、左軸及既有智慧單change沒有diff。
4. 若驗收失敗，可移除readout consumer與新optional欄位；OHLCV、成交量及既有drill-down仍可維持原行為。

## Open Questions

無。產品文字已確認為畫面`值 …萬`、tooltip／accessible name`成交值 …萬元`。
