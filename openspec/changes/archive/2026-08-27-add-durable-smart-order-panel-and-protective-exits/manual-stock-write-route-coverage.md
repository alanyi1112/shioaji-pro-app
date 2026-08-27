# 股票手動交易寫入路由覆蓋基線

## 1. 文件狀態與安全邊界

- 文件版本：`2026-08-14.2`
- 對應 change：`add-durable-smart-order-panel-and-protective-exits`
- 對應 task：`0.13`、後續 `0.17`、`3.7`、`6.2`、`14.7`
- 盤點方式：只讀取目前 repo 的 TypeScript／Vite／OpenSpec 原始碼；未呼叫 API、未讀取帳號值、未執行任何 broker write。
- 本文件與 `scripts/smart-order-runtime/manual-route-coverage.mjs` 是 task 0.13 的閉世界 inventory／classifier 基線，不是 write-unlock 證明。本文列出的現有寫入入口仍未經可信 server-side trading-write gateway 執行，因此所有可使用這些入口之股票帳號，其 automation write master 必須維持 `false`。
- 本文件只盤點股票 place／update／cancel。期貨、選擇權與組合單雖可能共用部分函式或畫面，但不因此列入股票 automation allowlist；跨商品混合入口必須先在 server boundary 解出 canonical security type，才能套用本矩陣。
- `manual_user_confirmed`、`automation`、`gate_probe` 均為未來 gateway 在可信 server boundary 衍生的分類；目前 browser payload、React state、`custom_field`、環境變數或 feature flag 都不是可信 provenance。

### 1.2 Task 6.2 superseding 狀態

Task 6.2 已將本文盤點的 18 條股票 place／update／cancel route 全部改經 same-origin gateway 與 private server-side classifier；manual request 保留原本合法 order-class payload，automation caller 不能取得或複用 manual confirmation。`src/lib/shioaji.ts` 的股票 helpers 不再直接呼叫 8080 broker route，而 futures／options helper 也會機械性拒絕股票 contract，因此本文的 route migration、manual equivalence 與 server-derived provenance projection 現為完成。

這個完成狀態只證明「寫入入口已統一納管且當前 fail closed」；Gate 0 simulation evidence、risk／resource／target resolution、write master 與 broker adapter 仍未解鎖。目前 control plane 對該統一寫入 route 回傳 `423 broker_write_gate_closed`，`brokerWriteAttempted=false`、`brokerWriteAuthority=false`、`writeMasterAuthority=false`，不會產生 broker bytes。下列第 2–8 節保留 task 0.13 時的原始紅隊 inventory 與遷移需求；本節與第 6 節的唯一 machine-readable projection 是 current authoritative 狀態。

### 1.1 覆蓋狀態詞彙

| 狀態 | 定義 | 對 automation 的效果 |
|---|---|---|
| `observed_bypass` | 原始碼中可到達 broker write sink，但尚未經中央 gateway／arbiter | 對應股票帳號 automation disabled |
| `manual_candidate` | 行為由目前可見的使用者操作開始，可作為未來 `manual_user_confirmed` 候選 | 未完成等價回歸前仍 disabled |
| `automation_candidate` | 由 timer、行情 callback、背景引擎或其他無逐筆即時使用者確認的 caller 開始 | 只能分類為 `automation`，不得借用 manual route／confirmation |
| `probe_candidate` | 只允許獨立 Gate CLI、同 run nonce 與同 run target | 不得由一般 UI／scheduler 呼叫；不會開啟一般 automation |
| `not_exposed` | 型別可能列名，但目前未找到可到達股票 broker sink 的 callsite | 不得據此宣稱已支援 |
| `governed` | route、caller、帳號、order class、確認、風控與 target resolution 已被 manifest 及測試完整覆蓋 | 仍須同時通過其餘 Gate conjunct |

## 2. 共用 broker write sink

目前所有已找到的股票寫入最後都進入 `src/lib/api.ts` 的 `apiPost()`，再由 browser `fetch` 或 Tauri HTTP plugin 送往 `getApiBase()`。Web 開發模式另可能經 Vite `/api` proxy。這些是 client-side transport，不是可衍生可信 provenance 的 server gateway。

