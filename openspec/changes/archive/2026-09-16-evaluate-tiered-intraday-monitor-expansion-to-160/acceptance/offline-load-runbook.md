# 直接 160 檔離線負載與容量 Runbook

主路徑使用 `measure-direct-160-storage.mjs`，輸入兩份已驗證 20 檔 capture 與原 stage plan，指定 repo 外全新絕對輸出目錄：

```sh
node openspec/changes/evaluate-tiered-intraday-monitor-expansion-to-160/acceptance/measure-direct-160-storage.mjs --execute --baseline=<前日capture> --capture=<完整日capture> --plan=<20檔plan> --output-dir=<全新絕對路徑>
```

它驗證來源、建立 160 檔兩日 synthetic 資料，執行 JSON 解析、量比重播、canonical hash、原子落檔與 readback。既有目錄或不足 8 GiB 空間會拒絕；不刪除舊輸出。結果只供容量評估，還須完成 DB／WAL、UI、持續負載與獨立 live runner。

舊 `run-offline-tiered-capacity-load.mjs` 與 50／100／160 歷史 evidence 保留作診斷；其 replay 是簡化 checksum／相鄰量變化，不是完整跨日量比 evaluator，DB growth=0 也不是 DB 寫入測試。不得用它宣稱完整 live／DB／UI Gate 通過。

新 plan 用 `prepare-tiered-stage-plans.mjs --execute --directory=<acceptance絕對路徑> --created-at=<實際ISO時間>` 產生，預設只建立日期化 160 plan，保留舊 v1 plans。若日期化檔已存在會拒絕，不以改日期字串假冒新驗收。
