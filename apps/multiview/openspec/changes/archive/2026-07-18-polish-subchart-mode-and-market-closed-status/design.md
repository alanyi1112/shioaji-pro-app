## Context

全域工具列目前同時顯示模式 `<select>` 與常駐說明 `<small>`，而 4／6／8 圖雖由程式強制採單一副圖，控制項仍容易讓人誤以為可切換。報價列則以核對狀態及日期新鮮度組合文案，週末讀取前一交易日已核對收盤價時，跨日條件會把畫面降級為「未驗證」。本次變更跨越前端版面與報價狀態格式化，但不修改市場資料來源或 D1 schema。

## Goals / Non-Goals

**Goals:**

- 以最小高度呈現副圖模式控制，移除常駐說明列。
- 讓 4／6／8 圖的控制項以原生 disabled 語意明確不可操作。
- 將使用者可見文案收斂為「單一副圖」與「多層副圖」，內部仍可沿用 `A`／`B` 值避免偏好 migration。
- 週末或已知休市日顯示「休市」，並保留最近交易日既有 verification，不重新降級。

**Non-Goals:**

- 不改變 1／2／3 圖預設多層副圖、4／6／8 圖固定單一副圖或 A／B 各自保存偏好的既有政策。
- 不新增台股行事曆資料源，也不改變官方收盤核對流程。
- 不變更報價數值、K 線資料或籌碼 API。

## Decisions

1. 模式 `<select>` 保留 `value="A"`／`value="B"`，只調整 option 顯示文字。這可保留既有 localStorage 與狀態協調器，不需要偏好 migration；替代方案是全面將值改成語意字串，但會增加相容風險而無使用者效益。
2. 4／6／8 圖直接設定 `<select disabled>`、`aria-disabled="true"` 並使用 disabled 樣式，不另外保留常駐說明列。原生 disabled 同時涵蓋滑鼠與鍵盤，優於只攔截 change event。
3. 將「是否為目前休市」與「最近報價是否曾核對」視為兩個維度。畫面主狀態在週末及可證明休市時顯示「休市」，verification metadata 仍保留最近交易日結果；只有真正的 verifier 失敗才可改成 `unverified`。
4. 休市判斷優先使用既有 `marketPhase`／session metadata，並至少涵蓋台北星期六、星期日。未知的平日無資料不冒充已知休市，仍沿用既有保守狀態。

## Risks / Trade-offs

- [平日國定假日若上游沒有明確 market state，無法只靠星期判斷] → 沿用既有 session evidence，僅在可證明休市時顯示「休市」。
- [disabled 控制項無法展開查看另一個 option] → 目前圖數本來就不允許切換，灰色「單一副圖」已足以表達 effective mode；切回 1／2／3 圖後立即恢復可操作。
- [休市文案可能遮蔽 stale 診斷] → tooltip 與 data attributes 保留 freshness／verification metadata，真正 stale cache 仍維持既有優先警示。

## Migration Plan

1. 先更新 HTML contract、模式狀態同步與報價文案 formatter 測試。
2. 完成 build、完整測試與 OpenSpec strict validation。
3. 部署私有 Sites 版本，在週末情境及 2 圖／4 圖切換下做已登入瀏覽器驗收。
4. 若休市顯示或模式控制回歸，可回退單一 Sites 版本；資料與偏好格式不需回滾。

## Open Questions

無。
