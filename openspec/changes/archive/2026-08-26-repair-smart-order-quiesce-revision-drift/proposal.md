## Why

智慧下單 sidecar 在 continuity gap 將 durable runtime revision 前進後，controller 的舊 revision 可能使 `quiesceRuntimeEpoch` fenced CAS 失敗；即使已認證、零 obligation 且 write master 關閉，runtime install 仍會永久 fail-closed，形成無法安全升級的 lifecycle deadlock。

## What Changes

- quiesce 在 runtime epoch、sender fence 與 API generation 均仍為目前權威時，以 repository 當下 revision 執行單向收斂，不因 controller revision 落後而拒絕。
- 不同 epoch／sender fence／API generation、衝突 operation、非允許 state 或任何 lifecycle obligation 仍維持 fail-closed。
- lifecycle operation identity、journal revision 與 SQL CAS 全部綁定 repository 當下 source revision。
- 加入 continuity invalidation 後以 stale expected revision 執行 quiesce 的回歸測試。
- 將 Web、MultiView、watchdog 與資料 pipeline 的 Node runtime 與 smart-order 安全核心分離，避免安裝器持久化的 Node 24 因 macOS Documents 權限阻斷 5173/5174，同時保留 sidecar 的 Node LTS 版本閘門。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `safe-local-runtime-mode-switch`: runtime install 的安全 quiesce 必須能在相同 durable epoch 發生保守 revision 前進後完成，不得要求強制 bootout。
- `safe-local-runtime-mode-switch`: runtime install 必須分離一般應用服務與 smart-order 安全核心的 Node 選擇，兩者任一失敗都不得降低交易安全閘門。

## Impact

- `scripts/smart-order-runtime/repository-worker.mjs` 的 runtime lifecycle transaction。
- smart-order repository／runtime controller 聚焦測試。
- 不改變 broker write、production、CA、帳戶或訂單資料邊界。
