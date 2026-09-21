# 盤中監控 20 檔試辦人工審閱表

## 基本資料

- Active 上限：`20`
- Evidence bundle hash：
- Cohort receipt manifest hash：
- 完整交易日：
- Reviewer：
- 審閱時間（Asia/Taipei）：
- 決策：`GO / NO-GO / NEEDS-MORE-EVIDENCE`

## 必查證據

- [ ] 至少兩個不同官方交易日，固定 20 檔皆有 09:01–13:30 共 270 個 sealed minute。
- [ ] 兩日皆證明 close authority 不早於 13:34:30，且每檔 `closeMode` 為 `normal_or_revised_13_30` 或 `delayed_13_33`；沒有 13:31 提前 unsubscribe 或補造 13:31–13:33 regular-minute rows。
- [ ] 第一個完整日只作 baseline；第二個適用完整日才執行同分鐘比較。
- [ ] cohort 固定，期間沒有替換、輪替、補位或未記錄的排序／revision 變更。
- [ ] KBar `volume` 累積量與同分鐘 ratio 可由保存 evidence 重算。
- [ ] deterministic replay 的 trigger count、event id 與 hash 一致。
- [ ] incomplete、forming、stale、gap、錯誤日期／單位或零分母觸發數為 0。
- [ ] notification dispatch 與 duplicate notification 均為 0。
- [ ] broker write、production transition、第二個 login 與自動 service lifecycle mutation 均為 0。
- [ ] provider physical usage、release 與 headroom 保持 unknown，沒有被 request／connection count 取代。
- [ ] reconnect 後舊 generation 不再推進 minute／trigger；缺口維持 degraded。
- [ ] CPU、RSS、單日 DB growth、SSE latency 與 K 線新鮮度未超過人工核定預算。
- [ ] chart、watchlist、alert、smart order、MultiView 與 simulation runtime 無新增退化。
- [ ] 失敗 evidence 與 blocker 均保留。

## 抽樣重算

| 交易日 | 商品 | minute | 今日累積量 | 基準累積量 | 門檻 | 重算結果 | event id／hash 一致 |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
|  |  |  |  |  |  |  |  |

## 資源與退化判讀

| 指標 | 核定上限／語意 | 實測 | 審閱判定 | 說明 |
| --- | ---: | ---: | --- | --- |
| active cohort | 固定 20 |  |  |  |
| physical usage／headroom | unknown |  |  | 不得推算 |
| CPU basis points | 人工核定 |  |  |  |
| RSS bytes | 人工核定 |  |  |  |
| 單日 DB growth bytes | 人工核定 |  |  |  |
| SSE latency ms | 人工核定 |  |  |  |
| K 線 freshness ms | 人工核定 |  |  |  |

## 決策與限制

- 是否核准本機 20 檔試辦版：
- 未解風險：
- 必須修正事項：
- rollback／停止條件：
- 簽核備註：

> 自動 validator 通過不是人工 GO。本表不能核准 50、100、160 或 200 檔 active；擴量必須另開 change。
