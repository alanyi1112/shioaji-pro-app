# 連續兩檔尾盤缺口調查與候選修正

## 原始實盤證據（Asia/Taipei）

| 交易日 | 原結果 | 缺少商品 | 原資源紀錄 |
| --- | --- | --- | --- |
| 10/7 | 158／160；兩檔268分鐘至13:28 | 3533.TW、6426.TW | peak RSS 135,118,848 bytes；最大處理924ms；resourceFault null |
| 10/8 | 158／160；兩檔269分鐘至13:29 | 2603.TW、5284.TW | peak RSS 132,333,568 bytes；最大處理1,211ms；resourceFault null |
| 10/12 | 158／160；兩檔269分鐘至13:29 | 3665.TW、6239.TW | peak RSS 135,593,984 bytes；最大處理407ms；resourceFault null |

三日原件位於 `Application Support/RealTimeStock/IntradayMonitor/daily-run/<交易日>/summary.json`。10/12 原13:40稽核為 `coverage_incomplete`，不可修改。今天43,198個reader KBar frame全部交adapter接受，malformedFrames 0、disconnect null、reconnectReceipt null；原小型收尾正常寫入，stop receipt證實本owner停止及退訂被接受。沒有RSS、磁碟或背壓超限的證據，不能以擴大quote保護池或記憶體當作已確認修復；這也不能排除API內部broadcast佇列不足。

新尾盤計數真正生效：3665、6239各收到13:29一筆，沒有13:30或13:33計數；2603、5284、3533、6426今天都收到13:30且封存270分鐘。13:34:30 final seal在延後收盤窗口後，並非13:30就提早停止。最後收到的是3227的13:30標籤、接收時間13:33:02.499；延遲接收不等於該股具備交易所延後收盤的正式證據。

16:00左右唯讀查核原生盤後採集143／160。已發布3665同日v2的13:29累積2,120、13:30累積2,260（增加140張），證明不能把其缺少收盤量補零。6239尚待原程序採集，不另開下載器。

## 確定的本機錯誤與仍未知的上游原因

`bounded-kbar-transport.mjs`原本在 `eventName !== 'kbar'` 時直接continue，來源的非KBar通知完全未留存。因此「所有收到的KBar都接受」只證明本機adapter未拒收，不能證明來源未丟失。官方HTTP文件說明衍生broadcast落後會送出 `<event_name>_gap` 與 `type=lagged`／`dropped`；現行1.7.1二進位也含 `_gap`、lagged JSON及market-data subscriber lagged文字。這證明診斷通知需處理，不證明今天曾送出特定通知。

官方參考：[HTTP_API.md](https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/HTTP_API.md)。SDK Rust src/server/http/stream.rs的公開原始碼不可取得；不能拿最新文件冒充已核對部署版本內部buffer大小。

現行simulation API服務日誌只留hash、時間與messageBytes，`rawMessageSaved=false`。本輪讀取既有log不能回復原始warning，更不能猜測每次兩檔必定是buffer丟2筆。今天來源端、API內部receiver／broadcast與SSE轉送之前的確切丟失層級仍未知；沒有真實來源gap及上游逐商品證據前，不宣稱根因完全查清。

## 已完成候選修正

- 專門解析並保存 `kbar_gap`，有效來源 dropped 計數與收到／接受KBar數分開。
- 畸形通知或整數溢位為unknown，不假設丟失0；樣本最多8筆，僅保存時間、固定分類、dropped與payload hash，不保存任意原文。
- 非KBar事件名稱計數最多16種類及overflow；可辨識未知來源事件而不記錄帳戶／憑證。
- 健康檢查保存來源gap事故，affectedSymbols unknown；不重開健康socket、不重訂閱、不補造KBar、不覆寫舊資料，現有逐商品連續性與historical補件限制維持。
- 資源故障、實體斷線及長期來源沉默優先於gap告警，避免新增gap分支掩蓋真正fatal故障。

隔離測試重現「158筆KBar＋來源報告丟失2筆」並證實舊邏輯的通知遺失；它是測試資料，不是今日原始事件。transport／runner相關25項通過，包含畸形通知、樣本上界、無秘密原文、無第二訂閱／重連、後續沉默fatal與最後健康檢查後才收到gap也不可ended。擴大adapter／sink／postclose相關回歸及尾端核實另通過；型別／build／兩案strict／diff檢查通過，build僅既有大chunk警告。

另外唯讀查現行8080的OpenAPI與`stream/receivers`：只有receiver可用性，沒有逐檔上游drop counter；`datastore/status`為歷史REST快取hit／miss總數，不是即時KBar接收證據。未找到兩檔今日可用的原生parquet，不重抓或混用歷史資料冒充即時來源。

已結束的原今日runner不會載入此修正；正在運作的13:35採集不變，不重啟API／watchdog／Web／MultiView。原生採集完整後由原程序按已載入版本做獨立tail reconciliation；這不能把今日live改成complete。下一個適用交易日需核對真正gap計數、逐商品收盤frame及上游診斷，才可判定是否來源／APIbuffer問題；未證實前維持7.4／7.7未完成。
