## Context

現有 `refresh-latest` 與單檔即時補取只讀 TDCC OpenAPI JSON；本機 LaunchAgent 週六／週日 22:30 執行整條 TDCC pipeline。2026-10-03 上午觀測到 TDCC 官方 CSV 已有 2026-10-02 資料，而 JSON 仍為 2026-09-24。官方說明只有「每週最後營業日營業結束後」的資料基準，沒有保證上架時刻。

## Goals / Non-Goals

**Goals:** 盡早偵測官方新週資料；擇新時驗證來源日期與 17 級距；避免較舊／衝突來源覆寫既有資料；在週末以低頻、有界方式重試並可追查來源。

**Non-Goals:** 不推測固定發布時間、不更動歷史互動查詢政策、不啟動新 broker session、不自動部署 Cloudflare 正式站。

## Decisions

1. 以官方 CSV 作優先候選，現有 OpenAPI JSON 作交叉檢查與備援。兩者都使用 GET、timeout 與回應大小上限。CSV 使用實際欄名轉成現有 `parseTdccSnapshot` 相容 rows；保留 BOM、空格代碼與 CRLF 的處理。若 CSV 可驗且資料日期較新，選 CSV；JSON 較新時選 JSON；同日資料不一致時不發布衝突內容。
2. 完整性先於新鮮度：候選必須只有一個有效資料日期、資料日期不得超過臺北今日、row 數合理、目標商品各有 1–17 級距並通過持股總和檢查。未知／缺少目標商品不得當成零持股。新日期入庫只在整批檢查後執行。
3. 早期探測與昂貴歷史補建分離。週五晚至週六上午有限時槽只做最新來源檢查／更新；來源未變即 noop，不重複跑歷史回補。保留週六／週日原完整 pipeline 作兜底。相同日期、相同內容重入須為冪等。
4. 本機排程由專案 runtime 安裝路徑生成，修改模板後透過安全的單一 LaunchAgent 更新啟用；不重啟 API、watchdog、Web 或 broker。
5. 現有 D1 `transport` CHECK 尚未包含 `official-csv`。為避免今日 live 資料表重建，CSV 在該欄沿用既有 `official-openapi` 相容值，實際來源以 `source_url` 精確保存；讀取摘要時把該 URL 呈現為 `official-csv`。後續如要擴充 enum，另做獨立 migration。

## Risks / Trade-offs

- [官方兩端發布不同步] → 以有效資料日期擇新，記錄 source 與 observed date，沒有新資料不宣稱完成。
- [CSV 格式變更或局部檔案] → 欄位、日期、級距及整批數量檢查；失敗時保留舊資料並轉查 JSON。
- [固定時槽仍可能早於發布] → 週末保留後續重試；實際更新取決於官方供應與電腦開機。
- [多次下載增加流量] → 低頻固定時槽、有 timeout／大小上限、429／403 停止當次；不做密集輪詢。

## Migration Plan

先加入來源擇新和回歸測試，再調整本機排程模板；檢查已安裝 plist 與實際下次觸發後才啟用新時槽。遇到來源格式異常時保持最後已驗證資料，可回退至原 JSON 候選而不刪庫。

## Open Questions

TDCC 未公開保證上架時刻，早期時槽是否足夠須以接下來數週 receipt 觀察調整；觀測到的單週時間不可寫成官方 SLA。
