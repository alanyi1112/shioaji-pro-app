## Context

`accelerate-multiview-tdcc-holder-backfill-with-verified-archive` 已完成本機與 Sites 的 verified archive、DB-only warm path、API 與 owner UI 驗收；Cloudflare 正式站則因 D1 免費額度已達限制而依使用者指示延後。這個 change 將延後義務與已完成工作分離，只有在額度與寫入能力實際恢復後才進入 Cloudflare migration、seed、workflow 與驗收。

## Goals / Non-Goals

**Goals:**

- 以 fresh exact deployment SHA 完成 Cloudflare 獨立 migration、verified archive seed、official coverage 與 readback。
- 取得可稽核的 protected health／API、D1 守恆與 Cloudflare Access owner UI 證據。
- 明確保留 `remaining`、`failed`、`overdue`、partial coverage 與資料來源 provenance，不用舊 run 或其他環境結果代替。
- 維持本機 simulation runtime、Sites 資料與交易安全邊界不變。

**Non-Goals:**

- 不在 D1 額度仍受限時嘗試繞過、重複寫入或用假資料完成驗收。
- 不重做已通過的本機或 Sites verified archive bootstrap。
- 不啟用 Shioaji production、真實下單或 CA。
- 不變更 Cloudflare Access 成員、權限或驗證方式，除非使用者另行明確授權。

## Decisions

1. **以額度與寫入能力作為硬 gate**：先唯讀核對限制解除，再取得當時 deployment 與 source SHA。相較沿用舊 SHA，此作法可避免驗收到已被後續部署取代的程式。
2. **每個環境維持獨立 receipts**：Cloudflare 必須自行產生 migration、manifest、validator、archive 與 official coverage 證據；Sites／本機只作規格參考，不可合併計數。
3. **先資料後 UI**：先完成 additive migration、seed、fresh workflow、protected health／API，再進行 Cloudflare Access owner UI。資料 gate 未通過時不宣告 canvas 驗收成功。
4. **DB-only warm path 以 fresh request 驗證**：對新增商品送出 no-cache protected request，必須回 `cache.mode=d1_hit`，且 browser network 不得出現非預期 TDCC／archive／official provider request。
5. **完成與 partial coverage 分列**：18 期 archive receipt 完成不等於 official 51 週完整；兩者各自列出 target、processed、remaining、failed、overdue 與日期範圍。
6. **Cloudflare 免費額度採實際餘額逐批續跑**：依 adaptive-backfill-plan.md，維持每批 10,000 邏輯列估算及 period-atomic finalize，但取消每日固定一期。每批前核對全帳戶用量、索引放大、其他工作預留及來源冷卻；每批後等用量可核對才允許同日串行續跑，禁止並行與重寫已完成資料。

## Risks / Trade-offs

- [Cloudflare 額度再次耗盡] → 每一階段先做 bounded readback，寫入前保存基線；額度不足即停止並保留未勾選狀態。
- [儀表板用量延遲] → 儀表板、D1 Insights 與 workflow 結果三方交叉核對；用量尚未更新時不追加同日 dispatch，並以逐批真實成本與正常服務預留保護額度。
- [部署版本漂移] → workflow 與驗收都核對 exact source SHA、deployment ID 與 protected health 回報，不沿用舊證據。
- [Access 需要人機驗證] → 保留既有登入頁，不讀取 cookie、token 或繞過 passkey；需要時請使用者在原頁完成。
- [Archive 與官方資料衝突] → staging-first、hash／欄位驗證與 insert-only；衝突時保留既有官方資料並 fail closed。
- [驗收影響本機行情 runtime] → 所有 Cloudflare 操作與本機 8080／5173／5174、watchdog、pipeline、行情連線分離，前後只做唯讀 listener／business API 核對。

## Migration Plan

1. 唯讀確認 Cloudflare D1 額度、資料庫狀態、現行 deployment 與 source SHA。
2. 保存 migration、schema、period、row／symbol、容量、continuous 與 integrity 基線。
3. 以 exact release 套用 additive migrations 與 verified manifest seed；失敗時停止，不改寫既有 verified rows。
4. fresh dispatch archive workflow；每批核對實際餘額、receipts 與守恆，餘額允許則同日續補，18/18 後再執行 bounded official history 補缺。
5. 完成 protected health／API、DB-only warm path 與 Cloudflare Access owner UI 驗收。
6. 更新 tasks、verification 與正式 spec evidence；完整測試後再依獨立授權歸檔、commit、push 或部署。

回復策略為停止後續 workflow、保留 additive schema 與既有資料；不得以 destructive rollback 刪除 D1 verified rows。

## Open Questions

- Cloudflare D1 額度恢復日期與恢復後可用寫入量，必須於執行當日重新確認。
- 執行時應採用的 exact deployment SHA，必須以當時正式站實際版本決定，不在本 change 預先固定。
