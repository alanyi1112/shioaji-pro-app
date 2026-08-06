## 1. Coverage 與快取狀態

- [x] 1.1 將日籌碼 fetch-state coverage 改為使用成功 rows 的實際首尾 `sessionDate`
- [x] 1.2 讓 partial 當日資料維持可重試，並確保 health／target discovery 不會誤判 ready

## 2. TWSE 三大法人 fallback

- [x] 2.1 實作依 T86 `fields` 名稱解析的 TWSE `institutional-flow` 正規化
- [x] 2.2 在 FinMind 最新資料日落後今天時合併 TWSE 當日 row，並保留正確 provenance 與失敗退讓

## 3. 驗證與發布

- [x] 3.1 新增 coverage 落後、同日重新抓取、T86 正規化及 fallback 合併回歸測試
- [x] 3.2 通過 lint、完整測試、build、OpenSpec strict validation 與 `git diff --check`
- [x] 3.3 發布 private Sites 版本並驗證正式站三大法人已顯示當日資料、health 與 cache 狀態一致

## 4. 中文狀態與更新時程

- [x] 4.1 將使用者可見的 dataset／reason code warnings 改為繁體中文資料名稱與內容說明
- [x] 4.2 為外資及陸資持股、借券成交加入正常發布時段、重查方式與無成交語意，並新增回歸測試
- [x] 4.3 通過完整驗證、發布 private Sites，並確認正式圖表不再顯示內部英文代碼

## 5. 提示位置與關閉控制

- [x] 5.1 將籌碼資料提示 markup 移到所有籌碼副圖群組之後，並加入可存取的關閉按鈕
- [x] 5.2 實作逐 panel、依商品／週期／內容 signature 的關閉生命週期，並新增位置與重新顯示回歸測試
- [x] 5.3 通過完整驗證、發布 private Sites，並確認正式站提示位於副圖尾端且可關閉
