## Context

`QuoteBoard` 已使用目前顯示的 `close` 與 `ContractInfo.limit_up`／`limit_down` 顯示「漲停／跌停」標籤，但判定留在元件內，且跌停檢查目前依附於 `limit_up > 0` 的外層條件。`WatchRow`、排行榜、熱力圖、衍生品報價表、持倉現價與托盤報價原本只依最新價相對參考價計算一般 up／down 文字色，尚未一致辨識漲跌停。

多數介面已直接持有 `ContractInfo`；排行榜與熱力圖既有 `loadStockDetails` 雖已取得完整 Contract V2 info，卻只保留分類欄位。排行榜點擊目前只傳商品代碼，而 `TradingApp.selectedSnapshot` 只從目前自選清單尋找，因此不在自選內的商品會在 QuoteBoard 顯示 `—`，直到新 quote 抵達；K 線非同步切換期間也可能暫留前一商品圖形。現有 theme 已提供語意化的 `vars.color.up`／`vars.color.down`，閃電下單價位也已有實心漲跌停底色搭配白字的視覺先例。

## Goals / Non-Goals

**Goals:**

- 讓所有具有可靠上下限價的目前報價面板以一致方式判定漲跌停狀態。
- 只反白承載最新價與當日漲跌資訊的報價群組，提供實心背景、高對比文字與可存取的狀態語意。
- 讓排行榜、熱力圖及其他非自選選取來源把當時 snapshot 交給全域選取，並以 latest-wins 防止舊選取資料回寫。
- 保持既有 theme 慣例、響應式排列、字體倍率、選取、hover、成交 flash 與拖放行為。
- 以純函式與可觀察的 DOM 狀態建立可重複驗證的契約。

**Non-Goals:**

- 不用漲跌幅推算或補造商品的上下限價。
- 不改變 Shioaji 串流、snapshot、商品合約、下單或 simulation runtime。
- 不替五檔價位、逐筆成交、歷史 K 棒讀值、行情摘要獨立價位、下單價格、損益或市場訊號事件增加持續反白。
- 不改變一般非漲跌停價格相對參考價的文字判色規則。

## Decisions

### 1. 以共用純函式判定目前漲跌停狀態

新增共用 primitive，輸入目前顯示的最新價、`limit_up`、`limit_down` 與是否為指數，輸出 `up`、`down` 或 `null`。最新價與對應上下限價都必須是大於零的有限數字；`limit_up` 與 `limit_down` 必須獨立驗證，指數一律回傳 `null`。

判定採最新價大於等於有效 `limit_up` 為 `up`、小於等於有效 `limit_down` 為 `down`，沿用目前 QuoteBoard 對超界或浮點來源差異的容錯方式。不得以漲跌幅門檻、參考價或商品類型的固定百分比推測。

元件仍先依既有優先順序選出實際顯示的最新價，再交給 primitive；因此 live tick 存在時以 live tick 為準，沒有 live tick 時可由目前本來就顯示的 snapshot 判定，狀態不會和畫面數字分離。

**替代方案：**各元件各自保留條件判斷。此方案程式改動較少，但容易再次出現跌停條件依附於漲停欄位、百分比推測或 fallback 不一致，因此不採用。

### 2. 將最新價與漲跌資訊包成可反白的報價群組

主 QuoteBoard 將右側最新價與下方漲跌／漲跌幅視為同一個報價群組；自選清單、排行榜、熱力圖、托盤、衍生品報價表與持倉現價則只反白各自的最新價／漲跌群組或儲存格。群組以 `data-limit-state="up|down"` 或等效、可測試的語意狀態驅動樣式。

群組進入漲跌停時使用實心 `vars.color.up`／`vars.color.down` 背景及白色高對比文字。主 QuoteBoard 不再顯示可見的「漲停／跌停」徽章；所有緊湊報價均以 `aria-label` 或等效方式提供非純色彩語意。非漲跌停狀態沿用既有透明背景與方向文字色。

