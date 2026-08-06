## Context

多層副圖是全域呈現模式，但台灣市場指數（例如 `^TWII`）不建立籌碼 pane，因此同一個四圖 grid 可能同時包含方式 B panel 與回退至方式 A 技術副圖的 panel。只要任一 panel 使用方式 B，grid 會套用 `is-mode-b-page-scroll`；目前該版型把 panel 的副圖 row 設為 `auto`，而方式 A 的 `.indicator-wrap` 又依賴 `height: 100%`，造成沒有內容高度基準時技術圖表 canvas 被壓成 0 高。

## Goals / Non-Goals

**Goals:**

- 讓 page-scroll grid 中回退至方式 A 的技術副圖維持與多層副圖相同的緊湊技術圖高度。
- 未選取技術指標時仍完全收合副圖，不引入空白高度。
- 以靜態回歸測試鎖定 selector、固定高度及 `has-technical-subchart` 條件。

**Non-Goals:**

- 不改變台灣市場指數的籌碼資格或資料 request lifecycle。
- 不改變方式 A／B 的選取保存、時間軸同步或技術指標算法。
- 不調整 6／8 圖與窄螢幕既有規則。

## Decisions

1. 在 `.chart-grid.is-mode-b-page-scroll` 作用域內，僅對 `.subchart-slot.is-mode-a-technical.has-technical-subchart` 指定 `height` 與 `min-height` 為 `var(--mode-b-technical-height)`。這沿用既有 104px 緊湊高度，不新增第二套尺寸常數。
2. selector 必須包含 `has-technical-subchart`，讓沒有勾選 RSI／KD／MACD／ATR 時仍由既有規則收合，不會產生空白副圖。
3. 不修改 JavaScript effective mode 或 panel eligibility；問題是 CSS layout context，不應藉由偽造方式 B controller 解決。

替代方案是將 grid 的 page-scroll 狀態改為逐 panel 套用，但會牽動 document 捲動、cohort 高度與 responsive selector，風險高於聚焦 CSS 修補。

## Risks / Trade-offs

- [Risk] 方式 A 技術副圖在 page-scroll grid 中使用 104px，而一般固定視窗模式高度由 grid fraction 決定 → 僅在混合多層副圖長頁面套用，並沿用既有方式 B 技術圖可讀高度。
- [Risk] CSS selector 優先序不足導致 `height: 100%` 繼續生效 → 使用更具體的 page-scroll selector，並以回歸測試檢查完整 declaration。

## Migration Plan

1. 加入 CSS 規則與回歸測試。
2. 執行完整測試、lint、OpenSpec strict 驗證與 `git diff --check`。
3. 依序重新部署 Sites 保留站與 Cloudflare 正式站，使用四圖混合頁籤捲動後驗收技術指標畫布高度與時間軸對齊。
4. 若線上驗收失敗，回滾本次小型 CSS commit；不涉及資料 migration。

## Open Questions

無。
