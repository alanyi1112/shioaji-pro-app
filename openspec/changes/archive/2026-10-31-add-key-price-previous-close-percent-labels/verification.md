# 實作與驗證紀錄（2026-10-31）

最新費波定義（21:15）：日K費波已改用目前圖表資料序列最後一根close，標籤置於線段左側、無「較昨收」前綴。壓撐仍用所屬參考K.close。下列T／P驗收屬早期定義，最新結果見末節。

最新使用者修正：CDP／三關價／Pivot Point已改用產生該組價位的參考K收盤價；日K費波保留實際T／P昨收。下列早期驗收保留當時定義，最新結果見「壓撐分母修正」末節。

## 完成範圍

主交易圖1m／5m／15m／60m／1D的CDP、三關價與Pivot Point標籤，及1D的費波回撤／拓展完成圖與合法水準預覽，直接顯示「較昨收」百分比。保留原名稱、比率、價格與線色，百分比獨立採主題漲跌色。未知顯示破折號及常駐原因；不補0、不改reference／錨點、不建立新儲存格式。1D壓撐為20:43依最新授權完成的擴充，下列早期驗收保留當時範圍，最新結果見末節。

新增純resolver與格式化器、被動日Kobserver及主圖context接線；T／P／價格基準／來源時間／快照generation一併保留。拒絕缺日、錯商品／基準、過期日曆、零／負／非法昨收、來源尚未確認與遲到身分。原cancel／chart-load identity守門保留。

## 離線與Chromium回歸

- 67項相關單元測試通過：昨收100對105／97／100、102.50與112，未格式化價位、負零、超過10%、假reference95、單日／缺日、休市、T切換、來源／generation與非法分母；涵蓋既有壓撐、費波、儲存及日線authority。
- 新增10項Chromium測試通過：四個分K各三公式15線；DPR1／2的真canvas字寬與邊界；360／800px費波回撤＋拓展密集SVG；pending／unknown；主React圖表的共用昨收、範圍限制及無額外日線載入。
- 既有日線價位7項、壓撐選單6項、主圖完整性6項Chromium回歸通過；合併新增案例共29項全數通過。部分fixture有React act提示與刻意來源失敗診斷；沒有測試失敗，不把fixture當live行情。
- 四種分K採相同原資料／原圖形、固定手動logical range及Y範圍，比較context切換前後：bar spacing、logical range、Y範圍、軸寬、pane高度、固定價格及logical座標均完全相等（0 CSS px差異）。主CandleChart另以被動快照更新重驗，無price-series options呼叫、視窗與座標完全相等。
- 費波原level線、色帶、錨點與完成拓展autoscale bounds不變；不把百分比當series資料。實際SVG getBBox確認文字在測試面板內；未傳context時沿用原標籤。MultiView沒有引用這組主圖consumer，未修改其程式或服務。
- 被動authority新增行情請求0；主圖fixture新增authority載入0，下單／修改／警示副作用0。本功能另共用一次既有本機日曆metadata GET，不作上游來源更新／下載、DB寫入或訂閱。

驗證指令：

```sh
pnpm exec vitest run src/lib/key-price-previous-close.test.ts src/lib/pivot-primitive.test.ts src/lib/fibonacci-overlay.test.ts src/lib/daily-indicator-authority.test.ts src/lib/fibonacci-annotations.test.ts src/lib/support-resistance.test.ts src/lib/support-resistance-state.test.ts
pnpm exec vitest run --config vitest.browser.config.ts src/components/key-price-percent.browser.test.ts src/components/key-price-benchmark.browser.test.ts src/components/daily-indicator-levels.browser.test.ts src/components/support-resistance-menu.browser.test.ts src/components/candle-chart-integrity.browser.test.ts
pnpm build
python3 scripts/openspec-offline.py validate --all --strict --no-interactive
```

TypeScript／build通過；build保留工作樹其他功能既有的BigInt目標相容性提示。OpenSpec strict 83/83通過，當次範圍diff check通過。

## 既有頁面實際讀回

2026-10-31台北20:14，以CUA讀取既有5173頁面。原頁Vite WebSocket未連上，先保留畫面，再依使用者明確同意重新整理一次。既有連動規則於重整後選到IX0001，時框5m；沒有為測試再切商品、增減指標或建立盤中／盤後採集。

實際基準：T=2026-10-30、P=2026-10-29、close=46,368.33、canonical-unadjusted-v1、authority generation=9，日曆來源版本與manual revision已隨讀回保存。10/31休市，因此沿用10/30行情日。

| 實際啟用Pivot | 原始價位 | 畫面較昨收 |
| --- | ---: | ---: |
| R3 | 47405.856667 | +2.24% |
| R2 | 46772.823333 | +0.87% |
| R1 | 45992.326667 | −0.81% |
| P | 45359.293333 | −2.18% |
| S1 | 44578.796667 | −3.86% |
| S2 | 43945.763333 | −5.22% |
| S3 | 43165.266667 | −6.91% |

