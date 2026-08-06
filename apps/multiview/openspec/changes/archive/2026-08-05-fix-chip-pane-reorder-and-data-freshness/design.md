## Context

目前 `chip-panes.js` 的「置頂／置底／拖曳排序」會先改變 DOM，再透過 `app.js` 的 `refreshPanelLayout()` 以當下的 logical range 重設圖表。DOM 重排期間 Lightweight Charts 可能暫時以不同寬度或掛載狀態計算時間軸，單純保存 logical index 會把這個暫時狀態當成正式 viewport，造成資料線左側留白與共用游標 X 座標偏移。

籌碼 API 目前回傳 `warnings[]`，但前端在 `setNotice()` 前將所有 warning 串成一個字串，CSS 只能對整個提示套用單一顏色。資料日期則直接採用前端最後一根 K 棒的日期；日 K 可能已包含盤中今日資料，但籌碼來源尚未到發布截止時間，服務仍可能以今日為查詢終點。

## Goals / Non-Goals

**Goals:**

- 重排副圖群組後保留使用者原本的時間錨點、可視範圍跨度、右側貼齊狀態與共用游標定位。
- 將 warning 依資料集拆成可讀的彩色說明，顏色與既有線圖／資料集識別一致，並保留關閉提示行為。
- 以台北時間的最近已完成交易日作為籌碼 API 的有效查詢終點；尚未發布的今日信用交易資料不得進入 rows、D1 讀值或副圖線圖。
- 保留真實來源日期、availability、coverage 與既有缺值／最近一筆顯示，不以前一日數值冒充今日。

**Non-Goals:**

- 不修改信用交易、法人、外資持股或借券的資料來源與授權。
- 不改變 D1 schema、回補排程、資料數值公式或多層副圖選擇政策。
- 不將提示改成 tooltip、橫向捲軸或自動隱藏文字。
- 不把本次修正與暫緩的 `add-mainforce-chip-subcharts` 合併。

## Decisions

### 1. 重排前以時間錨點保存 viewport

在 `applyControllerOrder()` 前由 app 端捕捉既有 viewport snapshot，snapshot 保存起訖 K 棒時間、兩端 fractional index、可視跨度、右側貼齊及 bar spacing。副圖 manager 以 `preserveViewport` reason 通知 layout coordinator；layout frame 在 DOM 重排完成、所有 chart resize 後，以時間 snapshot 還原，再重新計算 axis／overlay／crosshair。

選擇時間 snapshot 而非只保存 logical range，是因為 DOM 重排不得改變資料時間語意；選擇單次 layout frame 而非立即同步，是為了等待瀏覽器完成 grid／canvas 幾何更新。非重排事件仍沿用現有 logical range refresh。

### 2. Warning 保留結構化資料

前端 `setNotice()` 改接受 `warnings[]`，每筆 warning 先由前綴或明確 dataset 欄位解析為資料集，再建立一個 `<span>`。未知或跨資料集的 warning 使用中性色，避免錯誤歸類；warning 文字仍使用 textContent，不解析 HTML。提示簽章以結構化 warning 的順序與內容產生，關閉後仍只對同一份提示生效。

選擇前端拆分而非在 Worker 產生 HTML，是為了維持 API 純資料契約、避免 XSS 與保留 Sites／Cloudflare 共用 runtime。

### 3. Worker 以最近已完成台股交易日封頂

`taiwanStockChipPayload()` 將 URL 的 requested end 與 `latestCompletedTaiwanSessionDate(now)` 取較早者作為 effective end；`latestCompletedTaiwanSessionDate` 使用既有台北時間 22:00 發布截止規則並回退週末。所有 D1 read、provider adapter、official latest、coverage 與 availability 均使用 effective end，避免今日尚未發布的信用交易列進入結果。

測試可傳入 `now`，以固定「截止前」與「截止後」兩個情境。API 不刪除既有 D1 資料，只在查詢與新寫入路徑封頂；截止前請求今日時，前端仍可在今日 K 棒位置顯示「當日無資料／最近一筆」。

### 4. Readout 顯示遵循實際資料日期

信用交易 controller 的 latest readout 只以該 dataset 實際存在的最後一筆 row 為 latest；若游標落在 K 棒今日但沒有對應 row，日期保留游標日期，segments 顯示缺值，不把最近一筆的數值改標成今日。這讓圖線、readout、coverage 與提示的日期語意一致。

## Risks / Trade-offs

- [重排還原時 viewport 仍可能遇到 chart 尚未完成 resize] → 在既有兩段 layout frame 中執行 restore，並最後重新定位 shared crosshair；若時間 snapshot 無法對應新 candles，才安全回退到 preserved logical range。
- [warning 前綴未來新增或變更] → 建立集中 dataset color／label mapping，未知 warning 使用中性色並保留完整文字；測試要求已知資料集不得退回單一顏色。
- [22:00 cutoff 使來源已提早發布的資料延後顯示] → 以既有回補契約的保守發布截止為準，保留 source date／coverage；截止後下一次開啟或背景更新即可取得資料。
- [既有測試依賴動態 today] → 所有涉及當日資料的 service 測試改用顯式 `now`，分別驗證截止前封頂與截止後可使用當日資料。

## Migration Plan

1. 先加入 viewport snapshot、warning model 與 effective end 的純函式／source contract 測試。
2. 修改前端重排 layout、提示列與 readout，完成本機 1／2／3／4 圖及 3231.TW 的驗收。
3. 執行 `npm test`、`npm run lint`、`npm run build`、`openspec validate --all --strict` 與 `git diff --check`。
4. 使用同一已推送 commit 分別驗收 Sites 保留站與 Cloudflare 正式站；本次不進行 D1 migration。

## Open Questions

無。若正式站資料來源實際發布規則變更，應另開資料來源時點 change，不在本修正中放寬 fail-closed 邊界。
