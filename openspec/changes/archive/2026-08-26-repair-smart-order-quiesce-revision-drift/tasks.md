## 1. Repository lifecycle 修正

- [x] 1.1 將 quiesce source revision 改為 transaction 內的 current repository revision
- [x] 1.2 維持 current epoch／sender fence／API generation、operation conflict 與 obligation fail-closed 邊界

## 2. 回歸驗證

- [x] 2.1 加入 continuity invalidation 後 stale expected revision 仍可安全 quiesce 的 repository 測試
- [x] 2.2 驗證不同 epoch／operation 與 blocked lifecycle 仍拒絕
- [x] 2.3 執行聚焦測試與 OpenSpec strict validation
- [x] 2.4 分離 application Node 與 smart-order persisted Node runtime authority
- [x] 2.5 補上 Web、MultiView、watchdog、PE/TDCC 與 sidecar Node 選擇合約測試

## 3. Runtime 安裝

- [x] 3.1 重新執行 authenticated graceful stop 與完整 runtime install
- [x] 3.2 驗證 simulation、watchdog、5173、5174、pipelines 與 TDCC 排程恢復
