## Context

9/16 TPEx 曾回 invalid_source_payload，官方回應恢復後仍卡在 invalid。既有 operator 有共同 lease、每日失敗預算與 15 分鐘 deadline。

## Goals / Non-Goals

目標為指定今日交易日的一次性恢復；不改自動排程的 invalid 規則、不解除 blocked 或 rate limit、不改 broker／服務生命週期。

## Decisions

以 --recover-invalid-session=YYYY-MM-DD 明確啟用；僅當日期等於 expected 與台北今日、原 phase=invalid、冷卻到期、publication budget 未耗盡才接受。沿用 operator lease，以 screener_runs 新增唯一日期 receipt，保存原 readiness 與 hash；INSERT 唯一鍵先消耗機會，失敗／中断不刪除。只在當次記憶體允許 publication probe，不直接重設持久化狀態；沿用雙市場嚴格驗證與原發布管線。

## Risks / Trade-offs

- 中斷也消耗機會 → fail closed，保留 receipt 供人工追查。
- 其他資料集缺期仍阻擋結果 → 分列 readiness 成功與 snapshot 發布狀態，不偽造 ready。
- 大型混合工作樹 → 以完整相依整合批次驗證，不為拆 commit 製造壞的中間狀態。
