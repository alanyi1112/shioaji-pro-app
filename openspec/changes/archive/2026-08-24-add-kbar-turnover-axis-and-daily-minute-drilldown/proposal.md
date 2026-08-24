## 為什麼

主交易畫面的日 K 缺少直接進入指定交易日 1 分 K 的操作；手動切換時框只會載入最近資料，容易失去原本觀察日期。使用者已於 2026-08-24 撤回本 change 原先規劃的「分鐘 K 成交值左軸」能力；後續實機使用確認 MultiView 多圖模式必須保留快速單擊與雙擊開單圖導覽，但 MultiView 單一圖表畫面也需要從日 K 精確進入所選日期 1 分 K。

## 變更內容

- 在主交易畫面的日 K 觀察模式，雙擊有效 K 棒後，以該棒的 `Asia/Taipei` 日期載入同日 1 分 K。
- request 固定為 local Shioaji simulation、單日有界範圍、`1m`、最多 600 根，並驗證 source、symbol、schema、日期、排序與 latest generation。
- 所有 projection layers 完整後才原子切換 interval、candles、readout、成交量、indicators、day boundaries 與 viewport；失敗、取消或 context 漂移時保留原日 K。
- 主交易畫面的日 K 單擊壓撐選棒與同棒雙擊使用 bounded gesture arbiter；交易點價、費波那契與其他已持有 pointer 的工具維持既有 ownership。
- MultiView 不接入 bounded gesture arbiter；合法單擊立即交由既有工具處理。2／3／4／6／8 圖合法雙擊仍以目前商品與週期開啟單圖；圖表數量為 1 時，只有雙擊日 K 有效棒才在原 panel 精確載入該日期 `1m`，其他雙擊不開頁也不切換。
- MultiView 籌碼 manager 在同一商品、週期與資料範圍刷新時保留最後一份已驗證 payload；暫時空 K 棒、重排、取消或短暫請求失敗不得把大戶持股清成空白。
- MultiView 技術副圖的初次 viewport recovery 不得銷毀並重建 chart；籌碼 pane 必須將 topology、時間 anchor 與 material data render 分流，相同可見內容不得重複載入或全量重畫。
- MultiView 滑鼠游標熱路徑必須以 animation-frame latest-wins 合併事件；一般 pointer move 不得全量重建 overlay、重複處理相同 candle 或反覆重建相同籌碼 readout DOM。

## 能力

### 新增能力

- `daily-minute-drilldown`: 定義主交易畫面及 MultiView 單一圖表從日 K 精確載入指定日期 1 分 K 的 request、validation、gesture、atomic commit、fallback 與 simulation-only 安全契約。
- `multiview-workspace-navigation`: 定義 MultiView 立即單擊與雙擊開單圖的穩定導覽契約。
- `multiview-chip-data-stability`: 定義大戶持股等籌碼 pane 在刷新、重排與短暫失敗期間的資料保留契約。

### 撤回能力

- `kbar-turnover-axis`: 產品需求已撤回；不得保留 UI、canonical turnover schema、Tick cursor、gateway／Worker payload、cache fingerprint、測試或文件宣稱。

## 影響

- 影響主交易畫面 `CandleChart`、daily drill-down contract／loader、MultiView 單圖 target-date loader／panel routing、籌碼 manager、測試、README 與 runtime 文件。
- 不變更既有右側成交量 Histogram、台股 `common_lot` 正規化、分日線、一般 interval selector、交易工具或 broker safety boundary。
- 只使用既有 loopback simulation market-data adapter；不新增 broker write、production、CA、真實下單、服務啟停、部署、commit 或 push 權限。