| Sink ID | HTTP contract（目前原始碼） | Adapter symbol | account／target | 現有 mode／risk 檢查 | 現況與缺口 |
|---|---|---|---|---|---|
| `STK-SINK-PLACE` | `POST /api/v1/order/place_order`；body `{contract, stock_order}` | `src/lib/shioaji.ts::placeStockOrder` | `stock_order.account = accountFor('S')`；若沒有已選帳號會是 `undefined`，註解明示可能讓 server 選 default | `apiPost()` 只在 client 端呼叫 `assertRuntimeAllowsRequest()`；只有 `production-readonly` 被擋，`unknown` 未被擋。sink 本身不做 `checkOrderAllowed()`、LIVE、confirmation、reservation 或 provenance 檢查 | `observed_bypass`。帳號不固定、browser 可共用、無 canonical unit／order-class validation；不可供 automation 使用 |
| `STK-SINK-UPDATE-PRICE` | `POST /api/v1/order/update_price`；body `{trade_id, price}` | `src/lib/shioaji.ts::updateOrderPrice` | 只有 `trade_id`；沒有 account、trade date、contract、side、remaining quantity 或 broker revision | 同上；沒有 LIVE、risk、confirmation、target revalidation | `observed_bypass`。需先由固定帳號 refreshed trades 唯一解析 target，再在 lock 內緊鄰 broker bytes 前重驗 |
| `STK-SINK-UPDATE-QTY` | `POST /api/v1/order/update_qty`；body `{trade_id, quantity}` | `src/lib/shioaji.ts::updateOrderQty` | 只有 `trade_id`；沒有 account／revision；UI 文案稱「僅能減量」，sink 未自行證明或強制新量小於 remaining quantity | 同上 | `observed_bypass`。需驗整數、單位、remaining quantity、terminal state、revision 與 broker 實際 contract |
| `STK-SINK-CANCEL` | `POST /api/v1/order/cancel_order`；body `{trade_id}` | `src/lib/shioaji.ts::cancelOrder` | 只有 `trade_id`；股票與期貨 callsite 共用同一函式 | 同上；cancel 不經 `checkOrderAllowed()`，也沒有 account／target revision gate | `observed_bypass`。gateway 必須先分類商品與帳號，禁止用短 ID 或跨帳號模糊 target |

共用 mode guard 的 allowlist 位於 `src/lib/runtime-mode-shared.ts::TRADING_WRITE_PATHS`，Vite middleware 也只在 mode 恰為 `production-readonly` 時拒絕。`unknown`、mode file TOCTOU、Tauri 直連、外部 client 與直接連到 broker server 的路徑，不能由這個 browser／Vite guard 證明已 fail closed。未來中央 gateway 必須在 broker bytes 前再次以 shared mode lease 與雙重 simulation attestation 驗證；不能把現有 UI disabled 狀態當成安全閘門。

## 3. Place 入口與 provenance 候選

下列 Route ID 是本 change 的穩定 coverage ID；實作時 manifest 必須用這些 ID 或明確 versioned successor，不能只記檔名或顯示文字。

