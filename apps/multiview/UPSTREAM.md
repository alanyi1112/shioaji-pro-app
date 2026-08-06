# MultiView upstream provenance

## 固定來源

- Repository：`https://github.com/alanyi1112/MultiChartOnCodexSite.git`
- 遠端功能基準 branch：`codex/restore-cloudflare-small-group-login`
- 遠端功能基準 SHA：`ecae7cac837f06085801c96f3da0c570051d66e7`
- 授權整理 branch：`codex/license-local-integration`
- 匯入 SHA：`d6d7e0d64b928958f6b20523f39d8651ca584bae`
- 匯入日期：`2026-08-06`
- 匯入方式：從乾淨、隔離 checkout 的固定 commit tree 產生 `git archive`，解開至 `apps/multiview/`；未使用 sibling repo 的工作樹。

授權整理 SHA 的 parent 是遠端功能基準 SHA。該本機 commit 在本次匯入時尚未 push，但完整 commit tree、授權文件與 lockfile 已納入本 repo；正式發布來源 repo 前仍須由使用者明確要求 push。

## 授權

- MultiChartOnCodexSite 自有程式：`AGPL-3.0-only`。
- TradingView Lightweight Charts：v5.0.9，`Apache-2.0`；完整授權與第三方聲明保存在本目錄。
- 其他 dependencies：沿用各套件原始授權，精確版本由 lockfile 管理。

## 匯入排除範圍

- `.git/` 與任何本機 worktree metadata。
- `node_modules/`、`.next/`、`dist/`、`.vinext/`、`.wrangler/` 與生成的 `public/vendor/lightweight-charts.standalone.production.js`。
- `.env*`、`.dev.vars`、CA、token、帳戶資料、D1／SQLite state、log 與個人資料匯出。

原始 `.openai/hosting.json`、Cloudflare workflow、migration 與 pipeline 程式保留作為既有功能及資料語意的來源基準；本地整合不會執行 Sites／Cloudflare deploy，且 Shioaji 行情不得送往外部 runtime。

## RealTimeStock 本地修改

本 change 會在此固定 tree 上加入：

1. loopback-only 5174 local runtime 與 repo 外 D1 state。
2. Shioaji data-only adapter、台股即時 D／W／M overlay、來源模式及訂閱協調器。
3. 只允許日／週／月 K，停用 intraday。
4. 右鍵 OrderTicket bridge，且不加入任何直接交易能力。
5. 本機排程、備份、回復、健康檢查及安全驗證。

## Upstream 更新規則

不得在 build 或 runtime 自動追蹤 branch。更新時必須：

1. 從乾淨 checkout 取得候選完整 SHA。
2. 比較目前匯入 SHA 與候選的程式、schema、provider、授權、dependencies 及 OpenSpec 差異。
3. 重跑來源 repo 與 RealTimeStock 全部驗證。
4. 更新本檔 SHA、日期、差異摘要與 import revision 後，才能替換匯入內容。
