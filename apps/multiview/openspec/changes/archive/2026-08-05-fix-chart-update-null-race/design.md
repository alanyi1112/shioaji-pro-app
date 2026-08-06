## Context

分類相鄰頁會在背景預載 `/api/candles` 並寫入記憶體快取。使用者切到該頁時，panel 會先重建圖表並同步套用快取，接著在前景 request 回應後，於同一個 chart generation 再次執行 `applyPayload()`。實際以階段代碼重現後確認，錯誤發生在 `refitTimeScalesToCandles()` 對技術副圖呼叫 `setVisibleRange()`：series 重建期間該副圖的 time index 可能短暫為空，Lightweight Charts 的 `_internal_timeToIndex()` 回傳 null，最後由 `ensureNotNull()` 拋出 `Value is null`。Worker log 同時證明 request 成功，因此目前把圖表例外顯示成「更新失敗」會錯誤暗示資料來源故障。

## Goals / Non-Goals

**Goals:**

- 快取首繪與前景更新都只操作目前仍有效的 panel generation、load token 與 chart instance。
- 同一 panel 的 payload 套用不可重入；新回應須在上一輪同步與必要延遲圖表工作安全結束後原子套用。
- 正規化所有送入 Lightweight Charts 的 candle、line 與 histogram 資料；空值不能進入要求數值的 series。
- 新 payload 成功套用後才更新 canonical payload、last payload 與 panel cache；失敗時保留上一份完整可用畫面。
- 測試與瀏覽器驗收必須重現快速切頁及快取後更新，不得只檢查 API status。

**Non-Goals:**

- 不調整 `/api/candles` response schema、行情供應商、D1 schema 或籌碼來源。
- 不隱藏真正的 API 錯誤，也不把無效數值改成 0。
- 不更動圖表外觀、指標預設值或分類商品順序。

## Decisions

1. **初次 refit 一律使用 logical range。** 主圖、技術副圖與籌碼副圖已透過 time-anchor 保持相同資料索引，因此初次 full-range 對齊直接使用 `{ from, to }` logical range，不再要求每個剛重建的副圖先完成 absolute time index。即時行情既有 time-range 同步則在技術副圖改用主圖目前 logical range 作安全 fallback。

2. **將正規化放在任何圖表或快取 mutation 之前。** Candle 必須具備有效 time 與 OHLC；volume 使用非負有限值，指標 series 只保留有效 time 與有限 value，允許 whitespace 的 series 則把空值轉成只有 time 的資料點。整份 candle payload 無有效資料時拒絕套用，不偽造 K 線。

3. **採 prepare／apply／commit 三階段。** `prepare` 產生可繪製 payload；`apply` 對目前 chart 執行 series 與 viewport 更新；`commit` 僅在完整成功後更新 `canonicalPayload` 與快取，失敗時還原 `lastPayload`。若快取與前景 payload 的 render signature 相同，直接提交新 metadata，不重建相同 series。相較於先寫 cache 再畫圖，這可避免失敗 payload 汙染下一次預載，並減少不必要的重複圖表 mutation。

4. **保留可診斷的錯誤階段。** 圖表套用錯誤會帶有不含敏感資料的階段代碼；API request 失敗與 chart apply 失敗使用不同訊息。正式 UI 不顯示函式庫內部的 `Value is null`，但測試與 console 仍保留可追查資訊。

5. **以真實快速切頁作發布門檻。** 驗收至少往返第 1、2 頁多次，等待最後前景更新完成，再檢查最終 symbol、狀態、canvas、可視範圍與 console；另直接載入 `00982A.TW`，覆蓋使用者回報的代表商品。

## Risks / Trade-offs

- [延後前景套用可能增加極短等待] → 只串行化同一 panel 的圖表 mutation，不延後 request，快取仍立即顯示。
- [過度正規化可能隱藏上游資料問題] → 只略過個別無效指標點；無有效 candle 時整份拒絕並顯示明確狀態。
- [apply 中途失敗仍可能留下部分 series mutation] → 快取首繪保持可用，且 apply 前取消延遲工作；必要時以同一份最後成功 payload 重建目前 chart，而不是提交失敗的新 payload。
- [競態只在正式延遲下出現] → 自動 contract 測試搭配 Sites 保留站與 Cloudflare 正式站的實際快速切頁驗收。

## Migration Plan

1. 完成前端修正與 contract 測試，執行 build、完整測試、lint、OpenSpec strict 與 `git diff --check`。
2. 在本機與 Sites 保留站執行快速切頁及代表商品驗收。
3. 使用同一 pushed commit 發布 Sites 保留站與 Cloudflare 正式站，分別確認 deployment target 與受保護健康狀態。
4. 若正式驗收失敗，停止後續發布；程式可回滾至上一個 deployment，資料庫不需回復。

## Open Questions

無。
