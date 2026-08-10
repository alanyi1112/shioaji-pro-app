## 1. 前置基準與 fixture

- [x] 1.1 歸檔並同步 `align-chart-tools-and-add-multiview-minute-klines`，確認正式 `chart-technical-indicators` spec 已包含 1D-authoritative Pivot projection，再重新執行本 change strict validation
- [ ] 1.2 建立版本化 PivotPoint／三關價／CDP 共用 OHLC fixture，涵蓋正常值、相同高低、邊界 close、非法有限值與六位小數期望結果
- [ ] 1.3 定義 `SupportResistanceProjection`、formula id／version、reference metadata 與固定排序的 level-set 型別，且不引入外部行情或第三方 runtime dependency

## 2. 三套公式與自動 reference resolver

- [ ] 2.1 將既有 Traditional Pivot adapter 接入共用 level-set contract，保持 `traditional-pivot-tw-v1` 七線 fixture parity
- [ ] 2.2 實作 `three-level-price-tw-v1` 純函式與 UP／MID／DOWN 測試，拒絕非法 OHLC 並驗證公式順序
- [ ] 2.3 實作 `cdp-wilder-tw-v1` 純函式與 AH／NH／CDP／NL／AL 測試，拒絕非法 OHLC 並驗證單調順序
- [ ] 2.4 實作可注入 `Asia/Taipei` 時間、資料載入狀態與來源可用性的自動 reference resolver，涵蓋盤中今日 forming、13:35 後今日 completed、開盤前、週末、休市、補行交易日與資料倒序
- [ ] 2.5 為收盤後 Kbars 失敗、來源 unavailable、今日 OHLC 非法及沒有前一完整交易日加入 fail-closed 測試，確認不得用 quote 或零值補造 reference

## 3. Canonical state 與非破壞遷移

- [ ] 3.1 建立不含 timeframe／formula／instance id 的 product reference key 與 document-session pinned state，讓三套公式訂閱相同 reference
- [ ] 3.2 將三個 checkbox enabled state 接入既有 canonical indicator store，沿用 functional update、同 origin revision 與 storage failure reason code
- [ ] 3.3 實作最後一個 formula 取消時清除 pinned reference、reload 恢復 enabled 但回到自動 reference，以及不同商品／多 panel 隔離測試
- [ ] 3.4 實作可重入的 legacy `traditional-pivot` migration：可見轉為勾選、hidden 轉為未勾選、新版優先、成功保存前保留舊資料且不得產生重複七線
- [ ] 3.5 從通用 indicator picker 移除可新增 Traditional Pivot 的入口，保留公式與 legacy parser 供 migration／fixture 使用，並加入 picker regression test

## 4. 共用 renderer 與 readout

- [ ] 4.1 將既有 Pivot primitive 抽象為可同時接收多個 level sets 的共用壓撐 renderer，保留右向投影、價格軸安全邊界與 reference 不在分鐘窗時的左側 clamp
- [ ] 4.2 實作十五線跨公式固定排序、formula prefix、level 名稱、格式化價位、色彩／線型與全域 Y 標籤避碰，位移標籤以短 connector 指向真實價格
- [ ] 4.3 將 autoscale 限制為 enabled finite levels，並測試單一 formula 取消只移除自己的線、readout 與 autoscale contribution
- [ ] 4.4 加入三套公式共用 reference 的中文 readout，明示自動／固定歷史、reference 日期、完成／unavailable 狀態及各 level 價位
- [ ] 4.5 為價格相同／相近、十五線、resize、平移縮放、history paging、theme、快速 generation、切換商品／時框與 unmount 加入 renderer cleanup regression tests

## 5. 主交易畫面壓撐互動

- [ ] 5.1 在主交易畫面「指標」旁加入「壓撐」按鈕與 viewport-safe、鍵盤可操作的三 checkbox popover，提供 active、focus、outside click／Escape 與設定未保存狀態
- [ ] 5.2 勾選第一個公式時立即執行自動 reference；取消個別 formula 時保持其他 formula 與共用 reference；三項全關時清除整組投影
- [ ] 5.3 在 1D 游標觀察模式提供「固定歷史」與「回到最新」，讓點選已完成日 K 同步更新三套公式，並拒絕固定盤中 forming K
- [ ] 5.4 讓 1m、5m、15m、60m 唯讀鏡像 1D reference 與 enabled projections，顯示「由 1D 管理」且不提供任何會改變 reference／checkbox 的控制
- [ ] 5.5 保持點價買、點價賣、停損、停利及警示模式優先，測試壓撐選棒不攔截交易點擊、不送單、不啟用 production 且不改其他 indicator／Fibonacci state

## 6. 驗證與本機可見驗收

- [ ] 6.1 執行壓撐公式、resolver、store migration、primitive、CandleChart component 與既有 Pivot／indicator／交易互動 targeted tests
- [ ] 6.2 執行完整 root unit tests、browser tests、TypeScript／build、OpenSpec strict validation 與 `git diff --check`，修正所有 regression
- [ ] 6.3 在 `127.0.0.1:5173` 與 Shioaji simulation 以固定盤中時間驗證上一交易日 reference、三個 checkbox、1D 固定歷史及四個分鐘時框同組投影
- [ ] 6.4 在 `127.0.0.1:5173` 與 Shioaji simulation 以固定 13:35 後時間驗證最後一根完整日 K、資料不可用 fail-closed、十五線標籤避碰、個別取消、全清除及 reload 回自動 reference
- [ ] 6.5 回歸多 panel／不同商品、快速切換、console 未處理錯誤、MultiView 未被修改、simulation 安全邊界及既有 5173／5174 runtime 與行情連線保持運作
