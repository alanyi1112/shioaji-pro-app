# 實作驗證（2026-10-24）

實作已載入本機，尚未完全達標，不歸檔。詳細本機證據位於 `outputs/acceptance/reboot-repair-20261024/report.md`。

- 焦點 95 項、接續器原生回傳格式後續 2 項重跑、MultiView tsc、新 change strict validate 通過。
- v8 已恢復 159/160 日完整雙市場來源選擇，原 pending 不變造。
- 手動零下載日 K 連續性重驗 65/68 通過、3 檔 OTC 保持 unknown；原 SLA overdue 不重寫。
- TDCC 最終冷載入兩個並行控制流程 HTTP 200；原自然開機例外未重現，保留原失敗及新安全診斷。
- 授權的 10/20 單次來源尚未送出；同身分用量回退觸發 broker_daily_usage_nonmonotonic，缺正式 reset／身分銜接證據。沒有放寬 Gate。
- 休市設定、主終端自然載入憑證、source_blocked 與未完成跨日自然驗收保留；未 stage／commit／push。

## 本輪最新驗證：盤後資料補齊

最新證據與限制見 `outputs/acceptance/afterhours-completion-20261024/report.md`；上述 95 項／65 檔是前輪時間點，並非本輪最後結果。

- 257 項焦點測試全部通過，MultiView tsc 通過。
- 日 K 事後唯讀重驗 68／68 complete；清單三類每日籌碼各 68 檔至 10/22，借券 51 檔有實際資料、17 檔官方確認無成交，不補零。
- 全市場 TDCC 雙官方來源交叉驗證後匯入 1,978 檔 10/22；3 檔官方缺件保留。
- v2–v7 發布日資料 10/22、週資料 10/22；實際 HTTP status API 均以 10/22 為 expected/effective，保留 partial。新增 request 日曆投影不回寫舊 10/23 等待／source_blocked。
- v8／v9 仍缺 10/20，現行發布仍到 10/19；單日一次待補授權已由既有背景入口實際驗證，Gate 正確拒絕且 sourceRequests=0，不能結案。
- 休市設定與 16 份自然載入保護檔 hash 不變；更新來源後唯讀自然載入 Gate 通過、readerRequests=0，10/27→10/28 自然驗收仍未完成。
- API 過夜曾有大量 business_session_failed／network_unreachable 紀錄；07:27:49 啟動的程序最後檢查仍在運作，watchdog healthy。沒有將歷史失敗抹去或宣稱整晚穩定。本輪只主動重載 5174 一次，未主動重啟 API 或 5173。
- 未 stage、commit、push 或歸檔；精確變更與回復副本由本輪 manifest 保存。


## 2026/10/24 重開機用量銜接與 10/20 完成

修復原始計數直接與持久高水位比較、跨程序沒有不清帳銜接的問題。同帳戶完整舊收據、上限、正式身分與既有安全 port 通過後，沿原 quota epoch 加計舊保守全額及新段全額；同程序只加增量。未以重開機宣稱券商 reset，計數下降瞬間的券商端原因仍無完整證據。

實際 10/20 完整來源取得一次，1,987 列、121,390 bytes、attempts=1，原 admission 通過且新預留記 charged。v8 發布 09fdd2c5-a579-4bbb-85bc-4b0d57c19cde，160／160 日；v9 發布 77d7a4e9-3082-4e7a-b759-09dceadaa69c，64／64 日，兩者 effectiveSessionDate=2026-10-22、母體 1,981 檔，實際 HTTP 均 ready／canUseResults=true。v8 unknown=76、各商品歷史缺件與 before_listing 保留，來源窗口齊全不等於每檔完整日 K。

185／185 焦點回歸、MultiView TypeScript noEmit、OpenSpec strict validate 與 scoped diff check 通過。政策、quota identity 與全部 4,058 筆本輪前 reservation 不變；16 個自然驗收／休市設定保護檔 SHA 相同，source_blocked 不清除。API／5173／5174 PID 不變，watchdog armed 且失敗／重啟計數為零；未重啟、commit／push 或歸檔。

詳細前後證據、原檔備份、SHA、保守扣帳模型及回復邊界：outputs/acceptance/broker-reboot-continuity-20261024/report.md。唯讀自然 Gate verified=true、readerRequests=0、naturalAcceptanceComplete=false。整個 change 仍有原始 TDCC 開機例外與未完成自然驗收，不因此歸檔。

## 2026/10/24 獨立本機提交與實際 index 驗證

以上未 stage／commit 的敘述保留原時間點；後續使用者另行授權分批本機提交，並未授權 push 或歸檔。本節記錄該次離線整理，不將先前 HTTP 或資料庫結果視為本輪重新查驗。

| 批次 | 本機 commit | 精準範圍 | 實際 index 隔離驗證 |
| --- | --- | --- | --- |
| A | `98fb3bfdf222facc08067e2bcdc9bccc111ba6b3` | 4 檔：用量銜接與額度安全診斷 | 97 項離線測試 |
| B | `24db4515a5f02bc98e5a1a1797cdfa6376d4f8ec` | 8 檔：來源重用、pending 接續、單日一次上限 | 200 項離線測試 |
| C | `77ccc50cbd9a59dc68bd40ba7875545bd8e6f039` | 19 檔：本機簽署日曆、日 K 純重用與籌碼／選股完成交易日 | 216 項離線測試、完整 MultiView 型別檢查 |
| D | `6dcb6907a60c35a695d1de094180c29465af1f38` | 13 檔：TDCC 安全診斷、週資料獨立恢復與發布 | 248 項離線測試、完整 MultiView 型別檢查 |

測試集合重疊，各批數字不能直接相加。C／D 使用 network-denial preload，在隔離匯出的實際 index tree 執行；只連結既有本機依賴，未安裝套件。提交前後核對精準路徑、blob、parent 與空 index；兩批已提交 blob 均與被測 index 一致。C 的兩份手寫 `build/*.ts` 來源精準加入，未加入其他建置產物；D 排除既有 current-session cooldown 差異，保留相關未完成來源及測試。16 份休市設定／自然載入保護檔與其他原始工作區內容未改動。

E 僅納入本 change 的 `.openspec.yaml`、proposal、design、spec、tasks、verification 六份文件；由實際 index 隔離執行 strict validate，再記錄文件提交結果於本機證據目錄。證據：`outputs/acceptance/recovery-CDE-commits-20261024/`，各批 `*-index.json`、`*-tests.json`、`*-commit.json` 保存被測內容與提交對應；文件批另保存 strict validate 結果。

此輪未重啟、補跑或新增請求，未更新來源、休市設定、凍結 bundle 或晚登入政策。原始 TDCC 開機例外仍未重現，三檔官方 TDCC 缺件與個股歷史不足不變，10/27→10/28 自然驗收仍待實際發生。change 保持 18／20 項完成，不歸檔。
