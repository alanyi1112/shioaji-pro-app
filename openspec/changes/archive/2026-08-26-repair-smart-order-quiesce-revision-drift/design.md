## Context

目前 live sidecar 的 authenticated diagnostics 顯示零 obligation、`writeMaster=disabled` 且 graceful stop 可執行，但 quiesce 回傳 `400 invalid_request`。D1 證據顯示同一 runtime epoch 先以 revision 0 啟動，之後 continuity gap 將 repository revision 前進為 1；`quiesceRuntimeEpoch` 卻要求 controller 提供的 `expectedRevision` 必須完全等於 repository revision，造成安全收斂操作被舊 revision 永久鎖死。

## Goals / Non-Goals

**Goals:**

- 相同 current epoch／sender fence／API generation 下，允許 quiesce 使用 repository 當下 revision 收斂至 `quiescing`。
- SQL update、operation identity、journal 與回傳 revision 使用同一個 repository source revision。
- 保留 operation conflict、epoch drift、非法 state 與 obligation 的 fail-closed 行為。

**Non-Goals:**

- 不放寬 broker write、production 或真實下單邊界。
- 不提供 force bootout 或跳過 durable stop completion。
- 不允許一般業務 mutation 忽略 stale revision；例外只限單向關閉權限的 lifecycle quiesce。

## Decisions

### Repository current revision 是 quiesce 的權威 source revision

transaction 已先驗證 `current_runtime_epoch_id`、`current_sender_fence` 與 `current_api_generation`，並重新讀取同一 row；quiesce 只會暫停策略、撤銷 rearm 並關閉 dispatch。對此單向安全收斂操作，controller 傳入 revision 只作觀測資訊，不再作為拒絕條件；實際 SQL CAS 仍綁定 transaction 內讀到的 `current.revision`。

### 其他 lifecycle fence 不放寬

若目前已是 `quiescing`，operation 必須相同且 durable operation identity 必須有效；若 state 不在 `reconciling`、`observe_only`、`ready`，仍拒絕。transaction 中任何 strategy／rearm CAS 或最終 runtime CAS 失敗仍整筆 rollback。

### 一般應用服務與 smart-order Node runtime 分離

`NODE_BIN` 保留為 smart-order 的持久化安全 runtime，必須符合 Node LTS `>=24.15.0 <25`、private file 與 resolved absolute path 合約。Web、MultiView、business watchdog、PE 與 TDCC pipeline 改用 `APP_NODE_BIN`，預設由各 LaunchAgent 的 PATH 解析，亦可透過 `REALTIME_STOCK_APP_NODE_BIN` 明確指定。如此可讓需要讀取 `Documents` source tree 的服務使用已取得 macOS 權限的系統 Node，同時避免 sidecar 被不支援的 Node 26 啟動。

任何 smart-order diagnostics、repository probe、mode lease、launch agent installer 與 sidecar entry 均不得改用 `APP_NODE_BIN`。

## Risks / Trade-offs

- [controller revision 落後可能隱藏其他變更] → 只允許相同 epoch／sender fence／API generation，並由 repository 重新計算完整 lifecycle projection；任何 obligation 仍阻止 drain。
- [並行 quiesce] → SQLite transaction、runtime row CAS 與 durable operation identity 保持冪等與衝突拒絕。
- [舊 sidecar 無法自行載入修正] → 修正通過測試後仍須依現有 fail-closed 政策處理首次升級，不把 force restart 寫入一般流程。
