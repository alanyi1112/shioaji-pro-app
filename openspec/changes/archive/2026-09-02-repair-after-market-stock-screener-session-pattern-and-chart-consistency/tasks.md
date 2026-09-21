## 1. 鎖定日期與回歸契約

- [x] 1.1 為 `effectiveSessionDate`、P／D 相鄰日、兩市場正式 receipt 共同日期與 mixed-session 拒絕建立純函式契約及單元測試
- [x] 1.2 加入 1409 新纖 2026-08-31／09-01／09-02 成交量與 OHLC fixture，證明舊窗 5.6393 倍不得延續到 09-02
- [x] 1.3 擴充 volume／turnover evidence schema，保存 `previousDate`、`currentDate` 與 D 成交值日期，並完成 v1／v2／v3 向後相容及非法日期測試
- [x] 1.4 定義父條件與成交值子條件的 effective criteria 正規化，補齊 query parser、fingerprint、domain verdict 與停用分支測試

## 2. 修正官方日資料與 OHLC 增量準備

- [x] 2.1 由官方日曆及 TWSE／TPEx 完整盤後日報 receipts 決定唯一 `effectiveSessionDate`，移除以批次 collector 單邊日期最小值決定 `technicalThrough` 的路徑
- [x] 2.2 將 OHLC receipt 的來源完整性與目前 universe coverage 分離，以 canonical rows、listing date、schema 與 source revision 計算真正缺口
- [x] 2.3 修正每日 session window 推進，使 universe 不變時只新增最新交易日的兩市場 target，保留其餘 59 日完成狀態
- [x] 2.4 修正 universe revision 差異規劃：改名／移除不得重跑全窗；新增商品只補其市場、上市日後且實際缺 row 的日期
- [x] 2.5 完成中斷續跑、request／時間 budget、Retry-After、稀疏回應保護、retention 與 source request 計數整合測試

## 3. 封鎖混期發布與過期結果

- [x] 3.1 在 v3 publisher staging 前與 CAS 寫入前強制核對 base expected session、daily D、technical through 及 effective session 完全相等
- [x] 3.2 為部分市場、舊 technical window、universe coverage 缺口及 mixed-session 建立明確 pending reason，保留最後合法 snapshot
- [x] 3.3 調整 v3 results／status route：技術條件停用時可使用最新相容 v2 projection，技術條件啟用時只接受當期 v3
- [x] 3.4 禁止 stale 或 mixed-session 「符合」rows 成為可操作結果，並維持歷史 snapshot／cursor 的日期與版本隔離
- [x] 3.5 補齊 publisher／repository／route 的全市場守恆、snapshot retention、cursor、GET 零外部請求與零寫入測試

## 4. 修正選股面板證據與父子控制

- [x] 4.1 將每筆日量改為 `P 日期＋股數 → D 日期＋股數`，成交值明示 D、單位與來源，避免與圖表不同日期混淆
- [x] 4.2 父條件關閉時停用成交值子控制並以 effective criteria 送出；舊偏好子開關為真時不得重複顯示或污染結果
- [x] 4.3 兩個已啟用分支共用同一 D 成交值時只顯示一次數值與日期，同時保留兩個分支各自 verdict／reason
- [x] 4.4 對 stale、mixed-session 與 technical preparation pending 顯示最後合法日期及原因，停用結果點選與「加入清單」操作
- [x] 4.5 加入窄版、大字級、鍵盤、偏好遷移、成交值重複與日期證據 browser tests

## 5. 修正指定 K 線圖行情 Snapshot

- [x] 5.1 將 chart-specific selection state 擴充為 contract、Snapshot 與 generation，使用既有合法 `fetchSnapshots` 路徑取得盤後報價
- [x] 5.2 只有目標仍未鎖定且 generation 最新時原子提交 contract／Snapshot，快速連點、目標移除或鎖定時丟棄過時回應
- [x] 5.3 QuoteBoard 使用 chart-local Snapshot fallback；取得失敗時顯示明確不可用原因，不以全欄 `—` 冒充成功
- [x] 5.4 顯示選股 evidence 日期與圖表資料日期／來源；同日成交量不同時明示來源差異，不以盤中值或估算值覆寫官方選股底稿
- [x] 5.5 驗證指定圖表以外的圖表、全域商品、自選清單、下單／智慧下單草稿、行情訂閱與交易寫入均不受影響

## 6. 分型與布林正確性驗證

- [x] 6.1 補齊原始三 K 頂／底、相等邊界、確認日推進與 1409 新舊窗口測試，逐項核對 strict high／low 條件
- [x] 6.2 補齊纏論包含向上／向下合併、方向不明、最新日被合併及原始日期映射測試
- [x] 6.3 補齊 BOLL 下軌陽 K、上軌陰 K、顏色相反、十字、碰軌、零影線及前日已在通道外的正反例
- [x] 6.4 建立本機 D1 全市場獨立重算驗證，逐筆比對 API pass symbols、A／B／C、P／D、bands、evidence hash 與守恆計數

## 7. 本機 Live 驗收與收尾

- [x] 7.1 在不停止 simulation API、watchdog、5173、5174、盤後 pipeline 或行情連線下完成最新共同交易日的一次 durable full run
- [x] 7.2 核對本機 D1 integrity、schema、兩市場 universe、60 日 sessions、receipts、target／processed／remaining／failed／overdue 與 snapshot 日期等式
- [x] 7.3 於 5173 實測成交量、大戶、原始／纏論頂底分型、兩種 BOLL、unknown、stale／pending、1409、未加入清單商品與實際指定圖表 QuoteBoard
- [x] 7.4 保存非敏感全市場 evidence 與畫面／console 結果至 `verification.md`，只有實際通過項目才勾選
- [x] 7.5 執行完整 `pnpm test`、lint、型別／build、`openspec validate --all --strict` 與 `git diff --check`，記錄所有結果

## 8. 成交量單位與結果卡呈現修正

- [x] 8.1 建立官方股數轉張與 Shioaji Snapshot common lot 的精確同日比較契約，涵蓋正差、負差、零差、日期不符及非法值
- [x] 8.2 將差異張數資訊移入選股結果卡，移除圖表上方選股提示列與結果卡成交值明細，保留成交值篩選及 API evidence
- [x] 8.3 補齊 browser／型別／完整回歸測試與本機畫面驗收，更新非敏感驗證紀錄
