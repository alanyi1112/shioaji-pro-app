# 主圖 Candle 資料完整性

## Purpose

確保主圖原始與顯示 Candle 具有獨立所有權，維持有效、嚴格遞增且唯一的時間軸，並在快取污染或系列提交失敗時提供局部隔離及有界復原。保護週期切換、歷史載入與既有圖表契約，並以分列的離線回歸及短時間實盤驗收證據確認修復，不干擾既有 simulation 連線、背景擷取與共用服務。

## Requirements

### Requirement: 原始與顯示 Candle 必須具有獨立所有權

系統 MUST 在所有週期的聚合結果建立獨立陣列及 Candle 物件，包括 1 分分支。對顯示尾棒的更新 MUST NOT 修改原始尾棒，反之亦然；同一合法事件在各表示中 MUST 只套用一次既有 cursor 接受的價量與成交值增量。

#### Scenario: 1 分聚合不能共用輸入物件
- **WHEN** 原始 1 分資料產生顯示資料，並更新任一方的尾棒或新增下一分鐘
- **THEN** 另一方的陣列與 Candle MUST 保持不變，直到其自身接受同一合法事件

#### Scenario: 同分鐘價量只能累加一次
- **WHEN** bootstrap 後接受一筆同分鐘的合法 volume／turnover 增量
- **THEN** raw 與 display 的最終累計值 MUST 各增加一次該增量，不得因物件別名增加兩次

#### Scenario: 跨分鐘不能建立重複 K 棒
- **WHEN** 一筆合法事件建立下一分鐘 K 棒
- **THEN** raw 與 display MUST 各只有一根該分鐘 K 棒，且既有事件去重與舊事件拒絕規則不變

### Requirement: 快取與圖表提交必須驗證唯一時間軸

系統 MUST 在保存／使用記憶體快取及提交 Candle 系列前確認時間有效、嚴格遞增且唯一。正常資料的 OHLCV、成交值與時間編碼 MUST 保持原值；系統 MUST NOT 以相加 snapshot、猜測合併衝突數值或生成假 K 棒修補污染資料。

#### Scenario: 污染快取成為目前 key 的 miss
- **WHEN** 切回 1 分 K 時快取包含重複時間或非遞增時間
- **THEN** 系統 MUST 拒絕該 entry，透過既有正常 bootstrap 路徑有界重建，而不清空其他 key 或修改來源證據

#### Scenario: 正常快取保留原值
- **WHEN** 唯一且嚴格遞增的資料存入並讀回快取
- **THEN** 系統 MUST 保留原始 OHLCV／成交值與時間，不重複套用時區偏移

#### Scenario: 不合法來源不能進入圖表
- **WHEN** bootstrap 或歷史載入後的候選系列時間不合法
- **THEN** 系統 MUST 拒絕提交並保留可診斷原因，不送入 `setData` 或啟動無限重試

### Requirement: 系列提交失敗必須局部隔離與有界復原

系統 MUST 將 Candle 提交失敗隔離於受影響的圖表，保留同一 chart key／generation 的最後有效系列及局部錯誤狀態；沒有有效系列時 MUST 顯示未完成／失敗，不得冒充 ready。錯誤 MUST 可診斷且不得包含機密；一次載入的污染快取復原 MUST 最多使用一次既有 bootstrap，不得使整頁進入啟動失敗或影響其他面板。

#### Scenario: setData 例外不造成全頁崩潰
- **WHEN** 圖表函式庫在提交候選系列時拋出例外
- **THEN** 系統 MUST 保持其他面板運作，記錄局部原因並保留同 key 的最後有效系列，不要求全頁重載才能繼續操作

#### Scenario: 復原失敗停止自動迴圈
- **WHEN** 污染快取後的一次 bootstrap 仍然失敗
- **THEN** 系統 MUST 顯示局部失敗並停止該輪自動復原，等待明確重試或正常後續載入

### Requirement: 切換週期與歷史載入必須保護既有圖表契約

系統 MUST 保留 canonical identity／generation 隔離、合法即時尾棒、既有成交量與成交值來源、viewport 及拖曳間距。週期切換、history prepend 與 cache recall MUST NOT 產生重複時間、跨商品尾棒或假 K 棒；既有指標、readout、CDP／三關價／Pivot Point／Fibonacci 行為 MUST 維持不變。

#### Scenario: 來回切換週期保留唯一系列
- **WHEN** 使用者在即時事件持續到達時切換 1m、5m、1D 再回到 1m
- **THEN** 各系列 MUST 嚴格遞增且唯一，舊 generation 不得提交至目前圖表

#### Scenario: 歷史載入保留尾棒及閱讀位置
- **WHEN** 使用者拖曳載入更早資料並接回合法 live tail
- **THEN** 系統 MUST 保留唯一尾棒、既有 viewport 與 K 棒間距，不因 prepend 增加重複 K 棒

### Requirement: 驗收必須區分離線重現與短時間實盤

系統修復的結案證據 MUST 分列離線重現／回歸及短時間實盤確認。前端修復 MUST 允許在盤中進行，不得將收盤或正式擷取 cleanup 設為必要前置條件；實作前後 MUST 核對並保護既有背景擷取與共用服務。實盤 MUST 優先於今日修復及離線回歸通過後使用既有 simulation 連線，跨至少三個分鐘邊界核對切換、唯一時間軸、單次價量增量與 console；時間／真實事件不足時 MUST 保留未完成並延至次一適用交易日，不得用 fixture 或盤後資料冒充 live，亦不得因此放寬其他監控 change 的完整交易日驗收契約。

#### Scenario: 今日盤中可立即進行有界修復與驗證
- **WHEN** 使用者要求待會兒於盤中實作，且修復限定前端 Candle 路徑、不需變更正式擷取或重啟共用服務
- **THEN** 系統 MUST 允許完成安全預檢後進行實作，不等待收盤；離線回歸通過且仍有足夠真實事件時 MUST 接續今日短時間 live 確認

#### Scenario: 短時間 live 確認尚未完成
- **WHEN** 離線與 Chromium 回歸已通過但未完成交易日實盤確認
- **THEN** 此 change MUST 保留 live 任務未完成，不宣稱可歸檔

#### Scenario: 前端確認不干擾正式擷取
- **WHEN** 盤中實作或今日／次一交易日短時間驗證此修復
- **THEN** 系統 MUST 保留共用服務、原始擷取及失敗證據，不新建 login／行情連線；額外訂閱或生命週期操作必須另有使用者授權
