# 日線關鍵價位實作與驗證

日期：2026-10-29（Asia/Taipei）。本 change 已實作並在既有本機 Web 載入，保留工作區原有變更；本次依使用者直接授權同步正式規格、歸檔並建立本機commit，未push。

## 使用方式

在 K 線圖的「指標 → 主圖疊加」搜尋／加入「日線關鍵價位」。首次加入開啟日5／10／20／60／120MA，以及日BOLL上／中／下軌；各項可獨立關閉、調整顏色、線寬及線型。BOLL 預設20期、2倍母體標準差，可調整2–200期及0.5–5倍（步進0.5）。設定沿用既有 canonical store、草稿確認／取消及同 origin 同步；僅保存設定，不保存計算價位。

1m、5m、15m、60m 都投影同商品最新1D快照；盤中包含今日尚未完成日K的最新合法成交價。切換時框、游標或橫向捲動不改成歷史選棒價位。1D保留設定與數值清單，不重複畫水平線。這組設定與原有分鐘MA、BOLL及日線壓撐分開。

來源日期及「盤中暫估／已收盤／完成狀態未知」顯示於狀態列，展開可看八項價格、來源更新時間、資料不足與舊值原因。完全同價的日20MA與日BOLL中軌可共用標籤，仍保留兩項開關；僅格式化相同的不同值不合併。固定不擴張Y軸，只畫原可見價格區間內的水平線及標籤；視窗外價位可在清單查看。已移除納入自動縮放選項，舊設定不再生效，沒有 fitContent 或重設X軸。

## 資料與範圍

- 商品身分包含 security type、region、exchange、code、target code 與既有 canonical 未還原來源版本；計算重用 `referenceSma`、`bollinger`，保留原始公式精度，顯示再套既有 formatter。
- 商品共用 authority 先等待既有圖表在途歷史、重用合法 coverage；不足才以既有 `fetchKbars` 路徑按需循序讀取30日 chunk，最多365日曆日／13個 chunk，單次逾時20秒。不是預先耗用13次；達到開啟項目的最大期數即停止。未加入、隱藏或全關時不產生本功能需求。
- 保留每商品至多201根日K；inactive LRU以12個商品為容量目標，仍有consumer的商品不強制淘汰。原始1m payload不因八項價位複製八份。
- 共用 consumer、StrictMode與取消處理，最後 consumer 離開才取消專屬載入；來源失敗不因時框切換無限重試。舊資料保留原 as-of 並標示 stale；不足逐項顯示，不補零或拿分鐘MA代替。
- 行情沿用主圖已接受的合法成交及累積量cursor，不新增 SSE、subscribe、poll 或後端採集。真實新交易日成交才建立新日K；單靠時鐘換日不造棒。完成狀態須有來源歷史時間與尾端證據；未知商品時段不套台股收盤時間。
- 已知 gap、非有限數值或錯身分不計算。沒有額外官方交易日稽核來源，因此不宣稱本功能可獨立證明所有停牌／缺日差異。

## 首輪隔離測試與建置

| 範圍 | 結果 | 主要證據 |
|---|---|---|
| 對應單元／整合 | 78項通過 | 日線計算5、authority10、設定／回測3、renderer2，及既有指標、壓撐、drill-down、量值整合回歸 |
| Chromium | 20項通過 | 本功能7項，及主圖完整性、壓撐選單、指標readout既有13項 |
| TypeScript | 通過 | Node24 `tsc -b --pretty false` |
| Vite build | 通過 | 2249 modules；既有無關BigInt target與chunk大小警告保留 |
| OpenSpec離線strict | 81／81通過 | `python3 scripts/openspec-offline.py validate --all --strict --no-interactive` |
| 限定diff | 通過 | 四個既有主檔的diff檢查及新增檔案空白檢查 |

隔離來源明確為合成資料，業務HTTP被mock拒絕。協調器測試涵蓋forming close更新、來源證明closed、期貨完成狀態unknown、換日無棒、來源逾時／拒絕、A→B遲到回覆、跨consumer共用及最後取消。瀏覽器使用真正 lightweight-charts canvas，核對日線標籤、四時框同值、40日不足、刷新失敗stale、StrictMode設定事件、深／淺色與360px面板。

八個日線名稱與十五條壓撐共同renderer驗證22個實際位置／23個名稱、高DPI座標與connector、短面板有界分欄。後續原視窗修正直接驗證啟用前後K棒價位座標、面板大小及X軸不變／不呼叫fitContent，並驗證舊autoscale設定不再生效。純顯示操作不觸發交易；既有點價買與拖單只送達隔離mock接點，無即時價格的警示仍拒絕建立。共用回測renderer實際驗證忽略日線primitive，保留原SMA，不引入今日價格。

測試中的13 chunk邊界fixture刻意每chunk只有1根合成日K，量測為13次、canonical JSON 1235 bytes、13根保留棒、1個快取／consumer及四捨五入0ms。這是容量／接線證據，不代表實際券商payload、網路速度或市場下載耗時。真實來源wire bytes及冷載精確耗時本次未量測。

