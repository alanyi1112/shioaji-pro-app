## ADDED Requirements

### Requirement: 收盤尾筆例外必須與原live覆蓋及盤後補算分開呈現

API／UI MUST保留原daily executionOutcome、逐檔live coverage與原失敗原因，另呈現經驗證的收盤尾筆例外產品判定、政策版本與補算時間。通過時MUST顯示「日常運作通過（收盤尾筆例外）」及「盤後補算，不通知」；補算列MUST列出商品、13:30今日／前日累積量、有效門檻與比較版本、量比或零分母原因、是否符合，不能塞入原即時trigger清單或提升通知權限。artifact缺席、損壞或不符原summary時MUST顯示待補算／未通過而非預設成功。

#### Scenario: 原live部分收尾而例外產品通過

- **WHEN** 原live為157／160而三筆盤後補算完整驗證且例外政策通過
- **THEN** 面板MUST同時顯示157／160原live及例外通過，三筆補算標為非即時；原結果、排序與門檻／名單草稿不得變動

#### Scenario: 收尾後重新載入結果超過單頁

- **WHEN** 當日已有245筆持久化結果而本機API每頁最多100筆，原通知lease已結束
- **THEN** 面板MUST沿本機cursor有界讀完三頁，不能只顯示首100筆或依賴重新開行情連線補齊
- **AND** generation或repository revision跨頁改變、cursor循環、20秒期限或32頁上限到達時MUST拒絕假稱完整並保留既有結果，不新增broker登入／訂閱／通知

### Requirement: 盤中快捷門檻必須呈現真正生效狀態

面板 MUST 提供1.5／2／3倍快捷操作，盤中只修改門檻時 MUST 可立即要求原runner安全套用，不夾帶未保存名單草稿。MUST 分列savedRevision、activeComparisonRevision、目前有效門檻、套用中／已生效／失敗／無active owner及實際effectiveAt／逐檔effectiveMinute；未取得runner與durable切換收據確認前，不得因config保存HTTP200而顯示已生效。未知schema或舊runtime MUST 明示不支援即時切換，不能靜默fallback宣稱成功。

切換後最後封閉分鐘的重新符合 MUST 標示「門檻調整後符合」，不補發聲音／系統通知；原歷史trigger的門檻、版本與時間 MUST 保留。多分頁及快速連按須使用原子revision與冪等請求，同門檻重複要求不得建立假生效或重複通知。

#### Scenario: 門檻已保存但runner尚未確認

- **WHEN** config已儲存而active comparison仍是舊版本
- **THEN** 面板 MUST 顯示「套用中」與舊有效門檻，不得把saved revision當已生效

#### Scenario: 只有名單草稿未儲存

- **WHEN** 使用者有未保存的名單草稿並點選3倍即時門檻
- **THEN** MUST 只提交已保存設定的門檻變更，保留名單草稿，且不得額外訂閱商品

### Requirement: 日常狀態必須分開呈現監控與基準完整性

長駐分頁 MUST 隨台北實際日期更新查詢範圍，並在背景暫停後復原時重新核對。跨日 MUST 隔離前日結果、cursor、盤後投影及舊非同步回應，保留使用者設定與未儲存名單草稿；同日檢查不得反覆建立頁面lease或事件連線。日期修正 MUST NOT 重啟背景owner、券商登入或訂閱。

#### Scenario: 昨日開啟的分頁在今日仍持續使用

- **WHEN** 分頁載入於10/14，而台北時間已到10/15或從背景復原
- **THEN** MUST 自動讀取10/15結果，前日cursor不得沿用，前日遲到回應不得混入今日結果
- **AND** 背景行情owner與未儲存草稿 MUST 保持，不能靠每日整頁重載作為正常跨日功能

盤中選股 API／面板 MUST 明列 schemaVersion、runtimeMode、tradeDate、設定／plan、generation，並分別呈現今日監控、逐檔 live coverage／最後有效分鐘、前日基準、下一交易日基準與選用診斷。今日 live partial 與下一日 baseline ready 可以同時成立；diagnostics disabled／not_requested 不得顯示為啟動失敗。

歷史 Stage 容量資訊 MUST 保留在可收合說明，不得標成今日 live GO。v2 品質 MUST 明列實際總量核對狀態，不使用假的 `readyForBundle=true` 或 formal acceptance 欄位；相容舊 client 的未知 schema／欄位 MUST 顯示 unknown 而非預設成功。

#### Scenario: live 尾端 partial 但盤後基準 ready

- **WHEN** 本日有單檔尾端缺口，而新版盤後基準已完整發布
- **THEN** 面板 MUST 分別呈現缺口與翌日可用，不得互相覆蓋或把歷史回補顯示成 live 成功

#### Scenario: 舊版 client 收到新基準

- **WHEN** client 無法辨識 v2 或缺少某項檢查資料
- **THEN** client MUST 顯示未知／需更新，不得把缺欄位當作零缺口或完整驗收

### Requirement: 收尾後結果與背景資料活動必須維持誠實

面板 MUST 從實際收到的資料與持久化水位呈現 data activity／freshness，不依賴圖表可見性、週期或 render commit。收尾後 MUST 保留合法唯讀結果、顯示 execution ended 與最後比較分鐘，關閉新通知權限；歷史觸發值、最後有效量比及目前資料有效性 MUST 分開標示。

每筆已接受的封閉分鐘 observation MUST 將分鐘鍵、今日累積量及可取得的前日同分鐘累積量同步保存於當日 session 的逐檔水位，供 API 投影使用；前日基準不存在時 MUST 明列 null。session 已非 current 時，API MUST NOT 將保存的舊水位顯示成當下即時資料。此投影不得額外訂閱行情或把不連續的分鐘算作可比較結果。

#### Scenario: 圖表關閉但仍收到資料

- **WHEN** 主圖不可見但背景收到合法來源事件
- **THEN** 面板 MUST 正常更新 data activity，不要求切到 1 分 K

#### Scenario: 背景已保存分鐘但逐檔 API 水位缺失

- **WHEN** 日常 runtime 接受某商品的 09:02 封閉分鐘，SQLite 已保存今日累積量與可用的前日同分鐘基準，且當日 session 仍 current
- **THEN** status API MUST 顯示該商品的 09:02、今日及前日累積量；若 session 失效則不得沿用該水位宣稱即時更新

#### Scenario: 整日結果已停止更新

- **WHEN** runtime 已正常收尾
- **THEN** 面板 MUST 保留結果並顯示已結束／資料時間，不得因沒有 capture 或圖表 commit 清空結果，也不得把舊 trigger 當作仍可即時通知
