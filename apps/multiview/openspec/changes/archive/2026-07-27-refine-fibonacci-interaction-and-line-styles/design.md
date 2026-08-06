## Context

現有 `chart-annotations.js` 以單一 `completed.fibonacci` 保存一張回撤或拓展，完成任何新費波那契圖都會覆寫前一張；`app.js` 則直接把滑鼠 Y 座標換算為價格，沒有依錨點階段使用 K 棒 `low`／`high`。SVG 水平級別線與波段導引線目前都是 1.6 CSS px，導引線已有完成與暫態虛線；本益比河流圖已以七條 SVG polyline 呈現，P50 為 1.4 CSS px、其他線為 1 CSS px，provisional 尾端另用虛線及透明度區分。

本變更只調整瀏覽器端互動、註記本機資料與 SVG 呈現，不改動費波那契公式、河流資料來源、Worker API、D1、排程或秘密邊界。既有 `enhance-main-chart-valuation-and-drawing-tools` 已完成但尚未歸檔；本 change 是該能力的後續修訂，歸檔時必須先讓前一 change 建立 `main-chart-fibonacci-tools` 主規格，再套用本 change 的 delta。

## Goals / Non-Goals

**Goals:**

- 讓一般 A／B／C 選點準確吸附所點 K 棒的 low／high，並以 Option／Alt 提供明確的自由價位操作。
- 同一商品與週期同時保留一張回撤及一張拓展，依完成順序決定彩色與單色視覺層級。
- 安全遷移既有單張本機註記，維持重繪、autoscale 與 PNG 匯出一致。
- 將費波那契水平線及波段虛線縮為 1 CSS px，並鎖定本益比河流圖 P50／其他線／provisional 的既定線型。

**Non-Goals:**

- 不支援同種類型多張註記、個別圖形選取、拖曳編輯、單張刪除或任意圖層排序。
- 不改變費波那契回撤／拓展比率、價格公式、錨點圓與待選價格導引線。
- 不以區間搜尋取代點選 K 棒：A 的最低價、B 的最高價與 C 的最低價均指所點單根 K 棒的 `low`／`high`。
- 不變更本益比河流圖 percentile、band、資料口徑或 provisional 狀態判定。

## Decisions

### 1. 以最多兩筆、每種類型唯一的集合保存費波那契

`completed.fibonacci` SHALL 由單一物件改為陣列，每筆含 `kind`、`anchors` 與單調遞增 `order`。完成新圖時先移除相同 `kind`，再加入新筆，因此最多同時存在一張 `retracement` 與一張 `extension`；不同類型不得互相覆寫。

呈現時依 `order` 排序。只有一筆時採分級彩色；有兩筆時較早完成者採分級彩色，較晚完成者以淺灰藍單色呈現。重畫任一類型會取得新的 `order`，因此重畫者成為第二張單色圖，另一張成為第一張彩色圖。此規則直接反映「先畫彩色、後畫單色」，不另存容易漂移的 style flag。

考慮過以 `retracement`／`extension` 固定欄位保存；陣列更容易依完成順序渲染及彙總 autoscale，同時仍可用 `kind` 唯一性維持一類一張。

### 2. 本機 payload 升級至 version 3 並就地遷移

沿用既有依 canonical symbol 與 interval 隔離的 storage key，payload 版本升級為 3。version 1／2 的單一 `completed.fibonacci` 若有效，遷移成只有一筆且 `order: 1` 的陣列；損毀、重複 kind、錨點數錯誤或非有限值仍 fail-safe 忽略。下一個 order 由現存最大值加一推導，不依賴時鐘。

不更換 storage key，避免同一身份同時殘留兩套資料；不使用 timestamp，避免系統時間變更影響順序。

### 3. preview 與 click 共用錨點解析規則

主圖先取得游標的原始 `{time, price}`，再以目前 pending anchor index、所點位置是否存在「完全相同時間」的 K 棒及 `event.altKey` 解析：

- 未按 Option／Alt：A 使用該 K 棒 `low`、B 使用 `high`；沒有 K 棒時回傳無效。
- 未按 Option／Alt：C 有 K 棒時使用 `low`，無 K 棒時使用原始自由價位與未來時間。
- 按住 Option／Alt：A／B／C 均使用游標原始價格；有 K 棒時時間仍對齊該 K 棒，無 K 棒時保留圖表換算時間。
- 價格範圍工具不經過此吸附規則，維持自由座標。

滑鼠移動 preview 與左鍵完成都呼叫同一解析器。K 棒存在性使用精確 time identity 判斷，不以最近 K 棒替代，避免右側未來空白區被誤判成最後一根 K 棒。

### 4. 以渲染狀態決定第二圖單色，不改費波那契數學

渲染器逐筆處理完成註記，對第二筆加上 `is-monochrome` class；若另一種類型已存在，新工具的 pending preview 也預先使用單色。單色 class 覆寫水平線、band 與價格標籤的 `--fibonacci-level-color`，並覆寫波段導引線 stroke；錨點幾何、比率、價格與標籤內容維持不變。

拓展 autoscale 改為從完成註記集合篩選 `extension`，仍只納入完成拓展，不讓 pending preview 污染價格範圍。PNG 匯出沿用現有 SVG clone，自然包含兩筆完成註記及相同 class 樣式。

### 5. 線條角色維持不變，只收斂指定寬度

費波那契水平級別線改為 1 CSS px 實線；完成與 pending 的 A–B／A–B–C 導引線維持虛線並改為 1 CSS px，pending 另以較低透明度呈現。既有價格導引線、halo、錨點圓與文字描邊不在本次調整範圍。

本益比河流圖現有實作已符合 P50 1.4 CSS px、其他線 1 CSS px、verified 實線與 provisional 虛線／較低透明度；本次以測試與 delta spec 鎖定，不做無意義的重寫。

## Risks / Trade-offs

- [精確時間判斷可能在座標落於 K 棒間隙時找不到資料] → A／B 明確視為無效；C 或按 Option／Alt 時才允許保留自由位置，並以互動測試覆蓋右側空白區。
- [重畫第一種類型後彩色／單色角色互換] → 以完成順序作為唯一規則，pending 預先顯示完成後樣式，避免點下最後一點才突然變色。
- [舊 payload 遷移錯誤可能清除使用者註記] → 同時接受 version 1／2，先驗證再遷移，並以 fixture 測試正常、損毀與重複種類。
- [兩張拓展或同類多張需求日後增加] → 本次以 kind 唯一性保持模型簡單；若未來要求多張，需另行設計選取、刪除與圖層管理。
- [兩張 SVG 色帶增加視覺密度] → 第二張所有線、band 與標籤採一致單色，並維持既有低透明度及 `pointer-events: none`。

## Migration Plan

1. 先完成 controller version 3、舊資料遷移與雙類型單元測試。
2. 加入錨點解析及 app 互動整合，再調整雙圖渲染、autoscale 與 CSS。
3. 鎖定 PE 河流圖線型、PNG 與瀏覽器可見行為，執行完整測試與 strict validation。
4. 發布時沿用既有 Sites 流程；若發生回歸可回退前一 Sites version，version 3 payload 仍可由修正版讀取，不需後端 rollback。

## Open Questions

- 無；使用者已確認每種類型各保留一張，且未按 Option／Alt 時 A／B 點到無 K 棒區域必須視為無效。