## 本機實際資料核對

沿用既有Chrome主圖商品3090（日電貿），來源交易日2026-10-29、來源尾端13:30:00、狀態已收盤；BOLL20／2。下列完整精度讀回在1D及1m／5m／15m／60m逐項完全相同，均為available：

| 價位 | 讀回值 |
|---|---:|
| 日5MA | 159 |
| 日10MA | 164 |
| 日20MA | 166.85 |
| 日60MA | 164.916667 |
| 日120MA | 193.708333 |
| 日BOLL上軌 | 181.926803 |
| 日BOLL中軌 | 166.85 |
| 日BOLL下軌 | 151.773197 |

本功能首次實際載入為6個歷史chunk、保留122根日K；四種分鐘圖切換後counter均維持6，沒有因切換而重抓日線長歷史。此counter只計本功能authority請求，不把原有分鐘圖正常歷史請求算成0。已看見60m主圖水平線、價位及既有壓撐同時顯示，最後恢復原3090／1D視圖及原壓撐選棒；保留新功能啟用。

私密證據位於 `Acceptance/daily-indicator-price-levels-20261029/`：`live-readback.json`、`live-3090-60m.png`、兩張隔離深／淺色畫面及 `final-summary.json`。實際截圖僅裁切圖表，不含帳戶資訊。

本次為盤後驗證，**真實盤中forming連續更新及自然forming→closed尚未現場觀察**；上述情境已有隔離測試，不能冒稱真實盤中驗收。未替此功能新增排程或全日observer。也不將主圖驗證擴稱MultiView／全市場／交易驗收。

## 相容性與停用

修改範圍為主圖、指標註冊／設定與共同價位renderer，以及新增日線authority、計算、readout、label layout與測試。既有MA／BOLL、日線壓撐reference、交易handler及回測資料契約保留。API／Web／MultiView native PID仍991／969／974；watchdog設定SHA、正式execution政策與四個calendar job plist均與先前正式安裝讀回相符。未操作服務生命週期、重綁job、修改預算Gate、原監控資料或收據。

停用可在指標設定移除「日線關鍵價位」，或關閉全部八項；最後consumer離開後取消本功能專屬載入並清理投影。程式回退只針對本change新增檔案與四個既有檔案的本輪增量，不可以整檔還原覆蓋工作區其他已授權修改；本輪前的四檔快照另保留於本機暫存區。原資料、舊指標、版面及排程不清除。

## 追加：固定保留原分鐘K線價格視窗

依使用者追加要求，移除日線價位的Y軸範圍擴張接線與「納入自動縮放」選項；canonical設定正規化會略去舊autoscale參數，主圖也不再讀取它。只繪製真實價位座標位於原可見範圍內的日線水平線與標籤，範圍外項目在共同標籤配置前排除；縮放／拖曳後隨畫面重繪重新判斷，數值清單仍保留所有已開啟項目及視窗外提示。

本次針對性單元回歸17項、Chromium7項全部通過；包含可見範圍內外互換、原Y座標／面板高度／X軸不變、舊autoscale設定失效、設定僅保留八個價位開關。TypeScript通過，Vite build通過（2249 modules），OpenSpec離線strict81／81及限定diff檢查通過。

本機沿用使用者當下的2454聯發科／15m圖驗證：日5MA4078、日10MA4163.5、日60MA4339.333333、日120MA4146.541667位於原價格視窗，日20MA／BOLL中軌4507.75、上軌5267.068609及下軌3748.431391列為視窗外且未畫入主圖；原有PP／三關／CDP及分鐘指標保持。沒有為展示全部日線價位將縱軸擴張至5267；保留使用者商品與時框，完成後收合數值清單。實際畫面保存為私密證據 `live-visible-only-2454-15m.png`；這項現場檢查為盤後視覺證據，精確開關前後座標不變由上述隔離Chromium測試核對。

## 歸檔與提交範圍

27項任務完成，新增規格同步至 `openspec/specs/daily-indicator-price-levels/spec.md`，本change歸檔至 `openspec/changes/archive/2026-10-29-add-daily-indicator-price-levels/`。提交限本功能與本次原視窗修正、測試及上述文件。主圖原有HMR／continuity改動以本輪前快照分離，保留在工作區且不納入此提交；其餘未提交工作、私密驗收資料、生成截圖與建置產物同樣不納入。

待提交index另匯出成隔離副本，型別、build及Chromium20項通過；單元／整合79項通過。單元入口明確使用 `node node_modules/vitest/vitest.mjs run --config vitest.daily-indicator-levels.config.ts`，僅載入圖表所需plugin，不初始化正式Vite gateway／repository。首次使用預設Vite入口曾因目前資料庫版本不相容而在gateway初始化時停止，該次不列為測試通過。隔離候選build為2224 modules，與含有其他未提交工作之完整工作區2249 modules分別記錄；兩者都通過。歸檔後OpenSpec離線strict81／81通過。