沿實際renderer鏡像的七筆價位與未四捨五入percentValue逐條重算，最大差異0。可見文字及常駐基準已截圖；保留工具原有範圍外線價／標籤規則，不以新增百分比擴大價格範圍。

本機證據（outputs不納入Git）：

- `outputs/key-price-percent-20261031/live-readback.json`
- `outputs/key-price-percent-20261031/live-pivot-5m.png`
- `src/components/key-price-fib-360.png`、`key-price-fib-800.png`為Chromium合成資料畫面，非live。

實際頁當下只啟用Pivot；其餘兩公式、其他時框與1D費波以真Chromium隔離回歸驗證，沒有為取得live驗收而再下載歷史行情。重新整理本身依原程式讀取行情，其請求數未作計量，不冒稱整輪業務請求為0。

## 工作樹與交付邊界

本次程式修改為`candle-chart.tsx`、`fibonacci-overlay.tsx`、`daily-indicator-authority.ts`、`fibonacci-overlay.ts`、`pivot-primitive.ts`，新增`key-price-previous-close.ts`及三份測試；文件只更新此change。`candle-chart.tsx`原有HMR週期接線／continuityKey差異屬先前工作，保留不重作。其他混合工作樹、runtime、API、watchdog、MultiView、排程、資料庫與Gate均未操作。

未commit、push或歸檔；保留原件。實際頁已讀回新功能，回歸與live畫面的證據範圍如上，不把隔離案例冒稱所有商品／時框的live驗收。

## 連續切換後數字消失修正（2026-10-31台北20:37）

### 根因與修正

以延後回覆的真React／Chromium測試重現：先取得同商品有效昨收100，切到1m後立刻切15m；舊1m請求被取消，`DailyIndicatorAuthority.track`卻將既有快照標成stale，畫面昨收變成null並顯示「日K來源尚未確認或已過期」。修正前此新增測試明確失敗，修正後通過。

`track`現在接收原載入的AbortSignal，圖表既有週期載入及45日日K來源接線均傳入自己的signal。只有signal確實已取消時才不撤銷原本有效來源；未取消的真失敗仍標stale，單靠AbortError名稱不能繞過。原快照的asOf／receivedAt不假刷新、不補資料、不新增重試或行情需求，日期／價格基準／分母及Gate檢查不變。

### 新增回歸與完整預檢

- 單元驗證取消不撤銷舊快照、不增加請求；沒有取消的同名AbortError仍標stale。
- Chromium可控制Promise回覆順序，驗取消時數字仍為100，後續新週期正確完成並有15條百分比。
- 三個合成商品分母分別100／200／300，三輪共54次週期切換，跨1D與四種分K。每個分K逐次讀當下renderer的15條標籤，而非沿用fillText歷史紀錄；逐條重算及商品身分正確，authority額外下載0。
- 含既有回歸共71項單元測試與31項Chromium測試通過；TypeScript／build通過、OpenSpec strict 83/83、當次範圍diff check通過。保留既有React act與BigInt相容性提示，無測試失敗。

### 實際5173連續操作

本輪沒有重新整理頁面或重啟服務；Vite既有連線正常，確認`candle-chart.tsx`熱更新已載入。

- 奇鋐3017：連續三輪1m→15m→60m→5m，共12次快速切換；每輪結束仍有7條已啟用Pivot百分比，昨收3105、reason=null。
- 台積電2330／奇鋐3017來回三輪，共6次換股；各自昨收2415／3105，P均2026-10-29。六次均有7條百分比，逐條與目前商品分母重算一致，未混用商品。
- 最後回到原奇鋐3017／5m。只使用既有UI的一般切換流程，未另建來源下載、補抓或probe。
- 觀察到使用者原頁停在1D且未畫費波；依原規格，1D壓撐沒有新增百分比，1D的費波才顯示。此範圍保持原契約，返回分K則恢復百分比；不把合法範圍差異混稱來源失敗。

本機證據：`outputs/key-price-switch-repair-20261031/live-switch-readback.json`、`live-repaired.png`、`browser-regression.json`。合成54次回歸與實際18次操作分列，不冒稱全部為live。修改只涉及本change的取消接線、測試與文件；未動API、watchdog、MultiView、資料庫、排程或Gate，未commit／push／歸檔。

## 日K壓撐百分比擴充（2026-10-31台北20:43，最新授權）

1D的CDP／三關價／Pivot Point現在與四種分K共用`supportPercentVisible`接線。日K即使沒有費波圖，也顯示同商品T／P／close基準與每條合法壓撐百分比；固定歷史reference不改分母為歷史close。只增加context傳入範圍，沒有改renderer公式、K棒資料、原autoscale、價格軸或時間視窗，也沒有新增下載／訂閱／寫入或Gate變更。

