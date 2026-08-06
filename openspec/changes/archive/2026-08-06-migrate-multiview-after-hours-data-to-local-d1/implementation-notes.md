## 實作與驗收紀錄

### 2026-08-07 唯讀 preflight

- Git HEAD：`d7a6c61d8fde01ef4d5494810bc9e84affe5a57c`。
- runtime：simulation；production-readonly stopped；8080、5173、5174 可用。
- Wrangler OAuth 與 `multichart-production` D1 可用；遠端操作只有 metadata、aggregate query 與 table allowlist export，未執行 write、workflow 或 deploy。
- 12 個 allowlist table 全部存在。遠端主要 coverage：candle 29,300 rows／62 symbols、daily chip 6,667／29、TDCC distribution 1,444／29、PE 21,634／18；本機 seed 前后三族群皆為 0。
- 因遠端 coverage 明顯較完整，採 data-only table export，不重抓逐日／逐週官方來源。

### Staging 與原子 seed

- repo 外 mode 700 暫存目錄；export SQL mode 600，39,617,921 bytes，SHA-256 `b7625ca7c5b1823912972b928b5de41a9bd4dbb3dde99d220a2ceb1abfbb6b6a`。
- 空 staging DB 套用 22 個 migration，匯入 11 個有資料的 allowlist table；第 12 個 `tdcc_shareholder_backfill_week` 為合法空表。
- staging schema equality 與 `PRAGMA integrity_check` 通過。
- live seed 前建立 `after-hours-seed-2026-08-06T163704683Z.sqlite`；單一 transaction 合併後 integrity 通過，個人清單 4 tabs／24 instruments 的 material hash 在 transaction 前後一致。
- 去識別化報告：`after-hours-seed-2026-08-06T163704683Z.json`，並更新 `after-hours-seed-latest.json`。

### 本機 readback

- candle：29,316 rows／62 symbols，實際時間 2024-07-29 至 2026-08-06。
- daily chip：6,667 rows／29 symbols，2025-07-24 至 2026-08-05。
- TDCC：1,444 rows／29 symbols，52 個官方週日期；每筆為 15 個級距＋level 16 adjustment＋level 17 total。
- PE：21,634 rows／18 symbols，2021-07-30 至 2026-08-06；18 個 available、3 個 insufficient_history state 保持 incomplete。
- 2330.TW 的五種籌碼資料皆 available，PE river 回傳 1,215 points；2330.TW、8069.TWO、00919.TW 日 K 均由本機 API 成功 readback。
- `scripts/realtimestock-runtime status` 已分別顯示 market／chip／tdcc／pe `completed`。

### 本機回補與 UI 驗收

- 實際執行 daily pipeline：PE run `local-pe-20260807-00`，latest accepted 18，history claimed／completed／failed 為 8／8／0；兩個尚未發布的 active ETF 保留 `official_not_published`，未補造資料。
- 實際執行 TDCC pipeline：最新官方日期 2026-07-31，24 個 symbol 完成 daily chip warm；既有 coverage 已完整，因此 continuous history 為合法 0-work no-op。
- browser 已從本機 D1 呈現既有盤後 pane 與詳細資料入口；PNG／下載、未發布缺值與各 pane payload 由完整 contract tests 驗證。
- runtime stop／restart、D1 restore 及 uninstall／install 後再次核對，盤後四族群 status、個人清單 hash 與 integrity 均維持正常。

### 最終品質檢查

- migration staging／atomic seed tests、MultiView 完整 tests 462/462、lint、顯式 typecheck、build、source governance、production/full dependency audit、秘密掃描與 `git diff --check` 全部通過。
- `openspec validate migrate-multiview-after-hours-data-to-local-d1 --strict` 通過。