| Route ID | Callsite／觸發方式 | 實際股票 order class | account／cond／lot／price／TIF／unit | 現有檢查 | Provenance 候選、旁路與處置 |
|---|---|---|---|---|---|
| `STK-MAN-PLACE-TICKET` | `src/components/order-ticket.tsx::OrderTicket.execute`；按鈕第一次 arm、第二次送出 | Buy／Sell；`LMT` 或 `MKT`；`ROD`／`IOC`／`FOK`；`Common`／`IntradayOdd`；Common Sell 且 contract `day_trade === 'Yes'` 時可送 `daytrade_short=true` | account：目前 UI selected stock 或 server default fallback；cond：request 無 `order_cond`，不得宣稱融資／融券，Cash 也只是未明示的候選；lot：Common 或 IntradayOdd；MKT price 送數字 `0`；quantity：Common 畫面為「張」、IntradayOdd 為「股」；TIF：畫面可在切換 MKT 後再選 ROD／FOK，因此實際可組出未驗證組合 | UI LIVE disabled；兩步按鈕；送出前 `checkOrderAllowed(qty)`；LMT 價格須有限且大於零；sink 仍無 server confirmation／fixed account／class validator | `manual_candidate`。confirmation 必須綁定完整 canonical payload；所有 UI 可組合須逐列驗證或在 manual manifest 標為 unsupported，不能以 automation 縮限默默改寫 |
| `STK-MAN-PLACE-CHART` | `src/components/candle-chart.tsx` 的 chart `buy`／`sell` mode，選 mode 後點價一次送出 | Common `LMT+ROD` Buy／Sell | account：同 sink fallback；cond：未明示；lot：placeQuickOrder 預設 Common；price：chart 點選價；TIF：ROD；quantity：toolbar 文案為張數，實際 number | `placeQuickOrder()` 檢查 LIVE、IND、`checkOrderAllowed()`；chart mode 是 one-shot，但沒有 server-issued confirmation | `manual_candidate`。點 mode＋點價可視為一次確認候選，但必須 server 生成短效 payload-bound confirmation；直接呼叫 helper 仍是旁路 |
| `STK-MAN-PLACE-FLASH` | `src/components/flash-order.tsx::send`；先啟用閃電下單，再點價格格或市價按鈕 | Common `LMT+ROD` 或 Common `MKT+IOC` Buy／Sell | account：同 sink fallback；cond：未明示；lot：Common；price：格價或 MKT→0；TIF：ROD／IOC；quantity：畫面數字，股票預期為張但未有 branded unit type | 非 LIVE 自動 disarm；arm、inflight key 防重；`placeQuickOrder()` 做 LIVE／risk | `manual_candidate`。每次點擊都須取得獨立或受限連續操作 confirmation policy；單一 arm toggle 不能成為無期限 bearer capability |
| `STK-MAN-PLACE-FLASH-FLAT` | `src/components/flash-order.tsx::flatten` → `send()`；armed 後以聚合 position 反向市價 | Common `MKT+IOC` | `fetchPositions('S')` 明確要求 `unit: Share`，但 Flash 直接把 `pos.net` 傳給預設 Common order；account／cond 同上 | arm、LIVE、risk；未見 Share→CommonLot conversion | `manual_candidate`，但目前有高風險單位不一致候選，等價回歸前不可納管為可用。若股票 position 為 Share，必須改走 exact Share→CommonLot／IntradayOdd 拆分或明確 disabled |
| `STK-MAN-PLACE-POSITION-CLOSE` | `src/components/bottom-dock.tsx::PositionsTable.act(..., 'close')` | 對 Share position：整千股拆為 Common `MKT+IOC`，餘數拆為 IntradayOdd `LMT+ROD`，價格用 Sell limit_down／Buy limit_up | account：同 sink fallback；cond：position 有可選 `cond`，但 helper 未把 cond 傳回 order，因此無法證明融資券部位能安全平倉；lot／unit：CommonLot＋Share 拆分 | 表頭需先 unlock；LIVE disabled；helper 檢查 LIVE；每個子單個別走 risk，但沒有原子 reservation／整體 confirmation | `manual_candidate`。confirmation 必須綁定拆分計畫與所有 legs；任何 cond 不明、limit 缺失、部分成功後未知都需停止並人工處理 |
| `STK-MAN-PLACE-POSITION-REVERSE` | 同上，`act(..., 'reverse')`，quantity 使用 position Share × 2 | 與 close 相同拆分，但建立反向曝險 | account／cond／lot／unit 同上 | arm／LIVE／分腿 risk；未見 account-wide reservation 或原子風控 | `manual_candidate`，新曝險風險高於 close；未完成 canonical cond、unit、reservation 與 partial-leg recovery 前應在 automation 帳號 disabled，且不得被保護單 classifier 誤認 reduce-only |
| `STK-MAN-PLACE-GRID-ONCE` | `src/components/grid-ticket.tsx::layGrid` → `placeAt`；使用者 unlock 後點「鋪 N 檔」 | Common `LMT+ROD` Buy／Sell，多筆；`custom_field='sjgrid'` | account：同 sink fallback；cond：未明示；lot：Common；price：依 tick helper 與 limit band；quantity：每檔 CommonLot；TIF：ROD | 一次檢查 `checkOrderAllowed(qtyPer * levels)`；LIVE 只在按鈕 disabled；逐筆送出，部分失敗仍繼續；無 batch reservation／canonical confirmation digest | `manual_candidate`，但 confirmation 必須綁定有限、排序後的全部 legs 及最大 operation count；不可把 `custom_field` 當 provenance |
| `STK-AUTO-PLACE-GRID-FOLLOW` | `src/components/grid-ticket.tsx` 2.5 秒 timer；armed＋follow 時自動補缺價位 | Common `LMT+ROD` Buy／Sell，多次 cancel／replace | 與 grid once 相同 | 每 cycle 最多 4 ops、recent map 防重；**timer 補單沒有重新執行 `checkOrderAllowed()`、沒有逐筆 confirmation**；仍只剩 client mode guard | `automation_candidate` 且為目前明確旁路。scheduler 不得重用 `STK-MAN-PLACE-GRID-ONCE` confirmation；在中央 automation gate、reservation、queue、reconcile 完成前必須 disabled |
| `STK-AUTO-PLACE-TRIGGER` | `src/lib/trigger-engine.ts` legacy compatibility runtime | 無 broker order class；舊 storage只保留人工重建資訊 | 不再持有 account／order payload／broker caller | 現行實作為 alert-only，production import graph無 `placeQuickOrder`／broker sink | `retired_fail_closed`。AST inventory仍保留穩定 Route ID，若未來重新出現 broker callsite會使 coverage test失敗並維持automation disabled |
| `STK-AUTO-PLACE-BRACKET-EXIT` | `src/lib/bracket.ts` legacy compatibility boundary | 無 broker order class | 不再建立 watcher／trigger／broker payload | production API固定同步拒絕 bracket建立 | `retired_fail_closed`。不得以相同名稱另建旁路；任何新實作須使用新的受管 Route ID與automation provenance |

