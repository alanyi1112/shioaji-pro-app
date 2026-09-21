## Why

目前收盤後選股的 v2 日量快照與 v3 技術型態快照可以停在不同交易日，過期 v3 仍會回傳可操作結果，造成商品明明應以最新收盤日重新判定，畫面卻繼續顯示前一日的成交量、成交值、分型與布林結果。2026-09-02 的 1409 新纖已實際重現：v3 仍以 2026-08-31 → 2026-09-01 算出 5.6393 倍，但最新官方日量應為 2026-09-01 → 2026-09-02，1409 不再符合三倍條件；同時指定 K 線圖沒有取得商品 Snapshot、未啟用大戶條件的成交值仍重複顯示，讓資料日期與來源更加難以辨識。

## What Changes

- 建立唯一的已完成共同交易日 `effectiveSessionDate`，日量 D／P、成交值 D、技術 OHLC 滑動窗與 v3 `technicalAnchors.through` 必須以同一日期發布；任何日期分歧一律 fail closed，不得產生混期快照。
- 修正技術 OHLC 準備器的日期來源與增量策略，重用日期、來源與商品集合皆未變的已驗證資料；universe revision 變動時只補新增商品或真正缺少的 `market + session + symbol`，不得因此重抓整個 60 日視窗。
- v3 尚未有當期技術快照時，純成交量／大戶查詢必須使用同一期最新相容底稿；啟用分型或布林條件時則顯示等待當期技術資料。過期或混期快照不得回傳可點選、可加入清單的「符合」結果。
- 每筆結果明示成交量的 P／D 日期與原始股數；成交值保留為實際啟用父條件的篩選依據，但不在結果卡重複顯示數值。父條件關閉時，其成交值子條件必須失效、不可參與查詢指紋或結果判定。
- 指定 K 線圖切換商品時，同步取得該圖表專屬行情 Snapshot，維持 generation 防競爭、圖表隔離與 simulation-only 邊界；同日資料以官方股數精確換算為張，將官方盤後、Shioaji Snapshot 與有正負號的差異張數寫回該選股結果卡，不在圖表上方另加提示列。
- 以全市場官方 OHLC 重新驗證原始三 K、纏論包含處理與 BOLL(20,2)。陽 K 固定為 `close > open`、陰 K 固定為 `close < open`；前一日仍在通道內、最新完整日首次嚴格穿越及指定影線缺一不可。
- 加入 1409 新纖的跨日回歸案例、上下軌紅綠 K 正反例、頂／底分型逐棒證據、快照日期守恆、來源成交量差異、快速連點與父子條件停用等自動化及本機 live 驗收。

## Capabilities

### New Capabilities

<!-- 無新增 capability；本 change 修正既有選股與圖表連動契約。 -->

### Modified Capabilities

- `taiwan-stock-screener-data`: 強制最新共同交易日、快照新鮮度與逐筆 P／D 日期守恆，並禁止過期結果繼續作為當期可操作選股結果。
- `taiwan-stock-screener-daily-ohlcv-history`: 修正技術 OHLC 的日期錨點、增量準備與 v3 發布 gate，禁止日量與技術型態混期。
- `after-market-stock-screener-technical-patterns`: 強化分型／布林使用最新完整交易日、陽陰 K 定義與全市場逐筆證據驗證。
- `after-market-stock-screener-advanced-filters`: 明定主要條件與成交值子條件的父子啟用語意，消除停用分支的重複成交值及指紋污染。
- `after-market-stock-screener`: 修正結果日期呈現、過期狀態操作邊界，以及指定 K 線圖的商品 Snapshot 與選股證據日期一致性。

## Impact

- 本機選股 operator、官方交易日期判定、OHLC checkpoint／receipt 規劃、v2／v3 snapshot publisher 與唯讀 results API。
- 選股面板結果列、父子篩選控制、狀態文案、指定 K 線圖選擇狀態與 Snapshot 載入。
- 本機 D1 既有選股資料與 checkpoint 需向後相容；不得修改個人自選清單、TDCC 長歷史 target、Shioaji 行情訂閱、下單／智慧下單狀態或啟用 production。
- 驗證涵蓋純函式、publisher／route、browser fixture、本機 D1 全市場守恆及 5173 實際 UI；GET／UI 操作仍不得觸發外部資料抓取或 runtime 管理。
