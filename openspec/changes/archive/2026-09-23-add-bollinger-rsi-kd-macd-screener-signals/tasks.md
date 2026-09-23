## 1. 既有公式與資料契約盤點

- [x] 1.1 核對目前 v6 criteria、preference、snapshot、cursor、gateway allowlist 與 D1 schema 的實際版本入口，記錄 v7 擴充點且不改寫舊版。
- [x] 1.2 以現有 reference tests 核對 BOLL(20,2)、Wilder RSI5／10、KD(9,3,3)、MACD(12,26,9) 與 `volume_shares` 的 canonical 公式、暖機及邊界語意。
- [x] 1.3 盤點 130-session OHLCV 對全市場商品的實際 coverage、缺漏原因與 MACD 暖機可用率，將無法支援者明列為 unknown，不縮短公式。

## 2. v7 criteria、驗證與偏好遷移

- [x] 2.1 建立 `bollPosition`、`rsiCross`、`kdCross`、`macdSignal` 與條件內 `volumeConfirmation` 的 v7 型別、預設值、enum allowlist 及數值界線。
- [x] 2.2 實作 effective criteria 正規化與 fingerprint，移除停用分支及不適用的隱藏參數，加入等價 criteria／非法值／未知欄位測試。
- [x] 2.3 實作決定性 v6→v7 preference migration，驗證新條件預設關閉、舊條件與排序不變、非法 v7 fail closed 且不清除最後合法偏好。
- [x] 2.4 擴充本機 gateway status／results allowlist 與離線安全 response，拒絕超界、小數位錯誤、未知 enum、任意 path／method／upstream 控制欄位。

## 3. 技術訊號純函式

- [x] 3.1 實作 BOLL 上軌外、下軌外、中軌附近與中軌方向，加入碰軌、零寬度、容許範圍及既有布林反轉 K 不變的邊界測試。
- [x] 3.2 實作 RSI5／RSI10 高檔死亡與低檔黃金交叉，加入 P／D 相鄰、極值區雙線、等號與未四捨五入邊界測試。
- [x] 3.3 實作 KD(9,3,3) 高檔死亡與低檔黃金交叉，加入暖機、極值區、等號、缺 session 與 reference-value 測試。
- [x] 3.4 實作 MACD 零軸接近、零軸穿越、軸上／下及任意黃金／死亡交叉，加入 P2→P→D 連續靠近、價格正規化、穿越互斥與軸側邊界測試。
- [x] 3.5 實作條件內量能確認，基準排除 D 並使用完整前期 N 日 `volume_shares`；加入恰等門檻、流動性下限、缺日、零基準與單位測試。
- [x] 3.6 實作技術訊號、量能子條件及外層 `all`／`any` 的三態合併，驗證逐子條件 reason 與守恆不重複計數。

## 4. v7 publisher、repository 與原子發布

- [x] 4.1 擴充選股 row／evidence schema，保存 D／P／P2、bands／indicator、量能基準、實際參數、逐子條件 verdict／reason、formula version 與 hash。
- [x] 4.2 擴充 D1 repository／migration 與 immutable snapshot 讀寫，確保 v1–v6 rows、cursor、cache 與偏好不被 v7 重解釋或覆寫。
- [x] 4.3 將四個訊號接入既有 130-session full-universe publisher，沿用有界 batch、checkpoint、lease 與 deterministic replay，不從 UI／GET／圖表臨時計算。
- [x] 4.4 加入 TWSE／TPEx、through date、universe／normalization／formula version、逐商品 continuity 與守恆 publication gate，任一不一致不得發布 ready v7。
- [x] 4.5 實作 v7 失敗保留 v6 的 rollback／projection 行為，加入 staging 中斷、D1 寫入失敗、mixed-session 與單一市場落後測試。

## 5. API 與結果查詢

- [x] 5.1 擴充 status／results API 的 v7 request／response parser、criteria fingerprint、cursor identity、排序與每頁上限，保持本機限定及唯讀。
- [x] 5.2 實作四個新分支的 pass／fail／unknown 查詢、逐條件計數與 `matched + notMatched + unknown = total` 驗證。
- [x] 5.3 實作新條件啟用但 v7 尚未 ready 的 preparation pending，以及新條件全關閉時的合法 v6 相容投影。
- [x] 5.4 加入 GET／排序／翻頁不觸發 provider、DDL、Shioaji、行情訂閱、清單同步、交易或 runtime lifecycle 的副作用測試。

## 6. 選股 UI 與 evidence

- [x] 6.1 在技術分類加入四個 compact accordion，實作摘要、按需展開、模式相依欄位、驗證訊息與「全部取消」整合。
- [x] 6.2 實作每個條件內的量能確認控制，明示基準不含當日、股／張換算與預設 20 日、1.2 倍、可選 1,000 張流動性下限。
- [x] 6.3 擴充尚未套用、preparation pending、stale／mixed-session、partial 與 unknown 呈現，禁止不可操作 rows 被點選或加入清單。
- [x] 6.4 擴充結果卡短摘要與可展開 evidence，顯示公式、日期、原始判定值、門檻、量能及 unknown reason，不以格式化值重新判定。
- [x] 6.5 驗證點選結果只更新指定未鎖定圖表；篩選與點選不自動加入 Shioaji／MultiView 清單，也不變更交易草稿或其他分頁。
- [x] 6.6 以 600 CSS px 高、最小面板寬度、特大字級及鍵盤完成設定／提交／檢視流程，確認面板內捲動且 workspace 高度不增加。

## 7. 自動測試與回歸

- [x] 7.1 新增 criteria／migration／formula／三態／publisher／repository／API 的 focused unit 與 integration tests，涵蓋所有模式及邊界。
- [x] 7.2 新增 browser tests 與必要 screenshot，覆蓋 compact accordion、非法門檻、量能確認、尚未套用、結果 evidence、窄版面與鍵盤操作。
- [x] 7.3 執行主前端 build／typecheck／test／browser test 與 MultiView 相關回歸，分離並記錄非本 change 的既有失敗。
- [x] 7.4 執行 `openspec validate add-bollinger-rsi-kd-macd-screener-signals --strict` 與 `git diff --check`，修正所有本 change 錯誤。

## 8. 全市場與實際畫面驗收

- [x] 8.1 在實際本機 D1 完成 v7 全市場重算，保存雙市場 target／processed、逐模式 pass／fail／unknown、缺漏、守恆、coverage、日期與 hash 證據。
- [x] 8.2 對每種 BOLL、RSI、KD、MACD 模式保存可重算代表商品；當期零筆時保存完整母體零集合證據，並核對量能 baseline 排除 D。
- [x] 8.3 以不在個人清單且非排行前百名的實際普通股完成 API 全分頁與 UI 點選驗收，核對圖表商品、日期、evidence 與 console。
- [x] 8.4 證明篩選前後自選清單、雙清單同步、TDCC／籌碼佇列、行情連線、simulation runtime、交易草稿與委託計數不變，完成 verification 紀錄後才勾選本 change。
