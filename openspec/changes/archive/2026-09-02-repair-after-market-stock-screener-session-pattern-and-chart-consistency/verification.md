# 驗證紀錄

## 驗證範圍

- 僅驗證本機 RealTimeStock、5173 與其共用本機 D1；未部署或寫入 Sites／Cloudflare。
- 驗證期間保持 simulation API、business-session watchdog、5173、5174、盤後 pipeline 與行情連線運作，未停止或重新啟動服務。
- 正式選股底稿固定為 TWSE／TPEx 完整盤後日報的最新共同交易日，不以 Shioaji 盤中 Snapshot 取代。

## Durable full run 與 D1

- 執行 `node scripts/stock-screener-update.mjs --bootstrap-history --limit=1 --ohlcv-limit=120` 完成一次 durable full run。
- v2 snapshot：`4d36e1b3-d4f6-4b53-8d26-3485769d822f`，母體 1,974 檔，P=`2026-09-01`、D=`2026-09-02`。
- v3 snapshot：`8406eff0-e618-4137-845f-3bb1045a96c2`，`expectedSessionDate`、`effectiveSessionDate`、daily D、`technicalAnchors.through` 均為 `2026-09-02`。
- 最新 universe revision：TWSE 1,084 檔、TPEx 890 檔，合計 1,974 檔。
- OHLC：60 個交易日，`2026-06-09` 至 `2026-09-02`；target 120、processed 120、remaining 0、failed 0、overdue 0，TWSE／TPEx 各 60／60。
- 本次交易日推進只新增 TWSE 與 TPEx 的 `2026-09-02` 兩個來源請求；既有 59 日完成狀態未重抓。
- TDCC 六期：target 11,837、processed 11,837、remaining 0、failed 0、overdue 0；週期為 `2026-07-24`、`07-31`、`08-07`、`08-14`、`08-21`、`08-28`。
- `PRAGMA integrity_check` 回傳 `ok`；最新 schema v2／v3 snapshot 均可讀取。

## 1409 新纖日期與數值

- 5173 API 的三倍量「不符合」列固定顯示：P `2026-09-01` 65,478,367 股，D `2026-09-02` 25,510,372 股，倍數 0.3896000033。
- D 成交值為 `2026-09-02` 的 659,316,387 元；不再重複使用 `2026-09-01`。
- Fixture 同時保存 `2026-08-31` 11,610,980 股、`2026-09-01` 65,478,367 股與 `2026-09-02` 25,510,372 股，證明舊的 5.6393 倍不得延續到新 D。

## 全市場獨立重算

執行：

```text
node scripts/verify-stock-screener-v3.mjs --database=<本機作用中 D1>
```

結果：1,974／1,974 檔 evidence hash、P／D、原始 A／B／C、纏論合併與原始日期映射、BOLL bands 均與 immutable snapshot 一致；API 完整分頁 pass symbols 與獨立重算集合相同。

| 條件 | 通過檔數 |
| --- | ---: |
| 原始三 K 底分型 | 63 |
| 原始三 K 頂分型 | 281 |
| 纏論底分型 | 273 |
| 纏論頂分型 | 344 |
| BOLL 下軌陽 K＋下影 | 1 |
| BOLL 上軌陰 K＋上影 | 0 |

## 5173 實際 UI／圖表

- 成交量三倍篩選列明示 P／D，例如 1453 大將為 P `2026-09-01` 10,899 股 → D `2026-09-02` 37,230 股，3.4159 倍。
- 千張大戶單週增加條件顯示六期實際 TDCC 歷史；`unknown` 可見缺期原因，不補零或跨缺口比較。
- 原始三 K 頂／底與纏論頂／底四種 UI 查詢均顯示中心日、確認日；確認日為 `2026-09-02`。
- BOLL 下軌陽 K＋下影唯一結果為 1468 昶和，展開內容顯示：P `2026-09-01` O/H/L/C 與 bands、D `2026-09-02` O/H/L/C 與 bands、上下影線判定；上軌陰 K＋上影的當期結果為空，與獨立重算一致。
- stale／pending／partial 的狀態文字及 stale 時停用結果點選與「加入清單」，由 browser fixture 覆蓋；mixed-session publisher／repository／route 由整合測試拒絕。
- 1453 不存在於四個自選清單，仍可從選股結果切換指定 `chart-0`。QuoteBoard 顯示 1453 大將 Snapshot：11.05、-0.10、-0.90%、開 11.15、高 11.15、低 11.00、量 34。
- 2419 仲琦的選股 D 為 `2026-09-02`、2,493,846 股；點選後取得同日 Shioaji Snapshot 2,475 張，結果卡精確顯示「官方盤後 2,493.846 張 − Shioaji Snapshot 2,475 張 = +18.846 張」。
- 圖表 QuoteBoard 與主圖之間不再顯示額外的「選股證據」提示列；結果卡不顯示成交量條件、大戶條件或共同成交值明細，成交值門檻仍保留於控制項、「已套用」摘要與 API 判定 evidence。
- 日期不同、Snapshot 缺漏或成交量非法時不顯示同日差異；正差、負差、零差與不足一張的小數差異均由純函式測試覆蓋。
- 指定圖表共有 7 個可見 canvas，CSS 尺寸均非零；主圖 canvas 為 732×196 CSS px（HiDPI backing 1464×392）。
- console error／warning：0。

## 自動化檢查

- `pnpm test`：172 files、2,065 tests 全數通過。
- `pnpm test:browser`：7 files、85 tests 全數通過。
- `pnpm test:multiview`：703 tests 全數通過。
- `pnpm lint:multiview`：通過，0 warnings。
- `pnpm exec tsc --noEmit --project tsconfig.app.json`：通過。
- `pnpm typecheck:multiview`：通過。
- `pnpm build`、`pnpm build:multiview`：通過；新增程式未產生 target 相容警告，僅有既有的 chunk size／Vinext native config 提示。
- `openspec validate --all --strict`：36 items passed、0 failed。
- `git diff --check`：通過。
- 將時間相依的既有「台股官方核對 stream parity」測試固定在 fixture 的 `2026-07-10T02:00:00Z`，避免日曆隨實際日期推進造成假失敗；其單測與完整 Multiview 套件均通過。
