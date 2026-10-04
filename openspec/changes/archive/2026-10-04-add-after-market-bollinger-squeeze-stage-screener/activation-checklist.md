# 正式接線與驗收清單

最新接續仍為 **34／41**：18:18 官方 2026-02-02 雙市場回應成功，但 2330 的量與先前 Shioaji 記錄差 1 股，根因未確認。18:26 新 admission 真實 Gate 零 HTTP 拒絕未配置政策，原收據未變；新增政策前置／途中重驗與整數／conflict 防護，138 項 Node tests 通過。來源相容性與正式預算仍 pending，不啟用策略；見 [最新來源／預算證據](acceptance/source-contract-and-budget-preflight-2026-10-03.md)。下方原接線紀錄保留。

目前 **34／41**。17:06 TPEx 指定日期入口已恢復，並修正其 11,928 列原始日報超過舊 10,000 列上限的問題。18:03 已備份並精準安裝 0037–0039，18:05 真實本機 admission 因 `broker_policy_pending` 拒絕，HTTP=0；來源 review、quota epoch／其他工作承諾更新／實測政策仍缺，策略保持停用。最新證據見 [備援 schema 安裝與 Gate](acceptance/fallback-schema-activation-2026-10-03.md)；[入口恢復與日報修正](acceptance/tpex-recovery-and-report-row-bound-2026-10-03.md)及前一階段失敗證據保留。

## 1. 先解除來源契約阻礙（task 1.1）

- TWSE／TPEx 已取得同一 10/2 指定日期回應；TPEx 先前 ECONNRESET 原證據保留。尚未驗整個歷史窗口或指定日期入口的適用使用範圍；每次唯讀重查有界，不繞來源限制、不停用 TLS、不暗中重試。
- 核實實際採用來源的使用範圍、量／實際金額單位、資料日期、完整母體與 schema；最新日 OpenAPI／政府資料集授權不能直接當歷史網站入口證據。官方來源與 Shioaji review 分開；獨立 verified 的備援可供兩市場使用，不必等 TPEx 網站恢復，但官方日曆／普通股母體仍須成立。
- 保存真實去機密證據後，才建立來源自己的 verified checkpoint。格式參考 `BollingerSourceReview`，備援須擴充獨立 provider 契約；expiry／endpoint／mapping／usage 必須成立，不能將測試中的 hash 複製到正式環境。
- 先完成 tasks 8.1–8.7 的備援 parser、持久共享、集中流量 admission、來源 policy／UI 與回歸，才能啟用 fallback。兩日期可行性證據見 [Shioaji 探測](acceptance/shioaji-daily-quotes-feasibility-2026-10-03.md)，不是正式 review 或 160 日已齊。
- 8.3 已提供 immutable review、market/date selection、逐列來源與全窗口 mapping hash；只接受已持久化的合法 source receipt，正式恢復比較只 append。此 repository 不是 watcher 已接線；下一步 8.4 必須補共用持續 reservation，不能沿用各工作自己的 baseline forecast 就宣稱集中額度完成。

### 最新接續順序

1. 完成實際採用來源的價格／量／金額／交易範圍相容性及使用／展示 review；兩日期探測與公開文件仍不足以通過 1.1／8.1。未採用的官方入口可保持 pending，但不能偽造 verified 備援。
2. 8.4 的 ledger 與 concrete port 已可接線；補齊至少兩份可驗證 usage-before/after、HTTP bytes、quota reset identity、可設定行情保留額度、其他工作承諾及其即時更新 port。不得把靜態時間戳每輪改成現在冒充新觀測，或把未知工作額度填 0。
3. 0037／0038／0039 已精準安裝且保留舊 schema／head／failed receipts；勿重複套用或覆蓋備份。來源 review、`screener-bollinger-source-policy` 與 `screener-bollinger-broker-budget-policy` 仍未建立且各自獨立，後者缺失或 stale 均不送 broker HTTP。
4. 確認所有 Gate 後明確儲存每日 profile，等既有 watcher 自然觸發有界續跑。不得重啟共用服務或人工改 receipt 假稱排程成功。160 日逐商品真實覆蓋、三階段獨立重算、自動發布／同鍵 no-op 與實際 UI／雙清單驗收完成後，才勾 8.8／7.2–7.4。

## 2. 現行本機環境接線（task 5.1）

已於 2026-10-03 完成以下範圍，原排程 13:09:05 自然載入並回報 `profile_disabled`；詳細證據與備份見 [本機接線驗證](acceptance/local-activation-2026-10-03.md)。後續環境不可因已完成就重複安裝或覆蓋備份。

- 先核對唯一 local DB、現有 schema／migration 記錄和 installed runtime 與 repo 差異。禁止覆蓋整份 dirty runtime，避免混入其他盤中監控變更。
- 有界、可回復地套用 additive 0035／0036，保留舊表、head、snapshot 與原收據；不重啟 API／watchdog／Web／MultiView。
- 只同步 `service_multiview_screener_pipeline` 的可選 `--bollinger-only` 參數及 `service_multiview_tdcc_watcher` 的前置 hook；保留已安裝的其他程式、300 秒頻率與 RunAtLoad。這不是整份 runtime 的部署。
- 新 profile 預設不存在／停用，不因 migration 或安裝就下載資料。等待真實既有 watcher 新輪次，核對確實讀到新入口以及 profile-disabled／source-contract-pending 的誠實狀態，才完成接線任務。

## 3. 有界準備與真實發布（tasks 7.2／7.3）

- 明確儲存每日設定不觸發下載；RunAtLoad／既有 watcher 在日期 Gate 通過後續跑，無須瀏覽器。
- 預設 160 日、放大參數依需求最多 400 日。每輪價量來源合計最多兩次 HTTP request、8 MiB，包含官方與備援；含日曆／發布整輪最多 15 分鐘。首次準備可能跨多輪，不縮窗、不逐檔查分鐘 K。daily_quotes 共用既有 session、每日期兩市場只抓一次，額度經集中持續保留與可設定行情預算 admission，不寫死固定啟動門檻。
- 來源晚公布／429／schema error／期限滿分別保留原因、nextAttemptAt、attempt、bytes、failed／partial receipts。已完成批次不重抓，原失敗不刪除。
- 逐商品 readiness 與母體守恆、量／金額 provenance、三階段代表案例獨立重算，兩市場同一 D；只有真實成功 publication／atomic head 與同鍵 no-op 才勾任務。

## 4. 正式結果端到端（task 7.4）

- 核對實際 GET request counts、console、底稿／來源日期、daily profile 與草稿隔離、snapshot cursor、分類及其他分支 unknown。
- 使用真實結果手動連動指定未鎖定圖表及加入 Shioaji「選股」／MultiView「選股篩選」；完整記錄雙清單與無交易副作用。既有 fixture callbacks 與 pending 畫面驗證不能代替這一步。
- 保留失敗／partial；尚有 live 缺口時不得 archive 或宣稱每天已自動成功。
