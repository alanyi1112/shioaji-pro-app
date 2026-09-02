# 來源審查與固定清單

## 審查結論

- 原資料提供機關維持臺灣集中保管結算所（TDCC）。正式產品的 provider 仍為 `tdcc`；`wirelessr/tdcc-opendata-archive` 只作為已驗證的歷史傳輸鏡像，不是另一個官方資料提供者。
- 官方最新全市場資料使用 TDCC OpenAPI `https://openapi.tdcc.com.tw/v1/opendata/1-5`，欄位為 `資料日期`、`證券代號`、`持股分級`、`人數`、`股數`、`占集保庫存數比例%`。每個商品應有唯一的 1–17 級，其中 16 為差異數調整、17 為合計。
- TDCC payload 不提供上市／上櫃別，因此 suffix 映射不得由代號猜測。普通股沿用盤後選股已由 TWSE／TPEx 發行人官方名冊驗證的 `screener_universe`；ETF 另以 TWSE `STOCK_DAY_ALL` 與 TPEx `tpex_mainboard_quotes` 官方目錄中可驗證的 ETF 代號補入，並把本次固定母體保存於 `tdcc_archive_symbol_universe`。
- 政府資料開放平臺資料集為「集保戶股權分散表」，頁面為 `https://data.gov.tw/dataset/11452`。產品與文件應顯示原資料提供機關與政府資料開放授權條款；鏡像 repository 另列為傳輸來源。
- 鏡像 repository 的 GitHub Actions 每日嘗試下載 TDCC 官方 CSV，只有偵測到新快照才提交。這能縮短初始歷史回補時間，但不能取代最新官方資料、官方歷史表單或逐列衝突檢查。
- 第一版只允許 2026 近期期別；明確排除 repository 中來源鏈不同且不連續的 2021 快照。

## 固定來源與自動化邊界

- 審查日期：2026-09-02（Asia/Taipei）
- Repository：`https://github.com/wirelessr/tdcc-opendata-archive`
- Immutable commit：`17944774a7a37c8ef52a7ca919817fe6f949891c`
- Manifest version：`tdcc-archive-2026-v1`
- Validator version：`tdcc-archive-validator-v1`
- Normalization version：`tdcc-official-distribution-v1`
- 唯一允許 host：`raw.githubusercontent.com`
- 唯一路徑模板：`/wirelessr/tdcc-opendata-archive/17944774a7a37c8ef52a7ca919817fe6f949891c/snapshots/2026/YYYY-MM-DD.csv`
- 禁止 query、fragment、redirect、浮動 `main`、環境變數 URL、UI URL、request URL 與任意 payload 注入。
- 初始 run 必須先下載並驗證 manifest 全部檔案，任何一檔失敗時不得開始正式表寫入。

## 2026 初始 allowlist manifest

| 資料日期 | bytes | SHA-256 |
|---|---:|---|
| 2026-04-30 | 2,313,365 | `e2b69495d5b85cdd65ecf76bd6b0ff24367a2fd3e66232a801c6b776429189cb` |
| 2026-05-08 | 2,315,913 | `d533d882abda9385ab673f043e9bf5e3d2841b1c46ecd6aba36f40434f4314d9` |
| 2026-05-15 | 2,318,612 | `7d4784474befaac31a6825a94d683e6f70afd018f76dfc69b9880a8feca8e8be` |
| 2026-05-22 | 2,320,402 | `0719b26960e1674fa24d63efca21a5225b2587990dcdb4f01c4d81610228a603` |
| 2026-05-29 | 2,322,238 | `3f84eb6a66414caf74919ba524a441ef529c150e4177ea640de7f19b06956575` |
| 2026-06-05 | 2,325,870 | `94661f633f29adae7f80627394d65223da1e7ffd0edbf5a188f04dfe52f516ee` |
| 2026-06-12 | 2,327,129 | `760a9178a06f7258d2874715ec22719e5bb3c58484184eb7a30dcb9a54a61232` |
| 2026-06-18 | 2,328,229 | `1e643f3dd3f1bb43d48d7168e59dc0d5edcdbe42ad22480a5bf26dfa27c8dc77` |
| 2026-06-26 | 2,332,634 | `8ea48f27b213ceb3a1b35838ac48701fe10b63df437fa82c032529c846a94c2c` |
| 2026-07-03 | 2,333,431 | `a01634970798cb2ff6ba531aff80336a540232ce18a6fd4d333001a0d8548d0e` |
| 2026-07-09 | 2,334,523 | `f7b62180e119bd79b81da38c3e227aaddd8e98998db9aa7da6b269a4d2a7c5a6` |
| 2026-07-17 | 2,338,672 | `7e88da9a8cbff7e5a4bcaebce57a955ce4bb8120c595d61105411fdb019987d7` |
| 2026-07-24 | 2,341,148 | `91867bb70afebf5a6b7c3eb7cab86928875bf854a79f6d6dcc4496729d8b0a54` |
| 2026-07-31 | 2,344,332 | `7ad5886e994418975b72e100be97d8782e8ed320e5428fc253d5817e886aaf44` |
| 2026-08-07 | 2,347,711 | `c7cb74ae2e093ac145bfb9d5b2b153069b7f1e1f5e9603f8dec882d72ccc9ad6` |
| 2026-08-14 | 2,348,999 | `6098051708b362ac0215606174d539c40cac91902467b83f4c9da471a19adf8c` |
| 2026-08-21 | 2,352,208 | `4582e2ed52cc4fd48c4f7f6f858291f2c2937fbfa3084c3d44dc58f202eaeaa1` |
| 2026-08-28 | 2,359,165 | `95960f0f828ade074a2e817ce42202488fd3e53522e07b8b8656ff0f469b3dd1` |

完整 URL 一律由固定 commit、固定目錄與 manifest date 組合，不在設定或 request 中保存可覆寫 URL。

## 發布日期語意與驗證

- 實際資料期別只信任 payload 的 `資料日期`，不由檔名、星期或資料集 metadata 推算。
- 最新 manifest period 必須在同一次 operator prepare 中與 TDCC 官方 OpenAPI canonical 全市場列完全相同。
- 歷史 period 若與資料庫既有官方列重疊，必須逐商品比較 material hash；不一致時整期不得 finalize。
- 證券代號必須先移除 TDCC padding，再依當期受支援母體映射成 `.TW` 或 `.TWO`；不得一律假設 `.TW`。

## 授權、顯名與資料保存

- UI／API 的可讀來源說明須包含 TDCC 原資料提供機關、政府資料開放授權條款與 verified archive transport。
- Repo 只提交 manifest、驗證器、最小合成／去識別 fixture 與非敏感 receipt evidence；不提交約 2.3 MB／期的原始 CSV、staging DB、cookie、token、秘密或個人資料。
- 若鏡像不可用或驗證失敗，既有 verified rows 保持可讀，官方 OpenAPI／history lane 繼續補真正缺口。
