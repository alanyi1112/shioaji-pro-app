## Context

`StockScreenerPanel` 目前在單一表單中依序渲染 14 組條件；除了前兩組基本條件外，其餘條件均以完整 `fieldset` 顯示參數與說明。表單下方又同時顯示結果設定、完整 readiness／日期／涵蓋率證據、目標 K 線圖控制及長篇計算口徑，因此在窄面板或較大字級下需要大量垂直捲動。

既有狀態已區分尚未提交的 `draft`、最後成功提交的 `applied` 與後端 `response`。本次變更應只重組 UI 與新增暫時性的展開狀態，不得改變 criteria 正規化、fingerprint、偏好版本、API 查詢、immutable snapshot 或圖表連動契約。

## Goals / Non-Goals

**Goals:**

- 讓使用者能快速辨識已啟用條件及主要參數，並在較短的面板中編輯單一條件。
- 明確區隔「展開查看」、「啟用條件」及「提交篩選」三種動作。
- 提供可復原且不影響既有結果的「全部取消」草稿操作。
- 將完整資料期間與方法說明收合，同時保留會影響結果可信度的主要狀態與警告。
- 維持鍵盤、螢幕閱讀器、窄面板、特大字級與面板內捲動可用性。

**Non-Goals:**

- 不新增、刪除或改寫任何篩選條件及其公式、合法範圍或預設參數。
- 不變更 v5 preference schema、criteria fingerprint、API request／response 或後端資料收集流程。
- 不改變 readiness、stale／partial 判定、結果可操作性、加入清單或 K 線圖連動語意。
- 不啟動來源抓取、Shioaji session、行情訂閱、runtime 管理或交易寫入。

## Decisions

### 1. 採受控的兩層手風琴，不使用下拉式單一條件選擇器

條件先分為「基本條件」、「技術型態」與「籌碼／價量」三組，每組摘要顯示已啟用數量；組內每一條件以固定順序顯示一列摘要。使用 `button`、`aria-expanded`、`aria-controls` 與具標籤的 region 建立受控手風琴，同一時間只渲染一組條件的完整設定。

初始 active condition 取 draft 中第一個已啟用條件；若全部停用，使用成交量條件。相對應群組展開，其餘群組收合。套用 preset 後重新定位至該 preset 第一個已啟用條件；「全部取消」後回到成交量條件，讓使用者可立即開始新草稿。

相較於 14 個同層原生 `details`，兩層分組能進一步減少未使用條件占用高度；相較於 select／dialog 編輯器，仍保留條件的可掃讀性與現有表單心智模型。受控按鈕也能避免 checkbox 與 `<summary>` 點擊事件互相觸發。

### 2. 展開狀態與篩選狀態完全分離

新增 `activeConditionId` 及由它推導的展開群組；這些狀態僅存在於元件生命週期，不寫入 localStorage，也不進入 `effectiveCriteriaV5` 或 fingerprint。點擊條件名稱只改變 active condition，不會修改 `enabled`；由停用切換為啟用時，才同時把該條件設為 active，方便立即設定參數。停用目前展開條件不強制關閉，以便檢查或修改保留值。

此選擇避免因 UI 偏好造成查詢語意或 preference migration 改變。重整頁面後依既有 draft 重新推導展開位置即可。

### 3. 以集中式條件描述表產生群組、標題、啟用狀態與摘要

建立型別安全的條件 metadata／helper，固定 14 個 top-level condition key、群組、中文名稱、讀取 `enabled` 的方式及精簡摘要 formatter。摘要只格式化目前 draft 的既有值，例如「3 倍」、「KD-K · 底背離」或「近 20 日」，不得重新計算或改寫 canonical criteria。

所有摘要在空間不足時允許視覺截斷，但完整名稱、啟用狀態及摘要必須透過可存取名稱或同列文字取得。條件控制沿用既有 `aria-label`，避免破壞自動化與輔助技術定位。

### 4. 「全部取消」只改寫 top-level draft enabled flags

集中式 helper 以不可變更新將 14 個 top-level condition 的 `enabled` 設為 `false`，但保留門檻、週數、模式、period、turnover 子設定與其他參數。此動作不呼叫 `run`、不保存 preference、不清除 `applied`、`response`、results、pagination 或圖表 selection。

