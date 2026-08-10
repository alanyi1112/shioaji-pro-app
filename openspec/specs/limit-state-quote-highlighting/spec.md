# limit-state-quote-highlighting Specification

## Purpose
定義目前報價欄位以可靠上下限價判定漲跌停、套用一致的高對比反白，並確保非自選商品連動時同步當下 snapshot 且舊請求不得回寫的介面契約。

## Requirements
### Requirement: 漲跌停狀態必須由可靠上下限價判定
系統 MUST 以目前報價元件實際顯示的最新價和同一商品 `ContractInfo` 的有效 `limit_up`／`limit_down` 判定目前漲停、跌停或非漲跌停狀態。系統 MUST 獨立驗證上下限價，不得以漲跌幅門檻、參考價或固定百分比推測漲跌停；最新價或對應上下限價缺少、不是有限數字或小於等於零時 MUST fail-closed，不得產生對應漲跌停狀態。指數商品 MUST NOT 產生個別商品漲跌停反白。

#### Scenario: 最新價等於合法漲停價但漲幅不是整數百分比
- **WHEN** 非指數商品目前顯示的最新價為 `271.50`、`limit_up` 為 `271.50`，且顯示漲幅為 `+9.92%`
- **THEN** 系統 MUST 判定目前狀態為漲停
- **AND** 系統 MUST NOT 因漲幅不是 `+10.00%` 而漏判

#### Scenario: 最新價等於合法跌停價
- **WHEN** 非指數商品目前顯示的最新價等於有效 `limit_down`
- **THEN** 系統 MUST 判定目前狀態為跌停

#### Scenario: 上下限價獨立驗證
- **WHEN** `limit_up` 缺少或無效，但目前顯示的最新價與有效 `limit_down` 相等
- **THEN** 系統 MUST 仍判定目前狀態為跌停
- **AND** 無效的 `limit_up` MUST NOT 阻止跌停判定

#### Scenario: 目前顯示價來自 snapshot
- **WHEN** live tick 尚不可用、報價元件依既有 fallback 顯示 snapshot 最新價，且該價格等於有效上下限價
- **THEN** 系統 MUST 依該畫面實際顯示價格產生對應漲跌停狀態
- **AND** 系統 MUST NOT 將此狀態宣稱為委託簿鎖死或即時成交保證

#### Scenario: 資料不足或商品為指數
- **WHEN** 最新價無效、對應上下限價無效，或目前商品為指數
- **THEN** 系統 MUST 維持非漲跌停狀態
- **AND** 系統 MUST NOT 使用漲跌幅或其他欄位補造上下限價

### Requirement: 主要即時報價群組必須持續反白漲跌停狀態
當目前最新價位於漲停或跌停時，系統 MUST 對主 QuoteBoard、自選清單、排行榜、類股熱力圖、托盤迷你自選／排行、個股期／權證／選擇權報價表及持倉現價中承載目前最新價與當日漲跌資訊的報價群組或儲存格套用持續狀態背景與高對比文字。反白 MUST 限於目前報價，不得擴張至商品代碼、名稱、走勢縮圖、整列或整個面板；非漲跌停時 MUST 沿用既有一般樣式。

#### Scenario: 主 QuoteBoard 顯示漲停
- **WHEN** 主 QuoteBoard 的目前狀態為漲停
- **THEN** 最新價、漲跌與漲跌幅所屬報價群組 MUST 使用 theme 的 `up` 實心背景與白色高對比文字
- **AND** 報價群組 MUST NOT 顯示可見的「漲停」或「跌停」徽章文字
- **AND** 報價群組 MUST 以 `aria-label` 或等效方式保留「漲停」或「跌停」可存取語意
- **AND** 商品代碼、名稱及右側行情摘要 MUST NOT 被反白

#### Scenario: 排行榜與其他目前報價面板顯示漲跌停
- **WHEN** 排行榜、類股熱力圖、托盤排行、個股期／權證／選擇權報價表或持倉現價具有有效 Contract V2 上下限價，且目前顯示價等於對應上下限價
- **THEN** 最新價及同組漲跌資訊 MUST 使用對應 theme 實心背景與白色高對比文字
- **AND** 系統 MUST NOT 只因漲跌幅接近 `+10%` 或 `-10%` 就產生反白
- **AND** 商品識別、分類、成交量、履約價、損益及其他非目前報價欄位 MUST 維持既有樣式

#### Scenario: 自選清單顯示跌停
- **WHEN** 自選清單某商品的目前狀態為跌停
- **THEN** 該列右側最新價、漲跌與漲跌幅所屬報價群組 MUST 使用 theme 的 `down` 實心背景與白色高對比文字
- **AND** 商品代碼、名稱、走勢縮圖及整列背景 MUST NOT 被反白

#### Scenario: 托盤迷你自選顯示漲跌停
- **WHEN** 托盤迷你自選商品的目前狀態為漲停或跌停
- **THEN** 該商品的最新價與漲跌幅報價群組 MUST 使用對應實心狀態背景與高對比文字
- **AND** 托盤中的商品代碼、名稱與走勢縮圖 MUST 維持既有樣式

#### Scenario: 緊湊報價提供非色彩狀態語意
- **WHEN** 自選清單或托盤迷你自選以背景色表示漲停或跌停
- **THEN** 對應報價群組 MUST 以 `aria-label` 或等效可存取方式提供「漲停」或「跌停」文字語意
- **AND** 狀態 MUST NOT 只依賴顏色傳達

