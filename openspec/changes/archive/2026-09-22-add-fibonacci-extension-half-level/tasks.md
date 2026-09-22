## 1. Root 公式與遷移

- [x] 1.1 將 `src/lib/fibonacci-annotations.ts` 的拓展水準更新為九條，加入最前方 `0.5`，並固定其顏色為 `#60a5fa`，不改動既有拓展水準配色
- [x] 1.2 將 root 公式 fixture 升為 `multichart-ecae7ca-fibonacci-v3`，讓 restore 接受合法 v1、v2、v3 並將 v1／v2 canonical anchors 安全寫回 v3
- [x] 1.3 更新 root domain tests，鎖定九條比例、上漲／下跌／平盤價格、`0.5` 顏色、非有限輸入及 v1／v2 遷移後 kind、anchors、order 不變

## 2. Shioaji K 線呈現

- [x] 2.1 更新 Shioaji K 線完成圖與 pending preview，讓 `0.5` 水準、標籤、自動縮放及八個相鄰色帶使用既有安全邊界與格式化規則
- [x] 2.2 補強 Shioaji renderer／browser tests，驗證九條線、色帶、標籤避讓、單色第二張圖及既有回撤行為沒有回歸

## 3. MultiView 同步

- [x] 3.1 更新 `apps/multiview/public/static/chart-annotations.js` 的拓展水準與顏色映射，維持 localStorage anchors、clear、preview 及 autoscale 契約
- [x] 3.2 更新 MultiView renderer 與樣式 fixture，驗證完成圖及 pending preview 均顯示九條線、八個色帶且既有水準顏色不位移
- [x] 3.3 加入 root／MultiView parity fixture，對相同 A／B／C 比較 ratio 順序、ratioText、percentage、價格與 `0.5` 顏色

## 4. 規格與驗收

- [x] 4.1 同步更新 `apps/multiview/openspec/specs/main-chart-fibonacci-tools/spec.md`，將拓展契約、線數、色帶數及 `0.5` 顏色改為新版要求
- [x] 4.2 執行 root Fibonacci Vitest、相關 CandleChart browser tests、MultiView chart-annotations tests、TypeScript／lint 及 `git diff --check`
- [x] 4.3 以 Shioaji K 線與 MultiView 實際畫出相同三錨點拓展，核對九條線、格式化價格、舊保存圖恢復與回撤無回歸，保存可檢視證據
- [x] 4.4 執行 root 與 nested MultiView OpenSpec strict validation，將指令、結果與仍存在的非本 change 風險寫入 verification 記錄
