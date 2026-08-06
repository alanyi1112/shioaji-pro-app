# 驗收紀錄

## 自動驗證

- `npm run lint`：通過，0 warnings。
- `npm test`：通過；包含 `vinext build` 與 162 項 Node 測試，162 passed、0 failed。
- `openspec validate --all --strict`：16 項全部通過。

## 本機瀏覽器驗收

- 主圖與副圖選單：選單內可連續複選；在圖表外按滑鼠左鍵後收合；同 panel 選單互斥，console 無 error／warning。
- K 線游標日期：有效 K 棒顯示唯一 `YYYY-MM-DD`，實測 `2026-05-07`；離開圖表後隱藏並清空，標籤維持在主圖左右邊界內。
- 空技術副圖：方式 B 取消 KD 與 ATR 後，技術列高度為 0；籌碼 stack 仍以自身內容撐開 820.5625px，沒有內層垂直捲軸；重新勾選 ATR 後技術列恢復 104px 且圖表重新建立。
- 多層排序：在 8 個作用中籌碼 panes 將 `dealer-flow` 從第二個拖到第一個，再以右鍵「下移／上移」移動；重新整理後順序仍由 `dealer-flow` 起始。最上方「上移」disabled，方式 A 不顯示拖曳把手與排序選項。
- 1／2／3 圖：方式 B 分別顯示 1、2、3 panels，各 panel 保持至少 5 個作用中籌碼 panes，頁面只有 document 垂直捲軸；三圖量測各 panel 日期 X 座標 delta 都為 0px，右側 axis safe width 分別為 88px、82px、66px。
- 4／6／8 圖與聚焦：自動強制「單一副圖」，每個 panel 只有一個共用副圖槽位且至多一個籌碼 pane；聚焦後只顯示一個 panel。持股 pane 右側數值軸可見，header 無資料來源文字。
- 既有功能：大戶持股右鍵仍提供「詳細資料」與回補狀態；詳細資料表完整顯示持股比例、持股張數、持股增減、持股人數與 `TDCC` 資料來源。

## 驗收中修正

實際瀏覽器發現方式 B 取消最後一個技術指標時，籌碼內容雖可見但父層 slot 高度曾為 0。已將無技術指標的 page-scroll slot 改為 block flow，並讓 slot／chip region 使用內容最小高度；修正後 panel 與 document 高度會由籌碼 stack 正確撐開。
