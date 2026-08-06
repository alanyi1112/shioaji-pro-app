## Context

`renderPanels()` 目前會同步銷毀舊 panel，再建立新 panel；每個 panel 已有 `destroyed`、load token、AbortController 與部分 timer／frame 清理。然而圖表建立後仍有多條延遲 layout、crosshair、overlay、resize、資料套用與 controller callback 可跨越銷毀邊界。使用者在圖表數量、分類分頁或市場頁籤間快速連續切換時，舊 callback 可能在 `chart.remove()` 後呼叫 Lightweight Charts API，production 因此偶發 `Uncaught Error: Value is null`。

完整圖數與分頁矩陣另外揭露一條獨立但同樣被 production build 壓縮成 `Value is null` 的初始化錯誤：`renderIndicatorChart()` 在 ATR series 尚未建立前即呼叫 `priceScale("atr").applyOptions()`。development build 明確回報 `Trying to apply price scale options with incorrect ID: atr`，因此修正範圍也包含自訂 price scale 的有效建立順序。

部署後慢網路矩陣進一步確認頁面級 batch coordinator 有相同 ID 重用競態：request 的 snapshot 使用 `panel-0` 等 ID，panel 重建後新 subscription 也會沿用相同 ID；成功 response 路徑只依 ID 查詢目前 subscription，未像錯誤路徑比對原 snapshot token，因此會把舊商品 payload 投遞給新 panel。這個問題同時影響主圖、技術副圖與可選籌碼／估值 controller 的生命週期，且必須保留最後一次操作立即生效的互動語意，因此需要統一生命週期契約，不適合只在單一 callback 外加 `try/catch`。

## Goals / Non-Goals

**Goals:**

- 所有 panel 延遲工作都能判斷自己是否仍屬於目前有效 generation。
- panel 銷毀時先封鎖新工作，再取消可取消資源，最後才移除 Lightweight Charts 實例與 DOM。
- 快速切換圖表數量、分類分頁及市場頁籤時採 latest-wins，最後畫面與 canonical 商品切片一致。
- 正常與快速切換的瀏覽器驗收皆維持 Console 0 lifecycle errors。
- 保留 6／8 圖固定單一副圖、1／2／3／4 圖偏好恢復與 deep link 清理契約。

**Non-Goals:**

- 不變更行情 API、stream protocol、D1 schema、上游資料來源或帳號存取控制。
- 不升級或替換 `lightweight-charts@5.0.9`。
- 不以長時間 debounce 延後使用者操作，也不降低圖表數量或關閉既有功能。
- 不納入 `add-mainforce-chip-subcharts` 或其他 active change。

## Decisions

### 1. 每次 panel 建立都使用不可重用的 generation

`createPanel()` 取得目前 render generation，panel 內所有非同步 callback 在操作 chart、series、controller 或 DOM 前都必須同時確認 `!destroyed` 與 generation 仍有效。`renderPanels()` 每次執行都遞增全域 generation，使上一輪尚未完成的工作自然失效。

替代方案是只依現有 `destroyed` boolean；但 callback 可能在銷毀與新實例建立的交界持有舊 reference，單一 boolean 無法表達它屬於哪一輪 render，因此不採用。

### 2. 集中登記 timer、animation frame 與取消函式

panel 內新增小型 lifecycle registry，統一追蹤 `setTimeout`、`requestAnimationFrame` 與 listener／observer／subscription cleanup。既有具名 timer 與 frame 可逐步接入同一 teardown，銷毀時一次取消，callback 執行後也從 registry 移除。

替代方案是在每個現有 callback 前零散新增判斷；這容易漏掉雙層 `requestAnimationFrame`、延遲 resize 或後續新增功能，無法形成可測試的完整邊界。

### 3. 固定 teardown 順序

