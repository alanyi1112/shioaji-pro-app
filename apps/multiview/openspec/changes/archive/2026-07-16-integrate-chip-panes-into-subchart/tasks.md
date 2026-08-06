## 1. 合併副圖控制入口

- [x] 1.1 更新 panel template，移除獨立「籌碼」按鈕，將技術指標與十種籌碼項目以可及群組整合到單一「副圖」選單
- [x] 1.2 調整工具列與合併選單樣式，確認 1／2／3／4／6／8 圖及窄螢幕不因多餘欄位浪費空間

## 2. 實作方式 A 共用副圖槽位

- [x] 2.1 建立包含技術副圖與籌碼區域的共用副圖槽位，讓方式 A 同時只顯示其中一種內容且不新增額外列
- [x] 2.2 擴充 chip pane manager，保存 `modeASlotKind`、支援技術／籌碼作用種類切換，並相容既有 A 與 B 選擇資料
- [x] 2.3 串接技術與籌碼選項事件：方式 A 切換時保留各自偏好、隔離舊 request、恢復 visible range 與尺寸，且不重建主 K 線

## 3. 維持方式 B 與 lifecycle

- [x] 3.1 確認方式 B 保留技術副圖與多層籌碼 stack、固定排序、共用 dataset request、移除控制及副圖區域內捲動
- [x] 3.2 確認圖數切換、聚焦、symbol／interval 切換與 panel 銷毀會正確保存狀態並清理 chart、listener、observer 與舊 request

## 4. 測試與交付驗證

- [x] 4.1 更新前端 contract 與 lifecycle 測試，涵蓋單一入口、A 同槽替換、B 多層、偏好相容及舊 response 隔離
- [x] 4.2 執行語法檢查、完整測試與 `openspec validate --all --strict`
- [x] 4.3 在本機實際操作驗證單一入口、A 技術／籌碼互換、B 多層、1／2／3 與 4／6／8 圖政策、resize、時間軸及十字線
- [x] 4.4 發布 Codex Sites，使用已登入 session 驗證正式站可見行為與靜態資產版本
- [x] 4.5 完成後歸檔 OpenSpec change，重新執行嚴格驗證並確認 repo 無秘密資料
