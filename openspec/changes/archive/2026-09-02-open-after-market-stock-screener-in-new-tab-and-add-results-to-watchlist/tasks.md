## 1. 建立完整選股交易版面新頁

- [x] 1.1 建立只接受 loopback 5173 的 `?layout=stock-screener` 視窗 opener，以 `_blank` 與 `noopener` 同步開頁。
- [x] 1.2 讓 `layout=stock-screener` 繼續渲染完整 `TradingApp`，不走只有選股控制項的 `popout=screener` 根頁面。
- [x] 1.3 建立左側選股 5 欄、右側 K 線 19 欄、高 29 grid rows 的專用 workspace，保留完整頂部工具列。
- [x] 1.4 讓專用 workspace 在新分頁採 session-only 更新，不寫入來源頁共用的 current-workspace storage key。
- [x] 1.5 新增單元與 browser 測試，涵蓋 URL、版型內容、workspace 隔離、不原地套用 preset 與不開單一選股根頁面。
- [x] 1.6 依 grid 容器實際可視高度動態計算完整 row 數，讓左側選股與右側 K 線等高且不超出 viewport，並在 resize／工具列換行時重新計算。
- [x] 1.7 修正 `noopener` 成功開頁卻回傳 `null` 的誤判：保留瀏覽器原生 `noopener` 隔離，不再以有歧義的回傳值顯示自製阻擋 alert，並以單元、browser 與實際開頁驗收。

## 2. 實作指定「選股」清單寫入

- [x] 2.1 在 watchlist domain 層新增依正規化名稱尋找清單並加入 canonical 合約的 API，禁止重用會切換 active list 的既有流程。
- [x] 2.2 實作不存在時建立名稱精確為「選股」的清單、已存在商品冪等成功、後端 id 寫入及完成後重抓確認。
- [x] 2.3 實作同時建立的 duplicate/conflict recovery；重抓仍無法判定唯一同名清單或合約不一致時 fail closed，不猜測或任選目標。
- [x] 2.4 實作不含機密資訊的同源 watchlist invalidation，讓其他頁重抓 metadata／目前清單內容，但不得切換 active list、選取商品或圖表與交易狀態。
- [x] 2.5 新增測試涵蓋首次建立、既有清單新增、重複加入、快速重按、雙分頁建立競態、非法／不一致合約、API 失敗及 active list 不變。

## 3. 更新選股結果介面

- [x] 3.1 將結果卡片改為同層的內容 action 與右上方「加入清單」按鈕，補上可辨識的 hover highlight，避免巢狀 button，並確保 mouse、touch、Enter／Space 與事件傳遞互不穿透。
- [x] 3.2 接上 `idle`、`pending`、`added`／`already_present`、`error` 狀態與可重試回饋，只有後端確認成功才顯示「已加入」。
- [x] 3.3 保留結果內容與同一 `TradingApp` workspace 的 K 線連動，重新驗證目標仍存在且未鎖定。
- [x] 3.4 調整左側選股面板、600 CSS px 高 viewport、窄寬度及特大字級版面，確保目標選擇器、結果內容、「加入清單」及錯誤訊息可見或可捲動抵達。
- [x] 3.5 新增元件測試證明按「加入清單」不送 chart pick、點內容不送 watchlist mutation、鍵盤焦點／label 正確及 pending 期間不重複寫入。

## 4. 整合版面入口與舊版面相容

- [x] 4.1 在 viewport-safe「版面」選單的「預設版面 Presets」區提供「選股篩選」 action，啟用後開啟完整交易終端與專用 workspace。
- [x] 4.2 恢復「＋新增面板」中「選股」的原有 `addBlock`、singleton、renderer 與 storage schema 語意，使 workspace／profile 內嵌 block 可建立、載入、操作、移除及再保存。
- [x] 4.3 更新 workspace／menu 測試，涵蓋版面選單開啟完整選股交易頁、不在來源頁載入 preset、新增面板選股建立 singleton block 及鍵盤可達性。
- [x] 4.4 確認選股新分頁沿用既有 5174 status／results 唯讀契約；服務離線只顯示既有離線狀態，不啟停 runtime 或觸發資料回補。

## 5. 端對端驗收與副作用對帳

- [x] 5.1 在實際本機 5173／5174 以主交易頁「版面」的「選股篩選」入口開啟新頁，核對完整頂部工具列、左側選股、右側 K 線、URL、DOM、桌面尺寸、console 與來源 workspace 未變。
- [x] 5.2 以實際全市場選股結果核對點選內容只更新同一新頁指定的未鎖定 K 線；測試多目標、建立日 K 圖、所有圖表鎖定與快速連點。
- [x] 5.3 以一檔尚未存在商品驗證自動建立／使用「選股」清單、右上按鈕狀態、重複加入單一項目、重整持久化及主頁清單同步，並保留原 active list。
- [x] 5.4 以受控失敗驗證合約不一致與 watchlist API 失敗不偽報成功，且結果內容仍不隱性加入清單。
- [x] 5.5 對帳驗收期間沒有未授權的交易／智慧下單寫入、行情訂閱、provider 抓取、選股回補、DDL、runtime 啟停或其他圖表與草稿副作用，保存非敏感 evidence。

## 6. 完整品質閘門

- [x] 6.1 執行新模組及受影響 workspace、watchlist、選股 focused tests，修正所有回歸。
- [x] 6.2 執行專案完整 `npm test`、`npm run test:browser` 與 `npm run build`；root 未配置 `lint` script／ESLint 時記錄此既有工具邊界，不為本 change 臨時引入 lint toolchain。
- [x] 6.3 執行 `openspec validate --all --strict` 與 `git diff --check`，核對所有規格、tasks 與程式差異可歸檔且未納入無關 dirty tree。