按鈕在沒有任何 draft enabled condition 時停用。執行後顯示禮貌型 status：「已取消 N 個草稿條件；目前結果尚未變更」，並沿用既有 invalid state 阻止「開始篩選」。之後使用者重新啟用條件時，原先參數仍可沿用。

不提供確認 dialog，因為此操作只修改尚未提交且保留參數的草稿；明確回饋與既有提交閘門已提供可逆性。

### 5. 重新安排條件摘要、結果設定與提交動作

表單頂部保留 preset，並加入「已選 N 項」、已啟用條件摘要與「全部取消」。條件組之後顯示可收合的「結果設定」，摘要列至少呈現 AND／OR、結果狀態、排序欄位與方向；其完整 select 控制仍使用既有 draft state。

「開始篩選」、驗證錯誤與「條件尚未套用」保持在表單主要流程中，不藏入收合內容。這可降低高度，又不會讓使用者在提交前看不到 query 的關鍵狀態。

### 6. readiness 採主要訊息常駐、證據細節收合

狀態區永遠顯示目前 state、錯誤、主要 reason，以及 expected／effective 不一致、來源離線、stale／partial、跨市場未完成等會影響結果可信度或操作性的警告。已套用條件改為「已套用 N 項」加精簡摘要，完整條件字串可在同一詳情區查看。

日期 anchors、TDCC 歷史窗、技術範圍、coverage、counts、逐條件缺漏與 snapshot time 放入預設收合的「資料範圍與完整性」。內容仍由既有 response 直接產生，收合只改變呈現，不得省略、推導或改寫證據。

頁尾長篇規則放入預設收合的「計算口徑與資料來源」。目標 K 線圖與新增圖表控制移到結果區上方的緊湊工具列；沒有可用圖表時的指引仍保持可見。

### 7. 驗收以 DOM、鍵盤流程與高度改善共同證明

單元測試涵蓋條件 metadata、第一個 active condition、摘要與全部取消 helper。Browser tests 在既有窄面板案例上增加：預設展開、只開一個條件、展開不啟用、啟用自動展開、preset 定位、全部取消保留參數與舊結果、readiness 主要警告常駐，以及詳細證據可展開。

以 600 CSS px 高、最小允許寬度與特大字級執行鍵盤流程；確認面板沒有水平 overflow、焦點不被收合內容吞掉，且從頂端抵達「開始篩選」所需的捲動高度明顯低於變更前固定 fixture。高度檢查只用於 UI 回歸，不取代語意與可存取性斷言。

## Risks / Trade-offs

- [收合後使用者忽略已啟用條件] → 在頂部與各群組摘要顯示已選數量，條件列持續顯示 enabled 狀態及主要參數。
- [展開與 checkbox 點擊彼此誤觸] → 使用分離的 checkbox 與 accordion button，並以受控狀態處理，不把 checkbox 放進 `<summary>`。
- [條件 metadata 與 criteria schema 漂移] → 以完整的 typed key 清單與測試保證 14 個 top-level condition 全部被摘要、計數及全部取消涵蓋。
- [重要資料警告被藏入詳情] → 定義常駐的 critical summary，expected／effective mismatch、來源錯誤與 stale／partial 永不只存在於收合內容。
- [已收合控制因 unmount 失去瀏覽器輸入狀態] → 所有值均由 React draft 控制；切換 active condition 後重新渲染必須還原相同值，並以測試驗證。
- [CSS sticky 或絕對定位遮蔽內容] → 不新增覆蓋內容的固定 footer；維持單一面板內捲動與正常文件流。

## Migration Plan

1. 先加入條件 metadata、摘要及 immutable 全部取消 helper 與單元測試。
2. 將既有條件控制逐組移入 accordion body，保留原有 label、值、驗證與 update callback。
3. 重整狀態、結果設定、目標 K 線圖與說明區，補齊 browser tests。
4. 執行 TypeScript、相關 Vitest/browser tests、`git diff --check` 與 OpenSpec strict validation。
5. 以既有 v5 preference、長線佈局 preset、ready／partial／stale／offline fixtures 做窄版實際 DOM 驗收。

若回歸，可還原呈現元件與 CSS；因未遷移 preference、資料或 API，不需要資料 rollback。

## Open Questions

無。群組、初始展開規則、全部取消語意與主要警告常駐策略均已在本 change 固定。
