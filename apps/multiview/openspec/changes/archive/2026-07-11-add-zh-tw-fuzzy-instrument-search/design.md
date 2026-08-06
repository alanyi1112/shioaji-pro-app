## Context

目前 `/api/instrument-search` 依序合併 `stock_setup.md`、TWSE／TPEx 即時查詢及 Yahoo Search，只以小寫後的 `includes()` 判斷相符。正式 Codex Site 已重現以下問題：TPEx runtime 連線失敗時，`元太`沒有候選；輸入 `8069` 只會得到 Yahoo 的英文名稱；`輝達`、`蘋果`、`日經`、`布蘭特原油`等中文名稱無法穩定搜尋。兩段外部查詢共用單一 warning，後發生的錯誤還可能覆蓋前一個錯誤。

既有前端已具備 debounce、候選清單、點選填表及明確按下「儲存商品」才寫入的流程，因此這次應保留互動骨架，集中補強商品目錄、查詢解析、排序與候選資訊。既有 TPEx D1 行情鏡像只保存日期、代號及收盤價，沒有 `CompanyName`，不能直接充當中文商品目錄。

## Goals / Non-Goals

**Goals:**

- 讓使用者能以繁體中文名稱、常見中文別名、英文名稱或商品代號，搜尋上市／上櫃股票與 ETF，以及系統支援的海外商品。
- 候選優先顯示繁體中文主名稱，並保留英文正式名稱、代號、市場、交易所、類型與來源供辨識。
- 在 Workers runtime 無法即時存取 TPEx 時，仍能由 Sites D1 商品目錄搜尋完整上櫃股票與 ETF。
- 建立可預期、可測試的正規化、模糊比對、排序與去重規則，不使用 LLM 在 request-time 猜測商品。
- 保持 `/api/instrument-search` 及商品表單向後相容，並保留使用者最後確認儲存的動作。
- 不依賴 Render、不要求 Massive 方案升級，也不新增需要提交至 repo 的秘密資料。

**Non-Goals:**

- 不建立涵蓋全球所有交易所、所有語言及所有金融商品的完整授權資料庫。
- 不以機器翻譯或 LLM 自動產生未審核的金融商品中文名稱。
- 不改變行情 provider、K 線來源或第二資訊源核對規則。
- 不在點選候選時自動新增或自動儲存商品。
- 不在第一版納入台股權證、興櫃、期貨選擇權完整合約鏈。

## Decisions

### 1. 將「可搜尋商品目錄」與使用者清單、行情鏡像分離

新增共用 D1 `instrument_catalog`，建議欄位包含 `symbol`、`exchange`、`localized_name`、`english_name`、`aliases_json`、`market`、`group_name`、`quote_type`、`source`、`active`、`source_updated_at`，並以 `symbol + exchange` 作為穩定識別。`stock_setup.md` 仍只代表預設／本機商品，不灌入數千筆台股；`tpex_market_mirror` 仍只負責行情核對，不混入商品主檔責任。

Alternative considered：把全部台股寫進 `stock_setup.md`。這會讓預設清單與可搜尋商品全集混在一起，也會增加前端載入與人工維護成本，因此不採用。

### 2. 台股中文名稱以官方主檔同步到 D1，request-time 只作輕量查詢

TWSE／TPEx 官方資料由受控同步流程取得、驗證後 upsert 至 `instrument_catalog`。上市轉成 `.TW`，上櫃轉成 `.TWO`；同步至少檢查有效筆數、代號格式、非空中文名稱、交易所與重複代號。Codex Sites 搜尋優先讀 D1，官方 API 即時查詢只能作補充或維護 fallback，不得因 TPEx 出口限制讓整個台股搜尋失效。

既有 private GitHub Actions TPEx 鏡像流程可擴充為同時發布商品目錄，但 ingest contract 必須獨立驗證中文名稱，且沿用受保護的伺服器端 secret；secret 不得出現在 client、repo、OpenSpec 或紀錄輸出。

Alternative considered：每次搜尋直接呼叫 TWSE／TPEx。正式 Sites runtime 已證實 TPEx 可能連線失敗，而且每次下載完整市場資料成本高，因此不作主要路徑。

### 3. 海外中文名稱使用可審核的本機 seed 與別名資料

新增版本控制的海外商品 seed，至少涵蓋 `stock_setup.md` 已支援的美股、全球指數、期貨、匯率、債券及加密貨幣；每筆可保存繁體中文主名稱、英文正式名稱與多個中文／英文別名。例如 `NVDA` 使用「輝達」為主名稱，別名包含 `NVIDIA`、`英偉達`；`^N225` 使用「日經 225 指數」，別名包含 `日經`、`Nikkei 225`。

Yahoo Search 只負責補充未知代號或英文查詢候選。若本機／D1 目錄有同一 `symbol + exchange`，必須用已審核的繁中名稱 enrich Yahoo 候選；若沒有可信中文名稱，保留英文並標示外部來源，不自動翻譯或假裝已中文化。

