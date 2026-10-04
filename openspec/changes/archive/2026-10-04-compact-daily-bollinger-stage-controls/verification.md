# 每日布林三階段控制驗證

## 範圍與日期

2026-10-04，Asia/Taipei。本次僅調整每日布林策略設定 UI、錯誤訊息與測試；不改公式、來源政策、排程、交易 Gate 或正式每日 profile。

## 自動產生時機

依 `scripts/stock-screener-bollinger-schedule.ts`，官方共同交易日 14:00 起進入到期範圍，由既有五分鐘 watcher 檢查。每日 profile 必須啟用；官方交易日／商品母體、當日與必要歷史資料、來源審查及有界流量預算成立後才能發布。14:00 是最早檢查時間，並非保證完成時間。來源未備妥時保留 pending／冷卻；同一發布鍵完成後休眠，不重複下載或發布。晚啟動以真實 late-boot 記錄處理，不冒充原時間執行。

背景發布與手動頁面查詢分開：畫面要列出結果，仍須啟用手動布林條件並按「開始篩選」。每日設定的收合或階段切換不觸發查詢／儲存／行情下載；只有明確儲存才送出 profile PUT。

## 自動測試

- 四份聚焦 unit／公式／API／gateway 測試：55/55 通過。
- 三份 Chromium component／面板測試：47/47 通過，含全選預設、既有部分選擇、停用設定重新啟用、深度複製、手動草稿隔離、空選擇阻擋、409／403 失敗不覆寫、320px、鍵盤及 busy 防重複操作。
- `tsc -b` 與 `vite build` 通過；build 保留既有 chunk 超過 500 kB 警告，不屬本次新增失敗。
- 本 change strict validation、`git diff --check` 與新檔 whitespace 檢查通過。

## 真實頁面驗證

使用既有 Chrome `http://127.0.0.1:5173/?layout=stock-screener`，不重載、不切換商品、不執行正式 profile PUT 或選股查詢。

- 初始每日策略預設收合，摘要為「已啟用 · 已存 3/3 項 · revision 1」。
- 展開後三個按鈕皆選取，條件附註可獨立展開，涵蓋實際門檻及當日／前期平均時間軸。
- 真實畫面 screenshot 與 DOM 尺寸核對：設定區 width／scrollWidth 均為 276px，沒有該區橫向溢出；三個 `aria-pressed` 均為 true。
- 將「正在壓縮」取消一次，只出現「每日階段尚未儲存；背景仍使用已存設定」；再選回並收合。未按儲存／停用／開始篩選。
- 操作後唯讀 GET 核對 profile 仍為 version 8、revision 1、enabled true，stages 為 compressing／preparing／breakout，與操作前摘要一致。
- 本輪 UI 操作只有展開、收合、local draft 切換；沒有發出下載器、交易、broker login 或訂閱操作。這是本輪操作範圍的證據，不宣稱共用頁面整段歷史網路紀錄全部零請求。

## 保留限制

原畫面「每日設定儲存失敗」缺少當時的 HTTP 紀錄，無法判定原失敗原因；HMR 保留原 React 訊息，不刪除失敗證據。本次改為分類 HTTP 錯誤與 timeout 不確定結果提示，不宣稱修復未取得證據的後端故障，也未放寬 local-write 安全檢查。

實際 PUT 成功／衝突／拒絕覆蓋由隔離 Chromium 測試驗證；為保護正式排程，本輪沒有改寫真實 profile，不能將 fixture PUT 當作新的正式儲存收據。

未歸檔、commit、push，未重啟或停止共用服務，無關 dirty work 保留。

## 結果標籤配色補充驗證（2026-10-04 15:27，台北時間）

- 使用者要求紅框內三階段名稱改醒目字色。本次僅將結果卡片的階段名稱拆成獨立 span：正在壓縮亮藍 `#75bdff`、準備突破金黃 `#ffd166`、今日正式突破亮紫 `#d5a6ff`，均 font-weight 700。股名、分類結果與資料不變，無法判定／未符合保留原語意且不套用符合色。
- 淺色主題對應深藍 `#075fae`、深金 `#935700`、深紫 `#7532a8`。第一次回歸發現原深金在 hover 背景僅 4.08:1，已加深並重測；未以失敗結果宣稱通過。
- 三份 Chromium 測試最終 53/53 通過，六種主題均驗證正常與 hover 背景對比至少 4.5:1、文字保留、三種字色不同、700 字重及點選 callback 不變，直接結果元件不發出 fetch。
- 真實既有 Chrome 選股頁唯讀 DOM 與 screenshot 核對 16 筆既有結果：14 筆壓縮 `rgb(117,189,255)`、1 筆準備 `rgb(255,209,102)`、1 筆突破 `rgb(213,166,255)`，均字重 700。畫面上 2426 鼎元的準備突破呈金黃、相鄰壓縮股票呈亮藍。未重載、查詢、切換商品或變更每日設定。
- `tsc -b`、此 change strict validation 與 `git diff --check` 通過；本輪未改篩選公式、排程或來源，不重啟服務，未歸檔／commit／push。

## 同步與歸檔

2026-10-04，使用者確認先同步主規格再歸檔。已將四項新增 requirement 同步到 `openspec/specs/daily-bollinger-stage-controls/spec.md`，再歸檔至 `openspec/changes/archive/2026-10-04-compact-daily-bollinger-stage-controls`，保留完整 artifacts、8/8 tasks 及上述成功／限制／失敗證據。

歸檔後 60 份主規格 strict validation 通過，diff 與新檔 whitespace 檢查通過。其餘五個 active change 仍有未完成任務，未歸檔；程式與無關 dirty work 保留，未 commit／push 或變更服務生命週期。
