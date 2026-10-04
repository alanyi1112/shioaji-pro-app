## Why

目前「選股篩選」版面的「選股」面板已有分型、布林與指標訊號，但沒有將 K 線反轉組合的前期趨勢、實體關係及確認時點轉成可重現的篩選能力。使用者指定影片介紹的紅三兵、看跌吞噬、晨星與三隻烏鴉，並追加台股研究中的刺透，共五種；要求附註研究數字、使用台灣配色，以及嚴格納入晨星與刺透收盤超過首根實體中點等必要條件。

2026-10-04 依使用者要求擴充尚未實作的範圍，保留原 change ID `add-four-candlestick-reversal-screener-patterns` 以維持既有連結；名稱中的 four 為原始範圍，實際規格與驗收以五種為準。

## What Changes

- 在「技術型態」新增可獨立啟用、預設停用的「K 線反轉型態」條件；內含五個可複選按鈕，初始子集合全選，子型態以三態 OR 組合。
- 刺透預設採台股研究的兩棒開收關係，第二根開盤不高於首根收盤、收盤嚴格超過可調回補位置且低於首根開盤；另外提供明示的嚴格跳空及長首棒過濾，不混同看多吞噬。台股研究報酬／獲利比例與 Bulkowski 反轉率分開附註，揭露樣本與策略差異。
- 使用已完成、相鄰官方市場交易日的 canonical OHLCV，判斷前期趨勢、長／小實體、開盤與前一根實體關係、收盤接近高低點、吞噬及晨星嚴格回補比例。
- 將晨星十字列為晨星內的明確子型；一般晨星研究反轉率 78%，晨星十字另列 76%，不得混用。
- 提供最新日形態成立及隔日突破確認兩種時點；可選的量能與支撐／壓力位置過濾固定 AND 於形態內，不成為外層 OR 的獨立捷徑。
- 新增版本化 criteria、來源能力與 immutable OHLC 特徵；沿用既有背景資料準備及唯讀查詢，避免在查詢／展開說明時抓取行情。
- 沿用精簡 accordion、全部取消、草稿／已套用隔離、指定圖表及明確加入清單操作；統計與條件說明可收合。
- 在功能說明附註原研究反轉率、排名、來源及口徑限制，不將外部統計當作本功能台股勝率；台灣配色固定為紅陽、綠陰，判斷只依 OHLC。

## Capabilities

### New Capabilities

- `candlestick-reversal-screener`: 五種反轉組合、晨星十字子型、可設定數值定義、完整日資料、三態判定、版本化凍結特徵、唯讀查詢與可稽核 evidence。

### Modified Capabilities

- `after-market-stock-screener`: 新增技術分類內的收合五型態控制、統計附註、偏好遷移、結果證據與既有操作隔離。

## Impact

- 前端：`src/components/stock-screener-condition-accordion.tsx`、`stock-screener-panel.tsx`、相關樣式與 browser tests；`src/lib/stock-screener-condition-ui.ts`、選股 API／偏好版本與新增純函式。
- 本機選股服務：`scripts/stock-screener-gateway.mjs`、`apps/multiview/worker/stock-screener-*-publisher.ts`／repository／route 與本機持久化 schema，新增有界 OHLC 特徵發布及讀取能力。
- v8 布林凍結特徵只含 close 等統計，不能直接當作完整 OHLC；新能力需獨立版本與來源校驗，舊 snapshot、每日布林 profile、cursor 及條件不得重解釋或覆寫。
- 不新增常態 Codex 排程、不新增資料來源、不啟用 production／CA／交易，也不修改盤中監控、既有 watcher 頻率、下載預算、broker login／subscription 或 runtime 生命週期。
- 本 change 只新增選股查詢能力，不新增五型態的每日自動策略 profile；需要自動保存／發布策略時另行規劃。