### 回歸

- 三商品三輪共54次週期切換，現在包含每次1D的15條百分比與正確分母100／200／300，逐次檢查目前renderer輸出。早期「1D應沒有基準」斷言已依新授權改成應有15條數值。
- 原同資料／原圖形手動範圍測試新增1440分鐘週期，核對百分比context開啟前後logical range、bar spacing、Y範圍、軸寬、pane高度及固定價位／K棒X座標完全相等。
- 新增完整CandleChart日K測試：15條百分比、基準正常更新與失效unknown時，固定價格／時間範圍、K棒座標／資料及容器尺寸均完全相等；沒有price-series `applyOptions`或`fitContent`呼叫。未知保留15條原合法價位與破折號；authority額外歷史需求0。
- 71項相關單元、33項Chromium、TypeScript／build、OpenSpec strict 83/83及當次範圍diff check通過。既有act與其他功能的BigInt提示保留，不影響通過結果。

### 實際畫面與連續切換

既有5173頁面熱更新後直接使用，沒有reload或重啟服務。台積電2330與奇鋐3017來回兩輪，共4次商品切換；每次各切5m→1D，共8次週期切換。八筆讀回均有已啟用Pivot七條數值，reason=null，P=2026-10-29；台積電昨收2415、奇鋐昨收3105，各筆百分比與正確分母重新計算一致。

實際頁只啟用Pivot，因此沒有為驗收修改使用者的指標開關；日K三公式全部15條由Chromium合成資料測試確認。換商品／時框本身沿用原正常歷史載入流程，不冒稱正常互動整輪沒有行情請求；本功能沒有新增來源需求。最後停留奇鋐3017／1D，畫面可直接看到百分比。

證據：`outputs/key-price-daily-20261031/live-daily-percent.png`、`live-switch-readback.json`、`browser-regression.json`。本輪程式僅擴充主圖scope及兩份既有瀏覽器測試，其他修改為同change文件；未commit、push或歸檔。

## 壓撐分母修正（2026-10-31台北21:00，最新使用者定義）

三套壓撐改採 `(levelPrice / reference.close - 1) * 100`。自動／固定歷史K棒及其分K鏡像採同一參考K收盤，不再用目前行情日的前一交易日close。費波計算維持原契約。常駐說明分為「壓撐較昨收基準：參考K日期／close／參考K棒收盤價」與「費波較昨收基準：P日期／close／行情日T」。

壓撐resolver只讀原契約已接受的reference，核商品key、完成身分、日期及正數有限close；缺失／非法則未知。renderer於同次draw從實際reference與productKey解析分母，拒絕舊context或另一商品的close；分母與所繪價位保持同組。壓撐不再為分母讀本機日曆，沒有新增行情下載。原OHLC、reference合法性、來源及Gate維持不變；測試中不把非法reference送進原公式。

### 驗證

- 純測試區分三個值：實際前日close100、行情reference95、所屬參考Kclose103；三套壓撐用103。固定歷史close95時，價位105顯示+10.53%；費波在同時仍依實際close100顯示+5.00%。非法／零負／非有限close與錯商品保持未知。
- 原54次連續三商品／五週期測試改為逐次核參考Kclose103／206／309；15條百分比均正確。歷史參考K切換及跨1D／分K仍使用同組分母。
- 五種週期同資料／原圖形手動範圍回歸，刻意讓呼叫端context.close=777，實際reference.close=100，renderer仍逐條用100；確認不受舊context影響。缺分母與正常繪製都維持原bounds、軸寬、bar spacing、logical range與座標。
- 完整CandleChart測試將合法參考K收盤切至101，逐條核新分母，同時確認固定時間／價格範圍、K棒資料／座標、容器尺寸不變，沒有fitContent或price-series options呼叫。僅被動日K更新不會改寫壓撐reference的close。
- 72項單元、33項Chromium、TypeScript／build及OpenSpec strict 83/83通過，當次範圍diff check通過；既有fixture act及其他功能BigInt提示保留。

### 實際頁面

使用者當時頁面為金像電2368／1D，固定歷史reference=2026-10-29、close=1115。本輪保留該歷史選取，不更改指標開關；實際日K↔5m兩輪共四次切換，均保留同參考日期／close與七條啟用Pivot，逐條重算差異0。例如R3價1240→+11.21%、P價1140→+2.24%、S3價1015→−8.97%。沒有reload或服務操作，最後仍為原商品／固定歷史reference／1D。

實際三套全部15線由Chromium測試驗證；現有頁只啟用Pivot，不冒稱三套皆已於live同時開啟。正常週期切換沿用既有資料載入，不另作來源補抓。證據：`outputs/key-price-reference-close-20261031/live-readback.json`、`live-reference-close.png`、`browser-regression.json`。

