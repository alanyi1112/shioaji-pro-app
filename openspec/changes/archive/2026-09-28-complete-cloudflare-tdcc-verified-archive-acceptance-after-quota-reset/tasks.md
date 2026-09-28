## 1. 額度恢復與安全基線

- [x] 1.1 唯讀確認 Cloudflare D1 免費額度、寫入能力與相關限制已恢復；若仍受限則停止，且不執行 migration、seed、workflow dispatch 或資料寫入
- [x] 1.2 記錄當時 Cloudflare 正式站 deployment ID、exact source SHA、Access 邊界與 protected health，不沿用本 change 建立前的舊版本證據
- [x] 1.3 保存 Cloudflare D1 schema／migration、period dates、row／symbol count、bytes／page count、continuous target／remaining／failed／overdue 與 `PRAGMA integrity_check` 基線

## 2. Cloudflare migration 與 verified archive

- [x] 2.1 以 1.2 的 exact release 對 Cloudflare D1 套用 additive migrations 與 verified manifest seed，核對 manifest version、validator version、immutable archive commit 與逐 period hashes
- [x] 2.2 fresh dispatch `cloudflare-tdcc-verified-archive-bootstrap.yml`，核對固定 2,330 檔 universe、18 期 receipts 與 `target=processed=18`、`remaining=failed=overdue=0`、`complete=true`
- [x] 2.3 以 protected readback 與 D1 查詢核對 staging-first、insert-only、官方資料優先、衝突 fail closed、row／symbol 守恆與 `PRAGMA integrity_check=ok`
- [x] 2.4 執行 bounded official history 補缺，分列 archive complete 與 official 51 週 expected／completed／remaining／failed／overdue，不重抓已完成 dates

- [x] 2.5 依2026-09-17最新要求重訂實際餘額逐批補檔計畫，取消每日一期操作限制，區分D1計費列、TDCC來源節流與批次估算，更新多時段排程並核對實際next_run_at
- [x] 2.6 取得涵蓋前一批且一致的全帳戶用量／Row Metrics，依新gate驗證同日串行續批，記錄prepared及未prepared批次實際成本，不以排程更新冒充實測完成

## 3. Protected API 與 DB-only warm path

- [x] 3.1 以 Cloudflare protected health 核對 deployment SHA、migration、archive receipt、official coverage、failed／overdue 與 bounded missing dates
- [x] 3.2 對 8103、代表性 `.TW`、`.TWO` 與 ETF 執行 fresh protected shareholder-distribution API，核對日期、17 級距、provenance、archive／official weeks 與實際最新數值
- [x] 3.3 將先前不在 owner 個人清單但已有多期 D1 rows 的商品加入後，驗證 fresh no-cache request 回 `cache.mode=d1_hit`、provider calls 為 0，且快速顯示多期持股資料
- [x] 3.4 對零期或一期商品核對 partial／準備中文案與 bounded 背景 handoff，不得產生假歷史、錯誤週變化或未受控 request

## 4. Cloudflare Access owner UI 驗收

- [x] 4.1 在已登入 Cloudflare Access 的 owner 身分瀏覽器核對 8103、代表性 `.TW`、`.TWO` 與 ETF 的商品選擇、日期、狀態文案、大戶／散戶週變化與最新數值
- [x] 4.2 逐商品核對大戶與散戶主 canvas 可見、CSS／bitmap 尺寸非零，並驗證重整、切頁與新增商品後不消失
- [x] 4.3 核對 console 無相關 warning／error，browser network 無 TDCC open data、archive GitHub／raw、FinMind、TWSE、TPEX 或其他非預期外部 request
- [x] 4.4 若 Access 仍停留在 passkey 或其他人機驗證，保留未完成狀態並請使用者在原頁完成；不得讀取 cookie／token、繞過驗證或使用 machine bypass／`SAMPLE` 冒充 owner UI

## 5. 證據、測試與收尾

- [x] 5.1 將 Cloudflare fresh exact SHA、receipts、D1 守恆、protected health／API、DB-only warm path、DOM／canvas／console／network 的非敏感證據寫回繁體中文 `verification.md` 與 tasks
- [x] 5.2 執行完整 `npm test`、lint、type／build、migration suites、`openspec validate --all --strict` 與 `git diff --check`
- [x] 5.3 驗收前後唯讀核對 simulation API、business-session watchdog、5173、5174、daily／TDCC／PE pipeline 與行情連線保持原狀，production、真實下單與 CA 維持停用
- [x] 5.4 精準盤點 archive／commit／push／deployment scope，排除秘密、大型 CSV、SQLite、logs、screenshots、exports、產生物與無關 dirty work；各動作仍依獨立授權執行