**替代方案：**反白整個面板或整列自選商品。此方案視覺更強，但會覆蓋商品代碼、名稱、走勢縮圖、選取與拖放語意，也超出使用者指出的報價欄位範圍，因此不採用。

### 3. 以 snapshot-aware、latest-wins 的全域選取避免空白或舊商品回寫

定義共用的報價選取 callback，可同時傳入 `code` 與來源目前已有的 `Snapshot`。排行榜與熱力圖在點擊時直接傳遞該列 snapshot；衍生品表格也傳遞已輪詢到的 snapshot。`TradingApp` 將外部 snapshot 與商品代碼綁定，只在目前選取 code 相符時提供給 QuoteBoard。

若選取來源沒有 snapshot，`TradingApp` 在解析 `ContractInfo` 後補抓單一商品 snapshot。每次選取遞增 generation；合約或 snapshot 請求完成時必須核對 generation 與 code，較早選取不得覆蓋較晚選取。自選清單既有 snapshot 仍為第一優先。

K 線資料來源在 contract code 改變時必須先清除前一商品 series／readout，再載入新商品，避免把上一商品 K 線誤認為目前商品。

**替代方案：**只等待新 SSE tick。盤後、未訂閱或訂閱建立前會持續顯示空白，且不能表達使用者點擊當下已看到的排行報價，因此不採用。

### 4. 持續狀態優先於短暫互動效果，但不阻擋互動

選取框、左側選取色帶、hover、拖放提示與成交 flash 可以繼續存在，但不得把漲跌停群組恢復成一般底色。成交 flash 結束後，群組必須仍呈現目前漲跌停狀態；價格離開上下限價後則於同一次報價更新移除反白。

樣式不得攔截 pointer event，也不得因新增 padding、border 或文字折行改變列高、造成數字裁切或擠壓行情摘要。

### 5. 沿用使用者選定的價格配色慣例

所有背景均使用 theme 的語意 token，而非硬編碼紅色與綠色。預設 `*-tw` theme 呈現漲停紅底、跌停綠底；使用者選擇 `*-intl` theme 時沿用既有綠漲紅跌設定，與全站價格方向保持一致。

**替代方案：**無論 theme 都固定紅漲綠跌。此方案符合單一截圖，但會違反既有明確的國際配色設定，因此不採用。

## Risks / Trade-offs

- [大量漲跌停商品造成畫面色塊密度提高] → 僅反白最新價與漲跌資訊群組，不反白整列或整個面板。
- [白字在不同 theme 色票上的對比不足] → 驗收所有 dark、midnight、light 的台股與國際配色，必要時調整群組內標籤邊界但不改變語意 token。
- [成交 flash 或選取樣式覆蓋持續狀態] → 明確分離群組的持續背景與整列短暫 overlay，加入互動狀態驗收。
- [snapshot 等於漲跌停但行情並非即時] → 狀態只描述「目前畫面顯示價位於上下限」，不宣稱委託簿鎖死；既有行情時間與連線狀態仍負責表達新鮮度。
- [不同元件對無效數值採取不同 fallback] → primitive fail-closed，元件只傳入自己實際顯示的最新價與合約上下限。
- [快速連點排行榜造成舊 snapshot 或 K 線回寫] → 選取合約、snapshot 與圖表載入都核對 generation／code，採 latest-wins。
- [為排行／熱力圖重複查詢完整合約造成負載] → 延用 `loadStockDetails` 已取得的 Contract V2 info 並擴充本機 metadata，不以漲跌幅猜測。

## Migration Plan

1. 先加入共用 primitive 與單元測試，再讓三個報價元件改用同一判定。
2. 補齊 snapshot-aware 選取與圖表切換清理，再逐一加入所有目前報價群組狀態與樣式。
3. 確認一般、漲停、跌停、打開狀態及快速切換不會顯示空白或前一商品資料。
4. 執行元件／瀏覽器驗收、OpenSpec strict validation 與既有測試。
5. 本變更不涉及資料遷移；若需回復，只需回退報價群組樣式與 snapshot handoff，不影響行情或交易資料。

## Open Questions

無。
