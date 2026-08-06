## 1. Runtime 模式與 Web 唯讀邊界

- [x] 1.1 建立集中管理的 runtime mode 與交易寫入路徑模組
- [x] 1.2 在 Vite 加入 runtime mode endpoint 與 production-readonly 交易 API 403 guard
- [x] 1.3 在前端共用 API／風控層加入 production-readonly client guard 與狀態提示
- [x] 1.4 補上 runtime mode 與交易阻擋的單元測試

## 2. macOS 常駐與模式切換

- [x] 2.1 建立 simulation API、Vite 與暫時 production-readonly 的 LaunchAgent 執行入口
- [x] 2.2 建立 `install`、`uninstall`、`simulation`、`production-readonly` 與 `status` 指令
- [x] 2.3 實作 mode 互斥、CA fail-closed、port 等待與安全健康診斷
- [x] 2.4 補上本機操作、切換、回復與秘密資料安全說明

## 3. 安裝與驗收

- [x] 3.1 安裝使用者層級 LaunchAgent 並驗證 simulation 自動啟動
- [x] 3.2 驗證 production-readonly 不載入 CA、不呼叫交易 API且 Web guard 回傳 403
- [x] 3.3 將終態切回 simulation，驗證 5173、8080、health 與 2330 snapshot
- [x] 3.4 執行 Vitest、build、OpenSpec strict validation 與 `git diff --check`
