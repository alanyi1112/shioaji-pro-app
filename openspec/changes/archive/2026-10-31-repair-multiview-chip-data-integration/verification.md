## 實際修復與本機驗收（2026-10-31）

- 已將籌碼資格、日籌碼更新與 TDCC 清單接上 user_system_tab_instruments。00406A 原已在該表，並非使用者未加入清單；前次唯讀查核漏讀新表的判斷已更正。
- 已驗證來源資料採同 SQLite 的相容讀取層共用，查核收據、日期、mapping、數值與單位；沒有自營商或合計來源的欄位保留 null，較完整原件不被覆寫。這是共用資料讀取，並未破壞性合併或刪除舊表。
- 重現30秒簽章證明與長輪工作的期限混淆，以及15:00已驗證日曆被22:00舊啟發式否決。改為入口驗證一次、同一有界工作固定交易日；新請求仍查新鮮簽章，工作到180秒仍停止。
- 本輪實際驗證又發現新增 target sync 不能使用虛擬 internal origin 讀取本機 setup；已改用 loopback origin並保留中間失敗紀錄，修正後同路徑 HTTP 200。

## 實際讀回

- 00406A 日籌碼96筆，最新來源日10/30；現有日線多層副圖已顯示法人、外資持股、融資券、借券成交與估算維持率。
- 集保由原12期增加至21期，6/12–10/30逐期驗證17級數值及合計通過。原 watcher `local-tdcc-watch-20261031-1130` 於11:30:10開始、11:31:40自然完成；missingDates=[]。
- ledger 52期完成包含21期真實資料，以及31期上市前官方未發布資料的缺值紀錄；不是52期有數值。00406A上市日6/11依[證交所原公告](https://www.twse.com.tw/staticFiles/news/news/tsecnews/8a8216d69e6379f4019eabb5dc8801c2.pdf)核對，沒有補零。
- 有界日籌碼 operator 驗證處理18檔、待執行0，仍有23檔來源／歷史覆蓋不足，保留 warming，不能當作全母體完整。此筆為 operator 驗證，不冒稱16:45自然排程收據。
- 台積電同日法人與融資券投影從正式收據唯讀重算相符；讀得10月19個日資料及6期集保，不新增來源請求。
- 原00406A的12期資料與三筆舊失敗紀錄之邏輯列SHA在新增資料後完全相同。借券餘額等來源未提供欄位仍明示無資料。

## 驗證

相關Node回歸229項通過、MultiView TypeScript與建置通過、OpenSpec strict 82/82、diff check通過。包含使用者隔離、新舊清單、停用商品、錯日／錯收據／mapping、整數與單位、資料不降級、30秒／180秒邊界及來源錯誤 allowlist。

私密證據：`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/chip-repair-20261031-1125/`，含 final-summary.json、00406A-readback.json及實際持股副圖截圖。檔案0600、目錄0700。既有16:45、TDCC早期排程及300秒watcher設定不改；不重啟服務、不改交易 API、盤中監控或遠端站、不commit／push。

## 23檔逐日缺口續查（2026-10-31）

- 14檔的近期完整法人／融資融券來源未接入共用層；13檔缺10/29、10/30，6274只缺10/30。精準附加54筆完整官方資料，4筆官方修訂以新來源版本保留；未覆寫原資料或收據。
- 4檔ETF的上市前期間不適用；另5檔與2426的借券歷史窗口不足。只對沒有完成成交列的缺口區間查詢，524個區間全部通過回應日期範圍、商品、欄位與SHA驗證，均無官方成交來源列；不補零、不以成交量代替借券餘額。
- 新增附加表綁定原收據、來源觀測時間與逐列SHA；自然collector從同一回應保存完整欄位，回歸證明不增加請求，已完成來源不重抓。原fetch state不改寫，健康投影保留原365日／20小時／冷卻Gate，診斷分列歷史範圍與時效，不再把全部pending顯示成官方未發布。
- 本次23檔13檔解除原阻擋，10檔保留pending；全部72檔讀回60 ready／12 pending，額外00919、00929及00878法人證據為時效到期，未擅自更新來源。ready是原預熱Gate，不冒稱所有逐日欄位或全UI均完整。
- 5228筆原始日列、92份原fetch state及1824次原收據參照逐筆核對不變；54筆新增列原來源數值、完整核心欄位、SHA與收據讀回相符。相關回歸255/255、型別、建置、OpenSpec82/82及本輪範圍diff check通過。
- 私密逐檔逐日證據位於`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/chip-23-gap-audit-20261031-1719/`，包括`23-symbol-gap-report.md`、`per-symbol-date-audit.json`、`canonical-application-result.json`及所有來源回應／收據。保留舊失敗、原來源及收據，未重啟服務或操作其他排程。

## 本機正式常駐套用（2026-10-31 18:51起）

- 範圍為本機5173／5174及既有自然排程。原生launchd確認Web PID956、MultiView PID961、runs均1；正式wrapper的6個MultiView／選股入口與工作區一致，引用工作區原始碼，沒有另一份舊副本需替換。
- 正式讀取核對發現完整共用表尚未納入圖表快取識別，已修正，新增回歸證明原fetch state落後仍為`d1_hit`、下載0、原資料／fetch state寫入0；並用native RO＋封鎖fetch對14檔完整service路徑驗證同樣結果。
- 正式HTTP逐檔讀回14檔54筆，均`d1_hit`；同日完整核心欄位、來源SHA及receipt ID與計畫相符。HTTP健康分類亦載入新診斷，60 ready／12 pending；10檔原歷史限制與另2檔時效不足保留。
- 附加表的DDL已在前輪套用，這輪以獨立`0041_shared_verified_chip_rows.sql`接續原0040登記；歷史候選0035檔名與既有布林migration編號重複，因此正式順序改為0041，DDL SHA不變。交易內CAS核對既有表／索引、54列材料SHA及原head，只附加migration紀錄，沒有重寫業務資料。
- HTTP讀回後再次核對5228原列、92原fetch state及原收據參照全部不變；256項相關回歸通過，migration改名後52項相依回歸通過，型別與建置通過。
- 私密正式證據位於`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/chip-formal-apply-20261031-1851/`，含`live-readback.json`與`migration-application.json`。不重啟API／watchdog／Web／MultiView，不補跑排程、不新增來源請求、不放寬Gate；未把正式接線或HTTP驗收冒稱下一輪自然排程成功。

## 規格同步與歸檔範圍（2026-10-31）

依使用者明確授權同步正式規格並歸檔。歸檔代表本change列出的修復、正式接線與有界驗證完成，不代表全部商品、所有日期／欄位或下一輪自然排程均完整；既有來源、歷史與時效缺口及舊失敗持續保留，Gate不變。

本次提交範圍僅本change的歸檔文件及對應正式規格；原始碼、migration與其他工作區變更不納入此歸檔提交。規格檢查不替代程式回歸或新增自然驗收；實際讀回與回歸範圍如上。未執行push、來源請求或服務操作。
