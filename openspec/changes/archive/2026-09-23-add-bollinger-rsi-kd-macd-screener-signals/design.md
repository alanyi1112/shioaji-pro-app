## Context

目前最新選股資料契約為 v6，技術底稿已使用官方未還原日 OHLCV 並具備 130 個官方交易日的逐商品 continuity、RSI5／RSI10、KD-K 與 MACD 背離計算能力，但 UI 沒有把布林位置、指標極值區交叉及 MACD 零軸訊號暴露成獨立條件。外層條件可選 `all`／`any`，因此若把「量能確認」另做一個平行條件，`any` 可能讓使用者誤以為價量訊號已同時成立。

本 change 橫跨 criteria／偏好、指標公式、全市場 publisher、D1 immutable snapshot、唯讀 API、選股 UI 與驗收證據。所有計算仍限於本機盤後流程，不增加來源、Shioaji 訂閱或交易權限。

## Goals / Non-Goals

**Goals:**

- 提供可調門檻且 deterministic 的 BOLL、RSI、KD、MACD 盤後訊號。
- 讓每個訊號可自行要求量能確認，避免被外層 `any` 邏輯繞過。
- 以 v7 immutable snapshot 保存足以重算的逐條件 evidence、unknown reason 與全市場守恆計數。
- 保留 v1–v6 的公式、snapshot、cursor、偏好與既有布林反轉 K 語意。
- 在窄面板、600 CSS px 高 viewport 與鍵盤操作下維持精簡可用。

**Non-Goals:**

- 不做盤中即時計算、分鐘線訊號、預測分數或自動交易。
- 不新增「布林擠壓」、RSI／KD 背離、hidden divergence 或參數最佳化／回測。
- 不以圖表顯示值、Shioaji Snapshot、Yahoo 或其他第三方資料補官方日資料缺口。
- 不自動啟用量能確認，也不宣稱預設門檻能保證報酬。

## Decisions

### 1. 使用 v7 additive criteria 與 immutable snapshot

新增 `bollPosition`、`rsiCross`、`kdCross`、`macdSignal` 四個分支，預設皆關閉。合法 v6 偏好單向遷移成 v7，既有欄位不變；四個新分支皆關閉時可安全投影最新合法 v6。任一新分支啟用時只接受同一 `effectiveSessionDate`、universe revision、formula version 的 ready v7 snapshot。

選擇新版本而非原地擴寫 v6，是為避免舊 cursor、cache 或已保存 rows 被新公式重解釋。v7 snapshot 沿用現有 staging → full-universe gate → atomic publish 流程。

### 2. 布林位置沿用 BOLL(20,2)，中軌附近以通道寬度正規化

上／下軌外使用嚴格 `closeD > upperD`／`closeD < lowerD`。中軌附近使用：

`abs(closeD - middleD) / (upperD - lowerD) × 100 <= tolerancePercent`

預設 `tolerancePercent=10`，允許 1–25%。這比固定價格百分比能隨商品波動度調整，也不因股價級距不同而失真。若通道寬度非正值或任一 band 缺失，分支為 unknown。中軌附近另提供 `any`／`rising`／`falling` 中軌方向，預設 `any`；方向比較使用 P／D 未四捨五入中軌。

既有「布林反轉 K」要求 P 在通道內、D 首次穿越與 K 棒結構，公式完全不變；新分支不借用或覆寫其 evidence。

### 3. RSI 與 KD 使用相鄰完成交易日的嚴格交叉

RSI 固定沿用現有 Wilder RSI5（快）／RSI10（慢）；KD 固定沿用現有 KD(9,3,3) 的 K（快）／D（慢）。黃金交叉定義為 `fastP <= slowP && fastD > slowD`，死亡交叉為 `fastP >= slowP && fastD < slowD`。低檔黃金交叉還要求 P 或 D 至少一日的快慢值都小於等於低檔門檻；高檔死亡交叉同理要求快慢值都大於等於高檔門檻。

高／低門檻預設 80／20，分別允許 50–95 與 5–50，且必須 `low < high`。交叉使用未四捨五入值；只有顯示層可格式化。

### 4. MACD 同時支援零軸距離、零軸穿越與軸上／下快慢線交叉

固定使用現有 MACD(12,26,9) 的 DIF 與 DEA。支援：

