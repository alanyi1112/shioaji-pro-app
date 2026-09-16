# 直接 160 檔容量評估與程式調整

## 結論

採用已核准 20 → 直接 160 的主路徑，160 通過後不用做 50／100；失敗維持 20。儲存容量已用兩日 synthetic full-size 資料實測，但尚不代表 160 live 資料或 UI／DB 驗收完成。

## 來源與方法

來源為已通過固定 20 檔 validator 的 2026-09-10／2026-09-11 capture。每檔映射至明確 `SYNTHETIC_` 命名空間，形成 160 × 270 × 2 = 86,400 筆分鐘；不以複製的商品冒充 160 檔正式行情。工具 `measure-direct-160-storage.mjs` 實際執行事件 JSON 解析、跨日整數倍數比較、canonical 雜湊、原子 exclusive 落檔及讀回雜湊比對。來源 SHA-256 與 receipt 見 `direct-160-storage-measurement-2026-09-11.json`。

| 項目 | 這次量測 | 新上限／保留 |
| --- | ---: | ---: |
| 第一天 canonical session | 9,506,622 bytes（9.07 MiB） | 32 MiB |
| 第二天 canonical session | 9,505,854 bytes（9.07 MiB） | 32 MiB |
| 單日格式化 JSON | 13.77 MiB | capture 64 MiB |
| 兩日 bundle | 19,017,287 bytes（18.14 MiB） | 128 MiB |
| 本次三份主要落檔 | 36.27 MiB | 另保留原子暫存 |
| 程序 peak RSS | 425.12 MiB | 新 160 plan 1 GiB |
| 可用磁碟 | 347.69 GiB | 至少 8 GiB |
| 每次 replay 分鐘比較 | 43,200 | 43,200 |
| 兩次 replay | hash 一致，64 synthetic triggers | 不算正式觸發 |

舊 4 MiB session 雜湊確定不足；舊 256 MiB RSS 也低於此完整 parse／hash／readback 峰值。新上限是在 live 測試前根據 synthetic 負載制定，不回頭修改 20 檔原計畫或既有結果。

## 磁碟預算與保留政策

- 兩份 daily capture＋兩份暫存：4 × 64 = 256 MiB。
- 一份兩日 bundle＋暫存：2 × 128 = 256 MiB。
- offline fixture＋暫存：2 × 128 = 256 MiB。
- logs／metadata：64 MiB；DB／WAL 另保留 64 MiB（容量預留，尚非 DB 量測）。
- 合計保守工作集 896 MiB；啟動與每次發布 artifact 前，至少保留 8 GiB 可用空間，約 9.1 倍。
- 沒有自動刪除／輪替歷史 evidence。多次失敗或長期保留會占用空間，新的 run 必須重新查 free space；不足就拒絕，而非覆寫。
- 128 MiB stream／128 KiB frame／16 MiB log 上限列在 profile，尚須由後續 live runner 接線；不能聲稱目前未完成的 runner 已受其保護。

## 已完成的程式調整

- `tiered-capacity-evidence.mjs`：接受單日功能 bundle，160 required prior 改為 20；未知或偽造 bundle／GO 保持拒絕。
- `tiered-capacity-stage-artifacts.mjs`：plan v2 綁定儲存 profile，execution token v2 拒絕舊版；160 preflight 加入 8 GiB 檢查；未核准失敗保留 20。
- `direct-160-storage.mjs`：32／64／128 MiB canonical limits、free-space guard、fsync＋原子 no-clobber writer。沒有放寬已完成 fixed-20 路徑。
- `prepare-tiered-stage-plans.mjs`：預設只建立日期化 direct-160 plan，RSS 1 GiB、可用磁碟 8 GiB。保留原 v1 計畫與 historical evidence。
- 已產生 `direct-160-prerequisite-2026-09-11.json` 與 `direct-stage-plan-160-2026-09-11.json`；前者只表示來源前置合格，不是 live execution authority。

## 實測的限制與尚待工作

- 本工具未執行 DB／WAL 寫入、瀏覽器 UI 壓測、長時間 live 記憶體或 provider 訂閱；不能將 DB growth=0 當作 DB 成本零。
- live transport／adapter／recorder／launcher 仍保留原 20 檔護欄。需另外完成 exact-160 路徑接線、單次 token 消耗、session 邊界、failure sidecar、超限中止與相同 cohort 單次 unsubscribe 後才能啟動。
- per-stage bundle summary 尚需接上逐檔 minute 內容、緊接交易日及 deterministic replay 真實驗證；不能只接受布林宣告。
- 實際 160 股票清單需盤前重新核對合約與 liquidity；既有 160 manifest 是候選，不保證每檔都有每分鐘 KBar。
- 160 保留兩個完整交易日與配套 evidence；既有 20 檔 baseline 不能代表其餘 140 檔。
- 沒有啟動、停止或重啟任何行情服務；沒有 160 訂閱、production、通知、broker write、archive、commit 或 push。

## 重複量測與驗證

先前同工具第一輪 peak RSS 為 476.31 MiB，第二輪為 425.12 MiB；規劃採觀測較高值，不挑較低數字宣稱餘裕。兩次資料大小與重播結果一致；第二輪預算模型補列 DB／WAL 保留。新 1 GiB RSS 約為較高觀測值 2.1 倍，仍須 live 持續負載驗證。

完整非 browser 測試 219 files／2,374 tests 通過，包含直接 160 Gate、舊 token 拒絕、8 GiB preflight、profile hash、防覆寫與超限。build、OpenSpec strict 及 git diff --check 均通過。未修改 UI，因此未重跑 browser suite；既有 20 檔 dossier 仍須保持有效。
