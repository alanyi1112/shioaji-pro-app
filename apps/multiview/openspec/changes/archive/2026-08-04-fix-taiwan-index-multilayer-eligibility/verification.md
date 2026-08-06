## 驗證摘要

- 精確程式版本：`1887d73b0454062f2fdce37161605b89501c4001`。
- Sites 保留站版本：173。
- 發布網址：`https://quote-chart-multiview.alanyi1112.chatgpt.site/`。

## 自動化驗證

- `node --test tests/subchart-interaction.test.mjs`：28／28 通過。
- `npm test`：build 成功，392／392 通過。
- `npm run lint`：成功，0 warnings。
- `openspec validate --all --strict`：38／38 通過。
- `git diff --check`：成功。

## Sites 保留站瀏覽器驗收

- 「台股」頁籤四圖包含 `^TWII`、`00919.TW`、`00878.TW`、`00929.TW`，主圖、單一副圖、多層副圖三個選項皆可用。
- 選擇多層副圖後，全域模式為 `multi` 且使用 document scroll；`^TWII` panel 採 `is-mode-a-technical`、籌碼 pane 為 0。
- 同頁三支 `.TW` 商品皆採 `is-mode-b`，每個 panel 建立 12 個籌碼 pane。
- 一圖時多層副圖選項可用；若當頁可見商品為 `^TWII`，該 panel 仍安全降級為單一技術副圖。
- 六圖與八圖均強制 `single`，主圖與多層副圖選項 disabled、document scroll 關閉，`is-mode-b` slot 為 0。

## Cloudflare 正式站部署與驗收

- 正式站先前部署的 `5b6fe047131beefe6e10ee892508fa997f5ee662` 尚未包含本次 allowlist 修正，因此具有相同的台股市場指數誤判風險。
- GitHub Actions run `30908979108` 以 `workflow_dispatch` 發布精確 commit `3aadaa88ee4c820c01f3c2d1e17091a28495ed38`，Cloudflare version ID 為 `0357aacc-694a-4e36-b032-53ed65198f54`。
- 遠端 gate 為 lint 成功、`npm test` 392／392、OpenSpec strict 37／37、Free-tier budget、Wrangler dry-run、無待套用 D1 migration、匿名 Access 邊界 `302` 及 protected health exact-commit smoke 全部通過，未觸發 rollback。
- 既有授權 Chrome session 實測台股四圖可使用多層副圖；四個 `.TW` panel 均採 `is-mode-b` 且各建立 12 個籌碼 pane。
- 六圖與八圖均強制 `single`，主圖與多層副圖選項 disabled、document scroll 關閉、`is-mode-b` slot 為 0；恢復一圖後多層副圖偏好正常回復，console error 為 0。
- 正式站當下台股第一頁未包含 `^TWII`，故指數 panel 的瀏覽器可見證據以同一程式在 Sites 保留站的 `^TWII + .TW` 驗收為準；正式 Worker 已部署包含 `isTaiwanMultiLayerCompatibleSymbol()` 的精確 commit。