### 3.1 型別存在但目前未找到股票 place callsite

`src/lib/types/order.ts::StockOrderLot` 還列出 `BlockTrade`、`Fixing`、`Odd`，但目前可到達的股票 UI 只找到 `Common` 與 `IntradayOdd`；不得把型別 union 當成實際手動支援證據。`MKP` 只存在於 futures price type／期貨畫面，股票 `StockPriceType` 只有 `LMT | MKT`，因此股票 MKP 為 `not_exposed`。股票 place request 沒有 `order_cond`，所以 Cash／融資／融券的實際 broker mapping均未由目前 client contract 證明；`daytrade_short` 也不能自行推論等同所有現沖或融券語意。

## 4. Update／cancel 入口與 provenance 候選

| Route ID | Sink | Callsite／觸發方式 | Target 選取現況 | Provenance 候選、旁路與處置 |
|---|---|---|---|---|
| `STK-MAN-UPDATE-ORDER-PRICE` | `STK-SINK-UPDATE-PRICE` | `src/components/bottom-dock.tsx::EditableCell`，Orders table 輸入新價格 | 從合併股票／期貨 trades 的 `Trade.order.id` 直接送 `trade_id`；只驗 `n > 0` | `manual_candidate`。server 必須由固定股票帳號＋trade date＋broker IDs 唯一解析，綁 revision 並驗 tick／limit／order class；目前為 `observed_bypass` |
| `STK-MAN-UPDATE-ORDER-QTY` | `STK-SINK-UPDATE-QTY` | 同上，輸入新量 | 只驗整數且 `>=1`；預填 remaining quantity，但未比較新量不得增加；單位取決於原 order lot | `manual_candidate`。confirmation 必須綁新量、原量、remaining 與 unit；server 在 lock 內拒絕增加／terminal／revision drift；目前為 `observed_bypass` |
| `STK-MAN-UPDATE-CHART-DRAG` | `STK-SINK-UPDATE-PRICE` | `src/components/candle-chart.tsx` 拖曳 working-order price line 後 mouseup | 從圖上 `Trade.order.id` 直接送；price 只經 `roundToTick` | `manual_candidate`。一次 drag release 可作 confirmation gesture 候選，但仍需 server-issued payload-bound confirmation、固定帳號與 target revision；目前為 `observed_bypass` |
| `STK-MAN-CANCEL-ORDER-TABLE` | `STK-SINK-CANCEL` | `src/components/bottom-dock.tsx::OrdersTable.doCancel` | 合併 trades 的 id；錯誤被吞下，靠後續 refresh | `manual_candidate`。server 必須先分類股票／帳號並回傳可對帳結果；目前為 `observed_bypass` |
| `STK-MAN-CANCEL-CHART` | `STK-SINK-CANCEL` | `src/components/candle-chart.tsx` working order 列的 CANCEL | 目前 chart contract 的 working orders，但最終仍只送 id | `manual_candidate`；固定帳號／contract／side／revision 未綁定，為 `observed_bypass` |
| `STK-MAN-CANCEL-FLASH-PRICE` | `STK-SINK-CANCEL` | `src/components/flash-order.tsx::cancelAt`，依 code alias＋action＋price 篩出多筆 active trades | browser 先以合併 trades 選集合，逐筆只送 id | `manual_candidate`。confirmation 必須綁定排序後完整 target set；server 逐筆重驗同帳號／contract／side／price／revision，集合漂移時不得擴大範圍 |
| `STK-MAN-CANCEL-FLASH-SYMBOL` | `STK-SINK-CANCEL` | `src/components/flash-order.tsx::cancelSymbol` | browser 依 code alias 選該商品所有 active trades | `manual_candidate`。需 exact bounded set confirmation；不得讓新出現的 order 被舊 confirmation 一併 cancel |
| `STK-MAN-CANCEL-GRID-ALL` | `STK-SINK-CANCEL` | `src/components/grid-ticket.tsx::cancelGrid` | 依 active status、`custom_field='sjgrid'`、contract alias 選集合 | `manual_candidate`。`custom_field` 只能做次要 correlation，不能當 ownership／provenance；server 需固定帳號與 target set |
| `STK-MAN-CANCEL-HOTKEY-ALL` | `STK-SINK-CANCEL` | `src/hooks/use-hotkeys.ts` 0.6 秒內雙 Esc → `src/lib/trade.ts::cancelAllOrders` | 先 `fetchTrades('S')` 與 `fetchTrades('F')`，合併 active trades 後逐筆 cancel；股票帳號仍可能 fallback default | `manual_candidate`，也是跨商品 bulk route。confirmation gesture 是雙 Esc，但 future gateway 必須分帳號／商品建立 exact target set；未知或任一 account query 不完整時不得宣稱「全部」 |
| `STK-AUTO-CANCEL-GRID-FOLLOW` | `STK-SINK-CANCEL` | Grid follow timer 自動取消偏離 desired ladder 的 grid order | browser 依 `custom_field`／side／symbol／price 選 target | `automation_candidate`。不得使用 grid 手動 confirmation 或 manual cancel route；需 automation intent、revision、queue-head revalidation，否則 disabled |

