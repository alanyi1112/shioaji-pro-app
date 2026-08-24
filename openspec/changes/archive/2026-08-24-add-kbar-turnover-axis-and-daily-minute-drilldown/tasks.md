## 1. 指定日期 drill-down 共用契約與事件仲裁

- [x] 1.1 建立並測試 target-date request／validator，固定使用 canonical `Asia/Taipei` session date、單日有界範圍、simulation/source/symbol identity、schema、排序、混日、空資料、response guard、single-flight 與 generation acceptance
- [x] 1.2 建立日 K 觀察模式 bounded gesture arbiter 的固定 fixture，證明單擊逾時只提交一次壓撐選棒、同一 K 雙擊取消單擊副作用，而交易點價、費波那契、價格範圍、固定範圍 VP、drag 與非法目標保持既有 ownership
- [x] 1.3 建立 staged load／atomic commit contract 與 fault tests，證明成功時 interval、candles、source、readout、volume、indicators、day-boundaries 及 viewport 同步切換，失敗／取消／舊 generation 時原日 K context 完整保留

## 2. 主交易畫面日 K 雙擊垂直切片

- [x] 2.1 將 target-date staged loader 與 Lightweight Charts double-click 接入主交易畫面 production runtime，雙擊有效日 K 後以既有 simulation Shioaji adapter 載入該日 1 分 K，驗證成功才原子切換並 fit 選取 session
- [x] 2.2 整合主畫面壓撐單擊、forming 日 K、費波那契與交易 mode ownership；證明 drill-down 不先固定 reference、不延遲交易 click、不重送 broker write，失敗時保留 interval、viewport、reference 與工具狀態
- [x] 2.3 完成主畫面 focused、integration 與 browser-visible 驗收，涵蓋歷史日期、當日、空資料、混日、session unavailable、快速切換、返回日 K 與 console；通過獨立 P0/P1 檢查後立即更新本切片 tasks／evidence

## 3. MultiView 日 K 雙擊垂直切片

- [x] 3.1 擴充 page-scoped local Shioaji coordinator 的有界指定日期能力，將 staged loader 接入目前 panel；simulation 資料成功後才切至 `1m`，Yahoo／非支援 provider 不得以最近日、今天或 sample candles 替代
- [x] 3.2 整合 surface click、註記、固定範圍 VP、壓撐選棒與 panel `dblclick` routing；有效日 K 雙擊必須停止開新分頁 bubbling，非日 K／背景仍維持既有單圖新分頁行為，失敗不得 fallback 開頁
- [x] 3.3 完成 MultiView focused、integration 與 1／2／4／8 panel browser-visible 驗收，涵蓋 target date、single-flight、快速切換、來源不可用、返回日 K、繼承壓撐、stream lifecycle、完整 panel PNG 及 console；通過獨立 P0/P1 檢查後立即更新本切片 tasks／evidence

## 4. 範圍撤回、文件與最終 closure

- [x] 4.1 完整移除主交易畫面與 MultiView 的成交值左軸 UI、canonical schema、Tick cursor、gateway／Worker payload、cache fingerprint、focused tests與文件宣稱；保留右側成交量、指定日期 drill-down及其他既有功能
- [x] 4.2 更新 README、主畫面與 MultiView runtime 文件及驗收矩陣，說明日 K 指定日期 drill-down、gesture ownership、simulation-only 安全範圍與成交值能力已撤回；執行 focused tests、integration tests、TypeScript、production build、OpenSpec strict 與 `git diff --check`
- [x] 4.3 由獨立 P0/P1 closure 檢查 target-date race、gesture 穿透、雙開頁、atomic commit、simulation-only、無 broker authority，以及撤回後無成交值殘留；全部通過後才完成 change，不 commit、push、部署或啟停服務

## 5. MultiView 互動與大戶持股穩定性修補

- [x] 5.1 移除 MultiView 日 K bounded gesture 與 target-date production wiring，恢復合法單擊立即處理、所有 interval 合法雙擊開啟目前商品單圖；同步更新 proposal／design／spec／README 與 runtime 文件
- [x] 5.2 以 request identity 與 stale-while-refresh 修正籌碼 manager，確保同 context 空 candles、重排、取消與短暫失敗不清除已驗證大戶持股，商品／週期改變仍 fail closed 清除舊 identity
- [x] 5.3 完成 focused／integration、JavaScript syntax、lint、TypeScript、production build、OpenSpec strict、`git diff --check` 與一次獨立 P0/P1 closure；全部通過後才更新 evidence 並勾選本切片

## 6. MultiView 副圖單次載入與重繪修補

- [x] 6.1 將技術副圖初次 time-range recovery 改為既有 chart 的非破壞性 resize／viewport sync，移除 `remove()` 後遞迴完整 render 的重建路徑
- [x] 6.2 將籌碼 topology、neutral anchor 與 material render 分流，加入忽略非可見 refresh metadata 的 per-pane signature gate，證明相同 context、重排與相同 response 不重抓或重畫
- [x] 6.3 完成 focused／integration、JavaScript syntax、lint、TypeScript、production build、OpenSpec strict、`git diff --check` 與獨立 P0/P1 closure；全部通過後才更新 evidence 並勾選本切片

## 7. MultiView 游標熱路徑延遲修補

- [x] 7.1 移除一般 pointer move 的全 overlay render 與重複 native crosshair source，將 crosshair／annotation preview 接成 per-panel animation-frame latest-wins
- [x] 7.2 對相同 payload＋candle 的 crosshair commit及相同籌碼 readout DOM 加入 signature gate，保留跨 pane 同步、繪圖工具與 unmount cleanup
- [x] 7.3 完成 focused／integration、browser-visible 壓力驗收、JavaScript syntax、lint、TypeScript、production build、OpenSpec strict、`git diff --check` 與獨立 P0/P1 closure後更新 evidence

## 8. MultiView 單圖日 K 指定日期 drill-down

- [x] 8.1 將單圖／多圖雙擊 routing 與 page-scoped simulation exact-date coordinator 接入 production；單圖日 K 有效棒載入同日 `1m`，多圖維持開單圖，控制項／背景／非日 K不切換
- [x] 8.2 完成 candle hit、已完成日 K、tool ownership、single-flight、simulation recheck、generation／symbol／interval race、staged projection、atomic commit、失敗 rollback與返回日 K契約
- [x] 8.3 完成 focused／integration、1／2／4／8 panel browser-visible、JavaScript syntax、lint、TypeScript、production build、OpenSpec strict、`git diff --check`及獨立 P0/P1 closure後更新 evidence
