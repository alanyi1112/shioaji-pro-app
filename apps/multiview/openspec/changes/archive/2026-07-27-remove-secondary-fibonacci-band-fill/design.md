## Context

目前費波那契 SVG renderer 對每一組相鄰水準都建立 `chart-annotation-fibonacci-band` polygon，再以 `is-monochrome` 將第二張圖改成同一單色。回撤與拓展疊加時，第二張圖雖已無彩色層級，半透明填色仍會覆蓋第一張色帶與 K 棒。既有完成順序、單色角色、保存格式與 autoscale 行為均可沿用。

## Goals / Non-Goals

**Goals:**

- 第二張單色費波那契完成圖不建立區間填色 polygon。
- 第二種圖的 pending preview 同樣不建立區間填色，讓預覽與完成樣式一致。
- 第一張分級彩色圖繼續顯示既有半透明色帶。
- 保留第二張圖的水平線、標籤、錨點與波段虛線。

**Non-Goals:**

- 不變更回撤／拓展水準、錨點吸附、完成順序或本機保存 schema。
- 不調整第一張圖的色票、透明度與線寬。
- 不變更 Worker、API、D1 或 PNG 匯出流程；匯出自然沿用目前 SVG 畫面。

## Decisions

- 在 `renderFibonacciLevels` 以 `monochrome` 作為是否建立 band polygon 的條件，而不是只靠 CSS 設為透明。這可讓第二張圖的 DOM 與匯出內容都不含無用色帶，也避免透明 polygon 造成未來疊色或樣式回歸。
- pending 第二種圖沿用現有 `monochrome` 判定，因此尚未完成時即不建立 band；完成後不會發生色帶突然消失的視覺跳變。
- 保留現有 `is-monochrome` 線條與標籤樣式，避免改動已驗證的單色辨識角色。

## Risks / Trade-offs

- [DOM contract 測試只比對原始碼而漏掉渲染結果] → 補強測試以鎖定 band 建立必須受 `!monochrome` 條件限制，並以本機瀏覽器建立兩種圖確認 polygon 數量。
- [第二張圖少了面積提示後辨識度降低] → 保留單色水平線、標籤、錨點與波段虛線，仍可辨識水準與錨點關係。