目前未找到自動 update price／quantity callsite；但共用 exported helper 可被任何新 caller 匯入，故「目前未找到」不等於受控。新增 import、動態 import、直接 `apiPost()`、Tauri HTTP、Vite proxy 或任何直接 broker server request，都必須讓 route manifest digest 失效並將相關股票帳號 automation 切回 disabled。

## 5. 手動 order-class 基線

此表只描述目前 UI／helper 可產生的候選 payload，不代表 broker 已接受，也不代表每個交叉組合合法。Gate 0 必須用 fixture 與逐次授權 simulation smoke 分開證明；未證實格子標為 disabled，而不是 fallback 或靜默改寫。

| Class ID | cond | lot／quantity unit | price type | TIF | 現有入口 | Gate 0 狀態 |
|---|---|---|---|---|---|---|
| `STK-CLASS-CASH-COMMON-LMT` | request 未明示；Cash 候選尚待 probe | Common／CommonLot（畫面「張」） | LMT／正價格 | ROD、IOC、FOK 都可由 OrderTicket 選出 | Ticket；ROD 另有 Chart／Flash／Grid | 未證實；逐一驗證三個 TIF，不得從其中一個推論其他 |
| `STK-CLASS-CASH-COMMON-MKT` | 同上 | Common／CommonLot | MKT／client 送 `price=0` | OrderTicket 可選 ROD、IOC、FOK；quick helper固定 IOC | Ticket；Flash；position helper；trigger | 只有 `MKT+IOC` 可作 automation 第一階段候選；全部仍待 simulation contract probe |
| `STK-CLASS-CASH-INTRADAY-ODD-LMT` | 同上 | IntradayOdd／Share（股） | LMT／正價格 | OrderTicket 可選 ROD、IOC、FOK；position remainder helper 固定 ROD | Ticket；position close／reverse remainder | 未證實；需驗盤中時段、limit、TIF 與 Share，不可把 `Odd`、`IntradayOdd` 混用 |
| `STK-CLASS-CASH-INTRADAY-ODD-MKT` | 同上 | IntradayOdd／Share | MKT／0 | OrderTicket 可選 ROD、IOC、FOK | Ticket | 高風險未證實；helper 註解反而指出盤中零股只接受 LMT，未有官方／simulation contract 證據前 disabled |
| `STK-CLASS-DAYTRADE-SHORT` | client 只傳 `daytrade_short=true`，沒有 `order_cond` | 僅 Common／CommonLot | LMT 或 MKT | ROD／IOC／FOK 可由 Ticket 選出 | OrderTicket、只在 Sell＋Common＋`day_trade='Yes'` 顯示 | 語意與支援矩陣未證實；automation 第一階段不支援，但 manual 行為不可被自動縮限默默改寫 |
| `STK-CLASS-MARGIN` | 無 request 欄位／無 UI callsite | 未知 | 未知 | 未知 | `not_exposed` | 不得宣稱支援；既有 position `cond` 需另做平倉 mapping probe |
| `STK-CLASS-SHORT-SELL` | 無 `order_cond`；不可由 `daytrade_short` 推論 | 未知 | 未知 | 未知 | `not_exposed` | 不得宣稱支援 |
| `STK-CLASS-ODD` | 型別列名 `Odd`，無 place callsite | 未知 | 未知 | 未知 | `not_exposed` | 不得與 IntradayOdd 合併 |
| `STK-CLASS-FIXING` | 未明示 | `Fixing` 型別，無 callsite | 未知 | 未知 | `not_exposed` | 不得宣稱支援 |
| `STK-CLASS-BLOCK-TRADE` | 未明示 | `BlockTrade` 型別，無 callsite | 未知 | 未知 | `not_exposed` | 不得宣稱支援 |
| `STK-CLASS-STOCK-MKP` | 不適用；股票 type 未列 MKP | 未知 | MKP | 未知 | `not_exposed` | 股票 automation／manual manifest 均不得列為已支援 |

## 6. 現況旁路與 fail-closed 結論