#### Scenario: 一般價格維持既有樣式
- **WHEN** 目前最新價介於有效 `limit_down` 與 `limit_up` 之間
- **THEN** 報價群組 MUST NOT 顯示漲跌停實心背景
- **AND** 最新價、漲跌與漲跌幅 MUST 繼續依既有參考價方向規則判色

### Requirement: 漲跌停反白必須遵循目前 theme 配色慣例
漲跌停背景 MUST 使用目前 theme 的 `up`／`down` 語意 token。預設台股配色 MUST 呈現漲停紅底、跌停綠底；使用者已選擇國際配色時 MUST 保留該 theme 的綠漲紅跌慣例。所有支援的背景 theme 中，反白內文字 MUST 保持可讀對比。

#### Scenario: 預設台股配色
- **WHEN** 使用者使用 dark、midnight 或 light 的台股配色 theme
- **THEN** 漲停報價群組 MUST 顯示紅色實心背景
- **AND** 跌停報價群組 MUST 顯示綠色實心背景

#### Scenario: 使用者選擇國際配色
- **WHEN** 使用者主動選擇國際配色 theme
- **THEN** 漲停與跌停報價群組 MUST 分別沿用該 theme 的 `up` 與 `down` 顏色
- **AND** 系統 MUST NOT 為本功能硬編碼紅漲綠跌而破壞全站配色一致性

### Requirement: 持續反白必須隨最新價更新且不破壞既有互動
漲跌停反白 MUST 代表目前顯示的最新價狀態；價格離開上下限價後 MUST 在該次報價更新中移除反白。選取、hover、成交 flash、拖放、容器響應與字體倍率 MUST NOT 覆蓋持續狀態、阻擋操作、造成報價文字折行、裁切、重疊或明顯版面位移。

#### Scenario: 漲停打開
- **WHEN** 商品前一筆顯示價等於 `limit_up`，新一筆顯示價低於 `limit_up` 且高於 `limit_down`
- **THEN** 系統 MUST 在處理新報價時移除漲停實心背景
- **AND** 報價群組 MUST 回復既有一般方向樣式

#### Scenario: 成交 flash 後維持漲跌停反白
- **WHEN** 漲跌停商品收到觸發成交 flash 的新成交資料
- **THEN** 短暫 flash MAY 繼續顯示
- **AND** flash 結束後對應報價群組 MUST 仍呈現目前漲跌停背景

#### Scenario: 自選列選取及 hover
- **WHEN** 漲跌停商品的自選列同時處於選取或 hover 狀態
- **THEN** 選取色帶、邊界與 hover 互動 MUST 保持可辨識
- **AND** 右側報價群組的漲跌停背景 MUST NOT 被一般列背景覆蓋

#### Scenario: 響應式與放大字體
- **WHEN** 主 QuoteBoard 位於寬版、中版或極窄容器，或介面字體倍率為 `1.15` 或 `1.3`
- **THEN** 漲跌停反白 MUST 不改變既有資訊優先順序
- **AND** 最新價、漲跌、漲跌幅及狀態文字 MUST 完整可讀且不得折行、裁切、重疊或遮蔽行情摘要

### Requirement: 非自選選取來源必須同步當時報價且防止舊資料回寫
排行榜、類股熱力圖與其他可連動商品的目前報價面板在使用者點擊商品時，MUST 將來源已有的 snapshot 與商品代碼一起提供給全域選取。來源沒有 snapshot 時，系統 MUST 以已解析的 `ContractInfo` 補抓單一商品 snapshot。QuoteBoard MUST 只顯示與目前選取 code 相符的 snapshot；合約、snapshot 與 K 線非同步載入 MUST 採 latest-wins，且切換商品時 MUST NOT 將前一商品的報價、K 線或 readout 暫時標示為新商品資料。

#### Scenario: 點擊不在自選清單內的排行榜漲停商品
- **WHEN** 使用者點擊排行榜中的 `2103`，來源列已有最新價 `27.50` 與對應 Scanner snapshot，且 `2103` 不在目前自選清單
- **THEN** 全域選取 MUST 切換為 `2103`
- **AND** QuoteBoard MUST 立即顯示 `27.50` 及同一 snapshot 的漲跌資訊，不得顯示 `—`
- **AND** 若 `27.50` 等於有效 `limit_up`，QuoteBoard 與排行榜報價 MUST 同時使用漲停反白

#### Scenario: 快速連點不同排行榜商品
- **WHEN** 使用者先點商品 A、隨即點商品 B，而商品 A 的合約、snapshot 或 K 線請求較晚完成
- **THEN** 商品 A 的結果 MUST NOT 覆蓋目前商品 B 的 QuoteBoard、K 線或 readout
- **AND** 載入商品 B 期間 MUST NOT 把商品 A 的既有圖形標示為商品 B

### Requirement: 非主要即時報價欄位不得被持續反白
本功能 MUST NOT 因商品目前位於漲跌停，就替行情摘要的開、高、低、參考價、上下限價、委買、委賣、五檔價位、逐筆成交、歷史 K 棒讀值、下單價格、損益或市場訊號事件套用持續漲跌停背景。這些欄位 MUST 保留各自既有的價位方向、買賣側、歷史、事件或交易語意。

#### Scenario: 同一商品漲停時仍保留獨立欄位語意
- **WHEN** 商品目前最新價位於漲停，且畫面同時顯示行情摘要、五檔、逐筆成交、歷史 K 棒或下單欄位
- **THEN** 只有規格指定的最新報價群組 MUST 使用持續漲停背景
- **AND** 其他價格與交易欄位 MUST 維持既有樣式及語意