銷毀順序固定為：標記 disposed 並使 generation 失效 → 中止 fetch／stream 與 panel controller → 取消 timer／frame／observer／listener → 清除跨 panel 協調狀態 → `chart.remove()`／副圖 remove → 移除 DOM。圖表 reference 在 remove 後立刻設為 `null`，後續安全檢查不能把已移除實例視為可用。

不採用捕捉 `Value is null` 後忽略的方式，因為那只隱藏錯誤，不能保證舊 callback 沒有改寫新狀態。

### 4. 保持立即切換，以 latest-wins 驗收

使用者每次操作仍立即更新狀態並呼叫 render；不加入會改變手感的延遲 debounce。舊 generation 的資料或 layout 工作被隔離，最後一次操作建立的 generation 必須完整載入且成為唯一可操作畫面。

### 5. 以單元契約加瀏覽器壓力流程驗證

單元測試覆蓋 lifecycle registry、generation 失效與 teardown 順序；現有 rendered source 測試確認 `renderPanels()` 與 `destroy()` 接入安全邊界。瀏覽器驗收依序快速切換圖數、分類頁及市場頁籤，等待最後一次載入後核對 panel 數量、canonical symbols、6／8 圖模式及 Console 0 errors。

### 6. 自訂 ATR price scale 必須由 series 先建立

Lightweight Charts 只有在第一個使用自訂 `priceScaleId` 的 series 加入後，才保證該 price scale 存在。因此 ATR 流程固定先建立 `atrSeries`，再取得 `priceScale("atr")` 並套用顯示、邊框與 margin 選項。未選 ATR 時不建立或操作該 scale。

不採用預先建立空白 scale 或捕捉例外的方式，因為 library 的公開建立路徑就是透過 series，依序初始化能直接滿足 API contract。

### 7. Batch response 必須比對 request snapshot token

batch coordinator 在 request 開始時保存 `id → subscription` snapshot。response 回來時除了依 item ID 查詢目前 subscription，也必須確認目前 token 與 snapshot token 相同；同 ID 已被新 panel 取代時直接略過舊 item，再由既有 `rerunRequested` 立即為最新 subscriptions 補跑。成功與錯誤路徑採相同 token 邊界。

不以 payload symbol 與畫面 symbol 比對取代 token，因為同一商品也可能因週期、Pivot 或指標參數變更而重建 request；token 才能完整代表該次 subscription identity。

## Risks / Trade-offs

- [取消工作過早導致最後畫面少一次 layout] → 新 generation 建立後主動執行一次必要 layout，並以 loaded panel 數量與可見 chart 驗收。
- [registry 漏接現有 callback] → 先以可重現壓力流程定位 stack／時間點，再以 `rg` 盤點 panel 範圍內所有 timer、frame、observer 與 subscription。
- [teardown 重複執行] → `destroy()` 必須具備冪等性，第二次呼叫直接返回，不可再次 remove chart。
- [快速切換增加 API 請求取消率] → 沿用 AbortController 與 latest-wins token，不重試已失效 generation。
- [只在單一 runtime 驗證造成差異] → 本機測試後分別在 Sites 保留站與 Cloudflare 正式站執行相同隔離及壓力驗收。
- [production build 隱藏實際錯誤訊息] → 診斷階段可暫時使用 development build 定位，但提交與部署維持既有 production build，並以 Console 0 errors 作為終態門檻。

## Migration Plan

1. 在前端加入 generation 與 lifecycle registry，不變更儲存資料格式。
2. 補齊單元／整合測試並執行完整 lint、test、OpenSpec strict 與 diff check。
3. 先以本機瀏覽器重現腳本驗證正常與快速切換。
4. 以 exact commit 分別部署 Sites 保留站與 Cloudflare 正式站，再執行相同瀏覽器驗收。
5. 若部署後出現回歸，可直接回滾靜態資產與 Worker 到前一個 exact commit；不需要資料 migration。

## Open Questions

無。若診斷顯示錯誤位於特定 controller 的獨立生命週期，仍套用相同 generation／registry 契約，不擴大產品功能範圍。