| Finding ID | 現況證據 | 風險 | Gate 處置 |
|---|---|---|---|
| `BYPASS-01-RAW-SINKS` | 四個 exported sink 可由 browser module 直接呼叫 | caller 無法可信區分，automation 可偽裝 manual | raw broker routes 必須只對 private adapter 開放；任一直接 callsite 未遷移即 automation disabled |
| `BYPASS-02-DEFAULT-ACCOUNT` | `accountFor('S')` 可回 `undefined` 並讓 server default | UI selection、重啟或多帳號時可能送錯帳號 | place 必須帶固定完整 account；update/cancel 先由固定帳號唯一解析；缺帳號在 broker bytes 前拒絕 |
| `BYPASS-03-MODE-UNKNOWN` | client／Vite guard 只擋 `production-readonly`，`unknown` 會繼續 | mode file／同步失敗時 fail open | gateway 只接受持有 shared lease 的 confirmed simulation；unknown 一律拒絕 |
| `BYPASS-04-TRIGGER-RISK` | 舊 trigger／bracket broker caller已退役，Route ID仍由closed-world inventory監控 | 若同名功能未經gateway復活，可能再次繞過kill switch、quantity與PnL gate | 現況closed；AST inventory出現任何新broker callsite即失敗。未來所有 provenance仍須共用canonical risk／unit／reservation |
| `BYPASS-05-GRID-SCHEDULER` | follow timer 直接呼叫同一 `placeAt()`／`cancelOrder()` | scheduler 使用 manual helper，且後續 cycle 不重驗 risk | 分離 automation-only internal API；scheduler capability 不可取得 manual confirmation |
| `BYPASS-06-TARGET-ID-ONLY` | update/cancel payload 只有 `trade_id` | 短 ID、跨日、跨帳號、外部 update/fill 競態 | 固定帳號 refreshed trades 唯一解析＋revision lock＋queue-head revalidation；不唯一就人工處理 |
| `BYPASS-07-UNIT-DRIFT` | positions 以 Share 查詢，但 Flash flat 使用預設 Common；bracket trigger不保留 entry lot | 1000 倍量級錯單或錯誤保護量 | branded unit＋exact conversion；相關 route 在回歸通過前 disabled |
| `BYPASS-08-CLIENT-ONLY-CONFIRM` | arm／雙擊／雙 Esc 均只在 React state／browser event | script、惡意本機 caller或 background function可繞過 | confirmation由 server產生、一次性、短效、綁 canonical payload hash；browser 不能自稱 provenance |
| `BYPASS-09-NO-CLASS-VALIDATOR` | Ticket 可組出多個尚未證實的 price／TIF／lot 組合 | broker拒單或 client 靜默映射 | manual manifest逐格 allowlist；未證實只 disabled，不 fallback |
| `BYPASS-10-NO-REGRESSION` | 目前測試搜尋未找到上述 place/update/cancel UI payload 與 route 等價測試 | gateway 遷移可能破壞既有手動功能而未被發現 | 依第8節建立 route／class／UI／simulation regression suite後才能轉 governed |

因此本版本的 machine-readable Gate 結果應等價為：

```json
{
  "schema": "realtimestock.manual-stock-write-route-coverage/v1",
  "version": "2026-08-14.2",
  "inventoryComplete": true,
  "classifierContractPassed": true,
  "coverageComplete": true,
  "manualEquivalencePassed": true,
  "serverDerivedProvenancePassed": true,
  "ungovernedRouteIds": [],
  "automationAccountEligibility": "disabled"
}
```

實際 manifest 不得保存原始 account ID；可在受管本機 verifier 內使用 keyed opaque account reference，log／可攜 evidence 只保留不可逆、不可跨環境對照的遮罩 reference。

## 7. Server-derived `BrokerWriteProvenance` classifier 契約

### 7.1 信任邊界與 route 分離

未來 gateway 必須讓 browser／scheduler 只能抵達各自獨立的受管入口，raw Shioaji broker routes只由 private adapter 呼叫：

| Gateway route family | 唯一允許 caller | Server 衍生 provenance | 必要 envelope |
|---|---|---|---|
| `manual/place|update|cancel` | 互動式 UI control plane，且持有該次 server-issued confirmation | `manual_user_confirmed` | allowlisted Route ID、fixed account、canonical payload hash、一次性 nonce、短 TTL、confirmation revision、exact target set；不需要 strategy arm |
| `automation/place|update|cancel` | Runtime scheduler／quote evaluator 經內部 service capability | `automation` | strategy ID、activation ID、intent ID、revision、manifest、Gate 1、feature gate、user write master、strategy arm、readiness、risk／reservation／arbiter slot |
| `gate-probe/place|update|cancel` | 獨立 Gate CLI process identity | `gate_probe` | 每 operation 使用者另行授權、run lineage、一次性 nonce、同 run target、最大 1 CommonLot、雙重 simulation attestation；禁止 retry／盲目 cleanup |
| raw `/api/v1/order/*` | 只有 gateway private adapter | 不接受外部 provenance | network／process ACL與adapter call stack；browser、scheduler、一般 CLI 直接請求一律拒絕 |

