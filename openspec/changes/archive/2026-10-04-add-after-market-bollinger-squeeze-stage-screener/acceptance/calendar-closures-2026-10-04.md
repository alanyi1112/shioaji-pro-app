# 臨時全日休市與歷史窗口修正（2026-10-04，Asia/Taipei）

## 根因與正式來源

使用者指出 7/10 颱風休市，要求程式納入颱風及其他突發原因。原年度開休市表只含預定安排，布林歷史準備卻把它當作完整交易日清單，因此把 7/10 納入 160 日窗口並等待不存在的日行情；原 18 次空批次不是資料源應產出行情的證據。

本輪直接讀取交易所年度新聞 JSON，驗證真正 fields／完整 totalCount／日期／ID，而非憑使用者說法、空批次或新聞摘要直接改資料庫：

- 年度清單：`https://www.twse.com.tw/rwd/zh/news/newsList?response=json&startDate=2026&endDate=2026`。實際查詢必須使用年值；YYYYMMDD 參數被忽略、YYYY-MM-DD 回 HTML，皆未當作正確來源。
- 公告： [臺灣證券交易所集中交易市場115年7月10日休市一天](https://www.twse.com.tw/zh/about/news/news/content.html?8a8216d69ef76943019f46cb86bf0111)，發布日期 2026-07-09，適用全日 2026-07-10。
- 08:55 左右真實 2026 清單 HTTP 200、128,604 bytes，raw UTF-8 SHA-256 `c2a20650f09260322856a8cc1c699acc7d36cc1db76ba4b0b75cbde1c39ef066`；parser 正確輸出上述唯一全日休市公告。此 raw hash 與程式使用 stable JSON 字串雜湊的 technicalEvidenceHash 不混用。
- 真實 2024 清單解析 7/24、7/25、10/2、10/3、10/31 五個休市日；2025 清單沒有明確集中交易市場臨時全日休市公告。2024／2025 raw SHA-256 分別為 `91e30d450bf5fdf36fc5d66e93946c4709395867c314f8ddc75a6a0c763fcd58`、`47fc0fcce759f3af1703839e4b08579ac928bae4baacd702e97cfb2128e9a6a6`。
- 官方清單包含「中福，公司代號：1435，恢復在集中交易市場買賣及恢復交易方法」新聞，原新 parser 誤把它當全市場候選而拒絕；已加入具名公司代號排除並以真實標題回歸。不把它解析為全日休市。

## 實作與隔離

- 新 `official-full-day-market-closures-v1` authority 衍生原年度共同日；明確全日公告優先，支持民國／西元、跨月連日及其他緊急原因，不寫死日期或颱風名。
- 個股／條件式規則／部分時段不排除全日；範圍、日期、撤銷／恢復不明回 pending/review_required。空行情、HTML、截斷清單及來源錯誤不能推論休市。
- 當年度每個台北日期更新公告一次，過去年度 30 日；年度表原 cache 保留。三年度最多三公告 HTTP／180 秒／6 MiB，每次 30 秒／2 MiB、不跟轉址或內部重試，併入 run deadline，不提高價量兩 HTTP／run 或 broker 速率上限。
- 原文／hash／來源／公告日期 append-only 保存，建立獨立有效日曆及 calendar_replanned；新失敗回應在有界大小內亦保存原文/hash。single-flight 租約、失去租約不可覆寫新 head；同日有效重觸發以 SQLite total_changes() 驗證真正 zero-write。
- 新日曆重算交易日窗口，成功 idle gate 核對 historySessions。舊 snapshot 不改；混合來源依新窗口 mapping 發布，固定舊 mapping 不同窗口明示需審查，不拿舊成功鍵充數。
- 09:01 左右以真正本機年度 cache 與官方公告作唯讀重算：原窗口首日 **2026-02-03**，新首日 **2026-02-02**，排除 **2026-07-10**，末日 **2026-10-02**，仍 **160 日**。這是計畫依賴重算，不把 2/2 行情當成 7/10，不是 watcher 正式發布證據。

## 成功、失敗、partial 與尚待確認

成功：程式解析真實官方公告；唯讀重算維持 160 日；本機歷史 cache 7/10 的 attempts=18、reason=source_not_published 保留。原 23:21 的 158 failed 收據依 id／cache_key／payload／created_at 排序重算，仍為 `1fb7a9e0e0146249a0b61987fe9be6a2feedccdcd418fe6760b3584be27ab413`。

原新入口失敗：08:51 watcher 因上述個股恢復交易候選被誤擋，原 calendar_closure_review_required 及 nextAttemptAt=`2026-10-04T01:11:13.201Z`（台北 **09:11:13.201**）保留。修正 parser 不刪失敗、不手改 checkpoint，也不縮短冷卻；08:56 的真正後次喚醒沒有重試來源，依原期限回 pending。當時原失敗收據未保存完整 news body，未事後補造；新版後續失敗會保存有界原文。

Partial：原已得 159／160 日、318 市場日期保留；本輪不把它們宣稱為更正後完整 160 日。新 2/2 依賴須由既有 watcher 自然有界補建，10.4 與 7.2／7.3／7.4／8.8 保持未完成。

Unknown／限制：已核實 TWSE 集中交易市場全日休市可排除兩市場共同日，但不冒充 TPEx 自己的公告。TPEx-only 臨時休市 feed 尚未取得可驗證 transport/schema（本輪 API 連線重設），未接線，不宣稱所有市場所有突發情況已自動覆蓋；此時日資料 Gate 仍阻止缺口發布，不以空資料猜休市。全市場公告撤銷或新標題格式需要確認，不靜默忽略。當日公告快取之後才公布的變更可能至下個台北日期才重驗，不能承諾即時偵測。

## 回歸與安全

- Node 六檔 **76／76**：公告 9 項、來源準備、provider 續跑、transport、原官方／混合發布。涵蓋來源破損／部分清單、非颱風因素、個股復牌、撤銷、跨月、原18次失敗、zero-write、租約失效、舊窗口成功鍵不能充數。
- Vitest 四檔 **44／44**：歷史規劃、長窗口、策略與 decoder。
- Chromium 布林 panel **13／13**：新增公告 pending／review_required／舊窗口 Gate 文案不被收合、不可操作、不寫每日設定／自動跳圖；隔離 fixture 不當作正式 UI 或來源驗收。
- root build、MultiView 型別與三支新入口的直接 strict TypeScript 通過；首次直接型別命令誤指定根目錄未安裝的 @cloudflare/workers-types（TS2688），改用實際依賴 node 後通過，未安裝額外套件。既有 chunk >500 kB 警告保留。
- 收尾 OpenSpec strict、git diff --check 與本輪 16 份文字檔（包含 untracked）whitespace 核對通過；不以測試通過勾 live task。
- runtime status 真實 simulation／business session／2330 Snapshot available，production stopped／write master disabled、watchdog restart=0。8080／5173／5174 PID 為 1273／933／938，未變。watcher 300 秒、runs=451、last exit=0；輪次之間 not running 不表示停止。
- 未重啟共用服務、新增 broker login/subscription、production／下單、修改 profile／使用者清單、archive／commit／push。背景接續 prompt 已改為檢查新官方公告及 2/2 依賴，頻率仍 20 分鐘；scheduler 實際 next_run_at 核對為台北 2026-10-04 09:05:45。

本輪新增 10.1–10.4 後進度 **42／47**，不是原 change 已結案。先保留原始失敗與上述限制，再驗證自然新窗口及完整報告。
