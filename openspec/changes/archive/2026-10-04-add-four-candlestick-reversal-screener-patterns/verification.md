# 驗證計畫

## 目前狀態

### 提交範圍的隔離回歸

2026-10-04（Asia/Taipei）：將 Git 暫存區完整匯出至 `/private/tmp/realtimestock-candlestick-staged.ScmuPp`，確認本次提交不依賴工作目錄中未提交的監控程式。使用 Node 24.19.0，純函式／API／UI model 117／117、Node publication／migration 34／34、Chromium 面板 59／59，合計 **210／210** 通過；根目錄 `tsc -b` 與 MultiView `tsc --noEmit` 通過。

首次測試啟動因既有 monitor 設定版本與暫存區舊 reader 不相容而停止，後續僅以 `REALTIME_STOCK_APP_SUPPORT` 指向隔離測試目錄，不修改正式 runtime 或混入監控變更。Chromium 首次受 sandbox loopback listener `EPERM` 阻擋，經允許隔離測試 listener 後完整通過；上述啟動限制不當作測試成功。同步／歸檔後全專案 OpenSpec strict validation 66／66 通過，Git 暫存區 diff whitespace 檢查通過；本輪沒有重啟共用服務、另行下載行情或重做 broker 操作。

2026-10-04：依使用者明確授權，先同步 `after-market-stock-screener` 的 5 項新增 UI requirements／11 scenarios，以及新能力 `candlestick-reversal-screener` 的 12 requirements／29 scenarios，再歸檔至本目錄。17 requirements／40 scenarios 逐區塊精確比對一致；27／27 任務完成，其他四個監控 change 保留 active。Git 提交只涵蓋本功能程式、測試、同步主規格與歸檔文件，不包含原始 HAR、SQLite／備份、測試暫存圖片或無關監控變更。23:36 紀錄的「尚未歸檔」為先前時間點，不覆寫歷史驗收。

2026-10-04 23:36（Asia/Taipei）：五型態 UI、正式 additive migration、既有 watcher 自然發布、1,977 檔獨立公式重算及 43 次真實 API 分頁完成。使用者授權的 1519 日 K／雙清單操作與精準復原、完整 HAR 計數、共享連線／交易安全證據齊備；最新 210 項相關測試、兩側型別與 build 通過。詳見 [UI 與真實本機結案驗收](acceptance/ui-and-live-closeout-2026-10-04.md)。7/10 依官方颱風休市公告排除；原失敗保留。tasks **27／27** 完成，具備歸檔條件但尚未同步主規格、歸檔或 commit／push。下列為歷史階段狀態，不代表目前仍 pending。

2026-10-04 22:53（Asia/Taipei）：第二階段完成 additive 背景完整 OHLC schema／repository／publisher、既有 watcher 獨立準備接線及 GET-only v9 HTTP／gateway；tasks **17／27** 完成。見 [背景與唯讀 API 實作驗證](acceptance/background-and-readonly-api-2026-10-04.md)。本輪相關測試 **203／203**、根目錄與 MultiView 型別檢查、Vite build 通過；正式端點仍誠實回 `v9_schema_pending`，未套用真實 migration、未發布真實五型態 snapshot。UI 與真實環境驗收尚未完成，不能結案。

### 第一階段實作紀錄

2026-10-04 22:35（Asia/Taipei）：依使用者「開始實作」完成版本／統計契約、五型態純函式、短窗凍結 builder 及唯讀分頁核心；tasks **10／27** 完成（1.1–1.3、2.1–2.7）。背景 schema／repository／publisher、v9 HTTP／gateway、面板 UI 及正式資料／瀏覽器驗收仍未完成；沒有把離線測試當新 API／UI／背景發布的 live 通過證據。

實作與當期來源預檢見 [核心實作紀錄](acceptance/core-implementation-2026-10-04.md)。使用 Node **24.19.0** 執行六個 focused test files，共 **126／126** 通過；包含新核心／分頁與既有 v7、v8、技術型態、布林分頁回歸。TypeScript `tsc -b`、Vite build、此 change strict validation 與 `git diff --check` 通過。Build 有既有大於 500 kB bundle 提醒，沒有宣稱零警告。本輪未執行整份 repo-wide test 或瀏覽器／真實逐股稽核。

### 建規格階段的歷史紀錄

2026-10-04 規劃階段：僅建立 proposal、design、delta specs、來源說明與實作任務；當時尚未實作，沒有新 API／UI／背景發布的 live 通過證據。