route 名稱本身仍不足以證明 caller。server 必須同時驗 caller capability／process lineage；scheduler 即使知道 manual URL，也不能取得或兌換 manual confirmation。manual confirmation service不得接受 scheduler／quote callback identity，亦不得批次發出未綁 payload 的 token。

### 7.2 衍生規則

`BrokerWriteProvenance` 至少包含下列 server-owned metadata；client 傳入同名欄位必須忽略並記錄拒絕原因，不得覆蓋：

```ts
type BrokerWriteProvenance =
    | {
          kind: 'manual_user_confirmed';
          coverageVersion: '2026-08-13.1';
          routeId: string;
          confirmationId: string;
          confirmationRevision: number;
          canonicalPayloadHash: string;
          callerClass: 'interactive_ui';
      }
    | {
          kind: 'automation';
          coverageVersion: '2026-08-13.1';
          routeId: string;
          strategyId: string;
          activationId: string;
          intentId: string;
          intentRevision: number;
          callerClass: 'runtime_scheduler' | 'quote_evaluator';
      }
    | {
          kind: 'gate_probe';
          coverageVersion: '2026-08-13.1';
          routeId: string;
          probeRunId: string;
          operationNonce: string;
          callerClass: 'gate_cli';
      };
```

分類順序必須 fail closed：

1. 驗證受管 loopback listener、Host／Origin、request size、CSRF／replay 與 caller capability；不可信先拒絕。
2. 由 server route registration 取得 route family 與固定 Route ID，不讀取 payload 的 `provenance`、`manual`、`automation` 或 `gate_probe` 宣告。
3. 驗 caller class 與 route family完全相符；scheduler／quote callback 命中 manual family、browser 命中 automation family、一般 CLI 命中 probe family都在任何 broker bytes 前拒絕。
4. manual：原子 consume 一次性 confirmation，重算 canonical payload hash、fixed account、order class／unit、exact targets與revision；任一欄位變更、TTL過期、重放或 route mismatch 均拒絕。
5. automation：在同一 account arbiter流程重驗完整 automation conjunct；不得因 request 帶 manual confirmation 而降級。
6. probe：驗獨立 run lineage與同 run target；不得操作任意既有 trade ID或跨 run target。
7. 所有 provenance 都須通過 shared simulation lease、固定帳號、canonical contract、unit、risk／reservation、rate queue與 broker write緊鄰前 revalidation；只有各自額外 conjunct不同。
8. classifier 回傳 unknown、衝突、manifest version不符或 route 不在 coverage matrix時拒絕，將對應 account 的 automation eligibility 設為 false並要求重新產生 Gate manifest。

### 7.3 Update／cancel target resolver

因目前 upstream client contract只看到 `trade_id`，gateway 不得捏造 upstream 不支援的 account 欄位；應在 private adapter內：

1. 以 fixed stock account做 account-scoped `update_status`／trades refresh。
2. 以 account＋`Asia/Taipei trade_date`＋contract＋side＋immutable broker IDs＋本地 broker-order revision 唯一解析 target。
3. 在 per-account／per-order lock內、broker write緊鄰前再次確認 non-terminal、remaining quantity、revision與 exact operation。
4. 若排隊期間出現 fill／cancel／update，舊 intent 作廢並 reconcile；如果可能已有 bytes送出才失去確定性，轉 `unknown`，不得 retry。
5. manual bulk cancel只可操作 confirmation 綁定的 exact target set；集合新增不擴大，集合缺少或 revision漂移逐筆回報，不猜測替代 target。

## 8. 手動等價回歸計畫

本節是未來測試計畫，**本輪沒有執行 simulation write**。所有需要 broker write 的驗收都必須經 task 0.3a envelope，並由使用者對每個 operation另行明確授權。

### 8.1 靜態完整性 Gate

1. 建立 AST／import graph 掃描，列出所有 `apiPost|apiPut|apiDelete` 對 `/api/v1/order/*`、`placeStockOrder`、`placeQuickOrder`、`placeStockExitByShares`、`updateOrderPrice`、`updateOrderQty`、`cancelOrder` 的 callsite。
2. 每個 callsite 必須唯一對應本文 Route ID、provenance family與 order-class set；未知 callsite、computed route、direct `fetch`、Tauri HTTP或 raw adapter export使 Gate 失敗。
3. machine-readable manifest綁定 app build、gateway／adapter digest、coverage version與完整 Route ID set；source digest改變立即失效。
4. 驗 browser bundle不存在 raw broker write capability；private adapter不能被前端 import，Vite proxy／Tauri direct request不能繞過 gateway。

### 8.2 Fixture／contract 測試

對第3、4、5節每列建立 golden vectors，比較遷移前候選 payload與 gateway canonical payload的語意等價；比較欄位至少包括：fixed account reference、contract identity、Buy／Sell、cond、daytrade flag、lot、quantity數值與 branded unit、price type、decimal／tick price、TIF、`custom_field`、target set、revision、確認範圍與操作順序。

