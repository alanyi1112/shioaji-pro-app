# 舊版盤後尾端復原：被新版取代的退役結案

日期：2026-10-15，Asia/Taipei。使用者明確要求：「以被新版取代的退役方式結案，先同步主規格再歸檔，不影響現有服務與排程，先不要 commit 或 push。」本文件記錄該決議，不追認舊案尚未完成的實盤驗收。

## 結案性質

- 結案狀態：`retired_superseded_by_design`，不是 `live_acceptance_passed`。
- 原任務 14／15；5.3 保留未勾、未通過，因新規格取代而取消後續追驗，不偽造 15／15。
- 取代案：[simplify-intraday-relative-volume-runtime](../../2026-10-15-simplify-intraday-relative-volume-runtime/verification.md)；正式執行契約為 [intraday-monitor-daily-runtime](../../../../specs/intraday-monitor-daily-runtime/spec.md)。本文件搬入 archive 後以上連結指向同日已歸檔相依案及正式規格。
- 本次退役只結束舊 OpenSpec 目標與後續驗收待辦；不是停服務、卸載排程、刪除相容工具或修復上游漏送根因的操作。

## 契約遷移

| 舊版目的或條件 | 退役後處置 |
| --- | --- |
| v1 全日 capture、固定雙抓／ticks 與 Stage replay 作日常必要條件 | 由 daily v2 獨立基準取代；不再為取得日常成功而執行舊鏈路 |
| 最多 4 檔、各至多 5 分鐘的舊受限 derived acceptance | 僅用於舊 artifact 的歷史解讀或另經明確要求的 legacy diagnostic，不自動轉成新版通過 |
| 新版日常產品尾筆例外 | 只依現行版本化政策：固定 160 檔中最多 10 檔且只能缺 canonical 13:30；其餘 Gate、完整 v2 來源與原比較版本不可省略 |
| 原 live partial／failed、盤後來源與通知權限 | 全部保留；新版產品判定、盤後補算、下一日基準與原 live 完整性分開呈現，不補發即時通知 |
| 5.3 真實自動時序驗收 | 未通過而退役，不再為舊目標安排交易日工作；不得改寫為已取得原生時序證據 |
| 舊程式、歷史 API／UI、已載入服務及排程 | 本輪不修改、不刪除、不卸載；若日後需要實體清除，另立明確變更與安全遷移 |

## 主規格同步方式

同步 `intraday-monitor-postclose-tail-recovery` 與 `intraday-stock-selection-workspace`。前者明列退役狀態及歷史適用範圍，再保留舊分類／來源／資格／權限四項契約；後者將舊 v1 復原的 UI provenance 限定為歷史／明確診斷用途。現行 daily「最多 10 檔、僅缺 13:30」及原產品例外呈現要求不被覆寫或收緊。

此處的 MUST 保護歷史資料與相容性，不授權重新啟用舊自動採集。v2 也不會被標成已做 v1 雙抓或獨立 ticks 總量對帳。

## 原證據完整保留

三份歷史驗收文件不改寫，歸檔前後 SHA-256 相同：

| 文件 | SHA-256 |
| --- | --- |
| `functional-2026-10-04.md` | `91babc2876e8fd7701448a6c7f5d4494161573356f002d779d8b99ed35cd1d8d` |
| `offline-implementation-2026-10-02.md` | `aee944806410f1ef802e78e22d5755af484ff8c1556709014934630ee2aa810e` |
| `source-contract-audit-2026-10-02.md` | `c921d5ef49de11aec42df3ce0fa7d92133924fc63340b926a970865e7e48d95f` |

原 9/16 capture 不完整、10/2 整批 13:30 缺漏、首次寫入失敗、原 live／derived 資格 false 與 5.3 尚未通過的文字均保留。原 AppSupport capture、SQLite、claim／receipt、盤後基準與衍生結果不修改；歸檔不是對歷史原始資料重新發布或再驗收。

歷史文件內的相對路徑反映當時 active change 位置；目前對應的整體紀錄仍可由 repo 的 `docs/acceptance/2026-10-04-monitor-next-session-preparation.md` 與 `docs/acceptance/2026-10-04-wip-functional-acceptance.md` 查閱，不為修正歷史連結而改寫原驗收文件。

## 安全查核與驗證邊界

- 本次只對 proposal／design／tasks／delta／主規格與結案清單做文件修改，並搬移 change 目錄；不改任何 `src/`、`scripts/`、Vite、套件或 LaunchAgent。
- 變更前已保存 1,009 個程式／設定檔、14 份現有 RealTimeStock LaunchAgent、三份歷史驗收文件、Web 971／API 83566／MultiView 977 及 Git HEAD／staged 錨點；歸檔後核對前後不變。這只證明本輪前後，不代表全日服務從未換代。
- 本輪不呼叫下載器、baseline／recovery writer、broker API、SSE、login／subscribe、通知或交易，也不重載瀏覽器。無服務／排程生命週期操作。
- 文件變更只執行 OpenSpec strict、同步內容一致性、完整文件搬移、`git diff --check` 與新文字 whitespace 檢查；不以本次文件檢查宣稱新增實盤驗收，也不重跑不相關全量測試。
- Git 保持原 HEAD、staged 空白，未 commit／push；其餘三個 active changes 與所有其他 dirty work 保留。

結案後 active changes 應只剩跨日修復、晚開機補啟動及動態名單；本案獨立退役不替它們完成尚缺的真實條件。