同日依使用者要求追加第五種「刺透」。已直接核對影片 22:05／22:35 章節畫面及原研究文字、表格欄位與正文數字；直接 PDF 下載／瀏覽器視覺呈現失敗，限制保存於 references，未宣稱 PDF 視覺核對成功。共 27 項實作任務仍全部未勾選；原 change ID 保留，不代表仍只有四種。

本輪文件檢查：OpenSpec strict validation 通過，四份必要 artifacts 齊備；`git diff --check` 通過，另對本 change 8 個 untracked 文字檔檢查尾端空白及檔末換行，問題 0。這些是規格檢查，不代表純函式、API 或 UI 已實作／驗收。

## 必要邊界測試

- OHLC 陰陽使用 close 對 open，而不是 close 對昨收；主題配色不影響純函式。
- 嚴格價格相等、中點恰等於／上下各一 canonical unit、近高低比例與長短實體門檻邊界。
- 晨星第三根 high 過中點而 close 不過、中點不可用 (high+low)/2、第三根實體長度不可代替回補。
- 十字晨星與一般晨星分流；停用十字子型、嚴格跳空／不強制跳空各有獨立 evidence。
- 紅三兵／烏鴉開盤在前一實體內、邊界及外；吞噬只包實體但影線未包、端點等號及方向反例。
- 刺透先陰後陽、前期下跌、中點恰等／上下各一單位、high 過但 close 不過、close 等於／超過首根 open；預設 openB=closeA 合法、嚴格跳空 openB=lowA 不合法，回補上限與最多兩位小數驗證。
- 刺透未啟用長首棒不要求中位數暖機；其兩棒／次日確認日期及 OLS 趨勢差異明示，不混同晨星三棒、看多吞噬或原研究交易策略。
- catalog 的刺透 64% 反轉率、13.25% 平均交易報酬、90.91% 獲利比例／11 筆樣本須分欄並保存期間／成本／持有策略；不得寫成一個成功率或年化值。
- 前期窗排除型態；OLS 與首尾變動方向不一致、橫盤；量能排除 D、支撐壓力排除型態。
- 市場休市、跨週末、商品缺日、重複、停牌、非法來源／price basis、零 range／零中位數／零量分母。
- 固定形成日與確認日；未完成當日、碰線未越界、禁止任意找更早型態及前視。
- 子型 OR／內部 AND／外層 all／any 的完整三態真值表、未啟用資料不要求、命中去重與全市場守恆。
- 偏好精確 schema、v8 保留／v9 預設停用、未知版本、cursor／cache 綁定、clone／rowsHash／sourceHash 變更重驗。
- v8 布林 close-only 不可變完整 OHLC；新能力 pending 不阻斷舊能力；同鍵 no-op 與舊收據保留。

## 真實本機驗收

實作完成後在 `acceptance/` 以新的日期檔保存驗收；不覆寫本文或歷史失敗證據來假裝成功。

1. 保存官方市場日、來源選擇、snapshot／formula／mapping／catalog version、universe、資料窗口與逐股 readiness；所有理由分類為 pass、fail、unknown、pending。
2. 用與正式 evaluator 分離的稽核程式從凍結原值逐股重算五種形態、必要子條件與完整 API 分頁。比對集合及守恆，缺資料不能補假棒；零命中也需正確核對。
3. 在現有本機 UI 核對五按鈕、收合說明、研究數字、工程門檻與晨星／刺透中點公式、台灣陰陽、指定目標圖表、舊條件及全部取消。
4. 保存操作前與後的每日布林 profile、head、清單、交易草稿與共享連線身份，以及操作開始前即啟動的逐請求 network 計數。HTTP 200、全域健康或離線 fixture 不能代替這些 evidence。
5. 不自動覆寫使用者草稿、清單或 profile；需要清單測試時先保存精確內容，只復原本輪增量。訂閱／交易／服務生命週期權限不由「驗收」二字擴張。
6. console 的既有錯誤、新回歸錯誤與無法觀測項分開記錄；缺觀測或授權時相關 task 保留未完成。

## 結案界線

純函式與 fixture 通過表示公式有回歸保護，不等於真實資料／UI 通過。新能力來源、逐股重算、API／UI 操作及安全副作用證據完整後才能宣稱可結案；archive、主規格同步、commit、push 必須另依使用者指示處理。