保留前幾輪原件，未commit、push或歸檔；API／watchdog／MultiView／排程／資料庫與預算Gate均未操作。

## 費波最後日K收盤與左側標籤（2026-10-31台北21:15）

日K費波分母現在直接來自目前圖表`barsRef`最後一根close，並核1440週期、目前商品／載入身分及可用狀態。包含正常接受行情後尚未收盤的當日日K，不採前日、游標／可見區末端、日線authority或A/B/C錨點價格。壓撐reference.close與原較昨收前綴保持不變。

費波文字保留比率與價位，百分比只顯示正負號與兩位小數；基準列改為「費波比較基準／最後一根日K收盤」。缺失或非法close只顯示—與原因，不沿用另一商品或補0。費波與壓撐均不再因百分比分母需要讀日曆，沒有新增來源需求。

SVG按真字寬把標籤放在線段左端外側；左側空間不足時靠plot左緣，保持文字在原面板內並以connector連回真實線價。原level線／色帶／錨點／完成拓展autoscale bounds與儲存格式不變，不加入價格series、fitContent或視窗操作。

### 回歸

- 純計算驗最後close103相對價位105為+1.94%，而非前日close100的+5.00%；新close104更新、零負／NaN／Infinity、錯商品／週期與不可用均有驗證，無前綴的0.00%及—正常。
- 完整CandleChart載入已存費波圖，驗最後close103。捲到看不到最後K棒的歷史區間、向日線authority發布999，仍使用圖表尾端103，原座標／視窗／K棒資料不變。正常切回1D取得尾端104後，逐條按104重算；費波storage不存百分比。
- 真Chromium SVG驗寬／窄面板、全部比率與百分比無前綴；有左側空間的10條標籤，其getBBox右界均在實際線段左端之外。分母100更新200後，level線幾何及錨點不改；pending、unknown與分鐘圖原行為回歸保留。
- 73項單元、35項Chromium、TypeScript／build及OpenSpec strict83/83通過，當次diff check通過。既有fixture act與其他功能BigInt提示保留，無測試失敗。

### 當下既有實際圖形

未修改使用者圖形或切換商品／週期，讀取既有日月光投控3711／1D費波回撤：最後日K基準為2026-10-30、close668，當次可繪九條水準百分比逐條重算一致，沒有「較昨收」前綴。圖形／視窗由使用者操作期間會改變，因此九條是當次快照，不追認早期另一視窗的十條。

實際SVG使用DOM client rect換算原SVG座標核對：有空間的標籤在左端外側；不足的在原plot x=6左緣，九條均符合此配置規則。此快照有左緣fallback，不宣稱全部位於線段外側。原頁較早建立的被動畫布診斷尚無新增tailClose欄位，保留null；實際圖表尾端讀取接線由完整CandleChart回歸確認，不冒稱該欄已提供獨立證據。

證據為`outputs/fibonacci-last-daily-close-20261031/live-readback.json`、`live-fibonacci-left.png`、`browser-regression.json`。沒有reload、服務操作、額外行情探測、DB／排程／Gate變更，未commit、push或歸檔。

## 三套壓撐無文字前綴（最新顯示需求）

主圖CDP／三關價／Pivot Point的context設定空前綴，價位旁只保留+10.53%這類數字，未知仍為—。基準列改名「壓撐比較基準」，保留參考K日期／close。格式樣式key納入前綴，確保既有頁面熱更新時重畫文字。原reference.close分母、公式、漲跌色、線價及視窗不改。

更新既有五週期／54次換股與座標回歸斷言，相關16項Chromium及TypeScript通過，diff check通過。實際3711／1D目前啟用的七條Pivot已全數讀回無「較昨收」文字：+10.53%、+5.79%、+2.89%、−1.85%、−4.74%、−9.48%、−12.38%。其他兩公式由三公式15線回歸涵蓋，未改使用者指標開關。

證據：`outputs/key-price-compact-labels-20261031/live-readback.json`、`live-compact.png`。沒有reload、來源請求或服務操作；此輪僅顯示及既有測試／文件變更，未commit／push／歸檔。

## 規格同步與歸檔範圍（2026-10-31）

依使用者明確授權同步正式規格並歸檔。正式契約以最後確認的工具分母及純數字標籤為準：壓撐採同組reference.close，日K費波採圖表序列最後一根close；保留前述每輪驗證原件，不把早期設計文字當成最終行為。

本次提交範圍僅本change的歸檔文件及對應正式規格；原始碼與其他工作區變更不納入此歸檔提交。規格檢查不替代程式回歸或額外live驗收；原有回歸與畫面證據範圍如上。未執行push、來源請求或服務操作。
