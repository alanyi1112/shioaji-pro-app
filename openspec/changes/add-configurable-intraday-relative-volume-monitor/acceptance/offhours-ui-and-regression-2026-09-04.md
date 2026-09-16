# 離峰 UI 與既有功能回歸驗收（2026-09-04）

## 結論

- 本輪離峰驗收通過，可完成工作項目 8.7 與 8.8。
- 盤中選股專用 workspace 在桌面、窄寬、600／768／900 CSS px 高度及 150% 字級下均可操作；頁面本身沒有水平或垂直溢出，面板內容在需要時由面板內部捲動承接。
- 多分頁 lease 可正確累加，分頁關閉後會在 TTL 內回收；所有驗收分頁關閉並等待 TTL 後，`activeLeaseCount` 回到 `0`、`sessionState` 回到 `idle`。
- 監控 API 離線時會明確顯示「本機監控 API 離線」，右側 K 線與週期控制仍可使用。
- popup blocked 與 Notification denied 都有明確、可恢復的 UI 回饋，且不修改來源 workspace、不重複要求通知權限。
- 驗收期間 broker write、production 切換與服務生命週期異動皆為 `0`；runtime 前後皆維持 simulation。
- 工作項目 8.2–8.6 仍需至少兩個完整交易日的 shadow／dry run 與人工核准，本證據不取代交易日驗收。

## 測試環境與安全邊界

- 工作目錄：`/Users/alanyi/Documents/RealTimeStock`
- 目標 URL：`http://127.0.0.1:5173/?layout=intraday-stock-selection`
- 驗收時間：2026-09-04（Asia/Taipei，離峰時段）
- 最終腳本觀測時間：`2026-09-04T10:05:20.967Z`（Asia/Taipei 18:05:20）
- runtime：`simulation`
- production read-only job：`stopped`
- smart-order write master：`disabled`
- API／Web／MultiView listener：均為 `up`
- 驗收沒有重啟服務、切換 production、送出下單或執行 broker write。

## 實際 UI 驗收

可重跑腳本：[`verify-offhours-ui.mjs`](./verify-offhours-ui.mjs)

| 情境 | viewport／字級 | 結果 | 主要量測與觀察 |
| --- | --- | --- | --- |
| 桌面 | 1440 × 900／100% | 通過 | 文件 `1440/1440`、`900/900`；監控面板寬 470 px，K 線寬 950 px，左右並排 |
| 600 高 | 1024 × 600／100% | 通過 | 文件 `1024/1024`、`600/600`；監控內容 `611/463` 由面板內捲動承接，K 線仍在右側 |
| 768 高 | 900 × 768／100% | 通過 | 文件 `900/900`、`768/768`；監控內容 `650/607` 由面板內捲動承接，K 線仍在右側 |
| 窄寬 | 390 × 844／100% | 通過 | 文件 `390/390`、`844/844`；header 換行，監控與 K 線改為上下排列，K 線可捲動抵達 |
| 特大字級 | 1024 × 600／150% | 通過 | 文件無外層溢出；監控內容 `979/421` 由面板內捲動承接，通知、提示音與 1D 控制可操作 |
| 監控 API 離線 | 1280 × 768／100% | 通過 | 顯示服務離線，K 線與 1D 控制保留 |
| popup blocked | 1280 × 768／100% | 通過 | 顯示「請允許彈出視窗後重試」，來源 URL 與版面不變 |
| Notification denied | 1280 × 768／100% | 通過 | 顯示「系統通知：權限已拒絕」及不會重複要求；控制維持關閉 |
| 多分頁 | 2 個同時開啟的盤中選股分頁 | 通過 | 前置 viewport 驗收暫存 6 個未到期 lease，兩分頁開啟後為 8；異常關閉測試 context 並等待 TTL 後回到 0 |

驗收截圖：

- [`desktop-1440x900.png`](./screenshots/desktop-1440x900.png)
- [`short-1024x600.png`](./screenshots/short-1024x600.png)
- [`height-900x768.png`](./screenshots/height-900x768.png)
- [`narrow-390x844.png`](./screenshots/narrow-390x844.png)
- [`large-font-1024x600.png`](./screenshots/large-font-1024x600.png)
- [`offline.png`](./screenshots/offline.png)

## Console 與 HTTP 基線比對

主交易頁與盤中選股頁都會出現下列既有帳務 context 的 HTTP 400：

- `/api/v1/portfolio/position_unit`
- `/api/v1/order/trades`
- `/api/v1/portfolio/margin`

這三類回應在未開啟盤中選股的主頁即存在，因此列為既有基線。所有盤中選股驗收情境均為：

- uncaught page error：`0`
- 相對主頁基線新增的 HTTP 失敗：`0`
- 相對主頁基線新增的 console error 種類：`0`

本輪不把既有帳務 400 宣稱為已修正，也不把它歸因於盤中監控。

## 響應式修正

- `hud-header` 允許換行並解除 flex item 的最小寬度限制，避免 900 px 與 390 px 寬度出現文件級水平溢出。
- K 線工具列允許換行，避免窄寬或特大字級時週期與操作按鈕被裁切。
- 補上 popup blocked browser test，確認警告、來源 workspace 不變與選單正確收合。

## 完整回歸結果

| 指令 | 結果 |
| --- | --- |
| `pnpm test` | 189 files passed；2201 tests passed |
| `pnpm test:browser` | 9 files passed；99 tests passed |
| `pnpm test:multiview` | 722 tests passed |
| `pnpm build` | 通過；保留既有 chunk size warning |
| `pnpm build:multiview` | 通過；保留既有 vinext native config loader 相容性 warning |
| `pnpm typecheck:multiview` | 通過 |
| `pnpm lint:multiview` | 通過（0 warnings） |
| `pnpm verify:multiview-governance` | 通過 |

## Runtime 前後對帳

前測與後測的安全關鍵狀態一致：

- `runtime_mode=simulation`
- `production_readonly_job=stopped`
- `smart_order_write_master=disabled`
- `business_watchdog_state=healthy`
- `api_simulation=true`
- `api_health=healthy`
- `api_business_session=available`
- `market_snapshot_2330=available`
- `web_listener=up`
- `multiview_listener=up`

最後一個驗收分頁關閉並等待 lease TTL 後：

```json
{
  "activeLeaseCount": 0,
  "sessionState": "idle",
  "acceptingEvents": false,
  "active": 0,
  "availableForMonitor": 0,
  "reason": "gate_evidence_missing"
}
```

`gate_evidence_missing` 是預期的 fail-closed 狀態；因工作項目 1.2 與 8.2–8.6 尚未完成，本輪不啟用正式 active capacity。

## 本輪非變更項目

- 未修改或啟用 production。
- 未重啟 simulation API、Web、MultiView、watchdog 或 pipeline。
- 未送出交易或 watchlist 外的 broker mutation。
- 未完成或宣稱完成共享 physical usage 20／50／100／160 上限、各自固定 cohort 與實際 active 監控檔數的兩完整交易日試辦。
- 未將 change 標記為可歸檔；仍待 1.2、4.5、4.6、8.2–8.6、8.9 與最終 8.10。
