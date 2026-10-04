## 1. 版本與來源契約

- [x] 1.1 唯讀核對當期官方 session grid、完整 OHLC 來源、price basis、snapshot／能力及現有 publisher／gateway 接線，記錄可重用資料與缺口，不啟動下載或改動 runtime。
- [x] 1.2 建立 CriteriaV9／PreferenceV9 與反轉參數 validator、active fingerprint、v8→v9 安全遷移；測試新分支預設關閉、五種子集合全選及非法值不覆寫舊偏好，刺透回補 50–99.99%／合法開盤模式／長首棒開關須驗證。
- [x] 1.3 建立版本化統計 catalog 與來源附註：82／79／78／78、研究排名 3／5／6／7、晨星十字 76／8、刺透 64% 反轉率與台股研究 13.25% 平均報酬／90.91% 獲利比例／11 筆樣本分列；揭露期間、持有策略及 OLS／原研究趨勢差異，數字不得進入公式或當成本功能勝率。

## 2. 純函式形態與精確邊界

- [x] 2.1 實作 session 對齊、canonical units 比較、body／range、中位數及排除型態的前期 OLS 趨勢；涵蓋缺日、重複、非法 OHLC、零振幅／零中位數及方向矛盾。
- [x] 2.2 實作紅三兵與看跌吞噬，測試陽／陰與昨收漲跌不同、前期趨勢、開盤實體邊界、短影要求、只吞實體及端點相等反例。
- [x] 2.3 實作晨星、精確十字子型及兩種跳空模式；必測中點等於、少一價格單位、多一單位、只有 high 過中點、50–100% 回補與子型統計不混用。
- [x] 2.4 實作三隻烏鴉及首根開盤額外限制，測試前期上漲、逐根收低／low 較低、近低點、第 2／3 根開盤及首根限制切換。
- [x] 2.5 實作固定日期的形態成立／次日突破確認、可選量能及位置內部 AND，測試週末／臨時休市、未完成當日、碰線、基準不含當日與位置不含型態。
- [x] 2.6 接上子型態三態 OR、外層 all／any、命中去重及全市場守恆，測試停用參數不要求 readiness、不參與 active fingerprint與未知理由保留。
- [x] 2.7 實作兩棒刺透、獨立回補比例、research-close／below-prior-low 模式及選用長首棒；必測中點恰等與上下各一價格單位、openB=closeA、openB=lowA、closeB>=openA、只有 high 越中點、陰陽反例、未啟用長首棒不要求中位數暖機，以及兩棒固定日期／三態組合。

## 3. 背景凍結 OHLC 能力

- [x] 3.1 新增 additive 本機 schema／repository 及 `candlestick-ohlcv-history-v1`，保存最多 64 個 session 的完整 OHLCV、來源／calendar／mapping／formula hashes 與逐股缺口。
- [x] 3.2 接上既有背景準備的已驗證輸入與短窗 publisher；按實際資料發布新能力，拒絕 v8 close-only 冒充 OHLC，不由查詢觸發回補。
- [x] 3.3 實作發布鍵、atomic head、同鍵 no-op、版本及 hash 校驗；測試資料或 clone 改變重驗、不覆寫原收據與舊 snapshot、跨日期／universe／price basis join 拒絕。
- [x] 3.4 回歸 v7 技術與 v8 布林發布、legacy join、每日 profile／revision、背景限流與休眠，證明新 pending 不阻斷舊能力且不增加下載／login／subscription。

## 4. 唯讀 API 與結果證據

- [x] 4.1 加入唯讀 v9 query／status、validator 與 preparation pending 投影；測試只啟用新形態及混合舊條件，不能跨 snapshot 日期或把缺資料當 fail。
- [x] 4.2 完整回傳逐棒／前期窗／模式／可選過濾／精確比較／verdict reason／hash，固定 cursor 與排序 tie-break，測試舊 cursor 與未知能力 fail closed。
- [x] 4.3 保存每個端點的只讀副作用測試與 request counts；篩選、status、分頁、證據展開不得寫清單／profile、下載來源、登入、訂閱或更動交易狀態。

## 5. 收合控制與台灣呈現

- [x] 5.1 在技術型態的 K 棒分型後加入收合摘要與五個複選按鈕，支援看多／看空文字、只保留適用設定、空集合驗證及單一設定展開。
- [x] 5.2 提供成立／確認、工程數值門檻、晨星子型／跳空、烏鴉首根、刺透回補／開盤／長首棒、量能與位置控制；明示單位、公式、參考窗與可調預設不是影片統計參數。
- [x] 5.3 加入收合的型態條件、統計來源及配合條件說明；測試 103 種排名與影片四強／刺透彩蛋、一般晨星／晨星十字、反轉率／綜合表現／平均報酬／獲利比例／樣本數不混用。
- [x] 5.4 加入台灣紅陽／綠陰且不只依顏色的結果標記、模式／形成／確認日期及可展開 evidence；保持 pending／stale／來源與日期主要警告可見。
- [x] 5.5 接入全部取消、偏好與草稿隔離，回歸指定未鎖定圖表、結果更新不自動跟隨及雙清單明確加入；不動每日布林 profile 或交易草稿。

## 6. 驗證與交付

- [x] 6.1 執行純函式／API／publisher／遷移 focused tests 與既有技術、布林、清單／圖表回歸，記錄通過、失敗及其他 dirty work 既有缺口。
- [x] 6.2 執行 Chromium browser tests：最小寬度／600 CSS px 高／特大字級／鍵盤、明暗主題與台灣陰陽；保存 DOM／截圖、實際 console 與 network，fixture 不冒充 live。
- [x] 6.3 使用真實本機已發布來源逐股獨立重算五型態與 unknown、核對 API 全分頁集合／命中去重／守恆／來源日及 hashes，記錄零結果與不可判定，不造符合案例。
- [x] 6.4 以既有頁面與有界授權驗證指定圖表／雙清單及精準復原，保存完整操作前後 network counts、profile／head／清單／交易／共享連線證據；沒有安全權限時明列未完成，不增第二條行情連線。
- [x] 6.5 執行型別檢查、build、OpenSpec strict validation、git diff --check 與 untracked 文字 whitespace；更新繁中 verification，只有實際 evidence 完整才勾完成，不自行歸檔／commit／push。
