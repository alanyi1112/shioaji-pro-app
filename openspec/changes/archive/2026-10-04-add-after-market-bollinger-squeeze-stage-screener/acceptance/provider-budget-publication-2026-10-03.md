# 備援協調、集中額度與發布接線驗證（2026-10-03）

時間採 Asia/Taipei。接續 31／41，完成 8.5–8.7 後為 **34／41**。這是程式接線與隔離回歸；策略未啟用、未抓取新行情，也沒有正式 160 日資料或自動發布。原官方失敗、兩日期探測與前階段收據保留，不改寫成當時成功。

## 成功：已完成的程式與隔離驗證

### 集中額度核心（8.4 部分完成）

- additive `0039_broker_bandwidth_reservations.sql` 建立 observation／reservation／append-only receipt；不修改既有表或清除舊工作預算。
- admission 使用可設定行情保留額度、其他工作承諾、至少兩份獨立實測 usage delta、估量倍數與上限。沒有固定「剩餘 256 MiB 才啟動」門檻；未配置、承諾未知／過期、quota epoch 未驗證皆拒絕。
- 原子保留以集中 SUM 防止多 port 超賣；單調 usage、額度不變與 generation fencing。已消耗估量保守持續扣住至同 quota epoch 結束，即使實際 usage 已增加也不釋放；可能保守重複扣量，不能宣稱精確歸因。
- 送出前 `reserved → dispatched`；僅確認 owner 死亡且租約過期才回收。未送出可 release，已送出但未知消耗為 quarantine，不以租約到期／API 換代清債。
- concrete port 只讀私有 simulation runtime identity、info／health／2330 Snapshot／usage；固定 loopback、拒絕轉址、有界回應／逾時，不登入、不訂閱、不交易。Snapshot 為唯讀業務診斷 POST，不是下單。
- HTTP bytes 與共用 broker usage delta 分列；來源量測必須可驗證，不能複製 fixture 數值或將有其他背景工作干擾的差值稱為純 HTTP 扣量。

**8.4 尚未整項通過**：既有 monitor／歷史工作的承諾更新 producer、正式 quota epoch 與真實估量政策尚未接妥；並未假稱其他工作全部已改用新 ledger。靜態 `commitmentsObservedAt` 超過 60 秒便拒絕，不能由 watcher 無證據改成當下時間。正式接線需先完成這些來源與配置，不能填 0 或改日期繞 Gate。

### provider coordinator（8.5）

- 官方優先；獨立且有效的 verified 備援才可接手官方未驗／實際失敗／冷卻。預算不足不冒充官方失敗。原 failed／partial receipt 的 id／hash 放入不可變 manifest。
- 官方與備援合計最多 2 次價量 HTTP／8 MiB／15 分鐘。官方 transport 4 MiB、daily_quotes 2 MiB；失敗採保守 bytes 計帳，各自持久 attempts／cooldown 不重設。
- 同日期兩市場重用一份持久 broker cache，staging 續原來源；已凍結來源不換版或重抓。日曆／普通股母體缺口保持 pending。
- 官方交易日 08:30–14:00 不增加 broker 歷史請求，盤後才續跑；沒有 UI／GET／新 login／subscription 入口。

### manifest-aware publication／API／UI（8.6）

- 全窗口 160 日期 × 兩市場的選擇進入 mapping hash、features、publication key 與 cursor；資料 hash、單位、來源及 review 均核對後才能切 atomic head。
- 同鍵 fast path 唯讀 no-op；舊官方 mapping／快照不能用新 mapping 重新解釋。不同母體 revision 的準備進度不混算。
- 官方恢復只追加 matched／conflict；API 唯讀揭露已知衝突，decoder 核對其日期／市場／凍結 payload 身分，舊 rows／head 不覆寫。
- UI 明示 Shioaji 備援、有效日期、歷史日數、切換原因及已知來源衝突；詳細來源可收合，但警告不收合。新增 pre 換行規則，窄面板展開完整 JSON 不造成橫向溢出。
- 沒有更動圖表公式、清單 mutation 或交易草稿；兩套清單仍需使用者明確加入。

## 最終回歸（8.7）

Node 24.19.0。最終通過 **239 項不重複測試**，不把中間重跑加總：

| 組別 | 檔案／項數 | 結果 |
| --- | --- | --- |
| Node：central ledger、broker ports、provider coordinator、fallback publication、daily_quotes、source-selection、v8 publication、prepare、retention、source-fetch | 10／129 | 全通過 |
| Vitest：v8／v7／API／query／history／window／chart-selection／condition-ui | 8／78 | 全通過 |
| Chromium：布林面板／原選股面板 | 2／32 | 全通過 |

