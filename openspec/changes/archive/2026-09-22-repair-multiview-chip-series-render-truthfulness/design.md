## Context

MultiView 籌碼副圖把使用者 series 選取保存在 `localStorage`，並以籌碼 payload material signature 與控制項 signature 避免重複全量 render。現況只有自營商 pane 禁止取消最後一條 series；其他可設定 pane 可保存空陣列，但 readout 仍直接呈現 payload 欄位，因此會出現「文字有資料、圖沒有線或柱」的矛盾。另一方面，`setCandles()` 只更新 neutral time anchor；若 K 棒日期集合改變，既有籌碼 payload 不會依新日期映射重建可繪點。匯出 readiness 又把零條已選 series 視為 ready，無法攔截此類空白圖。

本修正必須維持既有非退化契約：同商品的即時日 K 更新不得重新抓取籌碼 API、純 layout／viewport 更新不得重建 series、來源真正沒有欄位時不得補造資料。

## Goals / Non-Goals

**Goals:**

- 將所有可設定籌碼 pane 的 series 選取正規化為至少一條合法選項，並自動修復既有空陣列設定。
- 以穩定的 candle date mapping signature 判斷是否需要用最後 payload 本機重畫。
- 追蹤每個 pane 實際提交至 Lightweight Charts 的可繪點數，讓畫面與匯出 readiness 能 fail closed。
- 以測試覆蓋法人、融資券、借券、比率及持股比 pane 的資料存在／資料缺失兩種情境。

**Non-Goals:**

- 不修改籌碼 API、D1 schema、來源更新頻率或資料日期政策。
- 不增加假資料，不把來源 `null` 當成零，也不要求無資料 pane 繪製空殼 series。
- 不在 K 棒變動時發出新的籌碼 request。
- 不改變 pane 群組、排序、顏色、數值單位或交易功能。

## Decisions

1. **在讀取與互動兩個入口統一套用非空選取。** 新增共用正規化函式：先過濾未知 series ID；若結果為空，回復該 pane 的 `defaults`。讀取舊設定與 checkbox change handler 都使用同一規則，避免只修新操作卻留下既有壞狀態。相較於只顯示警告，此做法能直接恢復圖形，且符合每個 pane 已定義的預設視覺。

2. **把 candle mapping 納入 render material identity，但不納入 API identity。** 以實際可映射的 candle 日期與 chart time 產生穩定 signature；signature 改變時以 `lastPayload` 呼叫本地 render。這可修正日期範圍或時間映射變動造成的漏畫，同時保持既有 request 去重與「即時日 K 不重抓籌碼」要求。純 candle 值變動而日期／time 不變時不重畫 series。

3. **在 series 建立時記錄實際點數。** `addHistogram`／`addLine` 記錄提交資料的長度；`clearSeries` 與 unmount 同步歸零。readiness 只有在 material 不預期存在，或至少一條已選 series 真正提交了可繪點時才成立。相較於讀 Canvas 像素，此方式不受 device pixel ratio、配色或 cross-origin canvas 限制，且能精確連結資料轉換結果。

4. **資料存在但目前選項沒有可繪點時明確 fail closed。** 不把 payload 有任意 row 等同每個選項都有資料；應以已選 series 經欄位 null 過濾及日期映射後的點數判定。來源欄位確實全為 `null` 時維持「無資料／部分資料」，不補畫零值。

## Risks / Trade-offs

- [K 棒日期新增時會多一次本機 series 重建] → 只在 candle mapping signature 改變時執行，且重用 `lastPayload`，不增加網路請求；同日最後一棒數值更新不觸發。
- [舊使用者刻意取消所有 series 的狀態會被修復] → 空白 pane 沒有可用視覺意義，統一回復官方預設，並保留非空的自訂組合。
- [某些資料集有 rows 但已選欄位全為 null] → readiness 依選定欄位的實際點數與 pane material expectation 判定，狀態文案必須維持來源真相，不能把 null 當零。
- [加入點數追蹤可能漏掉新 pane] → 所有 line／histogram 建立都必須經過共用 helper，並以 registry 驗收測試覆蓋。

## Migration Plan

1. 載入既有 `localStorage` 設定時正規化空選取；不需資料 migration 或版本清除。
2. 發布前執行 focused tests、MultiView build、OpenSpec strict validation 與實際 2449.TW 瀏覽器驗收。
3. 若發生回歸，可回退前端程式；使用者非空選取與籌碼 payload 不受影響。

## Open Questions

無。