- DIF 從下方／上方接近零軸；
- DIF 向上／向下穿越零軸；
- 零軸下黃金／死亡交叉；
- 零軸上黃金／死亡交叉；
- 不限制零軸位置的任一黃金／死亡交叉。

「接近零軸」不以絕對價格差判定，而以 `abs(DIF_D) / closeD × 100` 正規化，預設上限 0.25%，允許 0.01–5.00%；並要求 D、P、P2 連續兩段嚴格靠近零軸且未提前穿越。這可排除只因高價股而顯得 DIF 數字大的偏差。軸上／下快慢線交叉要求 P、D 的 DIF 與 DEA 都在指定軸側，避免把穿越零軸事件混成同一模式。

### 5. 量能確認是每個訊號內部的 AND 子條件

每個新分支都有獨立 `volumeConfirmation`，預設關閉。啟用時要求：

`volume(D) >= ratio × average(volume of previous N official sessions)`

其中基準明確排除 D，`N` 預設 20、允許 5–60，`ratio` 預設 1.2、允許 1.0–10.0。使用者可另外啟用 20 日均量流動性下限，預設 1,000 張；內部一律使用 `volume_shares`，UI 才換算為張。量能確認的 verdict 與技術訊號在同一分支內以 AND 合併，再交給外層 `all`／`any`。

選擇 opt-in 而非預設強制，是因 RSI／KD／MACD 的技術定義本身不包含成交量；量能可減少低流動性雜訊，但也會排除量縮轉折。其參數必須寫入 criteria fingerprint 與 evidence。

### 6. 計算只發生在 publisher，GET 與 UI 保持唯讀

publisher 從同一 v7 130-session canonical OHLCV window 建立 BOLL、RSI、KD、MACD 與量能基準，逐商品產生 pass／fail／unknown。GET 僅查 immutable rows；不得臨時從圖表、provider 或 Shioaji 補算。資料缺 session、P／D 不相鄰、指標暖機不足、volume 不可比較或 formula version 不一致時皆 fail closed。

### 7. UI 採既有精簡 accordion 與按需 evidence

四個條件放在「技術」分類，摘要列只顯示啟用狀態與主要模式；點選後才展開門檻、量能與說明。只有模式需要的欄位可編輯，其餘隱藏值不進 fingerprint。結果卡只顯示短摘要，完整 P／D／P2、指標、bands、volume baseline 與公式版本放在可展開 evidence。

## Risks / Trade-offs

- [預設門檻被誤解為投資建議] → UI 與說明標示為常見技術預設與可調參數，不承諾績效；僅供資料篩選。
- [四捨五入造成邊界誤判] → 判定與 hash 使用 canonical 未四捨五入值，格式化值只用於顯示。
- [外層 `any` 繞過量能] → 量能確認固定建模為訊號分支內部 AND，不另建平行條件。
- [新增指標使 snapshot 體積與重算時間增加] → 只保存重算必要的 D／P／P2 與量能摘要；沿用 full-universe 有界批次、checkpoint 與 atomic publish。
- [130 日對 MACD 暖機仍可能不足] → 不縮短公式或補造值；逐商品回 `indicator_warmup`，並在 full-run evidence 說明。
- [舊版與新版混用] → v7 criteria、snapshot、cursor、cache、formula version 全部隔離；新條件啟用時不接受 v6 rows。

## Migration Plan

1. 新增 v7 criteria／preference schema、決定性 v6→v7 migration 與純函式測試；新條件預設關閉。
2. 新增指標訊號與 volume confirmation domain，建立固定邊界 fixture 與 reference-value 測試。
3. 擴充 publisher／repository／D1 payload 與 gateway allowlist，但先不把 v7 設為可查詢最新版本。
4. 以既有 canonical OHLCV 完成全市場 v7 重算，核對 TWSE／TPEx coverage、守恆、hash 與代表商品公式。
5. 通過 API、UI、viewport、鍵盤、無副作用與 live D1 驗收後，原子啟用 v7 查詢；v6 保留為舊條件 projection 與 rollback 路徑。
6. 回滾時停止發布新 v7，讓四個新條件顯示 preparation unavailable；不得刪除 v1–v6 snapshot 或改寫舊偏好。

## Open Questions

無；若實作時發現現有 RSI／KD／MACD reference formula 與 publisher 版本不一致，必須先停下並建立獨立修正，不得在本 change 內靜默更換既有公式。
