## 1. 條件呈現模型與純函式

- [x] 1.1 建立涵蓋 14 個 top-level condition 的型別安全 metadata，定義固定順序、基本／技術型態／籌碼價量群組、中文名稱與 enabled 讀取方式。
- [x] 1.2 實作條件與群組精簡摘要 formatter，確保摘要只讀取現有 draft 且不正規化、重設或修改 criteria。
- [x] 1.3 實作初始 active condition／群組推導及 immutable「全部取消」helper；只停用 top-level enabled flags，保留所有參數與 turnover 子設定。
- [x] 1.4 為 metadata 完整性、固定順序、第一個已啟用條件、無啟用 fallback、摘要及全部取消參數保留補齊單元測試。

## 2. 緊湊條件編輯介面

- [x] 2.1 在 `StockScreenerPanel` 加入非持久化的 active condition 狀態，實作三個群組的受控 accordion 與同一時間唯一完整條件設定。
- [x] 2.2 將既有 14 組條件控制移入對應 accordion body，保留原本的值、合法範圍、disabled 規則、`aria-label`、驗證與 draft update 行為。
- [x] 2.3 實作「展開不啟用」、「啟用時自動展開」、「停用仍可檢查保留值」及重整後由 draft 推導第一個 active condition 的互動。
- [x] 2.4 在頂部加入已選數量、已啟用條件摘要與「全部取消」；無已選條件時停用按鈕，執行後顯示取消數量與舊結果未變的 status。
- [x] 2.5 調整「長線佈局」preset，使其保持既有 criteria 內容、只更新 draft，並把 active condition 定位至 preset 第一個已啟用條件。
- [x] 2.6 將 mode、result state、sort 與 direction 整理為可收合的「結果設定」與目前值摘要，同時保持「開始篩選」、驗證錯誤及尚未套用狀態直接可達。

## 3. 資料證據與結果工具列分層

- [x] 3.1 將 state、主要 reason、expected／effective mismatch、stale／partial、離線及逐市場未完成整理為不需展開即可看見的主要狀態摘要。
- [x] 3.2 將完整已套用條件、日期 anchors、TDCC 歷史窗、技術範圍、coverage、counts、逐條件缺漏及 snapshot time 移入鍵盤可展開的「資料範圍與完整性」，不刪減或改寫既有 response evidence。
- [x] 3.3 將長篇計算口徑與來源說明移入「計算口徑與資料來源」，保留既有來源與安全警語。
- [x] 3.4 將目標 K 線圖與新增圖表控制移至結果區上方的緊湊工具列，保留無可用目標指引、selection generation 與同頁圖表隔離行為。
- [x] 3.5 更新 Vanilla Extract 樣式，使群組／條件摘要、展開 body、狀態詳情與結果工具列在正常文件流中緊湊排列，並避免 sticky 覆蓋、水平 overflow 與 workspace 拖曳誤觸。

## 4. Browser 驗收與回歸

- [x] 4.1 補上預設只展開第一個已啟用條件、群組計數、單一 active condition、展開不啟用及啟用自動展開的 browser tests。
- [x] 4.2 補上長線 preset 定位，以及全部取消保留參數、停用提交、不發 request、不清除已套用結果與重新啟用還原值的 browser tests。
- [x] 4.3 補上 ready、partial、stale、expected／effective mismatch 與 offline fixtures，驗證主要警告常駐且完整證據可由鍵盤展開。
- [x] 4.4 在 600 CSS px 高、最小允許寬度及特大字級執行純鍵盤流程，驗證焦點、可存取名稱、面板內捲動、無水平 overflow，並以固定 fixture 比較「開始篩選」前的垂直占用確實縮短。
- [x] 4.5 執行相關 Vitest/browser tests、TypeScript 檢查、`git diff --check` 與 `openspec validate compact-stock-screener-condition-panel --strict`，記錄實際通過結果及任何未完成的 live UI 驗收。

### 驗證紀錄（2026-09-22）

- `pnpm exec vitest run src/lib/stock-screener-condition-ui.test.ts`：5 項通過。
- `pnpm exec vitest run --config vitest.browser.config.ts src/components/stock-screener-panel.browser.test.ts`：22 項通過。
- `pnpm exec tsc --noEmit --project tsconfig.app.json`：通過。
- `pnpm build`：通過；僅保留既有的大型 chunk 警告。
- `git diff --check`（本 change 範圍）：通過。
- `openspec validate compact-stock-screener-condition-panel --strict`：通過。
- 本機 `127.0.0.1:5173/?layout=stock-screener` live UI：已確認預設基本條件展開、技術型態群組可切換、群組互斥、同時只有一個完整設定區，且收合式結果／證據區塊正常呈現。
- Repo-wide `pnpm test`：本 change 相關測試皆通過；另有既存／其他進行中 change 的 3 項 Fibonacci 0.5 線舊預期失敗，以及 `scripts/maintenance-run-receipt.test.mjs` 無 test suite，未納入本 change 修正範圍。
