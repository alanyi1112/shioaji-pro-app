# 歷史來源對照與預算前置檢查（2026-10-03）

時間使用 Asia/Taipei。接續使用者指定順序：來源／預算 → 160 個交易日 → 自然發布 → 正式結果驗收。本輪先修正可確認的預算前置錯誤，並查出歷史來源數值差異；沒有把來源可連線當作契約通過，也沒有啟用未驗證策略。過去 failed／partial／denied 證據保留。

## 真實官方歷史樣本

本輪以既有有界 transport 診斷指定資料日 **2026-02-02**，各市場一次 GET，合計 **2 次 HTTP／2,011,447 bytes**，沒有 retry／redirect／broker 請求。各次 response 上限 4 MiB，維持 TLS 憑證驗證及既有 30 秒 socket timeout；本輪實際回應如下。這是人工來源契約診斷，不是 watcher 的正式準備收據或全窗口驗收。

| 市場 | 取得時間 | HTTP／來源日期 | bytes／原始列 | 原始本文 SHA-256 |
| --- | --- | --- | --- | --- |
| TWSE | 18:18:32.741 | 200／20260202 | 243,343／1,340 | `a94ad2a91c60f00d7af30aa90da43b9e56fc10b8446bd3b67f43be46d31b772f` |
| TPEx | 18:18:33.559 | 200／20260202 | 1,768,104／11,804 | `586a7c39b154339208090495379c685a5438eabf82050babbf06d7666bc5f94e` |

- TWSE：`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=20260202&type=ALLBUT0999&response=json`，stat=OK。
- TPEx：`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=2026%2F02%2F02&id=&response=json`，stat=ok。
- 本紀錄保存 hash／日期／有界摘要，未將大型 response 匯入正式 history 或 repo；不宣稱能以原本文重新播放全部列。

與先前 [14:52 Shioaji 樣本紀錄](shioaji-daily-quotes-feasibility-2026-10-03.md)比較。**本輪沒有重新抓 Shioaji**，先前原始 response 未持久保存，所以這是官方新回應對照先前記錄的欄位，不是兩份原始本文的完整重新播放。

| 商品 | 官方 O／H／L／C | 官方成交量（股） | 官方實際金額（TWD） | 先前 Shioaji 記錄比較 |
| --- | --- | --- | --- | --- |
| 2330 | 1750／1765／1745／1765 | 33,342,359 | 58,467,099,660 | OHLC／金額相同；Shioaji 量為 33,342,358，少 1 股 |
| 2449 | 289.5／293.5／280／285 | 17,191,140 | 4,908,944,906 | 此六欄相同 |
| 6488 | 495／497／467／473 | 5,676,322 | 2,721,453,490 | 此六欄相同 |
| 6510 | 3295／3450／3280／3435 | 835,873 | 2,834,391,415 | 此六欄相同 |

### 差異與限制

- 2330 存在 **1 股差異**。不能據此給備援寫入 `official-daily-compatible` verified review，也不能改來源數字、盲乘張數單位或暗加容差。
- 本機 parser 使用原始 number lexeme → canonical 整數字串；新增隔離回歸確認 `33342359`／`33342358` 均原樣保留，金額同樣保留。此測試確認本機解析行為，不是來源提供方精度已確認。
- 離線核對 `JSON.parse('33342359')` 為 33342359，而 `Math.fround(33342359)` 為 **33342360**，並不等於先前記錄的 33342358；不能直接把差異宣稱為 float32 根因。來源計算、修訂、原樣本記錄或其他來源差異仍待查明。
- 其他三檔所列六欄相同，不代表完整母體、除權息區間或 160 個交易日都相容。
- [第一方每日行情文件](https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/MARKET_DATA.md)說明指定日期每日行情與 column-oriented HTTP JSON，但沒有承諾與官方來源逐股完全一致。指定日期入口的使用／展示 review、完整歷史及來源相容性仍缺證據。
- source-selection 增加 1 股差異的隔離測試，確認追加 conflict 且凍結列／manifest 不變。**本輪未在 live DB 造正式 comparison 或 verified review**；實際差異保存於本紀錄。

## 已修正的預算問題

`scripts/broker-bandwidth-reservations.mjs` 原先先讀 usage，才驗證政策；concrete port 的 usage 路徑會經 simulation Gate 查 info／health／2330 Snapshot。當本機政策中的工作承諾或實測過期時，這些查詢可能在拒絕前發生。

修改後：

1. 先驗本機政策、至少兩份獨立實測、有效工作承諾與 operator 設定估量上限；未成立時零 usage／Snapshot 查詢。
2. usage 查詢回來再次驗政策／hash；查詢期間到期或承諾換版即拒絕，不用舊政策入帳。
3. dispatch 前驗 reservation owner／lease、有效政策及相同 hash；不成立則不送歷史下載、不刪原保留或收據。
4. 保留既有安全 settlement／回收規則；尚未送出的保留可以安全釋放，已送出或用量未知不藉政策換版清債。

新增四項 budget tests，覆蓋前置零查詢、查詢中換版／到期、dispatch 前換版、實測到期與原證據保留；另新增來源比較與 parser 各一項。這是防護修正，**不是 task 8.4 的正式政策 producer 已完成**。

### 真實本機 Gate

18:26:41.514 使用新 admission 程式與既有唯一 local DB，fetch port 加入計數並拒絕任何意外 HTTP：

```json
{"admission":{"allowed":false,"reason":"broker_policy_pending"},"http":0,"receiptsBefore":1,"receiptsAfter":2,"reservations":0,"previousReceiptsUnchanged":true}
```

舊 denied 收據逐欄比對不變；只追加新 denied。daily profile、publication、head、source review 均仍為 0。沒有生成假實測、quota epoch 或工作承諾，也沒有將靜態時間戳更新成現在冒充觀測。

8080／5173／5174 listener PID 為 1273／933／938，與前階段一致；未停止／重啟任何共用服務、第二次 login／subscription、production、下單、archive、commit 或 push。

## 回歸與狀態

- Node 24.19.0，10 個相關 test files，**138／138 通過**。先跑 60、137 項再補最後 parser 測試，最終採 138 項，不將重跑相加。
- `pnpm exec tsc -b --pretty false` 通過。
- 此 change OpenSpec strict validation、`git diff --check` 與本輪文字檔 whitespace 檢查通過。
- 本輪未修改面板／圖表，因此未重新跑全部 Vitest／Chromium／build；前輪結果仍只屬前輪。pending UI 不替代正式 7.4。

tasks 仍為 **34／41**。1.1／8.1 的來源 review、8.4 的正式預算 identity／實測／工作承諾 producer 尚未成立；7.2–7.4／8.8 的 160 日、自然發布及正式 API／UI／雙清單仍未進行。下一階段不得略過這些 Gate 或將本輪人工樣本冒充自動發布。