- `pnpm exec tsc -b --pretty false` 通過，`pnpm build` 通過；既有 >500 kB bundle 提示保留。
- OpenSpec strict validation、tracked diff 與新文字檔 whitespace 檢查通過。
- 另做全 repo 333 份 untracked 文字檔檢查，非本 change 的產生檔 `apps/multiview/worker-configuration.d.ts` 有 5 處既有空白問題（11534／12048／12116／12536／12971 行）；不修改或刪除無關檔案。本 change 的 scoped 新文字檔檢查另行通過，不能宣稱全 repo 所有 untracked 檔無問題。
- fixture 涵蓋官方 reset／HTML／403／429、獨立 review pending、未知日曆／母體、額度拒絕、大 int64、破損 arrays、跨市場快取、160 日窗口與真正混合 provider、head no-op、cursor 隔離、官方恢復衝突、租約競爭／中止續跑、盤中保留時段與無交易副作用。
- fixture 的日期 grid／review／行情／usage／quota identity 均是假設，不能替代官方實證或真實自動 run。

### 中間失敗與修正（不美化成一次通過）

- 首輪中央預算測試揭露 limit 改變仍可能 admission；已補 SQL matching limit，不降低 assertion。
- Node decoder 的 extensionless import 無法解析，改為 runtime `.ts` import；型別與 build 回歸通過。
- macOS `/var` 暫存目錄為 symlink，測試先解析真實暫存路徑；實際 private root／symlink 拒絕政策未放寬。
- 新 UI fixture 初填衝突 provider 錯誤，decoder 正確拒絕；fixture 改為 `official-twse`，不是修改 decoder 放行錯誤身分。
- 混合窗口 fixture 曾忽略有效官方來源應逐日期優先，導致 run_budget／未完整；改為明確模擬「前兩日已凍結官方，後續 review 待確認」，保留原選擇、不增加 run 上限。
- 盤中時段 fixture 最初早於 review 的 reviewedAt，正確遭拒；改用有效 review 後的測試時間，不放寬時效 Gate。
- 額度 lease recovery receipt 改為只在條件 UPDATE 確實成功後 append，避免競爭失敗被記成成功。

## Chromium 畫面／DOM（隔離 fixture）

320 CSS px、600 px 高、32 px 根字級；備援 160 日與來源衝突 1 筆明示。鍵盤展開完整來源後 `scrollWidth <= clientWidth + 1`，查詢沒有 PUT／自動跳商品／自動加入清單。畫面經實際檢視，警告可讀、來源 hash 可展開；截圖在本機 `src/components/bollinger-backup-source-320px-fixture.png`，不是正式行情畫面。

## 真實本機唯讀查證

16:40:25（`2026-10-03T08:40:25.609Z`），新 Chromium context 隔離 storage，拒絕選股以外 API／非 GET：

| 真實 request | 次數 | 結果 |
| --- | ---: | --- |
| daily-profile GET v8 | 2 | HTTP 200，profile=null |
| status GET v7 | 2 | 保留舊版唯讀路徑 |
| results GET v8 | 1 | HTTP 200，pending／v8_preparation_pending／rows=0 |
| 非 GET／broker／SSE | 0 | blocked=0、pageErrors=[]、consoleMessages=[] |

16:41:52（`2026-10-03T08:41:52.327Z`）使用 readOnly SQLite 查證：0037／0038／0039 對應表尚未安裝；profiles=0、publications=0，兩個 source／broker policy record 皆不存在。8080／5173／5174 原 listeners PID 為 1273／933／938，本輪未啟停任何服務、安裝 schema 或產生新 broker 來源請求。

這只證明未啟用及 pending UI 誠實，不替代 7.4 真實結果、雙清單或完整資料驗收。沒有 archive／commit／push。

## unknown／未通過／下一步

- **1.1／8.1**：公開 [Shioaji 行情文件](https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/MARKET_DATA.md) 確認 daily_quotes 指定日期／column arrays／權證排除接口；未就本 change 證實全窗口雙市場交易範圍相容性與本機展示 review。不能以公開 repo 的軟體 license 取代行情使用契約。
- [Shioaji 使用限制](https://sinotrade.github.io/tutor/limit/) 建議盤後取得歷史並快取，說明交易日 08:00 流量重設。列出的 50 次／10 秒市場資料清單沒有 daily_quotes；不能擅自外推為該接口的已驗證限速，正式 policy 尚待核實。
- **8.4 partial**：缺正式 quota epoch／新鮮承諾來源／實測政策，安全 port 會拒絕，不構造 verified record。這是正式啟用 Gate，不是應繞過的程式錯誤。
- **7.2／7.3／7.4／8.8**：未有真實 160 日逐商品覆蓋、來源相容／獨立重算、自動 watcher publication／同鍵 no-op、真實有結果的 API／UI／雙清單證據。不得勾選、歸檔或宣稱每日工作已完成。
- 先解除來源與預算前置條件，再精準套用 additive schema／verified 配置、明確儲存 profile，等既有 watcher 自然有界續跑，完整實證後才能結案。舊 TPEx reset／各階段失敗仍保留。
