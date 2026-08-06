## Why

目前每個 panel 的工具列同時出現「副圖」與「籌碼」兩個入口，占用有限的橫向空間；方式 A 雖名為單一副圖，籌碼 pane 仍另外加在技術副圖下方，與使用者預期的「替換同一個副圖位置」不一致。

## What Changes

- 移除獨立的「籌碼」工具列按鈕，將十種籌碼項目整合到既有「副圖」選單，並以清楚的「技術指標」與「籌碼資料」分組呈現。
- 方式 A 改為共用單一副圖槽位：選擇籌碼項目時，籌碼圖替換原本 KD／RSI／MACD／ATR 技術副圖位置；改選技術副圖時再替換回技術指標，不在主圖下方新增另一列。
- 方式 A 的技術副圖與籌碼副圖採單一作用項目；切換種類時只重建共用副圖槽位，不重建主 K 線。
- 方式 B 維持技術副圖原有行為，並依已勾選籌碼項目在下方建立多層 pane；所有選項仍由同一個「副圖」選單操作。
- 1／2／3 圖仍可切換 A／B，4／6／8 圖仍固定 A；跨模式與跨圖數時分別保存 A 最後作用項目、B 技術副圖狀態與 B 籌碼勾選組合。
- 更新 keyboard／ARIA、pane lifecycle、resize、時間軸與十字線同步，並加入正式站可見行為驗收。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 修改副圖選單入口、方式 A 的單一共用副圖槽位，以及 A／B 跨模式保存與 pane lifecycle 規則。

## Impact

- 前端：`public/static/index.html` 的 panel template、`public/static/app.js` 的技術副圖建立與同步、`public/static/chip-panes.js` 的 pane manager 掛載方式，以及 `public/static/styles.css` 的共用副圖槽位與選單分組樣式。
- 狀態：既有裝置端 `compactSubchartMode` 與籌碼選擇需要相容讀取；新增或調整 A 模式的單一作用項目保存格式時不得清空使用者既有 B 勾選組合。
- 資料 API、D1 schema、FinMind／TWSE／TPEx／TDCC adapter 與 runtime secret 不變。
- 驗證：更新前端 contract tests，並在本機與已登入 Sites 正式站驗證單一工具列入口、A 替換槽位、B 多層 pane、圖數政策及快速切換隔離。
