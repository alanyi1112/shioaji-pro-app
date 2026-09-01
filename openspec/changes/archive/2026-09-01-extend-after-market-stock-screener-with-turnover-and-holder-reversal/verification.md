# 驗證紀錄

## 2026-09-01 六期 TDCC bootstrap

### 來源與信任邊界

- 最新正式來源：`https://openapi.tdcc.com.tw/v1/opendata/1-5`。
- 一次性歷史傳輸鏡像：`wirelessr/tdcc-opendata-archive` exact commit `17944774a7a37c8ef52a7ca919817fe6f949891c`。
- 六檔皆固定原始位元組數與 SHA-256；完整下載與驗證六檔後才允許寫入。
- 2026-08-28 鏡像 68,799 筆與同次官方 OpenAPI 逐列一致；官方 payload hash 為 `b3d0cb3f83a231e470e3e58c421c7e0e965e9d0323e39fa59fc8b273ef08c78c`。
- 寫入採只補缺；既有官方 OpenAPI、原生歷史表單與合法本機列均保留原 provenance。

| 週期 | 原始 bytes | SHA-256 | 全資料列／證券 | universe 合法／有效 | 官方缺資料 |
| --- | ---: | --- | ---: | ---: | --- |
| 2026-07-24 | 2,341,148 | `91867bb70afebf5a6b7c3eb7cab86928875bf854a79f6d6dcc4496729d8b0a54` | 68,238／4,014 | 1,972／1,972 | 無 |
| 2026-07-31 | 2,344,332 | `7ad5886e994418975b72e100be97d8782e8ed320e5428fc253d5817e886aaf44` | 68,323／4,019 | 1,973／1,973 | 無 |
| 2026-08-07 | 2,347,711 | `c7cb74ae2e093ac145bfb9d5b2b153069b7f1e1f5e9603f8dec882d72ccc9ad6` | 68,442／4,026 | 1,973／1,973 | 無 |
| 2026-08-14 | 2,348,999 | `6098051708b362ac0215606174d539c40cac91902467b83f4c9da471a19adf8c` | 68,476／4,028 | 1,975／1,975 | 無 |
| 2026-08-21 | 2,352,208 | `4582e2ed52cc4fd48c4f7f6f858291f2c2937fbfa3084c3d44dc58f202eaeaa1` | 68,578／4,034 | 1,975／1,974 | `6241.TWO` |
| 2026-08-28 | 2,359,165 | `95960f0f828ade074a2e817ce42202488fd3e53522e07b8b8656ff0f469b3dd1` | 68,799／4,047 | 1,975／1,973 | `2867.TW`、`5371.TWO` |

### D1 寫入與背景終態

- 寫入前備份：`multiview-20260901T152949Z.sqlite`。
- universe revision：`b96e477b1d5aa1335e4c604382edd9c833bf887e745ccb01defa39f47edfe6d3`。
- 寫入前／後 `screener_tdcc_weekly`：6,222／11,840，新增 5,618 筆合法 `full-17`。
- progress：target 11,843、processed 11,843、remaining 0、failed 0、overdue 0、cursor `null`。
- 3 個官方缺資料商品週次以 `official_no_data` 計為已檢查，不建立虛構 17 級列。
- `PRAGMA integrity_check=ok`；六期 archive receipt 均為 `verified`。

### Snapshot 與 API acceptance

- snapshot：`90d3af39-ce96-4b8a-8f98-d6c1271f5ca9`，schema v2，1,975 rows／metadata total 1,975。
- 市場母體：TWSE 1,085、TPEx 890；所有 API case 均滿足 `matched + notMatched + unknown = 1,975` 與 `evaluated = matched + notMatched`。
- 日錨點：2026-08-31 → 2026-09-01；TDCC 六期：2026-07-24 至 2026-08-28。

| Case | matched | notMatched | unknown | 全分頁 rows |
| --- | ---: | ---: | ---: | ---: |
| 成交量 3 倍 | 149 | 1,811 | 15 | 149 |
| 大戶單週增加 0.2 pp | 278 | 1,694 | 3 | 278 |
| 由減轉增，前 4 週 | 10 | 1,959 | 6 | 10 |
| 由增轉減，前 4 週 | 13 | 1,956 | 6 | 13 |
| 成交量 3 倍＋成交值 10,000 萬 | 21 | 1,948 | 6 | 21 |
| 大戶單週＋成交值 10,000 萬 | 154 | 1,818 | 3 | 154 |
| AND | 12 | 1,960 | 3 | 12 |
| OR | 415 | 1,545 | 15 | 415 |

- 四週由減轉增的 unknown 為 6 檔，reason 均為 `history_pending`；其中 `6241.TWO` 正確反映缺 2026-08-21，未跳期或補零。
- 各 case 的 cursor 固定相同 snapshot，逐頁無重複，合計恰等於對應 verdict count。

### 實際本機 UI

- 5173 與 5174 均使用既有 listener，未重啟或停止任何服務。
- 1280×600、1280×768、1280×900 均能抵達並操作全部條件；選股內容區 `overflow-y:auto`，600 px 時 clientHeight 533、scrollHeight 3,779。
- DOM 顯示六個實際 TDCC 週期、母體 1,975、上市 1,085、上櫃 890，以及四週由增轉減 13／1,956／6。
- 選定第一張 K 線後點擊不在自選清單的 `1101 台泥`：第一張圖由 3711 更新為 1101；第二張圖、`下單面板 · 3711` 與自選清單維持不變。
- console warning／error：0。

### 程式驗證

- focused Node tests：13 pass（固定雜湊、日期、級距、來源集合、只補缺、operator）。
- `node --check`：新 bootstrap 與 operator script 通過。
- `npm run typecheck:multiview`：通過。
- `npm run lint:multiview`：通過。
- `npm run test:multiview`：659 tests pass、0 fail，且 MultiView production build 通過。
- `npm test`：168 test files、2,030 tests pass、0 fail。沙箱內因禁止測試建立 Unix socket／`127.0.0.1` listener 而出現 `listen EPERM`；使用相同程式與測試在允許本機 socket 的環境重跑後全數通過，未為測試停止既有 runtime。
- `openspec validate --all --strict`：29 passed、0 failed。
- `git diff --check`：通過。

### 已接受的來源 unknown

- 2026-08-21：`6241.TWO` 官方資料無該週列。
- 2026-08-28：`2867.TW`、`5371.TWO` 官方資料無該週列。
- 上述三個商品週次均保存為 `official_no_data` 已檢查結果；不補零、不借用其他週期，也不列為 failed／overdue。其餘六期 full-universe 工作皆完成，沒有尚未完成項目。

本 change 不包含歸檔、commit、push 或部署；亦未啟停 simulation API、watchdog、5173、5174、pipeline 或行情連線。