必要 negative tests：

- browser payload宣告 `manual_user_confirmed`／`automation`／`gate_probe`；
- scheduler呼叫 manual route、重放或竊用 manual confirmation；
- manual confirmation過期、已使用、payload／account／Route ID／target set 任一欄位變更；
- mode `unknown`、production、shared lease遺失、固定帳號缺失或 account切換；
- raw broker route、computed route、未知 callsite或未列名 order class；
- CommonLot／Share混用、fractional lot、IntradayOdd當Common、position cond不明；
- MKT／LMT、ROD／IOC／FOK不合法組合不得 fallback；
- update增加 quantity、target terminal、remaining／revision漂移、跨帳號／跨日短 ID碰撞；
- bulk cancel target set新增／消失；
- Grid follow與 trigger攜帶 manual token；
- trigger／bracket試圖以「保護」理由跳過 kill switch、reservation或 ExitClaim；
- broker timeout在 pre-byte／possibly-sent／ack-lost三個窗口的 unknown／no-retry行為。

### 8.3 UI 手動等價測試

逐一覆蓋：OrderTicket兩步確認、chart one-shot、Flash arm與每次點價、position close／reverse拆腿、Grid有限批次、Orders table改價／改量／cancel、chart drag、Flash價位／商品bulk cancel、Grid全撤、雙 Esc跨帳號全撤。

每個 case 驗證：

1. 顯示給使用者的帳號遮罩、商品、方向、cond、lot／unit、價格、TIF、數量與 target set，與 server canonical confirmation完全相同。
2. 修改任何欄位使舊 confirmation失效；送出按鈕不能只靠 React `armed`。
3. gateway前後的有效手動 payload、broker response與 UI結果等價；不合法或既有未證實 class明確 disabled並說明，不靜默轉成 automation allowlist。
4. manual route不要求 strategy arm，但仍要求 simulation、fixed account、risk／unit／reservation；manual cancel的 exposure policy可與新曝險不同，但須 versioned、不可由 payload選擇。

### 8.4 逐次授權 simulation smoke

在 0.3a、readiness及本地 manifest完整後，依使用者每次另行授權，使用最小數量測試經確認支援的 manual class；每次保存遮罩 evidence、canonical payload／result hash與 bounded reconciliation。place、update、cancel需使用同一固定帳號與唯一 target lineage；unknown立即停止，不自動 cleanup。未獲授權、CA／production載入、帳號或mode不確定時不得執行。

### 8.5 Automation 隔離回歸

- Grid follow、trigger、bracket exit只可產生 `automation` provenance；即使先前有手動 arm／confirmation也不得轉成 `manual_user_confirmed`。
- scheduler／quote callback對 manual endpoint的每一次嘗試都須在 broker bytes前拒絕，並留下不含帳號值的 reason code。
- automation縮限只允許正式核准的第一階段 class；manual FOK、IntradayOdd、daytrade等既有候選不得被靜默改寫，但只要其 gateway 等價尚未證明，對應帳號 automation仍 disabled。

## 9. Task 0.13 與 write-unlock 邊界

task 0.13 的 completion contract 僅是「盤點、矩陣、等價回歸計畫、server-derived classifier契約與未納管時automation鎖」：

1. TypeScript AST掃描與machine-readable inventory須精確列出目前所有受追蹤股票place／update／cancel helper callsite、四個stock sinks、Route ID與manual order-class候選；新增或遺漏callsite使測試失敗。
2. classifier只接受同一module boundary簽發的opaque route／caller／manual confirmation或probe nonce；scheduler命中manual route、client supplied provenance、重放、route／payload漂移皆在任何broker authority前拒絕。
3. classifier正確衍生的結果仍固定`admitted=false`、`brokerWriteAuthority=false`；production control plane即使收到eligible automation manifest，也會因current coverage有`observed_bypass`而降為`observe_only`並關閉全部automation feature gates。
4. 第5節matrix與第8節等價回歸計畫完整保存；未證實的Cash／融資券／當沖、Common／IntradayOdd、LMT／MKT／MKP、ROD／IOC／FOK不會被默默改寫成automation allowlist。

Task 6.2 已完成四個 stock sink 的入口私有化、所有 UI／scheduler route 遷移、manual payload 等價與 server-derived provenance 分類，因此本文件現固定 `coverageComplete=true`、`manualEquivalencePassed=true`、`serverDerivedProvenancePassed=true`、`automationAccountEligibility=disabled`。這不表示 `BYPASS-01`至 `BYPASS-10` 的後續 risk／resource／target／simulation／write-unlock 條件已全部關閉；task 0.13／6.2 本身絕不授予 broker write、write master、production、CA 或真實委託權限。
