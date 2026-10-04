# 工作承諾 writer 與證券 API 使用範圍（2026-10-03）

所有時間採 Asia/Taipei。本輪接續 8.4，整體 **35／42**；原始失敗、舊驗收及正式資料庫均未覆寫。

## 公開文件及使用者確認

使用者表示使用永豐金證券，個人用途不涉及提供憑證，並確認已線上簽署 [API 電子交易風險預告書暨使用同意書（證券）](https://www.sinotrade.com.tw/newweb/signCenter/S_openAPI/)。公開文件第 4 項談程式計算訊號、第 5 項談取得行情及相關資訊的風險、第 7／8 項談遵守約定及介面限制。使用者簽署狀態來自本人確認，本輪不查帳戶、不代簽，也不要求簽署截圖、帳密或金鑰。

[隱私權保護聲明](https://service.sinotrade.com.tw/newweb/Privacy/)的個人資料查閱，與本 change 的全市場歷史價量不是同一範圍；不能互相當來源授權。對本案既有 API 的個人本機分析，可將使用者確認、證券 API 文件與官方行情文件納入範圍審查。先前要求另行提供個人分析特別書面許可，並非該文件明訂的前置要求，這一要求不再作為阻礙；這不是公開再散布許可的法律結論。

本輪未寫 `localDisplayVerified=true` 或正式 source review，因完整技術 review／預算仍未齊；不能將簽署確認當作來源價格基礎、交易範圍、160 日覆蓋或發布驗收。後續應完成必要來源查證，不再把所有未完成一概歸因於缺少使用者法律文件。

使用者再次要求修正不必要限制後，已實際移除 Shioaji `validDailyQuotesReview` 與 `saveSourceReview` 的額外 `localDisplayVerified=true` Gate，不只修改說明。舊欄位仍原樣保存，但不能作為已授權 API 個人本機分析的額外阻礙；本機用途／固定端點、技術來源 review、單位、效期、母體、用量及 safety 仍保留，公開用途仍不在此功能範圍。官網來源仍獨立，不把 API 開通視為 TWSE／TPEx 任意網頁自動下載的同一契約。

先新增不帶展示許可旗標的回歸，在原程式重現 `false !== true`；修正後通過 parser 與 repository，舊 review 原值／hash 不改，官方來源的限制不被解除。這是對原設計額外要求的修正，不是偽造 true 或來源數值驗收。

## 程式修正

`saveScreenerBrokerCommitment` 接受背景工作自己提供的 actual observedAt、剩餘承諾、同 scope／quota identity 及來源證據 hash。只允許白名單欄位，未登錄、未知、過期、未來、非整數、錯身份或任意機密欄位均拒絕；complete 必須為零剩餘承諾。不由 writer 憑空填時間或 quota 證據。

- append-only `broker-consumer-observation:<hash>` 保存原始 payload；v2 head 只指向合法 immutable receipt。
- writer 核對目前資料庫正式配置，transaction 再綁定同一配置。配置換版時拒絕，不將 caller 的配置當正式配置。
- head CAS 防止並行覆蓋；倒退或同時刻不同內容拒絕，精確重跑 no-op。競爭落敗的 observation 保留，但不可宣稱 head 已更新。
- 既有 v1 head 在更新前另存原 payload；producer 同時支援原 v1 與新 pointer，缺 journal 或內容破損仍拒絕。
- 接口沒有 HTTP、帳戶查詢、broker login／subscription 或服務操作；尚未呼叫於正式各 consumer，不假稱完整 roster 已接妥。

首次先新增 writer 測試，因原模組缺少 `saveScreenerBrokerCommitment` export 而失敗；實作後 writer 測試通過，未將最初失敗隱藏。其後另補原 v1 archive 鍵破壞時不得抹掉唯一完整舊 head，writer 共 10 項。

## 真實本機唯讀核對

21:45:07.925 核對正式 SQLite，readOnly=true，以下八表全為 **0**：bollinger batches／daily、daily_quotes cache、source reviews／selections、daily profiles／publications、broker reservations。來源政策／預算政策／工作 head／observation 記錄亦未建立。

安全 Gate 使用既有 runtime：GET `/api/v1/info`、GET `/api/v1/health`、POST `/api/v1/data/snapshots`（只查 2330），合計 **3 HTTP**。確認 simulation=true、healthy、2330 Snapshot 合法及 generation 前後一致，business session 成立。generation 僅保存 hash `68b40818dbfa4fec89b114545d451b61071b0fefdd57f2cf2d15e3532a1ca169`，不列任何帳戶或憑證。

broker 歷史請求=0、正式 DB 寫入=0；沒有 login／subscription／order 呼叫。8080 PID 1273、5173 PID 933、5174 PID 938 listener 與前輪一致；本輪沒有重啟或停止任何服務。listener 不當作歷史準備或 publication 已成功。

## 回歸及未完成

Node 24.19.0：12 files／**165 tests** 通過；包含 writer 10、producer 6、ports 9、ledger 21 與來源／準備／保留／發布回歸。Vitest 8 files／**90 tests** 通過。本輪合計 **255** 項不重複測試，不把上輪測試再累加。前端及 MultiView TypeScript、OpenSpec strict、`git diff --check` 與本輪 10 個文字檔（包含 untracked）的 whitespace 檢查通過；本輪未重跑 build／browser，前輪證據另列而不冒充本輪。

task 8.4 仍缺各實際工作接線／完整 roster、可信額度週期與兩次獨立實測／正式配置；1.1／8.1 仍須完成技術來源 review，7.2–7.4／8.8 仍缺真實 160 日、watcher 自動發布及正式結果 UI。沒有勾 task、正式啟用、archive、commit 或 push，也沒有修改盤中監控、圖表／清單／交易草稿。