Alternative considered：要求 Yahoo 回傳繁中名稱。live capability 檢查顯示海外商品即使指定繁中 locale 仍主要回傳英文，因此不能作為中文名稱的可靠來源。

### 4. 使用分階段評分，不以單一 `includes()` 決定候選

查詢先進行 Unicode 相容正規化、英文 case-fold、全半形統一、空白／常見標點壓縮及 symbol suffix 正規化，再對 `symbol`、`localized_name`、`english_name`、`aliases` 建立可搜尋欄位。排序由高到低為：

1. 完整代號相符。
2. 繁中主名稱或別名完全相符。
3. 代號前綴相符。
4. 繁中主名稱或別名前綴相符。
5. 名稱／別名包含相符。
6. 兩個字以上中文查詢的 bigram／trigram 相似度。
7. 英文 fuzzy 與 Yahoo 外部候選。

同一級再依已收錄商品、官方台股目錄、已審核海外目錄、外部候選及穩定代號排序。去重鍵使用 `symbol + exchange`，不能只用名稱，也不能讓較早的英文名稱壓過同商品的繁中目錄資料。一個中文字不執行寬鬆 fuzzy；前端維持至少兩字才送出名稱搜尋，純代號則可從一碼開始。

Alternative considered：引入大型搜尋服務或 request-time LLM。資料量與流量不需要額外服務，且金融商品選擇必須可重現、可測試，因此先採 Workers 內的 deterministic ranking。

### 5. 擴充候選 contract，同時保持舊前端相容

`/api/instrument-search` 每個候選保留既有 `symbol`、`name`、`provider`、`source`、`market`、`exchange`、`group`、`quoteType`，其中 `name` 使用可用的繁中主名稱；另新增選填的 `localizedName`、`englishName`、`matchedBy` 與 `score`。前端以繁中名稱為主行、英文名稱為次行，再顯示代號、交易所與類型。

點選候選只填入 `symbol`、繁中 `name`、分類與 provider；畫面繼續顯示「已填入，確認後再按儲存商品」，只有按下「儲存商品」才寫入 D1。

### 6. 每個資料來源保留獨立診斷，部分失敗不清空結果

本機 seed、D1 catalog、TWSE、TPEx 與 Yahoo 各自捕捉錯誤，response 以 `warnings[]` 保存來源與安全訊息，並暫時保留彙整後的 `warning` 字串供舊前端使用。任一來源失敗時仍合併其他來源；前端若已有候選，必須同時呈現候選與非阻斷警告，不能因 warning 只顯示失敗狀態。

## Risks / Trade-offs

- [Risk] 海外中文名稱不可能一次涵蓋全球所有商品。→ 以「系統已支援商品完整覆蓋＋可維護別名 seed＋英文外部 fallback」定義邊界，並讓後續新增資料不必改搜尋程式。
- [Risk] 中文模糊比對可能把相似公司排得太前。→ exact／prefix 優先，fuzzy 設最低分數；候選固定顯示 symbol、exchange 與英文名稱，且不自動儲存。
- [Risk] 官方資料格式或欄位變更導致目錄同步失敗。→ ingest 嚴格驗證、transactional upsert、保留上一版可用目錄並回報同步狀態。
- [Risk] D1 全表掃描造成搜尋延遲。→ 儲存正規化欄位、限制候選集合與結果數；先量測全台股規模，若需要再加入索引或前綴欄位，不先引入額外服務。
- [Risk] 舊個人清單已保存英文名稱。→ 搜尋候選優先使用 catalog enrich；不強制覆寫既有資料，只有使用者選取並儲存後才更新該商品名稱。
- [Risk] private GitHub Actions 或 Sites ingest 暫時失敗。→ D1 保留上一版目錄；台股搜尋可繼續使用舊目錄並回傳資料時間／warning，不回退到 Render。

## Migration Plan

1. 建立 D1 `instrument_catalog` 與必要索引，不刪除或改寫既有 `user_instruments`、`tpex_market_mirror`。
2. 匯入海外繁中 seed，確認既有預設商品都有繁中名稱或明確保留的標準名稱。
3. 擴充受控同步流程，先在非正式 ingest 驗證 TWSE／TPEx 筆數、名稱與代號，再 upsert 正式 D1 目錄。
4. 部署向後相容的搜尋 API 與前端候選顯示，保留舊 `warning` 欄位。
5. 在正式 Codex Site 驗收台股中文、海外中文、代號、模糊輸入、部分來源失敗與選取後確認儲存。
6. 回滾時可退回舊搜尋 handler；新增資料表不影響既有使用者清單，暫不刪除以便重新部署。

## Open Questions

- 第一版海外 seed 以目前 `stock_setup.md` 全部商品及已知常用別名為完成門檻；後續是否擴充更多交易所，另以目錄資料更新或新 change 管理。
